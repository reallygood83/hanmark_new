import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { assembleNote, type AssemblyHost } from "../src/io/noteAssembly";
import { assemblyWarnings, prepareExportMarkdown } from "../src/io/exportPreparation";
import { adaptMarkdownForKordoc } from "../src/io/markdownAdapter";
import { setUiLocale } from "../src/i18n";

/** In-memory Vault: shortest-name resolution like Obsidian, exact paths first. */
function vault(files: Record<string, string>, extras: Record<string, string> = {}): AssemblyHost {
  const all = { ...files, ...extras };
  const paths = Object.keys(all);
  return {
    resolve(linkpath) {
      const wanted = linkpath.replace(/^\.\//u, "");
      const exact = paths.find((path) => path === wanted || path === `${wanted}.md`);
      const byName = paths.find((path) => {
        const name = path.split("/").pop() ?? path;
        return name === wanted || name === `${wanted}.md`;
      });
      const found = exact ?? byName;
      if (!found) return null;
      return { path: found, extension: found.split(".").pop()?.toLowerCase() ?? "" };
    },
    async read(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`not a note: ${path}`);
      return text;
    }
  };
}

const ko = { locale: "ko" as const };

describe("note assembly (2.7.0 W6)", () => {
  afterEach(() => setUiLocale("ko"));

  it("inlines a whole note without its frontmatter, as its own block", async () => {
    const host = vault({ "Child.md": "---\ntags: [x]\n---\n# 하위 제목\n하위 본문\n" });
    const result = await assembleNote(host, "앞 문단\n![[Child]]\n뒤 문단", "Root.md", ko);
    assert.equal(result.markdown, "앞 문단\n\n# 하위 제목\n하위 본문\n\n뒤 문단");
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.embedded, ["Child.md"]);
  });

  it("takes a heading section up to the next heading of the same or higher level", async () => {
    const host = vault({ "Child.md": "# 하나\n1\n## 하나-가\n1a\n# 둘\n2\n" });
    const section = await assembleNote(host, "![[Child#하나]]", "Root.md", ko);
    assert.equal(section.markdown.trim(), "# 하나\n1\n## 하나-가\n1a");
    const nested = await assembleNote(host, "![[Child#하나#하나-가]]", "Root.md", ko);
    assert.equal(nested.markdown.trim(), "## 하나-가\n1a");
  });

  it("takes a block by id: paragraph, standalone marker, and list item", async () => {
    const host = vault({
      "Child.md": [
        "첫 줄",
        "둘째 줄 ^para",
        "",
        "| 가 | 나 |",
        "|---|---|",
        "| 1 | 2 |",
        "^table",
        "",
        "- 항목 하나 ^item",
        "- 항목 둘"
      ].join("\n")
    });
    assert.equal((await assembleNote(host, "![[Child#^para]]", "R.md", ko)).markdown.trim(), "첫 줄\n둘째 줄");
    assert.equal(
      (await assembleNote(host, "![[Child#^table]]", "R.md", ko)).markdown.trim(),
      "| 가 | 나 |\n|---|---|\n| 1 | 2 |"
    );
    assert.equal((await assembleNote(host, "![[Child#^item]]", "R.md", ko)).markdown.trim(), "- 항목 하나");
  });

  it("assembles nested embeds and resolves them from the embedding note", async () => {
    const host = vault({
      "A.md": "A 본문\n![[B]]",
      "sub/B.md": "B 본문\n![[C]]",
      "sub/C.md": "C 본문"
    });
    const result = await assembleNote(host, "![[A]]", "Root.md", ko);
    assert.match(result.markdown, /A 본문[\s\S]*B 본문[\s\S]*C 본문/u);
    assert.deepEqual(result.embedded, ["A.md", "sub/B.md", "sub/C.md"]);
  });

  it("stops cycles, missing notes, missing sections, and deep chains with visible placeholders", async () => {
    const host = vault({
      "A.md": "A\n![[B]]",
      "B.md": "B\n![[A]]",
      "Child.md": "# 제목\n본문",
      ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`N${index}.md`, `N${index}\n![[N${index + 1}]]`]))
    });
    const cycle = await assembleNote(host, "![[A]]", "Root.md", ko);
    assert.match(cycle.markdown, /\[순환 임베드 생략: A\]/u);
    assert.deepEqual(cycle.issues.map((issue) => issue.code), ["cycle"]);

    const missing = await assembleNote(host, "![[없는 노트]]\n![[Child#없는 제목]]", "Root.md", ko);
    assert.match(missing.markdown, /\[임베드할 노트 없음: 없는 노트\]/u);
    assert.match(missing.markdown, /\[임베드할 제목·블록 없음: Child#없는 제목\]/u);
    assert.deepEqual(missing.issues.map((issue) => issue.code), ["missing", "section"]);

    const deep = await assembleNote(host, "![[N0]]", "Root.md", { locale: "ko", maxDepth: 3 });
    assert.match(deep.markdown, /\[임베드 깊이 한도: N3\]/u);
    assert.deepEqual(deep.issues.map((issue) => issue.code), ["depth"]);
  });

  it("writes placeholders in the document language", async () => {
    const host = vault({});
    const result = await assembleNote(host, "![[Missing]]", "Root.md", { locale: "en" });
    assert.equal(result.markdown.trim(), "[Missing embedded note: Missing]");
  });

  it("rewrites image references of embedded notes to Vault paths", async () => {
    const host = vault(
      { "notes/sub/Child.md": "![그림](img/p.png)\n![[q.png|300]]\n![원격](https://example.com/r.png)" },
      { "notes/sub/img/p.png": "", "attachments/q.png": "" }
    );
    const result = await assembleNote(host, "![[Child]]", "Root.md", ko);
    assert.match(result.markdown, /!\[그림\]\(<notes\/sub\/img\/p\.png>\)/u);
    assert.match(result.markdown, /!\[\[attachments\/q\.png\|300\]\]/u);
    assert.match(result.markdown, /!\[원격\]\(https:\/\/example\.com\/r\.png\)/u);
  });

  it("leaves code, inline code, and non-note embeds untouched", async () => {
    const host = vault({ "Child.md": "본문" }, { "pic.png": "", "doc.pdf": "" });
    const source = "```\n![[Child]]\n```\n`![[Child]]` 설명\n![[pic.png]]\n![[doc.pdf]]";
    const result = await assembleNote(host, source, "Root.md", ko);
    assert.equal(result.markdown, source);
    assert.deepEqual(result.issues, []);
  });

  it("keeps the quote or callout prefix on every inlined line", async () => {
    const host = vault({ "Child.md": "첫째\n\n둘째" });
    const result = await assembleNote(host, "> [!note] 참고\n> ![[Child]]", "Root.md", ko);
    assert.equal(result.markdown, "> [!note] 참고\n>\n> 첫째\n>\n> 둘째\n>");
  });

  it("splits text around an inline embed and drops a bare list marker", async () => {
    const host = vault({ "Child.md": "내용" });
    const inline = await assembleNote(host, "앞 ![[Child]] 뒤", "Root.md", ko);
    assert.equal(inline.markdown, "앞\n\n내용\n\n뒤");
    const listed = await assembleNote(host, "- ![[Child]]", "Root.md", ko);
    assert.equal(listed.markdown.trim(), "내용");
  });
});

