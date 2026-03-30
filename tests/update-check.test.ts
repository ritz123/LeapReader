import { describe, it, expect } from "vitest";
import { isNewer } from "../src/reader/update-check";

describe("isNewer — semantic version comparison", () => {
  // ── Remote is strictly newer ──────────────────────────────────────────────
  it("detects a newer major version", () => {
    expect(isNewer("1.3.2", "2.0.0")).toBe(true);
    expect(isNewer("1.3.2", "v2.0.0")).toBe(true); // v-prefix
  });

  it("detects a newer minor version", () => {
    expect(isNewer("1.3.2", "1.4.0")).toBe(true);
    expect(isNewer("1.3.2", "v1.4.0")).toBe(true);
  });

  it("detects a newer patch version", () => {
    expect(isNewer("1.3.2", "1.3.3")).toBe(true);
    expect(isNewer("1.3.2", "v1.3.3")).toBe(true);
  });

  // ── Same version ──────────────────────────────────────────────────────────
  it("returns false when versions are identical", () => {
    expect(isNewer("1.3.2", "1.3.2")).toBe(false);
    expect(isNewer("1.3.2", "v1.3.2")).toBe(false);
  });

  // ── Local is newer ────────────────────────────────────────────────────────
  it("returns false when local major > remote major", () => {
    expect(isNewer("2.0.0", "1.9.9")).toBe(false);
  });

  it("returns false when local minor > remote minor (same major)", () => {
    expect(isNewer("1.4.0", "1.3.9")).toBe(false);
  });

  it("returns false when local patch > remote patch (same major.minor)", () => {
    expect(isNewer("1.3.9", "1.3.2")).toBe(false);
  });

  // ── v-prefix handling ─────────────────────────────────────────────────────
  it("strips 'v' prefix from both sides without error", () => {
    expect(isNewer("v1.3.2", "v1.4.0")).toBe(true);
    expect(isNewer("v1.3.2", "v1.3.2")).toBe(false);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────
  it("treats missing segments as 0", () => {
    // "1.3" → [1, 3, 0]; "1.3.1" → [1, 3, 1]  → remote is newer
    expect(isNewer("1.3", "1.3.1")).toBe(true);
    // "1.3.0" vs "1.3" → both effectively [1, 3, 0] → not newer
    expect(isNewer("1.3.0", "1.3")).toBe(false);
  });

  it("handles very large version numbers", () => {
    expect(isNewer("1.99.0", "1.100.0")).toBe(true);
    expect(isNewer("999.0.0", "1000.0.0")).toBe(true);
  });

  it("handles zero-padded patch release", () => {
    expect(isNewer("1.0.0", "1.0.1")).toBe(true);
    expect(isNewer("1.0.1", "1.0.0")).toBe(false);
  });
});
