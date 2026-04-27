import { describe, it, expect } from "vitest";
import { insetMaxBoxForFrameAspect } from "../src/reader/page-frame";

describe("insetMaxBoxForFrameAspect", () => {
  it("returns padded inner box when frame aspect is unset", () => {
    const { maxW, maxH } = insetMaxBoxForFrameAspect(800, 600, null, 16);
    expect(maxW).toBe(784);
    expect(maxH).toBe(584);
  });

  it("fits a 16:9 frame inside a wide container", () => {
    const { maxW, maxH } = insetMaxBoxForFrameAspect(900, 500, 16 / 9, 16);
    expect(maxW / maxH).toBeCloseTo(16 / 9, 5);
    expect(maxH).toBeLessThanOrEqual(484);
    expect(maxW).toBeLessThanOrEqual(884);
  });

  it("fits a portrait frame inside a tall container", () => {
    const ar = 3 / 4;
    const { maxW, maxH } = insetMaxBoxForFrameAspect(400, 900, ar, 16);
    expect(maxW / maxH).toBeCloseTo(ar, 5);
  });
});
