/**
 * Leap reader — desktop shell (Electron).
 * Serves the Vite build from dist/ on 127.0.0.1, then loads it in a BrowserWindow.
 * Libraries, notes, and cached PDFs persist under userData/leap-reader-data/ (see IPC leap-reader-fs).
 */
import { app, BrowserWindow, ipcMain, Menu, shell, globalShortcut } from "electron";
import http from "node:http";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app.getAppPath() is the correct API for locating packaged app files:
// it returns the asar root when packaged, or the project root in dev.
// __dirname is kept for PRELOAD since that file lives next to main.mjs.
const DIST = path.join(app.getAppPath(), "dist");
const PRELOAD = path.join(__dirname, "preload.cjs");

function windowIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icons", "icon.png");
  }
  return path.join(__dirname, "..", "build", "icons", "icon.png");
}

/** On-disk app data (JSON + PDFs); renderer accesses via preload `leapReaderStorage`. */
const DATA_SUBDIR = "leap-reader-data";

function dataRoot() {
  return path.join(app.getPath("userData"), DATA_SUBDIR);
}

function safeRel(relPath) {
  if (typeof relPath !== "string" || relPath.includes("\0")) {
    throw new Error("Invalid path");
  }
  const norm = path.normalize(relPath);
  if (norm.startsWith(".." + path.sep) || norm === ".." || path.isAbsolute(norm)) {
    throw new Error("Invalid path");
  }
  return norm;
}

function resolveDataPath(relPath) {
  const safe = safeRel(relPath);
  const full = path.resolve(dataRoot(), safe);
  const root = path.resolve(dataRoot());
  if (!full.startsWith(root + path.sep) && full !== root) {
    throw new Error("Invalid path");
  }
  return full;
}

async function ensureDataDirs() {
  await fs.mkdir(path.join(dataRoot(), "documents"), { recursive: true });
}

ipcMain.handle("leap-reader-fs", async (_event, payload) => {
  const { op, relPath, text, buffer } = payload ?? {};
  await ensureDataDirs();
  switch (op) {
    case "getDataDirPath":
      return dataRoot();
    case "readText": {
      const p = resolveDataPath(relPath);
      try {
        return await fs.readFile(p, "utf8");
      } catch (e) {
        if (e && e.code === "ENOENT") return null;
        throw e;
      }
    }
    case "writeText": {
      const p = resolveDataPath(relPath);
      await fs.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.tmp`;
      await fs.writeFile(tmp, text, "utf8");
      await fs.rename(tmp, p);
      return undefined;
    }
    case "readBuffer": {
      const p = resolveDataPath(relPath);
      try {
        const buf = await fs.readFile(p);
        return new Uint8Array(buf);
      } catch (e) {
        if (e && e.code === "ENOENT") return null;
        throw e;
      }
    }
    case "writeBuffer": {
      const p = resolveDataPath(relPath);
      await fs.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.tmp`;
      const u8 = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer);
      await fs.writeFile(tmp, u8);
      await fs.rename(tmp, p);
      return undefined;
    }
    case "unlink": {
      const p = resolveDataPath(relPath);
      try {
        await fs.unlink(p);
      } catch (e) {
        if (e && e.code !== "ENOENT") throw e;
      }
      return undefined;
    }
    case "exists": {
      try {
        await fs.access(resolveDataPath(relPath));
        return true;
      } catch {
        return false;
      }
    }
    default:
      throw new Error(`Unknown leap-reader-fs op: ${op}`);
  }
});

/** Paths from CLI (`electron path/to.pdf`) or OS “open with” — popped by renderer via preload. */
const pendingLaunchFiles = [];

function collectFilePathsFromArgv(argv) {
  const paths = [];
  const start = process.defaultApp ? 2 : 1;
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.startsWith("-")) continue;
    try {
      const resolved = path.resolve(a);
      const st = fsSync.statSync(resolved);
      if (st.isFile()) paths.push(resolved);
    } catch {
      /* skip */
    }
  }
  return paths;
}

