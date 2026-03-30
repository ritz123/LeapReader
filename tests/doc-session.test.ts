import { describe, it, expect } from "vitest";
import { docTypeFromName } from "../src/reader/doc-session";

describe("docTypeFromName", () => {
  // ── Known PDF extension ───────────────────────────────────────────────────
  it("returns null for .pdf files (PDF is handled separately)", () => {
    expect(docTypeFromName("report.pdf")).toBeNull();
    expect(docTypeFromName("REPORT.PDF")).toBeNull(); // case-insensitive
  });

  // ── Word formats ──────────────────────────────────────────────────────────
  it("returns 'docx' for .docx files", () => {
    expect(docTypeFromName("paper.docx")).toBe("docx");
    expect(docTypeFromName("Paper.DOCX")).toBe("docx");
  });

  it("returns 'doc' for legacy .doc files", () => {
    expect(docTypeFromName("old.doc")).toBe("doc");
    expect(docTypeFromName("OLD.DOC")).toBe("doc");
  });

  // ── Plain text ────────────────────────────────────────────────────────────
  it("returns 'txt' for .txt files", () => {
    expect(docTypeFromName("notes.txt")).toBe("txt");
    expect(docTypeFromName("NOTES.TXT")).toBe("txt");
  });

  // ── Unknown/missing extensions treated as plain text ─────────────────────
  it("returns 'txt' for files with no extension", () => {
    expect(docTypeFromName("README")).toBe("txt");
    expect(docTypeFromName("Makefile")).toBe("txt");
  });

  it("returns 'txt' for unknown extensions (.log, .md, .csv, …)", () => {
    expect(docTypeFromName("server.log")).toBe("txt");
    expect(docTypeFromName("readme.md")).toBe("txt");
    expect(docTypeFromName("data.csv")).toBe("txt");
    expect(docTypeFromName("code.ts")).toBe("txt");
  });

  it("handles filenames with multiple dots correctly", () => {
    // Extension is the part after the LAST dot
    expect(docTypeFromName("my.report.pdf")).toBeNull();
    expect(docTypeFromName("my.report.docx")).toBe("docx");
    expect(docTypeFromName("archive.tar.gz")).toBe("txt"); // .gz → unknown → txt
  });

  it("handles filenames that are just a dot-prefixed name (hidden files)", () => {
    // ".gitignore" → split(".") gives ["", "gitignore"] → ext = "gitignore" → txt
    expect(docTypeFromName(".gitignore")).toBe("txt");
    expect(docTypeFromName(".env")).toBe("txt");
  });
});
