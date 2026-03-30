/// <reference types="vite/client" />

import type { LeapReaderFileApi } from "./storage-file";

declare global {
  const __APP_VERSION__: string;
  interface Window {
    leapReaderStorage?: LeapReaderFileApi;
    leapReaderApp?: { getAppInfo: () => Promise<{ isPackaged: boolean }> };
  }
}

export {};
