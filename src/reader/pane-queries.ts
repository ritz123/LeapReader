import { session } from "./session";

function paneHasContent(side: "left" | "right"): boolean {
  const st = session.paneState[side];
  return Boolean(st.doc || st.docHtml);
}

export function anyPaneHasDoc(): boolean {
  return paneHasContent("left") || paneHasContent("right");
}

export function bothPanesEmpty(): boolean {
  return !paneHasContent("left") && !paneHasContent("right");
}
