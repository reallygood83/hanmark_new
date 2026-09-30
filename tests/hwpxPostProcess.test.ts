import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { markdownToHwpx, parse, validateHwpx } from "kordoc";
import {
  addFootnoteAutoNumbers,
  finalizeHwpxPackage,
  HWPX_FIXED_ENTRY_DATE,
  repeatTableHeaderRows
} from "../src/io/hwpxPostProcess";
import { generateValidatedHwpx } from "../src/io/kordocEngine";

async function section(data: ArrayBuffer): Promise<string> {
  const archive = await JSZip.loadAsync(data);
  const entry = archive.file("Contents/section0.xml");
  assert.ok(entry);
  return entry.async("text");
}

describe("HWPX post-processing", () => {
  it("adds the leading footnote number control the upstream fix emits, once", async () => {
    const xml = await section(await markdownToHwpx("가[^a] 나[^b]\n\n[^a]: 첫째\n[^b]: 둘째\n"));
    const first = addFootnoteAutoNumbers(xml);
    assert.equal(first.added, 2);
    const notes = [...first.xml.matchAll(/<hp:footNote\s[^>]*>[\s\S]*?<\/hp:footNote>/g)].map((m) => m[0]);
    notes.forEach((note, index) => {
      const head = /<hp:subList [^>]*><hp:p [^>]*><hp:run [^>]*><hp:ctrl><hp:autoNum num="(\d+)" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" [^>]*suffixChar="\)"[^>]*\/><\/hp:autoNum><\/hp:ctrl><hp:t> <\/hp:t>/.exec(note);
      assert.ok(head, `footnote ${index + 1} starts with an autoNum control`);
      assert.equal(head[1], String(index + 1));
    });
    assert.equal(addFootnoteAutoNumbers(first.xml).added, 0, "second pass is a no-op");
  });

  it("makes Kordoc read the note numbers back like a Hancom-saved file", async () => {
    const generated = await generateValidatedHwpx("가[^a] 나[^b]\n\n[^a]: 첫째\n[^b]: 둘째\n");
    const reparsed = await parse(generated.data);
    assert.equal(reparsed.success, true);
    if (reparsed.success) assert.ok(reparsed.markdown.includes("(주: 1) 첫째; 2) 둘째)"), reparsed.markdown);
  });

  it("repeats a marked header row and leaves header-less tables alone", () => {
    const withHeader =
      '<hp:tbl id="1" pageBreak="CELL" repeatHeader="0" rowCnt="2"><hp:tr><hp:tc name="" header="1"></hp:tc></hp:tr><hp:tr><hp:tc name="" header="0"></hp:tc></hp:tr></hp:tbl>';
    const withoutHeader =
      '<hp:tbl id="2" pageBreak="CELL" repeatHeader="0" rowCnt="1"><hp:tr><hp:tc name="" header="0"></hp:tc></hp:tr></hp:tbl>';
    const result = repeatTableHeaderRows(withHeader + withoutHeader);
    assert.equal(result.changed, 1);
    assert.match(result.xml, /<hp:tbl id="1"[^>]*repeatHeader="1"/);
    assert.match(result.xml, /<hp:tbl id="2"[^>]*repeatHeader="0"/);
  });

  it("repeats the header row of generated long tables", async () => {
    const rows = Array.from({ length: 40 }, (_, index) => `| ${index + 1} | 값 ${index + 1} |`).join("\n");
    const generated = await generateValidatedHwpx(`| 번호 | 내용 |\n| --- | --- |\n${rows}\n`);
    assert.match(await section(generated.data), /<hp:tbl\b[^>]*repeatHeader="1"/);
  });

  it("produces identical bytes for identical input with a stored mimetype first", async () => {
    const markdown = "# 결정성\n\n본문[^1]\n\n| 가 | 나 |\n| --- | --- |\n| 1 | 2 |\n\n[^1]: 각주\n";
    const first = await generateValidatedHwpx(markdown);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await generateValidatedHwpx(markdown);
    assert.deepEqual(Buffer.from(first.data), Buffer.from(second.data));

    const archive = await JSZip.loadAsync(first.data);
    const names: string[] = [];
    archive.forEach((name) => names.push(name));
    assert.equal(names[0], "mimetype");
    const bytes = new Uint8Array(first.data);
    assert.equal(new TextDecoder().decode(bytes.slice(30, 38)), "mimetype");
    assert.equal(bytes[8] | (bytes[9] << 8), 0, "mimetype must be stored, not deflated");
    archive.forEach((_name, entry) => {
      assert.equal(entry.date.getTime(), HWPX_FIXED_ENTRY_DATE.getTime());
    });
    assert.equal((await validateHwpx(first.data)).ok, true);
  });

  it("rejects a package without a mimetype entry", async () => {
    const zip = new JSZip();
    zip.file("Contents/section0.xml", "<x/>");
    await assert.rejects(
      finalizeHwpxPackage(await zip.generateAsync({ type: "arraybuffer" })),
      /mimetype/
    );
  });
});