describe("export preparation", () => {
  afterEach(() => setUiLocale("ko"));

  it("returns the body unchanged when assembly is off", async () => {
    const host = vault({ "Child.md": "내용" });
    const prepared = await prepareExportMarkdown(host, "![[Child]]", "Root.md", {
      assembleEmbeds: false,
      outputLanguage: "auto"
    });
    assert.deepEqual(prepared, { markdown: "![[Child]]", warnings: [] });
  });

  it("groups assembly issues into adapter-style warnings", async () => {
    const warnings = assemblyWarnings([
      { code: "missing", target: "가", source: "R.md" },
      { code: "missing", target: "나", source: "R.md" },
      { code: "missing", target: "가", source: "S.md" },
      { code: "cycle", target: "다", source: "R.md" }
    ]);
    assert.deepEqual(warnings.map((warning) => [warning.code, warning.count]), [["embed-missing", 3], ["embed-cycle", 1]]);
    assert.match(warnings[0].message, /가, 나/u);
  });

  it("distinguishes embedded files from embedded notes in the adapter", () => {
    const file = adaptMarkdownForKordoc("본문\n![[자료.pdf]]\n");
    assert.deepEqual(file.warnings.map((warning) => warning.code), ["file-embed-flattened"]);
    const note = adaptMarkdownForKordoc("본문\n![[하위 노트]]\n");
    assert.deepEqual(note.warnings.map((warning) => warning.code), ["note-embed-flattened"]);
  });
});
