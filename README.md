# Leap reader

The main idea is the same as with a **paper-bound book**: you can **leap** to another page or document for a quick look-up while **keeping your place** on what you are reading. That split focus makes **technical documents** much easier to work through.

Web app (and Android wrapper via Capacitor) for viewing PDFs in a split layout: each pane can show **any page** of its own document, so you can compare **two different PDFs** side by side, or two pages from the same file.

## Compact UI (menu & floating controls)

The header is a slim strip: **☰** opens a flyout with **Recent**, **Libraries**, **Export highlights & notes**, **Help**, **About**, **Panes** (split vs single), and on narrow two-pane layouts **View** (stacked split vs tabs). Each PDF pane uses a floating **‹ page ›** bar and a **⋯** button (bottom-right) for open file, zoom, libraries, copy, highlight, notes, and marks. A floating **Left / Right** pill appears when only one pane is visible.

## Toolbar: single vs split panes

In the **☰** menu, **Panes → Split** shows **Left** and **Right** together. **Panes → Single** shows one pane at full width; use the floating **Left** / **Right** pill to switch slots. Stored in `localStorage` as `leapReaderPaneMode` (`split` or `single`; default split).

## Narrow windows (tabs vs split)

When the viewport is **720px wide or less** and **Panes → Split** is selected, open **☰** and use **View** (stacked split vs tabs):

- **Split** — both panes stay visible (stacked vertically), same as before on a phone in portrait.
- **Tabs** — only one pane at a time; use **Left** / **Right** to switch. Handy when the window is too narrow for two previews.

Your choice is stored in the browser (`localStorage` key `leapReaderLayout`). On wide viewports with two panes, both columns show and **View** is hidden in the menu. In **single-pane** mode **View** is hidden (you always use one pane at a time).

## Recent documents and libraries (on-device storage)

- **Recent** — Every PDF you open is saved in **IndexedDB** (database name `pdf-split-reader`) so you can reopen it from **Recent** without picking the file again. Each row has **Left** and **Right** to choose which pane opens that file. Data stays on **this browser / device** only. **Delete** removes that copy from storage (and unlinks it from libraries); if that file was open in one or both panes, those panes are cleared.
- **Libraries** — Named collections of references to saved documents. Creating or deleting a library does **not** delete the underlying PDF from Recent unless you delete the document itself. Whenever you open a PDF (from disk, **Recent**, or **Libraries**), it is also added to an **Imported** library, which is created automatically the first time you need it. You can remove documents from **Imported** like any other library; opening the file again will add it back.
- **Adding / removing PDFs in libraries** — **Add to library…** / **Remove from library…** apply to the pane you last interacted with (tap or open a file in that pane first). The document must be in Recent. Same pair on each **Recent** row. In **Libraries**, each document row has **Left** / **Right** to open into a pane; each library has **Add documents…** and **Remove documents…** as before. Nothing here deletes the PDF from Recent unless you use **Delete** there.

Rough cap: about **80** distinct stored PDFs; oldest by last-opened time may be removed when you add new ones. Layout preferences use **`localStorage`** (`leapReaderPaneMode`, `leapReaderLayout`), separate from IndexedDB.

## Text selection, copy, highlights, and notes

- **Copy** — Select text on a page (invisible PDF text layer over the canvas), then use the **floating bar** or **⋯ → Copy**, or the browser’s normal copy shortcut. A short “Copied” toast appears when using the button.
- **Highlight** — With text selected, use the **floating bar → Highlight** (or **⋯**). Pick a color, or **Shift+click Highlight** / **Ctrl+Shift+H** (⌘+Shift+H on Mac) to use the last color. Highlights are tied to **page**, **left/right pane**, and that pane’s document (saved library id, or `unsaved:name:size` for files not in Recent).
- **Place note** — Toggle **Place note** and tap a spot on the page, or select text and use **Note** on the floating bar / **Ctrl+Shift+N** (⌘+Shift+N on Mac) to drop a pin at the selection. A pin appears; tap it to read the note.
- **Marks** — Lists highlights and notes for **all** saved documents (not only the open panes), sorted by file name and page. **Go** opens the PDF in the pane where the mark was created and jumps to that page. **Edit** (notes only) does the same, then opens the note editor. **Delete** removes one mark.

