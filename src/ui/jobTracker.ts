/**
 * Counts HanMark jobs the user started (exports and imports) so the toolbar's bottom
 * edge can flow while one runs and flash once when the last one finishes (R-028).
 * Preview renders are not jobs: they run on their own and must not draw attention.
 */
export interface JobState {
  active: boolean;
  /** Set once, when the last job ends: whether it succeeded. */
  finished?: boolean;
}

export type JobListener = (state: JobState) => void;

export class JobTracker {
  private count = 0;
  private readonly listeners = new Set<JobListener>();

  get active(): boolean {
    return this.count > 0;
  }

  /** Starts a job; the returned function ends it (calling it again does nothing). */
  begin(): (succeeded?: boolean) => void {
    this.count += 1;
    if (this.count === 1) this.emit({ active: true });
    let ended = false;
    return (succeeded = true) => {
      if (ended) return;
      ended = true;
      this.count = Math.max(0, this.count - 1);
      if (this.count === 0) this.emit({ active: false, finished: succeeded });
    };
  }

  /** Runs `work` as a job; a thrown error or a null/false/cancelled result counts as not succeeded. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    const end = this.begin();
    let succeeded = false;
    try {
      const result = await work();
      succeeded = isSuccess(result);
      return result;
    } finally {
      end(succeeded);
    }
  }

  subscribe(listener: JobListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(state: JobState): void {
    for (const listener of this.listeners) listener(state);
  }
}

function isSuccess(result: unknown): boolean {
  if (result === null || result === false || result === undefined) return false;
  if (typeof result === "object" && "status" in result) {
    const status = (result as { status?: unknown }).status;
    return status !== "cancelled";
  }
  return true;
}