function enqueueLaunchPathsFromArgv(argv) {
  for (const p of collectFilePathsFromArgv(argv)) {
    pendingLaunchFiles.push(p);
  }
}

enqueueLaunchPathsFromArgv(process.argv);

/** macOS: Finder “Open with” / double-click passes the path here (not argv). */
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  try {
    const resolved = path.resolve(filePath);
    const st = fsSync.statSync(resolved);
    if (st.isFile()) pendingLaunchFiles.push(resolved);
  } catch {
    /* skip */
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("leap-reader-launch-queue-changed");
  }
});

ipcMain.handle("leap-reader-shift-launch-file", async () => {
  const next = pendingLaunchFiles.shift();
  if (!next) return null;
  try {
    const buf = await fs.readFile(next);
    const st = await fs.stat(next);
    return {
      path: next,
      name: path.basename(next),
      buffer: new Uint8Array(buf),
      lastModified: st.mtimeMs,
    };
  } catch (e) {
    console.error("Could not read launch file:", next, e);
    return null;
  }
});

/** Fixed port so the origin is stable across restarts — IndexedDB (notes, libraries, Recent) keys off http://127.0.0.1:PORT */
const LEAP_READER_PORT = 47847;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

function safeFilePath(urlPath) {
  let pathname = urlPath.split("?")[0] || "/";
  pathname = decodeURIComponent(pathname);
  if (pathname === "/" || pathname === "") pathname = "index.html";
  else pathname = pathname.replace(/^\/+/, "");
  const root = path.resolve(DIST);
  const filePath = path.resolve(root, pathname);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    return null;
  }
  return filePath;
}

function createStaticServer() {
  return http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end();
      return;
    }
    const filePath = safeFilePath(req.url);
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
}

/** @type {http.Server | null} */
let server = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

function startServer() {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(LEAP_READER_PORT);
      return;
    }
    const s = createStaticServer();
    s.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${LEAP_READER_PORT} is already in use. Close the other Leap reader window or quit the duplicate process.`
          )
        );
      } else {
        reject(err);
      }
    });
    s.listen(LEAP_READER_PORT, "127.0.0.1", () => {
      s.removeAllListeners("error");
      s.on("error", (e) => console.error("Static server error:", e));
      server = s;
      resolve(LEAP_READER_PORT);
    });
  });
}

function createWindow(port) {
  const icon = fsSync.existsSync(windowIconPath()) ? windowIconPath() : undefined;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 480,
    title: "Leap reader",
    icon,
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  void mainWindow.loadURL(`http://127.0.0.1:${port}/index.html`);

  // Open any external link (e.g. the GitHub release page) in the system browser
  // rather than in a new Electron window.
  const appOrigin = `http://127.0.0.1:${port}`;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(appOrigin)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appOrigin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    enqueueLaunchPathsFromArgv(argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.send("leap-reader-launch-queue-changed");
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);

    try {
      await fs.access(path.join(DIST, "index.html"));
    } catch {
      console.error(
        "Missing dist/ folder. Run: npm run build\nThen: npm run desktop:start"
      );
      app.quit();
      return;
    }

    try {
      await startServer();
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      app.quit();
      return;
    }

    createWindow(LEAP_READER_PORT);

    // Open DevTools with Ctrl+Shift+I (or Cmd+Option+I on macOS) / F12
    globalShortcut.register("CommandOrControl+Shift+I", () => {
      mainWindow?.webContents.toggleDevTools();
    });
    globalShortcut.register("F12", () => {
      mainWindow?.webContents.toggleDevTools();
    });

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        try {
          await startServer();
        } catch (e) {
          console.error(e instanceof Error ? e.message : e);
          return;
        }
        createWindow(LEAP_READER_PORT);
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    globalShortcut.unregisterAll();
    server?.close();
    server = null;
  });
}
