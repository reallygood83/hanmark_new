import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { extractDocumentStyleProfile, type DocumentStyleProfile } from "../src/io/documentStyle";
import {
  absentKeys,
  approvalNames,
  companyExportDecision,
  detachDeletedTemplateNotes,
  gongmunDraftFromDocumentStyle,
  normalizeCompanyTemplateRecord,
  renameCompanyTemplateNotes,
  suggestGongmunPreset,
  withoutCompanyTemplateFlags,
  type CompanyTemplateRecord
} from "../src/io/companyTemplate";
import { getTemplateLibrary, normalizeTemplateLibrary, putCompanyTemplate } from "../src/io/templateLibrary";
import { normalizeHanmarkSettings } from "../src/legacy-port/settings";

function profile(overrides: Partial<DocumentStyleProfile> = {}): DocumentStyleProfile {
  return {
    schemaVersion: 3,
    name: "sample",
    roles: {
      body: {
        character: { fontFamily: "휴먼명조", fontSizePt: 11 },
        paragraph: { alignment: "justify", lineSpacingPercent: 160 }
      },
      h1: { character: { fontFamily: "맑은 고딕", fontSizePt: 16, bold: true } }
    },
    page: {
      widthHu: 59528,
      heightHu: 84188,
      margins: { top: 5669, bottom: 4252, left: 5669, right: 5669 }
    },
    ...overrides
  };
}

function record(overrides: Partial<CompanyTemplateRecord> = {}): CompanyTemplateRecord {
  return {
    id: "company:11111111-1111-4111-8111-111111111111",
    name: "기관",
    notePath: "기관 템플릿.md",
    documentStyleId: "custom:style",
    gongmunTemplateId: "gongmun:form",
    registered: true,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
    ...overrides
  };
}

describe("company template mapping", () => {
  it("fills body font, size, spacing, heading font, and margins, and leaves type and approval empty", () => {
    const draft = gongmunDraftFromDocumentStyle(profile());
    assert.equal(draft.bodyFont, "myeongjo");
    assert.equal(draft.bodyPt, 11);
    assert.equal(draft.lineSpacing, 160);
    assert.equal(draft.fonts?.body, "휴먼명조");
    assert.equal(draft.fonts?.heading, "맑은 고딕");
    assert.deepEqual(draft.margins, { top: 20, bottom: 15, left: 20, right: 20 });
    assert.equal(draft.org, undefined);
    assert.equal(draft.approval, undefined);
    assert.equal("preset" in draft, false);
  });

  it("treats a gothic face as gothic even when the name also contains a myeongjo fragment", () => {
    const draft = gongmunDraftFromDocumentStyle(profile({
      roles: { body: { character: { fontFamily: "바탕고딕", fontSizePt: 10 } } }
    }));
    assert.equal(draft.bodyFont, "gothic");
  });

  it("omits a size, a spacing, or a margin set that the official-document form cannot store", () => {
    const draft = gongmunDraftFromDocumentStyle(profile({
      roles: {
        body: {
          character: { fontFamily: "휴먼명조", fontSizePt: 7 },
          paragraph: { lineSpacingPercent: 90 }
        }
      },
      page: {
        widthHu: 59528,
        heightHu: 84188,
        margins: { top: 567, bottom: 5669, left: 5669, right: 5669 }
      }
    }));
    assert.equal(draft.bodyPt, undefined);
    assert.equal(draft.lineSpacing, undefined);
    assert.equal(draft.margins, undefined);
  });

  it("reads the same fields from an HWPX header", async () => {
    const zip = new JSZip();
    zip.file("Contents/header.xml", `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:fontfaces>
      <hh:fontface lang="HANGUL"><hh:font id="0" face="휴먼명조"/></hh:fontface>
      <hh:fontface lang="LATIN"><hh:font id="0" face="Times New Roman"/></hh:fontface>
    </hh:fontfaces>
    <hh:charProperties>
      <hh:charPr id="0" height="1100"><hh:fontRef hangul="0" latin="0"/></hh:charPr>
      <hh:charPr id="1" height="1600"><hh:fontRef hangul="1" latin="0"/></hh:charPr>
    </hh:charProperties>
    <hh:paraProperties>
      <hh:paraPr id="0"><hh:align horizontal="JUSTIFY"/><hh:lineSpacing type="PERCENT" value="160"/></hh:paraPr>
    </hh:paraProperties>
    <hh:styles>
      <hh:style id="0" name="바탕글" engName="Normal" charPrIDRef="0" paraPrIDRef="0"/>
      <hh:style id="1" name="제목 1" engName="Heading 1" charPrIDRef="1" paraPrIDRef="0"/>
    </hh:styles>
  </hh:refList>
</hh:head>`);
    zip.file("mimetype", "");
    zip.file("Contents/section0.xml", `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
  <hp:p xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
    <hp:pagePr width="59528" height="84188"><hp:margin top="5669" bottom="5669" left="5669" right="5669"/></hp:pagePr>
  </hp:p>
</hs:sec>`);
    // Heading 1 points at font id 1, which this header does not define, so the body face is the one that must survive.
    zip.file("Contents/header.xml", (await zip.file("Contents/header.xml")!.async("string")).replace(
      'face="휴먼명조"',
      'face="휴먼명조"'
    ));
    const extracted = await extractDocumentStyleProfile(await zip.generateAsync({ type: "uint8array" }), "sample.hwpx");
    const draft = gongmunDraftFromDocumentStyle(extracted);
    assert.equal(draft.fonts?.body, "휴먼명조");
    assert.equal(draft.bodyFont, "myeongjo");
    assert.equal(draft.bodyPt, 11);
    assert.equal(draft.lineSpacing, 160);
    assert.deepEqual(draft.margins, { top: 20, bottom: 20, left: 20, right: 20 });
  });

  it("suggests a type from the file name and still defaults to a report", () => {
    assert.equal(suggestGongmunPreset("2026 업무보고서"), "ministry");
    assert.equal(suggestGongmunPreset("주간 보고서"), "report");
    assert.equal(suggestGongmunPreset("제1차 회의록"), "minutes");
    assert.equal(suggestGongmunPreset("notice"), "report");
  });

  it("keeps at most eight approval names", () => {
    assert.deepEqual(approvalNames(" 담당, 팀장，실장 "), ["담당", "팀장", "실장"]);
    assert.equal(approvalNames("1,2,3,4,5,6,7,8,9").length, 8);
  });
});

