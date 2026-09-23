# Roadmap

Ranked by feasibility against host 1.24.2. "Needs" = host API or manifest addition.

## Tier 1 — shippable now (client-side / granted APIs)

1. **In-file find & replace** — CodeMirror search extension, match highlight, replace-all. *Pure client-side.*
2. **Quick-open (`Ctrl/Cmd+P`)** — fuzzy finder over cached listings, ranked matches. *Pure client-side + `listDir` prefetch.*
3. **Outline / symbols** — walk the CodeMirror syntax tree (headings, functions, classes), click to jump. *Pure client-side.*
4. **Markdown preview toggle** — split preview from buffer, links via `openUrl`. *Pure client-side + `openUrl`.*
5. **Persist workspace state** — tabs + drafts, active tab, expanded dirs, splitter. *`storage` (64 KiB/value, 2 MiB total).*
6. **External-change detection** — poll `stat` (size/mtime), warn "changed on disk". *`stat`.*
7. **Tree/tab context menu** — copy absolute/relative path, copy file content. *`writeClipboard`.*
8. **Session-aware status** — session title + busy indicator, auto-refresh on completion. *`onSession`, `onSessionLifecycle`.*
9. **Unsaved-count rail badge** — dirty tab count on the panel icon. *`setBadge`.*
10. **"Open terminal" button** — switch host rail to the built-in terminal. *`openSurface('terminal')`.*

## Tier 2 — small manifest additions

11. **Send selection/file to chat** — `compose` (append) or `prompt` (`prompt` capability for `send: true`).
12. **Message action "open file from message"** — parse path from message text. *`contributes.actions` + `onItem`.*
13. **`/file <path>` slash command** — attach chip with `data: { path }`, reopen on click. *`contributes.commands` + `onResolve` + `onItem`.*
14. **Projects/worktrees browser** — root toggle across registered projects. *`listProjects`, `listWorktrees` (`sessions` capability).*
15. **AI helpers** — explain selection, summarize file. *`generate` (`model` capability; 90 s / 64 KB in / 4 KB out caps).*
16. **One-shot command runner** — format/lint/git-status via local service. *`contributes.service` + `serviceRequest` (≤ 20 s, ≤ 256 KB, no streaming; needs full-rights approval).*

## Tier 3 — blocked on host > 1.24.2

17. **Embedded live terminal** — needs `service.surface` frame-streamed PTY, which 1.24.2 lacks (present on upstream main). No host method, wire type, or manifest point exposes a PTY to guests today; guest WebSockets can't authenticate to host endpoints.

## Explicit non-goals (host has no API)

- Delete / rename / move / mkdir from the tree.
- Real file watching (poll `stat` instead — item 6).
- Search-by-content across files (only `listDir` + per-file `readFile` exist).
