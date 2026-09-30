import { type App, Modal, Notice, Setting, type TextComponent } from "obsidian";
import {
  defaultDocumentStyleProfile,
  normalizeDocumentStyleProfile,
  type DocumentStyleProfile,
  type DocumentStyleRole,
  type CharacterStyleProfile,
  type ParagraphStyleProfile,
  type RoleStyleProfile
} from "../io/documentStyle";
import { errorMessage } from "../utils/errors";
import { t, tKey, type MessageKey } from "../i18n";

const HU_PER_MM = 283.4646;
const ROLE_LABELS: Array<[DocumentStyleRole, MessageKey]> = [
  ["body", "docStyle.role.body"],
  ["h1", "docStyle.role.h1"],
  ["h2", "docStyle.role.h2"],
  ["h3", "docStyle.role.h3"],
  ["h4", "docStyle.role.h4"],
  ["h5", "docStyle.role.h5"],
  ["h6", "docStyle.role.h6"]
];

function cloneProfile(profile: DocumentStyleProfile): DocumentStyleProfile {
  return structuredClone(profile);
}

function mergedProfile(current?: DocumentStyleProfile): DocumentStyleProfile {
  const defaults = defaultDocumentStyleProfile();
  if (!current) return cloneProfile(defaults);
  const merged = cloneProfile(current);
  for (const [role] of ROLE_LABELS) {
    if (!merged.roles[role]) merged.roles[role] = cloneProfile(defaults).roles[role];
  }
  if (!merged.page) merged.page = cloneProfile(defaults).page;
  return merged;
}

function numericInput(
  component: TextComponent,
  value: number | undefined,
  min: number,
  max: number,
  step: number,
  update: (value: number) => void
): void {
  component.inputEl.type = "number";
  component.inputEl.min = String(min);
  component.inputEl.max = String(max);
  component.inputEl.step = String(step);
  component.setValue(String(value ?? ""));
  component.onChange((raw: string) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) update(parsed);
  });
}

function millimeters(hu: number | undefined): number {
  return Math.round(((hu ?? 0) / HU_PER_MM) * 10) / 10;
}

function hwpUnits(mm: number): number {
  return Math.round(mm * HU_PER_MM);
}

function points(hu: number | undefined): number {
  return Math.round(((hu ?? 0) / 100) * 10) / 10;
}

function hwpPoints(pt: number): number {
  return Math.round(pt * 100);
}

export class DocumentStyleModal extends Modal {
  private readonly draft: DocumentStyleProfile;
  private openRole: DocumentStyleRole = "body";

  constructor(
    app: App,
    current: DocumentStyleProfile | undefined,
    private readonly onSaveProfile: (profile: DocumentStyleProfile) => Promise<void>
  ) {
    super(app);
    this.draft = mergedProfile(current);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("hanmark-resizable-workspace-modal");
    contentEl.empty();
    contentEl.addClass("hanmark-document-style-modal");
    contentEl.createEl("h2", { text: t("docStyle.modal.title") });
    contentEl.createEl("p", {
      text: t("docStyle.modal.desc")
    });

    new Setting(contentEl)
      .setName(t("docStyle.modal.styleName.name"))
      .setDesc(t("docStyle.modal.styleName.desc"))
      .addText((text) => text.setValue(this.draft.name).onChange((value) => (this.draft.name = value)));

    for (const [role, label] of ROLE_LABELS) this.renderRole(contentEl, role, tKey(label));
    this.renderPage(contentEl);

    const actions = contentEl.createDiv({ cls: "hanmark-style-modal-actions" });
    actions.setCssStyles({ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" });
    const cancel = actions.createEl("button", { text: t("common.cancel") });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: t("docStyle.modal.saveAndApply") });
    save.classList.add("mod-cta");
    save.onclick = async () => {
      save.disabled = true;
      try {
        const normalized = normalizeDocumentStyleProfile(this.draft);
        await this.onSaveProfile(normalized);
        this.close();
      } catch (error: unknown) {
        new Notice(t("docStyle.modal.saveFailed", { detail: errorMessage(error) }));
        save.disabled = false;
      }
    };
  }

  private role(
    role: DocumentStyleRole
  ): RoleStyleProfile & { character: CharacterStyleProfile; paragraph: ParagraphStyleProfile } {
    const value = this.draft.roles[role] ?? {};
    value.character ??= {};
    value.paragraph ??= {};
    this.draft.roles[role] = value;
    return {
      ...value,
      character: value.character,
      paragraph: value.paragraph
    };
  }