describe("company template notes", () => {
  it("copies the body and official-document properties without the template flags", () => {
    const source = "---\nhanmark-template-draft: true\nhanmark-company-template: true\n공문_수신: 총무과\n---\n본문\n";
    const copy = withoutCompanyTemplateFlags(source);
    assert.equal(copy.includes("hanmark-"), false);
    assert.match(copy, /공문_수신: 총무과/u);
    assert.match(copy, /본문/u);
  });

  it("lists only properties the note does not already have", () => {
    assert.deepEqual(absentKeys({ 공문_수신: "총무과" }, ["공문_수신", "공문_기관"]), ["공문_기관"]);
  });

  it("follows a renamed template note and clears a deleted one", () => {
    const records = { [record().id]: record() };
    const renamed = renameCompanyTemplateNotes(records, "기관 템플릿.md", "서식/기관 템플릿.md");
    assert.equal(renamed[record().id].notePath, "서식/기관 템플릿.md");
    const detached = detachDeletedTemplateNotes(renamed, "서식");
    assert.equal(detached[record().id].notePath, "");
    assert.equal(detached[record().id].registered, true);
  });
});

describe("company template settings", () => {
  it("reads settings v12 as v13 with empty company-template maps", () => {
    const settings = normalizeHanmarkSettings({ settingsVersion: 12, htmlExportTheme: "classic" });
    assert.equal(settings.settingsVersion, 13);
    assert.equal(settings.htmlExportTheme, "classic");
    assert.deepEqual(settings.companyTemplateByNote, {});
    const library = normalizeTemplateLibrary({
      schemaVersion: 2,
      activeId: "builtin:korean-communication",
      activeGongmunId: "builtin:hallym-aicr",
      activeGongmunPreset: "notice"
    });
    assert.equal(library.activeId, "builtin:korean-communication");
    assert.equal(library.activeGongmunId, "builtin:hallym-aicr");
    assert.equal(library.activeGongmunPreset, "notice");
    assert.deepEqual(library.companyTemplates, {});
    assert.deepEqual(normalizeHanmarkSettings(settings), settings);
  });

  it("stores a company template without switching the global active template", () => {
    const settings = normalizeHanmarkSettings({});
    const host = { settings, saveSettings: async () => undefined };
    const before = getTemplateLibrary(host);
    const activeId = before.activeId;
    const activeGongmunId = before.activeGongmunId;
    putCompanyTemplate(host, record({ registered: false }));
    const after = getTemplateLibrary(host);
    assert.equal(after.activeId, activeId);
    assert.equal(after.activeGongmunId, activeGongmunId);
    assert.equal(after.companyTemplates[record().id].registered, false);
  });

  it("uses the linked template for a registered note and the global template otherwise", () => {
    assert.equal(companyExportDecision(undefined), "global");
    assert.equal(companyExportDecision(record({ registered: false })), "global");
    assert.equal(companyExportDecision(record({ notePath: "" })), "abort");
    assert.deepEqual(companyExportDecision(record()), {
      documentStyleId: "custom:style",
      gongmunTemplateId: "gongmun:form"
    });
  });

  it("drops a record that has no name", () => {
    assert.equal(normalizeCompanyTemplateRecord({ id: record().id, name: "  " }), undefined);
  });
});
