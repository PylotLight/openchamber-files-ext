# openchamber-files-ext

A **Files panel extension for [OpenChamber](https://openchamber.ai)** — browse the project (or home directory) tree with breadcrumbs, search, and edit files in a multi-tab [CodeMirror 6](https://codemirror.net) editor with syntax highlighting.

![panel](https://img.shields.io/badge/panel-files--nav-blue) ![host](https://img.shields.io/badge/openchamber-%3E%3D1.24.0-green) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **File tree** of the open project — or **`~` (home)** for generic/projectless chats
- **Breadcrumbs + ↑** for parent navigation inside the current root
- **Home ↔ Project toggle** when a real project is open
- **Expand / collapse** folders, **search filter** (120 ms debounced)
- **Multi-tab editor** — open several files, dirty dots, Save / Reload / Close, `Ctrl/Cmd+S` to save
- **Syntax highlighting** (JS/TS, JSON/JSONC, HTML, CSS, Markdown, Python, YAML, Shell, TOML, INI, SQL, Go, Rust, Ruby)
- **Draggable splitter** above the editor — height is remembered across sessions
- **Folder styling** — 📁 icons + bold labels so dirs stand out from files
- Follows **project switches**; status bar shows root, open file, unsaved state

## Install

1. Clone this repo (or copy the folder) anywhere, e.g.:
   ```bash
   git clone https://github.com/PylotLight/openchamber-files-ext.git
   ```
2. Install deps and build:
   ```bash
   cd openchamber-files-ext
   npm install
   npm run build
   ```
3. Open **Settings → Extensions** in OpenChamber (web or desktop).
4. Add the **absolute path** of this folder.
5. Approve **Read and write project files** plus the filesystem pattern **`~/**`** (home browse for generic chats).
6. Open the **Files** icon on the right rail, or full-screen from **Extension pages**.

> Re-installing after a version bump may re-prompt for the filesystem pattern.

## Development

```bash
npm install        # install deps
npm run build      # bundle panel/main.ts -> panel/main.js (IIFE)
npm run validate   # validate the extension manifest
```

Ship the built `panel/main.js` — OpenChamber does not compile TypeScript on install, so the bundle must be committed.

### Project structure

```
panel/
  index.html   # panel entry: full-height #root, loads main.js
  main.ts      # all panel logic (tree, toolbar, tabs, CodeMirror editor)
  main.js      # built bundle (committed)
docs/
  ARCHITECTURE.md   # module map + state/rendering model
  ROADMAP.md        # planned features, ranked by feasibility
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how `main.ts` is organized.

## Host API limits

- Project mode: relative paths only; home mode: paths under `~` matching `~/**`
- UTF-8 text, max **2 MB** per file; max **2000** entries per directory
- No delete / rename / mkdir (not in the host files API — `writeFile` can only create new paths)
- No file watching (external changes need manual Refresh); no exec/terminal RPC on host ≤ 1.24.2

## Roadmap

Short version — see [docs/ROADMAP.md](docs/ROADMAP.md) for details:

- **Now feasible:** in-file find & replace, quick-open (`Ctrl+P`), outline/symbols, Markdown preview, copy-path context menu, external-change detection via `stat`, unsaved-count rail badge, persist tabs across reloads
- **Needs small manifest additions:** send-to-chat, `/file` slash command, projects/worktrees browser, AI helpers
- **Blocked on host > 1.24.2:** embedded live terminal (`service.surface`); meanwhile an "Open terminal" button via `openSurface('terminal')` and one-shot commands via `contributes.service` are shippable

## License

MIT — see [LICENSE](LICENSE).
