import { session } from "./session";

export function anyPaneHasDoc(): boolean {
  return Boolean(session.paneState.left.doc || session.paneState.right.doc);
}

export function bothPanesEmpty(): boolean {
  return !session.paneState.left.doc && !session.paneState.right.doc;
}
