# Architecture

The panel shell lives in [`panel/main.ts`](../panel/main.ts) and the settings form in
[`panel/form/`](../panel/form). The host bundles `panel/main.js` (IIFE) — OpenChamber
never compiles the TS source.

## Layout shell

`mountOnce` appends six regions to `#root` (flex column, full height):

```
toolbar → search → body(tree → splitter → editor) → status
```

- `styleUi` injects one `<style>` block (tree rows, chips, CodeMirror host, crumbs, form host).
- `styleEls` sets flex layout inline styles and wires tree click + splitter drag listeners.
- `els.body` is the orientation container: `flex-direction: column` for stacked
  (tree above editor), `row` for side-by-side. `applySplit` flips it plus the
  splitter axis/cursor and the editor border, then calls `showEditor`.
- `showEditor` toggles tree/editor flex split per orientation; tree size clamped to
  80 px – 75 % of root height (stacked) or 160 px – 60 % of root width (side-by-side).

## State

| Variable | Meaning |
|---|---|
| `directory` / `rootKind` | host project dir; `"project"` vs `"home"` (session dirs resolve to home) |
| `currentPath`, `expanded` | tree nav position; set of open dir UI-paths (`""` = root) |
| `listings`, `inflight` | dir-listing cache + in-flight dedupe map |
| `tabs`, `activePath` | open file tabs (`raw`/`draft`/`loading`/`error`/`edited`/`synced`/`view`) |
| `tab.view` | `"text"` (CodeMirror) or `"form"` (settings form) for that tab |
| `query` | search filter (120 ms debounced repaint) |
| `cm`, `cmHost`, `editorPath` | single shared CodeMirror instance, rebound per active tab |
| `formView`, `formHost` | the mounted form and its container, one per active tab |
| `treeHeight` | tree pane px, persisted as host storage key `"editorHeight"` (historical name) |
| `split` / `treeWidth` | `"horizontal"` (stacked) vs `"vertical"` (side-by-side), toggled by the `Layout:` toolbar button; tree width persisted as `"treeWidth"` |
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

## Two views, one buffer

`formEligible()` decides whether the **Form** button appears: the file must be named
`opencode.json`/`opencode.jsonc`, or be a `.json`/`.jsonc` whose text contains
`opencode.ai/config.json` or already has a `provider` key. Anything else keeps the
plain editor — the form is built from opencode's schema, so applying it to an
arbitrary JSON file would be wrong.

Both views mutate the same `tab.draft` string:

- text view — CodeMirror writes the buffer, `flushDraft` pushes it into the tab
- form view — `createFormView({ getText, setText })`; every control edit is a surgical
  `jsonc-parser` write into the text, then `setText` updates the tab

`setTabView` flushes the buffer before switching and rebuilds the chrome; the form is
never mounted while `tab.loading` (it would render an empty config and could clobber
the incoming file). Dirty state, Save, Reload, tab dots and the tree dots are shared,
so nothing about the editor's contract changed.

## Form internals

| Module | Responsibility |
|---|---|
| `form/core.ts` | JSONC parse, indentation/EOL detection, `writeValue` (surgical edit), `readValue`/`hasPath`, human parse errors with line/column |
| `form/schema.ts` | vendored schema access: `$ref` deref, `variants()` for `anyOf`/`oneOf`, map/enum detection, `defaultForSchema` |
| `form/validate.ts` | AJV draft 2020-12 compile (once, lazily, failure-tolerant) and errors indexed by field path; union noise filtered when a branch is sharper |
| `form/catalog.ts` | lazy same-origin fetch of `panel/data/models.json`, weighted search ranking, provider↔npm resolution |
| `form/fields.ts` | generic renderer: scalars, enums, unions, arrays, maps, JSON escape hatches, and the override registry |
| `form/provider.ts` | provider cards, add-endpoint/add-provider modal, add-model modal, model cards, modality chips, env-key hints |
| `form/special.ts` | MCP server cards (local/remote), permission matrices, plugin list |
| `form/view.ts` | form state, curated section order, filter, validation bar, error push |
| `form/ui.ts` | cards, grids, modals, confirm buttons, form CSS |

**Never drop unknown keys.** The form edits the file as text, so any key the schema
doesn't describe survives untouched; `objectField` also surfaces schema-unknown keys as
editable raw JSON so they're never invisible.

**Override registry.** `registerOverride({ id, match, render })` lets a bespoke editor
win over the generic renderer at *any* depth — that is how `agent.build.permission`
gets the same matrix as the top-level `permission` without the object renderer knowing
about it.

**Density rules.** Maps (`agent`, `command`, `references`) render one *collapsed* card
per entry with a value summary; nested permission matrices are collapsed with a
`bash=deny · edit=ask` summary. Only explicit add/remove/variant actions trigger a full
re-render; leaf edits update just that control's error slot, so typing never loses focus.

## Host interaction

Used host APIs: `onReady`, `onDirectory`, `listDir`, `readFile`, `writeFile`,
`toast`, `storage.get/set`. UI kit: `mountButton`, `mountTextField`, `mountSelect`,
`mountSwitch`, `mountSearchField`, `mountEmpty`, `mountSpinner`, `mountBanner`,
`applyHostReady`.

`onDirectory` resets navigation; a root-*kind* switch also drops tabs and editor DOM.

## Constraints inherited from the host

- Text ≤ 2 MB/file, path ≤ 1024 chars, ≤ 2000 entries/dir, no `..`.
- No delete/rename/mkdir, no file watching, no exec/PTY RPC (host ≤ 1.24.2).
- Guest frame is `sandbox="allow-scripts"`, opaque origin — no direct clipboard/links/ESM.
- The guest cannot fetch `opencode.ai` or `models.dev` at runtime (neither sends CORS
  headers), so both are vendored at build time; `models.json` is served same-origin
  from the package and fetched lazily.
