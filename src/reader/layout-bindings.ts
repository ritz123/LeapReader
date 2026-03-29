import { bumpContinuousRevForOpenContinuousPanes } from "./continuous-helpers";
import { waitLayout } from "./dom";
import { setAppMenuOpen } from "./flyouts";
import {
  runSetLayoutMode,
  runSetPaneMode,
  type LayoutRuntime,
} from "./layout-controller";
import { anyPaneHasDoc } from "./pane-queries";
import { session } from "./session";

export function layoutRuntime(): LayoutRuntime {
  return {
    hasAnyOpenDocument: anyPaneHasDoc,
    invalidatePaneMeasures() {
      session.paneLayoutSnapshot.clear();
      bumpContinuousRevForOpenContinuousPanes();
    },
    closeAppMenu: () => setAppMenuOpen(false),
    waitLayout,
  };
}

export function setPaneMode(mode: "single" | "split"): void {
  runSetPaneMode(mode, layoutRuntime());
}

export function setLayoutMode(mode: "split" | "tabs"): void {
  runSetLayoutMode(mode, layoutRuntime());
}
