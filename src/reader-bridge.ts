export const OPEN_DOC_IN_READER_MESSAGE = "leap-reader-open-doc" as const;

/** auto: both panes empty → same doc in both; else first empty pane, else replace left */
export type OpenDocInReaderPane = "left" | "right" | "auto";

export type OpenDocInReaderPayload = {
  type: typeof OPEN_DOC_IN_READER_MESSAGE;
  docId: string;
  pane: OpenDocInReaderPane;
};

export function postOpenDocInReader(target: Window, docId: string, pane: OpenDocInReaderPane): void {
  const payload: OpenDocInReaderPayload = {
    type: OPEN_DOC_IN_READER_MESSAGE,
    docId,
    pane,
  };
  target.postMessage(payload, window.location.origin);
}

export const CLOSE_LIBRARIES_EMBED_MESSAGE = "leap-reader-close-libraries" as const;

export type CloseLibrariesEmbedPayload = {
  type: typeof CLOSE_LIBRARIES_EMBED_MESSAGE;
};

export function postCloseLibrariesEmbed(target: Window): void {
  const payload: CloseLibrariesEmbedPayload = { type: CLOSE_LIBRARIES_EMBED_MESSAGE };
  target.postMessage(payload, window.location.origin);
}
