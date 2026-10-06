import { type App, Modal, Setting } from "obsidian";
import { GONGMUN_PRESETS } from "../io/gongmunExport";
import type { CompanyTemplateRecord } from "../io/companyTemplate";
import { t, tKey } from "../i18n";
import type { GongmunPreset } from "kordoc";

export interface CompanyTemplateRegistration {
  name: string;
  preset: GongmunPreset;
  org: string;
  approval: string;
}

export interface CompanyTemplateStartChoice {
  id: string;
  name: string;
  detail: string;
}

export class CompanyTemplateStartModal extends Modal {
  constructor(
    app: App,
    private readonly choices: readonly CompanyTemplateStartChoice[],
    private readonly draftName: string | undefined,
    private readonly actions: {
      importHwpx: () => void;
      registerDraft: () => void;
      newDocument: (id: string) => void;
    }
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t("companyTemplate.startTitle"));
    this.contentEl.addClass("hanmark-company-start");
    this.contentEl.createEl("p", { text: t("companyTemplate.startDesc"), cls: "setting-item-description" });

    if (this.draftName) {
      const draft = this.contentEl.createDiv({ cls: "hanmark-company-start-draft" });
      draft.createEl("strong", { text: t("companyTemplate.draftReady", { name: this.draftName }) });
      draft.createEl("p", { text: t("companyTemplate.draftHint"), cls: "setting-item-description" });
      const register = draft.createEl("button", { text: t("command.registerCompanyTemplate"), cls: "mod-cta" });
      register.onclick = () => {
        this.close();
        this.actions.registerDraft();
      };
    }

    const importButton = this.contentEl.createEl("button", {
      cls: "hanmark-company-start-import",
      attr: { type: "button" }
    });
    importButton.createEl("strong", { text: t("companyTemplate.startImport") });
    importButton.createEl("small", { text: t("companyTemplate.startImportDesc") });
    importButton.onclick = () => {
      this.close();
      this.actions.importHwpx();
    };

    this.contentEl.createEl("h3", { text: t("companyTemplate.startExisting") });
    if (!this.choices.length) {
      this.contentEl.createEl("p", { text: t("companyTemplate.none"), cls: "setting-item-description" });
      return;
    }
    const list = this.contentEl.createDiv({ cls: "hanmark-company-start-list" });
    for (const choice of this.choices) {
      const button = list.createEl("button", { attr: { type: "button" } });
      button.createEl("strong", { text: choice.name });
      button.createEl("small", { text: choice.detail });
      button.onclick = () => {
        this.close();
        this.actions.newDocument(choice.id);
      };
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Name, document type, organization, and approval line. Cancel resolves to null. */
export function promptCompanyTemplateRegistration(
  app: App,
  initial: CompanyTemplateRegistration
): Promise<CompanyTemplateRegistration | null> {
  return new Promise((resolve) => {
    new RegistrationModal(app, initial, resolve).open();
  });
}

class RegistrationModal extends Modal {
  private name: string;
  private preset: GongmunPreset;
  private org: string;
  private approval: string;
  private settled = false;
  private errorEl: HTMLElement | null = null;
  private nameInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    initial: CompanyTemplateRegistration,
    private readonly resolve: (value: CompanyTemplateRegistration | null) => void
  ) {
    super(app);
    this.name = initial.name;
    this.preset = initial.preset;
    this.org = initial.org;
    this.approval = initial.approval;
  }

  onOpen(): void {
    this.titleEl.setText(t("companyTemplate.registerTitle"));
    this.contentEl.createEl("p", { text: t("companyTemplate.registerDesc"), cls: "setting-item-description" });
    const nameSetting = new Setting(this.contentEl).setName(t("companyTemplate.registerName")).addText((text) => {
      this.nameInput = text.inputEl;
      text.setValue(this.name).onChange((value) => {
        this.name = value;
        this.nameInput?.removeAttribute("aria-invalid");
        this.errorEl?.setText("");
      });
    });
    nameSetting.settingEl.addClass("hanmark-company-name-setting");
    this.errorEl = nameSetting.settingEl.createEl("p", {
      cls: "hanmark-company-field-error mod-warning",
      attr: { id: "hanmark-company-name-error", role: "alert" }
    });
    this.nameInput?.setAttribute("aria-describedby", "hanmark-company-name-error");
    new Setting(this.contentEl).setName(t("companyTemplate.registerPreset")).addDropdown((dropdown) => {
      for (const preset of GONGMUN_PRESETS) dropdown.addOption(preset.value, tKey(preset.label));
      dropdown.setValue(this.preset).onChange((value) => {
        this.preset = value as GongmunPreset;
      });
    });
    new Setting(this.contentEl).setName(t("companyTemplate.registerOrg")).addText((text) => {
      text.setValue(this.org).onChange((value) => {
        this.org = value;
      });
    });
    new Setting(this.contentEl)
      .setName(t("companyTemplate.registerApproval"))
      .setDesc(t("companyTemplate.registerApprovalHint"))
      .addText((text) => {
        text.setValue(this.approval).onChange((value) => {
          this.approval = value;
        });
      });
    const actions = this.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const confirm = actions.createEl("button", { text: t("common.confirm") });
    confirm.classList.add("mod-cta");
    confirm.onclick = () => {
      const name = this.name.trim();
      if (!name) {
        this.errorEl?.setText(t("companyTemplate.registerEmptyName"));
        this.nameInput?.setAttribute("aria-invalid", "true");
        this.nameInput?.focus();
        return;
      }
      this.settle({ name, preset: this.preset, org: this.org.trim(), approval: this.approval });
    };
  }

  onClose(): void {
    this.settle(null);
    this.contentEl.empty();
  }

  private settle(value: CompanyTemplateRegistration | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
    this.close();
  }
}

/** Picks one registered template. A single choice is returned without a dialog. */
export function promptCompanyTemplateChoice(
  app: App,
  records: readonly CompanyTemplateRecord[]
): Promise<CompanyTemplateRecord | null> {
  if (records.length === 1) return Promise.resolve(records[0]);
  return new Promise((resolve) => {
    new ChoiceModal(app, records, resolve).open();
  });
}

class ChoiceModal extends Modal {
  private selected: string;
  private settled = false;

  constructor(
    app: App,
    private readonly records: readonly CompanyTemplateRecord[],
    private readonly resolve: (value: CompanyTemplateRecord | null) => void
  ) {
    super(app);
    this.selected = records[0]?.id ?? "";
  }

  onOpen(): void {
    this.titleEl.setText(t("companyTemplate.pickTitle"));
    new Setting(this.contentEl).setName(t("companyTemplate.section")).addDropdown((dropdown) => {
      for (const record of this.records) dropdown.addOption(record.id, record.name);
      dropdown.setValue(this.selected).onChange((value) => {
        this.selected = value;
      });
    });
    const actions = this.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const confirm = actions.createEl("button", { text: t("common.confirm") });
    confirm.classList.add("mod-cta");
    confirm.onclick = () => {
      this.settle(this.records.find((record) => record.id === this.selected) ?? null);
    };
  }

  onClose(): void {
    this.settle(null);
    this.contentEl.empty();
  }

  private settle(value: CompanyTemplateRecord | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
    this.close();
  }
}
