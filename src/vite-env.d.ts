/// <reference types="vite/client" />

import type { LeapReaderFileApi } from "./storage-file";

declare global {
  interface Window {
    leapReaderStorage?: LeapReaderFileApi;
  }
}

export {};
