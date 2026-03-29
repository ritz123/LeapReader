import { session } from "./session";
import type { PaneSide } from "./types";

export function continuousLayerKey(side: PaneSide, page: number): string {
  return `${side}-${page}`;
}

export function bumpContinuousRev(side: PaneSide): void {
  session.continuousRev[side] += 1;
  session.continuousBuiltRev[side] = -1;
}

export function bumpContinuousRevForOpenContinuousPanes(): void {
  for (const s of ["left", "right"] as const) {
    if (session.paneState[s].doc && session.paneScrollMode[s] === "continuous") {
      bumpContinuousRev(s);
    }
  }
}
