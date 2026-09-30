import { type App, Modal, Setting } from "obsidian";
import { t } from "../i18n";

/**
 * Electron does not implement the browser prompt and confirm dialogs, so every question to the
 * user goes through these Obsidian modals. Each resolves exactly once: the entered
 * value (or true) on confirmation, null (or false) when cancelled or closed.
 */
export interface PromptTextOptions {
  title: string;
  label: string;
  value?: string;
  placeholder?: string;
  /** Accept an empty answer (for optional prefixes). Defaults to false. */
  allowEmpty?: boolean;
  confirmText?: string;
  cancelText?: string;
}

class PromptTextModal extends Modal {
  private value: string;
  private settled = false;

  constructor(
    app: App,
    private readonly options: PromptTextOptions,
    private readonly resolve: (value: string | null) => void
  ) {
    super(app);
    this.value = options.value ?? "";
  }

  onOpen(): void {
    this.titleEl.setText(this.options.title);
    new Setting(this.contentEl).setName(this.options.label).addText((text) => {
      text.setValue(this.value).onChange((value) => (this.value = value));
      if (this.options.placeholder) text.setPlaceholder(this.options.placeholder);
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          this.submit();
        }
      });
      window.setTimeout(() => {
        text.inputEl.focus();
        text.inputEl.select();
      });
    });
    const actions = this.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    actions.createEl("button", { text: this.options.cancelText ?? t("common.cancel") }).onclick = () => this.close();
    const confirm = actions.createEl("button", { text: this.options.confirmText ?? t("common.confirm") });
    confirm.classList.add("mod-cta");
    confirm.onclick = () => this.submit();
  }

  private submit(): void {
    if (!this.options.allowEmpty && !this.value.trim()) return;
    this.settle(this.value);
    this.close();
  }

  private settle(value: string | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
  }

  onClose(): void {
    this.settle(null);
    this.contentEl.empty();
  }
}

export function promptText(app: App, options: PromptTextOptions): Promise<string | null> {
  return new Promise((resolve) => new PromptTextModal(app, options, resolve).open());
}

export interface PromptSecretOptions {
  title: string;
  label: string;
  description?: string;
  /** Shown above the field, e.g. after a wrong password. */
  error?: string;
  confirmText?: string;
}

/**
 * Asks for a password. The value lives only in the returned promise: it is never
 * stored, logged, or written back into the input after the dialog closes.
 */
class PromptSecretModal extends Modal {
  private settled = false;
  private input: HTMLInputElement | null = null;

  constructor(
    app: App,
    private readonly options: PromptSecretOptions,
    private readonly resolve: (value: string | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.options.title);
    if (this.options.description) this.contentEl.createEl("p", { text: this.options.description });
    if (this.options.error) {
      this.contentEl.createEl("p", { cls: "hanmark-dialog-error", text: this.options.error });
    }
    const label = this.contentEl.createEl("label", { cls: "hanmark-dialog-secret", text: this.options.label });
    const input = label.createEl("input", {
      attr: { type: "password", autocomplete: "off", spellcheck: "false" }
    });
    this.input = input;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        this.submit();
      }
    });
    const actions = this.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const confirm = actions.createEl("button", { text: this.options.confirmText ?? t("common.confirm") });
    confirm.classList.add("mod-cta");
    confirm.onclick = () => this.submit();
    window.setTimeout(() => input.focus());
  }

  private submit(): void {
    const value = this.input?.value ?? "";
    if (!value) return;
    this.settle(value);
    this.close();
  }

  private settle(value: string | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
  }

  onClose(): void {
    if (this.input) this.input.value = "";
    this.input = null;
    this.settle(null);
    this.contentEl.empty();
  }
}

export function promptSecret(app: App, options: PromptSecretOptions): Promise<string | null> {
  return new Promise((resolve) => new PromptSecretModal(app, options, resolve).open());
}

export interface ConfirmActionOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm button as destructive. */
  warning?: boolean;
}

class ConfirmActionModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly options: ConfirmActionOptions,
    private readonly resolve: (value: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.options.title);
    this.contentEl.createEl("p", { text: this.options.message });
    const actions = this.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    actions.createEl("button", { text: this.options.cancelText ?? t("common.cancel") }).onclick = () => this.close();
    const confirm = actions.createEl("button", { text: this.options.confirmText ?? t("common.confirm") });
    confirm.classList.add(this.options.warning ? "mod-warning" : "mod-cta");
    confirm.onclick = () => {
      this.settle(true);
      this.close();
    };
    window.setTimeout(() => confirm.focus());
  }

  private settle(value: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
  }

  onClose(): void {
    this.settle(false);
    this.contentEl.empty();
  }
}

export function confirmAction(app: App, options: ConfirmActionOptions): Promise<boolean> {
  return new Promise((resolve) => new ConfirmActionModal(app, options, resolve).open());
}
