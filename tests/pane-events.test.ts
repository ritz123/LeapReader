import { describe, it, expect, vi } from "vitest";
import {
  onPaneDocChanged,
  emitPaneDocChanged,
  emitBothPanesDocChanged,
} from "../src/reader/pane-events";

// Re-import gives us a fresh module between tests when using vi.resetModules();
// here we share state but reset via the unsubscribe function instead.

describe("pane-events — Observer event bus", () => {
  describe("onPaneDocChanged / emitPaneDocChanged", () => {
    it("calls a registered handler when the matching side is emitted", () => {
      const handler = vi.fn();
      const unsub = onPaneDocChanged(handler);

      emitPaneDocChanged("left");

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith("left");
      unsub();
    });

    it("passes the correct side to each call", () => {
      const received: string[] = [];
      const unsub = onPaneDocChanged((side) => received.push(side));

      emitPaneDocChanged("left");
      emitPaneDocChanged("right");

      expect(received).toEqual(["left", "right"]);
      unsub();
    });

    it("calls multiple subscribers registered for the same event", () => {
      const a = vi.fn();
      const b = vi.fn();
      const unsubA = onPaneDocChanged(a);
      const unsubB = onPaneDocChanged(b);

      emitPaneDocChanged("right");

      expect(a).toHaveBeenCalledWith("right");
      expect(b).toHaveBeenCalledWith("right");
      unsubA();
      unsubB();
    });

    it("does NOT call a handler after it has been unsubscribed", () => {
      const handler = vi.fn();
      const unsub = onPaneDocChanged(handler);
      unsub(); // unsubscribe immediately

      emitPaneDocChanged("left");

      expect(handler).not.toHaveBeenCalled();
    });

    it("unsubscribing one handler does not affect other handlers", () => {
      const a = vi.fn();
      const b = vi.fn();
      const unsubA = onPaneDocChanged(a);
      const unsubB = onPaneDocChanged(b);
      unsubA();

      emitPaneDocChanged("left");

      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledOnce();
      unsubB();
    });

    it("calling unsub twice is harmless", () => {
      const handler = vi.fn();
      const unsub = onPaneDocChanged(handler);
      unsub();
      unsub(); // second call should not throw

      emitPaneDocChanged("left");
      expect(handler).not.toHaveBeenCalled();
    });

    it("handlers run synchronously before emitPaneDocChanged returns", () => {
      const order: number[] = [];
      const unsub = onPaneDocChanged(() => order.push(1));
      order.push(0);
      emitPaneDocChanged("left");
      order.push(2);

      expect(order).toEqual([0, 1, 2]);
      unsub();
    });
  });

  describe("emitBothPanesDocChanged", () => {
    it("fires handlers for left then right", () => {
      const sides: string[] = [];
      const unsub = onPaneDocChanged((side) => sides.push(side));

      emitBothPanesDocChanged();

      expect(sides).toEqual(["left", "right"]);
      unsub();
    });

    it("calls each handler twice (once per side)", () => {
      const handler = vi.fn();
      const unsub = onPaneDocChanged(handler);

      emitBothPanesDocChanged();

      expect(handler).toHaveBeenCalledTimes(2);
      unsub();
    });
  });
});
