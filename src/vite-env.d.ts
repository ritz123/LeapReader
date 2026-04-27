/// <reference types="vite/client" />

import type { LeapReaderFileApi } from "./storage-file";

/** Electron-only: CLI / “open with” document queue (see electron/main.mjs). */
export interface LeapReaderDesktopApi {
  shiftLaunchFile?: () => Promise<{
    path: string;
    name: string;
    buffer: ArrayBuffer | Uint8Array;
    lastModified: number;
  } | null>;
  onLaunchQueueChanged?: (handler: () => void) => () => void;
}

declare global {
  const __APP_VERSION__: string;
  interface Window {
    leapReaderStorage?: LeapReaderFileApi;
    leapReaderDesktop?: LeapReaderDesktopApi;
  }
}

export {};
