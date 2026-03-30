import { contextBridge, ipcRenderer } from "electron";

function toArrayBuffer(u8) {
  if (u8 == null) return null;
  if (u8 instanceof ArrayBuffer) return u8;
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

contextBridge.exposeInMainWorld("leapReaderApp", {
  getAppInfo: () => ipcRenderer.invoke("leap-reader-app"),
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
