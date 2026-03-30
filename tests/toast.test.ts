import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showToast } from "../src/reader/toast";

// jsdom provides a real DOM; we create the #toast element ourselves.
function makeToastEl(): HTMLElement {
  const el = document.createElement("div");
  el.id = "toast";
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("showToast", () => {
  it("shows the toast element immediately", () => {
    const el = makeToastEl();
    showToast("Hello");
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe("Hello");
  });

  it("hides the toast after the default 2000 ms", () => {
    const el = makeToastEl();
    showToast("Hello");
    expect(el.hidden).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(el.hidden).toBe(true);
  });

  it("hides the toast after a custom duration", () => {
    const el = makeToastEl();
    showToast("Wait", 5000);

    vi.advanceTimersByTime(4999);
    expect(el.hidden).toBe(false); // not yet

    vi.advanceTimersByTime(1);
    expect(el.hidden).toBe(true); // now hidden
  });

  it("cancels the previous timer when called rapidly — only one hide fires", () => {
    const el = makeToastEl();

    showToast("First");
    vi.advanceTimersByTime(1000); // halfway through first timer

    showToast("Second"); // replaces first
    expect(el.textContent).toBe("Second");

    vi.advanceTimersByTime(1000); // first timer would have fired here — but cancelled
    expect(el.hidden).toBe(false); // still visible: second timer has 1000 ms left

    vi.advanceTimersByTime(1000); // second timer completes
    expect(el.hidden).toBe(true);
  });

  it("updates the text when called a second time", () => {
    const el = makeToastEl();
    showToast("First");
    showToast("Second");
    expect(el.textContent).toBe("Second");
  });

  it("does not throw when the #toast element is absent", () => {
    // No element in DOM
    expect(() => showToast("No element")).not.toThrow();
  });
});
