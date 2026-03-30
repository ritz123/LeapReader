import { describe, it, expect, beforeEach } from "vitest";
import {
  readLayoutPref,
  writeLayoutPref,
  readPaneModePref,
  writePaneModePref,
  isTabLayoutActive,
  getActivePaneTab,
  setActivePaneTab,
  syncLayoutSegmentButtons,
  syncPaneModeButtons,
  syncPaneTabButtons,
} from "../src/reader/layout-controller";
import { LAYOUT_STORAGE_KEY, PANE_MODE_STORAGE_KEY } from "../src/reader/config";

beforeEach(() => {
  // Fresh localStorage and DOM for every test.
  localStorage.clear();
  document.body.className = "";
  document.body.innerHTML = "";
});

// ── Layout preference (localStorage) ─────────────────────────────────────────

describe("readLayoutPref / writeLayoutPref", () => {
  it("defaults to 'split' when nothing is stored", () => {
    expect(readLayoutPref()).toBe("split");
  });

  it("returns 'tabs' after storing 'tabs'", () => {
    writeLayoutPref("tabs");
    expect(readLayoutPref()).toBe("tabs");
  });

  it("returns 'split' after storing 'split'", () => {
    writeLayoutPref("tabs");
    writeLayoutPref("split");
    expect(readLayoutPref()).toBe("split");
  });

  it("round-trips through localStorage key " + LAYOUT_STORAGE_KEY, () => {
    writeLayoutPref("tabs");
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe("tabs");
  });
});

// ── Pane-mode preference (localStorage) ──────────────────────────────────────

describe("readPaneModePref / writePaneModePref", () => {
  it("defaults to 'single' when nothing is stored", () => {
    expect(readPaneModePref()).toBe("single");
  });

  it("returns 'split' after storing 'split'", () => {
    writePaneModePref("split");
    expect(readPaneModePref()).toBe("split");
  });

  it("returns 'single' after storing 'single'", () => {
    writePaneModePref("split");
    writePaneModePref("single");
    expect(readPaneModePref()).toBe("single");
  });

  it("round-trips through localStorage key " + PANE_MODE_STORAGE_KEY, () => {
    writePaneModePref("split");
    expect(localStorage.getItem(PANE_MODE_STORAGE_KEY)).toBe("split");
  });
});

// ── isTabLayoutActive ────────────────────────────────────────────────────────

describe("isTabLayoutActive", () => {
  it("is false when body has no layout class", () => {
    expect(isTabLayoutActive()).toBe(false);
  });

  it("is true when body has layout-tabs class", () => {
    document.body.classList.add("layout-tabs");
    expect(isTabLayoutActive()).toBe(true);
  });

  it("is true when body has layout-one-pane class", () => {
    document.body.classList.add("layout-one-pane");
    expect(isTabLayoutActive()).toBe(true);
  });

  it("is false when body has an unrelated layout class", () => {
    document.body.classList.add("some-other-class");
    expect(isTabLayoutActive()).toBe(false);
  });
});

// ── Active pane tab ───────────────────────────────────────────────────────────

describe("getActivePaneTab / setActivePaneTab", () => {
  beforeEach(() => {
    const split = document.createElement("div");
    split.id = "split";
    document.body.appendChild(split);
  });

  it("defaults to 'left' when no activeTab data attribute is set", () => {
    expect(getActivePaneTab()).toBe("left");
  });

  it("returns 'right' after setActivePaneTab('right')", () => {
    setActivePaneTab("right");
    expect(getActivePaneTab()).toBe("right");
  });

  it("returns 'left' after setActivePaneTab('left')", () => {
    setActivePaneTab("right");
    setActivePaneTab("left");
    expect(getActivePaneTab()).toBe("left");
  });
});

// ── syncLayoutSegmentButtons ─────────────────────────────────────────────────

describe("syncLayoutSegmentButtons", () => {
  beforeEach(() => {
    // Stamp two segment buttons into the DOM.
    document.body.innerHTML = `
      <button class="btn-seg" data-layout="split" aria-pressed="false"></button>
      <button class="btn-seg" data-layout="tabs"  aria-pressed="false"></button>
    `;
  });

  it("marks the 'split' button pressed when mode is 'split'", () => {
    syncLayoutSegmentButtons("split");
    const splitBtn = document.querySelector<HTMLButtonElement>('[data-layout="split"]')!;
    const tabsBtn = document.querySelector<HTMLButtonElement>('[data-layout="tabs"]')!;
    expect(splitBtn.getAttribute("aria-pressed")).toBe("true");
    expect(tabsBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("marks the 'tabs' button pressed when mode is 'tabs'", () => {
    syncLayoutSegmentButtons("tabs");
    const splitBtn = document.querySelector<HTMLButtonElement>('[data-layout="split"]')!;
    const tabsBtn = document.querySelector<HTMLButtonElement>('[data-layout="tabs"]')!;
    expect(splitBtn.getAttribute("aria-pressed")).toBe("false");
    expect(tabsBtn.getAttribute("aria-pressed")).toBe("true");
  });
});

// ── syncPaneModeButtons ───────────────────────────────────────────────────────

describe("syncPaneModeButtons", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button class="btn-seg" data-pane-mode="single" aria-pressed="false"></button>
      <button class="btn-seg" data-pane-mode="split"  aria-pressed="false"></button>
    `;
  });

  it("marks 'single' pressed when mode is 'single'", () => {
    syncPaneModeButtons("single");
    expect(
      document.querySelector('[data-pane-mode="single"]')!.getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      document.querySelector('[data-pane-mode="split"]')!.getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("marks 'split' pressed when mode is 'split'", () => {
    syncPaneModeButtons("split");
    expect(
      document.querySelector('[data-pane-mode="split"]')!.getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      document.querySelector('[data-pane-mode="single"]')!.getAttribute("aria-pressed")
    ).toBe("false");
  });
});

// ── syncPaneTabButtons ────────────────────────────────────────────────────────

describe("syncPaneTabButtons", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button class="btn-tab" data-pane-tab="left"  aria-selected="false"></button>
      <button class="btn-tab" data-pane-tab="right" aria-selected="false"></button>
    `;
  });

  it("marks 'left' tab selected", () => {
    syncPaneTabButtons("left");
    expect(
      document.querySelector('[data-pane-tab="left"]')!.getAttribute("aria-selected")
    ).toBe("true");
    expect(
      document.querySelector('[data-pane-tab="right"]')!.getAttribute("aria-selected")
    ).toBe("false");
  });

  it("marks 'right' tab selected", () => {
    syncPaneTabButtons("right");
    expect(
      document.querySelector('[data-pane-tab="right"]')!.getAttribute("aria-selected")
    ).toBe("true");
    expect(
      document.querySelector('[data-pane-tab="left"]')!.getAttribute("aria-selected")
    ).toBe("false");
  });
});
