# openchamber-files-ext

A **Files panel extension for [OpenChamber](https://openchamber.ai)** — browse the project (or home directory) tree with breadcrumbs, search, edit files in a multi-tab [CodeMirror 6](https://codemirror.net) editor with syntax highlighting, and edit `opencode.json` through a real settings form.

![panel](https://img.shields.io/badge/panel-files--nav-blue) ![host](https://img.shields.io/badge/openchamber-%3E%3D1.24.0-green) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **File tree** of the open project — or **`~` (home)** for generic/projectless chats
- **Breadcrumbs + ↑** for parent navigation inside the current root
- **Home ↔ Project toggle** when a real project is open
- **Expand / collapse** folders, **search filter** (120 ms debounced)
- **Multi-tab editor** — open several files, dirty dots, Save / Reload / Close, `Ctrl/Cmd+S` to save
- **Syntax highlighting** (JS/TS, JSON/JSONC, HTML, CSS, Markdown, Python, YAML, Shell, TOML, INI, SQL, Go, Rust, Ruby)
- **Draggable splitter** above the editor — height is remembered across sessions
- **Layout toggle** (`Layout: Stacked / Side-by-side` in the toolbar) — tree above
  editor, or tree left of editor; choice and both pane sizes persist
- **Folder styling** — 📁 icons + bold labels so dirs stand out from files
- **Form view for opencode config** — see below
- Follows **project switches**; status bar shows root, open file, unsaved state

## Form view (opencode config)

Open an `opencode.json` / `opencode.jsonc` (or any `.json` that declares
`"$schema": "https://opencode.ai/config.json"`) and click **Form** in the editor
header. The form and the text editor are two views of the same buffer, so dirty
state, Save, Reload and `Ctrl/Cmd+S` behave identically in both.

- **Add an endpoint in one flow** — *Custom endpoint* writes
  `npm: "@ai-sdk/openai-compatible"` plus `options.baseURL`; *Known provider*
  searches 223 providers from [models.dev](https://models.dev) and pre-fills the
  SDK package and an `{env:VAR}` key reference
- **Add models with a catalog picker** — search 8,177 models, scoped to the
  provider when its SDK package is known, or type an id for a private endpoint
- **Model editor** — name, input/output **modalities** (text/image/audio/video/pdf),
  capabilities (reasoning, tool calls, vision, temperature), context/output limits,
  and raw JSON for cost/options/headers/variants
- **API keys** are masked, and one click swaps a literal key for `{env:VAR}`
- **MCP servers** — local command (argv editor) or remote URL (headers, OAuth)
- **Permissions** — per-tool allow/ask/deny matrix plus pattern rules, at the top
  level and per agent
- **Everything else** is generated from opencode's published JSON Schema: enums,
  numbers with bounds, string lists, maps, and variant switchers for `anyOf`
  fields (`formatter`, `lsp`, `references`, …)
- **Validation** with the same schema the CLI uses (AJV, draft 2020-12), inline
  per field, with a live "valid opencode config" / "N schema issues" indicator
- **Comments and formatting survive** — every edit is a surgical JSONC edit, so
  your comments, key order and indentation stay exactly as you left them, and any
  key the form doesn't know about is preserved untouched
- **Filter** settings by name or value, and **Only set** to hide untouched sections

Both data files are vendored and refreshed on demand:

```bash
bun run sync:schema   # panel/data/opencode-schema.json  (from opencode.ai/config.json)
bun run sync:models   # panel/data/models.json           (from models.dev/api.json)
```

`models.json` is ~1.8 MB but is **not** in the bundle: it is served same-origin
from the extension package and fetched only when a picker opens.

## Settings

There is no host-provided settings UI for plain panels (the SDK only exposes
`Settings → Integrations` cards to extensions declaring an `integration` with an
auth block — wrong tool for a layout toggle). So settings live **inside the panel**
and persist via host `storage`:

| Setting | Control | Storage key |
|---|---|---|
| Split orientation (stacked / side-by-side) | `Layout:` toolbar button | `split` |
| Tree height (stacked) | drag splitter | `editorHeight` (historical name) |
| Tree width (side-by-side) | drag splitter | `treeWidth` |
| Expanded form sections | section headers in the form | `form.expanded` |

## Install

**Option A — git URL** (recommended, supports updates):

1. Open **Settings → Extensions** in OpenChamber (web or desktop).
2. Paste into **Folder, ZIP, or URL**:
   ```
   https://github.com/PylotLight/openchamber-files-ext.git
   ```
3. Approve **Read and write project files** plus the filesystem pattern **`~/**`**.
4. Open the **Files** icon on the right rail, or full-screen from **Extension pages**.
5. Updates: **check for updates** in Settings → Extensions (bump-driven — new
   releases raise `version` in `package.json`).

**Option B — local folder** (for development):

1. Clone the repo and build (`bun install && bun run build`).
2. Add the folder's **absolute path** in Settings → Extensions.
3. Folder installs run from disk — just rebuild and reload the panel after changes.

> Re-installing after a version bump may re-prompt for the filesystem pattern.

## Development

This repo uses [Bun](https://bun.sh).

```bash
bun install          # install deps
bun run build        # bundle panel/main.ts -> panel/main.js (IIFE)
bun run validate     # validate the extension manifest
bun test             # mock-host regression tests (test/)
bun run sync:schema  # refresh the vendored opencode config schema
bun run sync:models  # refresh the vendored model catalog
```

Ship the built `panel/main.js` — OpenChamber does not compile TypeScript on install, so the bundle must be committed.

### Project structure

```
panel/
  index.html   # panel entry: full-height #root, loads main.js
  main.ts      # panel shell: tree, toolbar, tabs, editor chrome, view switching
  main.js      # built bundle (committed)
  data/
    opencode-schema.json  # vendored opencode config schema (remote $refs stripped)
    models.json           # vendored models.dev catalog, lazy-loaded at runtime
  form/
    core.ts      # JSONC document model: parse, detect formatting, surgical writes
    schema.ts    # schema helpers: $ref deref, variants, map/enum detection
    validate.ts  # AJV 2020-12 validation, errors indexed by field path
    catalog.ts   # lazy model catalog + ranked search
    fields.ts    # generic schema-driven renderer (scalars, enums, arrays, maps)
    provider.ts  # provider / model / modality editors and the add flows
    special.ts   # MCP, permission, and plugin editors
    view.ts      # form state, section layout, validation wiring
    ui.ts        # layout primitives + form CSS
    context.ts   # the render contract
scripts/
  sync-schema.ts   # regenerate panel/data/opencode-schema.json
  sync-models.ts   # regenerate panel/data/models.json
test/
  harness.ts          # mock host: boots the real bundle under happy-dom
  first-open.test.ts  # first-open regression (incl. slow-storage race)
  form-core.test.ts   # JSONC edits, schema helpers, validation
  form-view.test.ts   # form view end-to-end through the mock host
  catalog.test.ts     # catalog loading and search ranking
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
