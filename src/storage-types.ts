export interface DocumentMeta {
  id: string;
  name: string;
  size: number;
  createdAt: number;
  lastOpenedAt: number;
}

export interface LibraryRecord {
  id: string;
  name: string;
  createdAt: number;
  documentIds: string[];
}

export type AnnotationPane = "left" | "right";

export type AnnotationRecord = {
  id: string;
  docId: string;
  pane: AnnotationPane;
  page: number;
  kind: "highlight" | "note";
  createdAt: number;
  rects?: { l: number; t: number; w: number; h: number }[];
  color?: string;
  quote?: string;
  x?: number;
  y?: number;
  text?: string;
};
