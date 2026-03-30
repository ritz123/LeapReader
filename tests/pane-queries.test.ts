import { describe, it, expect, beforeEach } from "vitest";
import { session } from "../src/reader/session";
import { anyPaneHasDoc, bothPanesEmpty } from "../src/reader/pane-queries";
import { emptyPanePdfState } from "../src/reader/pane-model";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** Minimal stub that satisfies the PDFDocumentProxy shape used by the queries. */
const fakePdf = { numPages: 5 } as unknown as PDFDocumentProxy;

beforeEach(() => {
  // Reset both panes to empty before every test.
  session.paneState.left = emptyPanePdfState();
  session.paneState.right = emptyPanePdfState();
});

describe("bothPanesEmpty", () => {
  it("is true when both panes have no doc and no HTML", () => {
    expect(bothPanesEmpty()).toBe(true);
  });

  it("is false when the left pane has a PDF doc", () => {
    session.paneState.left.doc = fakePdf;
    expect(bothPanesEmpty()).toBe(false);
  });

  it("is false when the right pane has a PDF doc", () => {
    session.paneState.right.doc = fakePdf;
    expect(bothPanesEmpty()).toBe(false);
  });

  it("is false when the left pane has rendered HTML (Word/text doc)", () => {
    session.paneState.left.docHtml = "<p>Hello</p>";
    expect(bothPanesEmpty()).toBe(false);
  });

  it("is false when the right pane has rendered HTML", () => {
    session.paneState.right.docHtml = "<pre>plain text</pre>";
    expect(bothPanesEmpty()).toBe(false);
  });

  it("is false when both panes have content", () => {
    session.paneState.left.doc = fakePdf;
    session.paneState.right.docHtml = "<p>Word doc</p>";
    expect(bothPanesEmpty()).toBe(false);
  });
});

describe("anyPaneHasDoc", () => {
  it("is false when both panes are empty", () => {
    expect(anyPaneHasDoc()).toBe(false);
  });

  it("is true when only left pane has a PDF", () => {
    session.paneState.left.doc = fakePdf;
    expect(anyPaneHasDoc()).toBe(true);
  });

  it("is true when only right pane has a PDF", () => {
    session.paneState.right.doc = fakePdf;
    expect(anyPaneHasDoc()).toBe(true);
  });

  it("is true when only left pane has HTML content", () => {
    session.paneState.left.docHtml = "<p>text doc</p>";
    expect(anyPaneHasDoc()).toBe(true);
  });

  it("is true when only right pane has HTML content", () => {
    session.paneState.right.docHtml = "<pre>code</pre>";
    expect(anyPaneHasDoc()).toBe(true);
  });

  it("is true when both panes have content", () => {
    session.paneState.left.doc = fakePdf;
    session.paneState.right.doc = fakePdf;
    expect(anyPaneHasDoc()).toBe(true);
  });

  it("is true when one pane has PDF and the other has HTML", () => {
    session.paneState.left.doc = fakePdf;
    session.paneState.right.docHtml = "<p>word</p>";
    expect(anyPaneHasDoc()).toBe(true);
  });
});
