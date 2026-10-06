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
    new Setting(this.contentEl).setName(t("companyTemplate.registerName")).addText((text) => {
      text.setValue(this.name).onChange((value) => {
        this.name = value;
      });
    });
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
    this.errorEl = this.contentEl.createEl("p", { cls: "mod-warning" });
    const actions = this.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const confirm = actions.createEl("button", { text: t("common.confirm") });
    confirm.classList.add("mod-cta");
    confirm.onclick = () => {
      const name = this.name.trim();
      if (!name) {
        this.errorEl?.setText(t("companyTemplate.registerEmptyName"));
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
