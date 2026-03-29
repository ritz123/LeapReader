export type HighlightColorId = "yellow" | "green" | "blue" | "pink" | "orange" | "purple";

const BG: Record<HighlightColorId, string> = {
  yellow: "rgba(255, 235, 59, 0.45)",
  green: "rgba(129, 199, 132, 0.55)",
  blue: "rgba(100, 181, 246, 0.5)",
  pink: "rgba(240, 98, 146, 0.45)",
  orange: "rgba(255, 183, 77, 0.55)",
  purple: "rgba(186, 104, 200, 0.45)",
};

export function highlightBackgroundForStored(color: string | undefined): string {
  if (color && color in BG) return BG[color as HighlightColorId];
  return BG.yellow;
}

/** Resolved id for DOM (`data-hl-color`) and print opaque fill. */
export function highlightColorIdForStored(color: string | undefined): HighlightColorId {
  if (color && color in BG) return color as HighlightColorId;
  return "yellow";
}

/**
 * Translucent fills for print (`--ann-hl-print`). @media print uses normal compositing so the
 * PDF canvas shows through; opaque colors were covering text when multiply was ignored.
 * Keep in sync with `style.css` print `.ann-highlight[data-hl-color]` fallbacks.
 */
export const HIGHLIGHT_PRINT_OPAQUE: Record<HighlightColorId, string> = {
  yellow: "rgba(255, 241, 118, 0.4)",
  green: "rgba(165, 214, 167, 0.44)",
  blue: "rgba(144, 202, 249, 0.42)",
  pink: "rgba(244, 143, 177, 0.38)",
  orange: "rgba(255, 204, 128, 0.42)",
  purple: "rgba(206, 147, 216, 0.38)",
};

export function isHighlightColorId(s: string): s is HighlightColorId {
  return s in BG;
}
