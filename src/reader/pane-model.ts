import type { PanePdfState } from "./types";

export function emptyPanePdfState(): PanePdfState {
  return { doc: null, name: "", storageId: null, annotationDocId: "" };
}
