import { describe, it, expect } from "vitest";
import { acquirePdfDoc } from "../src/reader/pdf-doc-pool";

describe("pdf-doc-pool", () => {
  it("rejects empty key before parsing", async () => {
    await expect(acquirePdfDoc("", new ArrayBuffer(8))).rejects.toThrow(/key/i);
  });

  it("requires bytes for unknown keys", async () => {
    await expect(acquirePdfDoc("unknown-doc-id")).rejects.toThrow(/ArrayBuffer/i);
  });
});
