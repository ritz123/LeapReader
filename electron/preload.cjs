/* eslint-disable @typescript-eslint/no-var-requires */
const { contextBridge, ipcRenderer } = require("electron");

function toArrayBuffer(u8) {
  if (u8 == null) return null;
  if (u8 instanceof ArrayBuffer) return u8;
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

contextBridge.exposeInMainWorld("leapReaderDesktop", {
  shiftLaunchFile: () => ipcRenderer.invoke("leap-reader-shift-launch-file"),
  onLaunchQueueChanged: (handler) => {
    const wrapped = () => handler();
    ipcRenderer.on("leap-reader-launch-queue-changed", wrapped);
    return () => ipcRenderer.removeListener("leap-reader-launch-queue-changed", wrapped);
  },
});

contextBridge.exposeInMainWorld("leapReaderAI", {
  /** @returns {Promise<number|null>} */
  getBackendPort: () => ipcRenderer.invoke("ai:get-backend-port"),
  /**
   * Called when the backend is ready. Returns a cleanup function.
   * @param {(data: {port: number}) => void} cb
   * @returns {() => void}
   */
  onBackendReady: (cb) => {
    const wrapped = (_event, data) => cb(data);
    ipcRenderer.on("backend:ready", wrapped);
    return () => ipcRenderer.removeListener("backend:ready", wrapped);
  },
  /**
   * Called when the backend crashes (will retry).
   * @param {(data: {attempt: number, maxAttempts: number}) => void} cb
   * @returns {() => void}
   */
  onBackendDown: (cb) => {
    const wrapped = (_event, data) => cb(data);
    ipcRenderer.on("backend:down", wrapped);
    return () => ipcRenderer.removeListener("backend:down", wrapped);
  },
  /**
   * Called when the backend has permanently failed (no more retries).
   * @param {(data: {reason: string}) => void} cb
   * @returns {() => void}
   */
  onBackendFailed: (cb) => {
    const wrapped = (_event, data) => cb(data);
    ipcRenderer.on("backend:failed", wrapped);
    return () => ipcRenderer.removeListener("backend:failed", wrapped);
  },
  /**
   * Called on each model pull progress tick.
   * @param {(event: {type:"pull_progress",pane_id:string,payload:{model:string,percent:number,status:string}}) => void} cb
   * @returns {() => void}
   */
  onPullProgress: (cb) => {
    const wrapped = (_event, data) => cb(data);
    ipcRenderer.on("backend:pull_progress", wrapped);
    return () => ipcRenderer.removeListener("backend:pull_progress", wrapped);
  },
  /**
   * Abort the active stream for a pane (AD-13 abort chain).
   * @param {"left"|"right"} paneId
   * @param {string} sessionId
   * @param {"chat"|"summarize"|"review"} [streamType]
   * @returns {Promise<{aborted: boolean}>}
   */
  abortStream: (paneId, sessionId, streamType = "chat") =>
    ipcRenderer.invoke(`ai:abort:${paneId}`, { session_id: sessionId, stream_type: streamType }),
});

contextBridge.exposeInMainWorld("leapReaderStorage", {
  getDataDirPath: () => ipcRenderer.invoke("leap-reader-fs", { op: "getDataDirPath" }),
  readText: (relPath) => ipcRenderer.invoke("leap-reader-fs", { op: "readText", relPath }),
  writeText: (relPath, text) =>
    ipcRenderer.invoke("leap-reader-fs", { op: "writeText", relPath, text }),
  readBuffer: async (relPath) => {
    const u8 = await ipcRenderer.invoke("leap-reader-fs", { op: "readBuffer", relPath });
    return toArrayBuffer(u8);
  },
  writeBuffer: (relPath, data) =>
    ipcRenderer.invoke("leap-reader-fs", { op: "writeBuffer", relPath, buffer: data }),
  unlink: (relPath) => ipcRenderer.invoke("leap-reader-fs", { op: "unlink", relPath }),
  exists: (relPath) => ipcRenderer.invoke("leap-reader-fs", { op: "exists", relPath }),
});