Marks are **not** embedded in the PDF file. They are stored with the rest of app data: **IndexedDB** in the browser (`annotations` store, database `pdf-split-reader` v2), or **`annotations.json`** under the desktop app’s `leap-reader-data` folder. Deleting a document from **Recent** removes its marks as well.

**Backup / export** — In the **☰** menu, **Export highlights & notes…** downloads a JSON file (`leap-reader-highlights-notes-*.json`) listing every highlight and note grouped by stored document id and filename. Use it for archives, moving data to another machine, or custom tooling. There is no import yet; re-import would be a separate feature.

## Requirements

- **Node.js** 18+ and npm (for development and builds)
- **Android**: Android Studio, Android SDK, and a JDK compatible with Capacitor 7 (see [Capacitor Android docs](https://capacitorjs.com/docs/android))

## Run on desktop

### Electron app (recommended)

Wraps the built UI in a desktop window (Node + Electron). From the project root:

```bash
npm install
npm run desktop:build
```

Or, if `dist/` is already built:

```bash
npm run desktop:start
```

On desktop, **libraries, notes, highlights, and cached PDFs** live in a real folder: `leap-reader-data` inside Electron’s [userData](https://www.electronjs.org/docs/latest/api/app#appgetpathname) directory (e.g. `~/.config/leap-reader/` on Linux). You will see `libraries.json`, `annotations.json`, `manifest.json`, and `documents/*.pdf` there. The **first** time you run this version, any data still in IndexedDB is copied into that folder once; the in-browser build continues to use IndexedDB only. If you upgraded from an older package name, copy `flip-reader-data` from the previous app config directory into `leap-reader-data` here to keep your files.

**Wrapper scripts** (install deps if needed, build if `dist/` is missing, then start Electron):

```bash
chmod +x scripts/run-desktop.sh start-desktop   # once, on Unix
./scripts/run-desktop.sh
# or
./start-desktop
```

On Windows:

```cmd
scripts\start-desktop.cmd
```

Or, if you have Bash (Git Bash, WSL):

```bash
npm run start:desktop
```

### Browser dev server

```bash
npm install
npm run desktop
```

This starts the Vite dev server and opens your default browser. Stop with Ctrl+C.

**Without opening a browser:**

```bash
npm run dev
```

Vite prints a local URL (and may listen on your LAN). Use the local URL for normal desktop use.

## Preview the production build locally

```bash
npm run build
npm run preview
```

Then open the URL Vite prints (use `--open` only if you add it to a custom script; the default `preview` script does not open a browser).

## Android

```bash
npm run build
npx cap sync android
npx cap open android
```

In Android Studio, run on a device or emulator. After changing web assets, run `npm run build` and `npx cap sync android` again.

## npm scripts

| Script             | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `desktop`          | Dev server + open browser (desktop workflow) |
| `desktop:start`    | Open Electron (expects `dist/` built)        |
| `desktop:build`    | `build` then Electron                        |
| `start:desktop`    | Wrapper: deps, build if needed, Electron     |
| `dev`              | Dev server only                              |
| `build`            | Typecheck + production build to `dist/`      |
| `preview`          | Serve `dist/` locally                        |
| `cap:sync`         | `cap sync` (copy web assets to native apps)  |
| `cap:open`         | Open native project in IDE (e.g. Android)    |

## Contact & copyright

The same information is in the app under **☰ → About**.

- **Contact:** [sarkarbiplab@gmail.com](mailto:sarkarbiplab@gmail.com)
- **Copyright:** © 2026 Biplab Sarkar. All rights reserved.
