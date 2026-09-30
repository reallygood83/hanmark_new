import tsparser from "@typescript-eslint/parser";
import json from "@eslint/json";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

// Product, format, and language names that keep their casing in English UI text
// (src/i18n/en.ts). Options replace the plugin defaults, so the defaults are spread in.
const HANMARK_BRANDS = [
  "HanMark",
  "Kordoc",
  "Pandoc",
  "Hancom",
  "Hancom Office",
  "Hangul",
  "Korean",
  "English",
  "Word",
  "Microsoft Word",
  "CMDS Eagle",
  "Cloudflare",
  "Achmage",
  "Achmage Editorial",
  "HanMark Editorial",
  "Classic",
  "Naver",
  "Naver Nanum",
  "Pretendard",
  "Noto Sans KR",
  "Noto Serif KR",
  "Adobe",
  "Source Han Sans",
  "Source Han Serif",
  "HCR Batang",
  "Malgun Gothic",
  // Proper name of a built-in HWPX template (the academic society whose style it follows)
  "Korean Society for Journalism and Communication Studies",
  // Hallym University built-in institution styles and their typefaces
  "Hallym University",
  "Ilsong College of Liberal Arts",
  "AI Convergence Research Institute",
  "Hallym Gothic",
  "Human Myeongjo"
];
const HANMARK_ACRONYMS = [
  "BMP",
  "HWP",
  "HWPX",
  "HWPML",
  "HML",
  "DOCX",
  "XLSX",
  "XLS",
  "PPTX",
  "DRM",
  "OLE",
  "OCR",
  "R2",
  "CMDS",
  "WCAG",
  "A4",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "PC",
  "ZIP",
  "DT",
  "MCP",
  "AICR"
];

export default defineConfig([
  {
    ignores: [
      "main.js",
      "legacy-main.cjs",
      "node_modules/**",
      "release/**",
      "src/io/embeddedAssets.ts"
    ]
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Keep the same type-safety checks used by the Community review scanner
      // as release-blocking errors.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      // UI text lives in src/i18n; the Korean table is not English prose, and the
      // English table is checked by the locale-module rule below.
      "obsidianmd/ui/sentence-case": "off"
    }
  },
  {
    files: ["src/i18n/en.ts"],
    rules: {
      "obsidianmd/ui/sentence-case-locale-module": [
        "error",
        {
          brands: [...DEFAULT_BRANDS, ...HANMARK_BRANDS],
          acronyms: [...DEFAULT_ACRONYMS, ...HANMARK_ACRONYMS]
        }
      ]
    }
  },
  {
    files: ["manifest.json"],
    language: "json/json",
    plugins: { json, obsidianmd },
    rules: {
      "no-irregular-whitespace": "off",
      "obsidianmd/validate-manifest": "error"
    }
  }
]);