  private renderRole(root: HTMLElement, role: DocumentStyleRole, label: string): void {
    const value = this.role(role);
    const card = root.createDiv({ cls: "hanmark-document-style-role" });
    card.classList.toggle("is-open", this.openRole === role);
    const heading = card.createEl("button", { cls: "hanmark-document-style-role-toggle" });
    heading.createSpan({ text: label });
    heading.createSpan({ text: this.openRole === role ? "▾" : "▸", cls: "hanmark-document-style-role-chevron" });
    heading.onclick = () => {
      this.openRole = role;
      this.onOpen();
    };
    if (this.openRole !== role) return;

    new Setting(card)
      .setName(t("docStyle.modal.hangulFont.name"))
      .setDesc(t("docStyle.modal.hangulFont.desc"))
      .addText((text) =>
        text
          .setPlaceholder("함초롬바탕") // i18n-data: font family name
          .setValue(value.character.fontFamily || "")
          .onChange((font) => {
            value.character.fontFamily = font;
          })
      );

    new Setting(card)
      .setName(t("docStyle.modal.latinFont.name"))
      .setDesc(t("docStyle.modal.latinFont.desc", { example: "Times New Roman, Arial" }))
      .addText((text) =>
        text
          .setPlaceholder(value.character.fontFamily || "Times New Roman")
          .setValue(value.character.latinFontFamily || "")
          .onChange((font) => {
            value.character.latinFontFamily = font;
          })
      );

    new Setting(card)
      .setName(t("docStyle.modal.sizeWeight.name"))
      .addText((text) =>
        numericInput(text, value.character.fontSizePt, 4, 100, 0.5, (size) => {
          value.character.fontSizePt = size;
        })
      )
      .addToggle((toggle) =>
        toggle
          .setTooltip(t("docStyle.modal.bold"))
          .setValue(value.character.bold ?? role !== "body")
          .onChange((bold) => {
            value.character.bold = bold;
          })
      )
      .addToggle((toggle) =>
        toggle
          .setTooltip(t("docStyle.modal.underline"))
          .setValue(value.character.underline ?? false)
          .onChange((underline) => {
            value.character.underline = underline;
          })
      )
      .addColorPicker((picker) =>
        picker.setValue(value.character.color || "#000000").onChange((selected) => {
          value.character.color = selected;
        })
      );

    new Setting(card)
      .setName(t("docStyle.modal.alignSpacing.name"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("JUSTIFY", t("docStyle.modal.align.justify"))
          .addOption("LEFT", t("docStyle.modal.align.left"))
          .addOption("CENTER", t("docStyle.modal.align.center"))
          .addOption("RIGHT", t("docStyle.modal.align.right"))
          .addOption("DISTRIBUTE", t("docStyle.modal.align.distribute"))
          .setValue(value.paragraph.alignment || "JUSTIFY")
          .onChange((alignment) => {
            if (
              alignment === "JUSTIFY" ||
              alignment === "LEFT" ||
              alignment === "CENTER" ||
              alignment === "RIGHT" ||
              alignment === "DISTRIBUTE" ||
              alignment === "DISTRIBUTE_SPACE"
            ) {
              value.paragraph.alignment = alignment;
            }
          })
      )
      .addText((text) =>
        numericInput(text, value.paragraph.lineSpacingPercent, 70, 400, 5, (spacing) => {
          value.paragraph.lineSpacingPercent = spacing;
        })
      );

    new Setting(card)
      .setName(t("docStyle.modal.widthSpacing.name"))
      .setDesc(t("docStyle.modal.widthSpacing.desc"))
      .addText((text) =>
        numericInput(text, value.character.widthPercent, 50, 200, 1, (width) => {
          value.character.widthPercent = width;
        })
      )
      .addText((text) =>
        numericInput(text, value.character.letterSpacingPercent, -50, 50, 1, (spacing) => {
          value.character.letterSpacingPercent = spacing;
        })
      );

    new Setting(card)
      .setName(t("docStyle.modal.indent.name"))
      .setDesc(t("docStyle.modal.indent.desc"))
      .addText((text) =>
        numericInput(text, points(value.paragraph.firstLineIndentHu), -200, 500, 0.5, (pt) => {
          value.paragraph.firstLineIndentHu = hwpPoints(pt);
        })
      )
      .addText((text) =>
        numericInput(text, points(value.paragraph.marginLeftHu), 0, 500, 0.5, (pt) => {
          value.paragraph.marginLeftHu = hwpPoints(pt);
        })
      )
      .addText((text) =>
        numericInput(text, points(value.paragraph.marginRightHu), 0, 500, 0.5, (pt) => {
          value.paragraph.marginRightHu = hwpPoints(pt);
        })
      );

    new Setting(card)
      .setName(t("docStyle.modal.paragraphSpacing.name"))
      .setDesc(t("docStyle.modal.paragraphSpacing.desc"))
      .addText((text) =>
        numericInput(text, points(value.paragraph.spaceBeforeHu), 0, 200, 0.5, (pt) => {
          value.paragraph.spaceBeforeHu = hwpPoints(pt);
        })
      )
      .addText((text) =>
        numericInput(text, points(value.paragraph.spaceAfterHu), 0, 200, 0.5, (pt) => {
          value.paragraph.spaceAfterHu = hwpPoints(pt);
        })
      );

    new Setting(card)
      .setName(t("docStyle.modal.keepWithNext.name"))
      .setDesc(t("docStyle.modal.keepWithNext.desc"))
      .addToggle((toggle) =>
        toggle.setValue(value.paragraph.keepWithNext ?? role !== "body").onChange((enabled) => {
          value.paragraph.keepWithNext = enabled;
        })
      );
  }

  private renderPage(root: HTMLElement): void {
    const page = this.draft.page;
    if (!page) return;
    const card = root.createDiv({ cls: "hanmark-document-style-page" });
    card.createEl("h3", { text: t("docStyle.modal.pageMargins") });
    const fields: Array<["top" | "bottom" | "left" | "right", MessageKey]> = [
      ["top", "docStyle.modal.marginTop"],
      ["bottom", "docStyle.modal.marginBottom"],
      ["left", "docStyle.modal.marginLeft"],
      ["right", "docStyle.modal.marginRight"]
    ];
    for (const [key, label] of fields) {
      new Setting(card)
        .setName(tKey(label))
        .setDesc("mm")
        .addText((text) =>
          numericInput(text, millimeters(page.margins[key]), 0, 100, 0.5, (mm) => {
            page.margins[key] = hwpUnits(mm);
          })
        );
    }
  }

  onClose(): void {
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.contentEl.empty();
  }
}
