# Architecture

All panel logic lives in [`panel/main.ts`](../panel/main.ts) (~1300 lines, single module).
The host bundles `panel/main.js` (IIFE) — OpenChamber never compiles the TS source.

## Layout shell

`mountOnce` appends six regions to `#root` (flex column, full height):

```
toolbar → search → tree → splitter → editor → status
```

- `styleUi` injects one `<style>` block (tree rows, chips, CodeMirror host, crumbs).
- `styleEls` sets flex layout inline styles and wires tree click + splitter drag listeners.
- `showEditor` toggles tree/editor flex split; tree height clamped to 80 px – 75 % of root.

## State

| Variable | Meaning |
|---|---|
| `directory` / `rootKind` | host project dir; `"project"` vs `"home"` (session dirs resolve to home) |
| `currentPath`, `expanded` | tree nav position; set of open dir UI-paths (`""` = root) |
| `listings`, `inflight` | dir-listing cache + in-flight dedupe map |
| `tabs`, `activePath` | open file tabs (`raw`/`draft`/`loading`/`error`/`edited`/`synced`) |
| `query` | search filter (120 ms debounced repaint) |
| `cm`, `cmHost`, `editorPath` | single shared CodeMirror instance, rebound per active tab |
| `treeHeight` | tree pane px, persisted as host storage key `"editorHeight"` (historical name) |
| `paintGen` | generation counter — stale async tree paints bail out |

UI paths are host-relative (`""` = root); `hostPath()` maps them to host form
(`~/p` in home mode, `p || "."` in project mode).

## Rendering strategy

- **`paintTree`** — async loader: computes needed dirs (`collectNeeded`), fetches only
  cache misses in parallel (`loadListing` + `inflight` dedupe), shows a spinner only on
  cache miss, guards with `paintGen`, then calls `renderTree`.
- **`renderTree`** — full synchronous rebuild via `DocumentFragment`, delegated click
  handler (`onTreeClick`), dirs-first sort (`sortEntries`).
- **`patchTreeState`** — cheap in-place update (active row, dirty dots) without rebuild.
- **Toolbar** — `buildToolbar` mounts static structure once (host buttons are handles
  with `.update()`, not DOM nodes); `updateToolbar` patches label/variant/disabled +
  rebuilds crumb buttons; `paintToolbar` is an alias kept for call-site stability.
- **Editor** — one `EditorView` rebuilt per tab switch (`ensureCm` manages only `cmHost`;
  chrome is built by `buildEditorChrome`). `syncChrome` patches buttons/read-only/title
  in place. Drafts sync on an 80 ms debounce (`scheduleDraftSync`) plus an explicit
  `flushDraft` on tab switch/close/open; `setDoc` swaps doc + language compartment.
- **Editor extensions** — line numbers, fold gutter, history, bracket matching,
  `Mod-S` save keymap, per-language `Compartment` (`languageFor` covers ~20 extensions,
  full grammars for JS/TS/JSON/HTML/CSS/Markdown/Python, CodeMirror legacy modes for
  the rest), custom `HighlightStyle` + `EditorView.theme` bound to `--oc-*` host vars.

## Host interaction

Used host APIs: `onReady`, `onDirectory`, `listDir`, `readFile`, `writeFile`,
`toast`, `storage.get/set`. UI kit: `mountButton`, `mountSearchField`, `mountEmpty`,
`mountSpinner`, `mountBanner`, `applyHostReady`.

`onDirectory` resets navigation; a root-*kind* switch also drops tabs and editor DOM.

## Constraints inherited from the host

- Text ≤ 2 MB/file, path ≤ 1024 chars, ≤ 2000 entries/dir, no `..`.
- No delete/rename/mkdir, no file watching, no exec/PTY RPC (host ≤ 1.24.2).
- Guest frame is `sandbox="allow-scripts"`, opaque origin — no direct clipboard/links/ESM.
