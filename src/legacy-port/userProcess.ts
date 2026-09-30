import { spawn } from "node:child_process";
import {
  clearTimeout as clearNodeTimeout,
  setTimeout as setNodeTimeout
} from "node:timers";
import { t } from "../i18n";

const USER_INITIATED = Symbol("hanmark-user-initiated-process");

export type UserActionSource = "command" | "toolbar" | "modal";

export interface UserInitiatedAction {
  readonly source: UserActionSource;
  readonly createdAt: number;
  readonly [USER_INITIATED]: true;
}

export interface ProcessRequest {
  executable: string;
  args: readonly string[];
  timeoutMs?: number;
  maxBufferBytes?: number;
  /**
   * Keeps converter console windows hidden by default. GUI launchers can opt
   * out when the requested result is the visible application window itself.
   */
  windowsHide?: boolean;
  /**
   * `exit` captures output and waits for a process result. `spawn` completes
   * once the operating system has accepted a GUI launcher request.
   */
  completionMode?: "exit" | "spawn";
  /**
   * Exit codes that mean the requested operation was handed off successfully.
   * Most processes use the default `[0]`; launcher-style platform utilities
   * may document additional non-error completion codes.
   */
  successExitCodes?: readonly number[];
}

export interface ProcessResult {
  stdout: Uint8Array;
  stderr: string;
}

export type UserProcessRunner = (
  request: ProcessRequest,
  action: UserInitiatedAction
) => Promise<ProcessResult>;

export function createUserInitiatedAction(source: UserActionSource): UserInitiatedAction {
  return Object.freeze({
    source,
    createdAt: Date.now(),
    [USER_INITIATED]: true as const
  });
}

export function assertUserInitiatedAction(action: UserInitiatedAction): void {
  if (!action || action[USER_INITIATED] !== true) {
    throw new Error(t("process.notUserAction"));
  }
}

function cleanExecutable(value: string): string {
  const executable = value.trim();
  if (!executable || executable.includes("\u0000")) {
    throw new Error(t("process.invalidPath"));
  }
  return executable;
}

function appendChunk(chunks: Buffer[], chunk: Buffer, total: number, limit: number): number {
  const nextTotal = total + chunk.byteLength;
  if (nextTotal > limit) throw new Error(t("process.outputTooLarge"));
  chunks.push(chunk);
  return nextTotal;
}

function toError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error(t("process.unknownFailure"));
}

/**
 * Start failures in plain language. A missing program (ENOENT) is the common case,
 * for example Pandoc not installed or a wrong executable path in settings.
 */
function startError(error: Error, executable: string): Error {
  const code = (error as { code?: unknown }).code;
  const program = executable.split(/[\\/]/u).pop() || executable;
  const message =
    code === "ENOENT"
      ? t("process.notFound", { program })
      : code === "EACCES" || code === "EPERM"
        ? t("process.notAllowed", { program })
        : null;
  // Keep the system error code for callers that branch on it.
  return message === null ? error : Object.assign(new Error(message), { code });
}

function checkedSuccessExitCodes(values: readonly number[] | undefined): Set<number> {
  const codes = values ?? [0];
  if (
    codes.length === 0 ||
    codes.some((code) => !Number.isInteger(code) || code < 0 || code > 255)
  ) {
    throw new Error(t("process.invalidExitCodes"));
  }
  return new Set(codes);
}

/**
 * The single intentional shell-process boundary in HanMark.
 *
 * `spawn` receives an executable and an argument array with `shell: false`; no
 * command string is evaluated. Callers must provide a fresh UI action token.
 */
export const runUserProcess: UserProcessRunner = async (request, action) => {
  assertUserInitiatedAction(action);
  const executable = cleanExecutable(request.executable);
  const completionMode = request.completionMode ?? "exit";
  const windowsHide = request.windowsHide ?? true;

  if (completionMode === "spawn") {
    return new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(executable, [...request.args], {
        windowsHide,
        shell: false,
        stdio: "ignore"
      });
      let settled = false;

      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        reject(startError(error, executable));
      });
      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve({
          stdout: new Uint8Array(),
          stderr: ""
        });
      });
    });
  }

  const timeoutMs = request.timeoutMs ?? 60_000;
  const maxBufferBytes = request.maxBufferBytes ?? 20 * 1024 * 1024;
  const successExitCodes = checkedSuccessExitCodes(request.successExitCodes);

  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(executable, [...request.args], {
      windowsHide,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearNodeTimeout(timer);
      callback();
    };

    const timer = setNodeTimeout(() => {
      child.kill();
      finish(() => reject(new Error(t("process.timedOut", { seconds: Math.round(timeoutMs / 1000) }))));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      try {
        stdoutBytes = appendChunk(stdout, chunk, stdoutBytes, maxBufferBytes);
      } catch (error) {
        child.kill();
        finish(() => reject(toError(error)));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      try {
        stderrBytes = appendChunk(stderr, chunk, stderrBytes, maxBufferBytes);
      } catch (error) {
        child.kill();
        finish(() => reject(toError(error)));
      }
    });
    child.on("error", (error) => finish(() => reject(startError(error, executable))));
    child.on("close", (code, signal) => {
      finish(() => {
        const stderrText = Buffer.concat(stderr).toString("utf8").trim();
        if (signal) {
          reject(new Error(t("process.killed", { signal })));
          return;
        }
        if (code === null || !successExitCodes.has(code)) {
          reject(new Error(stderrText || t("process.exitCode", { code: code ?? "?" })));
          return;
        }
        const output = Buffer.concat(stdout);
        resolve({
          stdout: new Uint8Array(output.buffer, output.byteOffset, output.byteLength),
          stderr: stderrText
        });
      });
    });
  });
};
