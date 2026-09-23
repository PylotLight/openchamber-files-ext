import { connectHost, HostRequestError } from "@openchamber/sdk";
import {
  applyHostReady,
  mountBanner,
  mountButton,
  mountEmpty,
  mountSearchField,
  mountSpinner,
} from "@openchamber/sdk/ui";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { go } from "@codemirror/legacy-modes/mode/go";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { json as jsonLegacy } from "@codemirror/legacy-modes/mode/javascript";

type Entry = { name: string; kind: "file" | "directory" | "other" };
type RootKind = "project" | "home";
type Tab = {
  path: string;
  raw: string;
  draft: string;
  loading: boolean;
  error: string | null;
  edited: boolean;
  synced: boolean;
};

const host = connectHost();
const rootEl = document.querySelector("#root");
if (!rootEl) throw new Error("no root");

const errorText = (error: unknown): string =>
  error instanceof HostRequestError ? `${error.code}: ${error.message}` : String(error);

const joinPath = (base: string, name: string): string =>
  !base || base === "." ? name : `${base}/${name}`;

const parentPath = (path: string): string => {
  if (!path || path === ".") return "";
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
};

const normalizePath = (path: string): string =>
  !path || path === "." ? "" : path;

const kindIcon = (kind: Entry["kind"], name: string): string => {
  if (kind === "directory") return "📁";
  if (name.endsWith(".md")) return "M";
  if (name.endsWith(".json") || name.endsWith(".jsonc")) return "{}";
  if (/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i.test(name)) return "JS";
  if (name.endsWith(".py")) return "Py";
  if (/\.(sh|bash|zsh)$/i.test(name)) return "$";
  if (/\.(ya?ml)$/i.test(name)) return "Y";
  if (name.endsWith(".toml")) return "T";
  if (/\.(css|scss|less)$/i.test(name)) return "#";
  if (/\.(html?|vue)$/i.test(name)) return "<>";
  return "·";
};

const isSessionDirectory = (dir: string | null): boolean => {
  if (!dir) return true;
  return (
    dir.includes("/.config/openchamber/chats/") ||
    /\/session-[0-9a-f-]{8,}/i.test(dir)
  );
};

let didMount = false;
let directory: string | null = null;
let rootKind: RootKind = "home";

let currentPath = "";
const expanded = new Set<string>([""]);
let query = "";
const listings = new Map<string, Entry[]>();
const inflight = new Map<string, Promise<Entry[]>>();

let tabs: Tab[] = [];
let activePath: string | null = null;
let fileSaving = false;
let paintGen = 0;
let treeHeight = 280; // tree pane height; persisted under the historical storage key "editorHeight"
type Split = "horizontal" | "vertical"; // "horizontal" = tree above editor, "vertical" = tree left of editor
let split: Split = "horizontal";
let treeWidth = 260; // tree pane width in vertical split; persisted as "treeWidth"

const els = {
  toolbar: document.createElement("div"),
  search: document.createElement("div"),
  body: document.createElement("div"),
  tree: document.createElement("div"),
  splitter: document.createElement("div"),
  editor: document.createElement("div"),
  status: document.createElement("div"),
};

let searchHandle: ReturnType<typeof mountSearchField> | undefined;
let saveBtn: ReturnType<typeof mountButton> | undefined;
let reloadBtn: ReturnType<typeof mountButton> | undefined;
let stripEl: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let upBtn: ReturnType<typeof mountButton> | undefined;
let crumbsEl: HTMLElement | null = null;
let splitBtn: ReturnType<typeof mountButton> | undefined;
let rootToggleBtn: ReturnType<typeof mountButton> | undefined;

let cm: EditorView | null = null;
let cmHost: HTMLElement | null = null;
let bannerShown = false;
let editorPath: string | null = null;
let applyingDoc = false;
let draftSyncTimer: ReturnType<typeof setTimeout> | null = null;

const langCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

const hostPath = (uiPath: string): string => {
  const p = normalizePath(uiPath);
  if (rootKind === "home") return p ? `~/${p}` : "~";
  return p || ".";
};

const rootLabel = (): string => (rootKind === "home" ? "home" : "project");

const breadcrumbPaths = (path: string): Array<{ label: string; path: string }> => {
  const norm = normalizePath(path);
  const parts = norm ? norm.split("/") : [];
  const crumbs: Array<{ label: string; path: string }> = [
    { label: rootLabel(), path: "" },
  ];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
};

const sortEntries = (entries: Entry[]): Entry[] =>
  [...entries].sort((a, b) => {
    if (a.kind === "directory" && b.kind !== "directory") return -1;
    if (a.kind !== "directory" && b.kind === "directory") return 1;
    return a.name.localeCompare(b.name);
  });

const loadListing = async (uiPath: string, force = false): Promise<Entry[]> => {
  const key = normalizePath(uiPath);
  if (!force) {
    const cached = listings.get(key);
    if (cached) return cached;
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const req = host
    .listDir(hostPath(key))
    .then(({ entries }) => {
      const sorted = sortEntries(entries as Entry[]);
      listings.set(key, sorted);
      inflight.delete(key);
      return sorted;
    })
    .catch((error) => {
      inflight.delete(key);
      throw error;
    });
  if (!force) inflight.set(key, req);
  return req;
};

const expandTo = (path: string) => {
  expanded.clear();
  expanded.add("");
  const norm = normalizePath(path);
  if (!norm) return;
  let acc = "";
  for (const part of norm.split("/")) {
    acc = acc ? `${acc}/${part}` : part;
    expanded.add(acc);
  }
};

const applyRootKind = (kind: RootKind) => {
  if (rootKind === kind) return;
  rootKind = kind;
  resetNavigation();
};

const resolveRootKind = (dir: string | null): RootKind =>
  isSessionDirectory(dir) ? "home" : "project";

const activeTab = (): Tab | null => tabs.find((t) => t.path === activePath) ?? null;

const isDirty = (t: Tab): boolean =>
  t.edited && (!t.synced || t.draft !== t.raw);

// Persist the CodeMirror buffer back into a tab's draft (no-op if no editor).
const flushDraft = (path: string | null) => {
  if (!cm || !path || applyingDoc) return;
  const t = tabs.find((tab) => tab.path === path);
  if (!t) return;
  t.draft = cm.state.doc.toString();
  t.synced = true;
  t.edited = t.draft !== t.raw;
};

const resetNavigation = () => {
  currentPath = "";
  expanded.clear();
  expanded.add("");
  listings.clear();
  inflight.clear();
  query = "";
  searchHandle?.update({ value: "" });
};

const clear = (node: HTMLElement) => {
  node.replaceChildren();
};

const syntaxHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#c678dd" },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: "#e5e5e5" },
  { tag: [t.function(t.variableName), t.labelName], color: "#61afef" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "#56b6c2" },
  { tag: [t.definition(t.name), t.separator], color: "#e5e5e5" },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: "#d19a66" },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: "#56b6c2" },
  { tag: [t.meta, t.comment], color: "#7f848e", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "#61afef", textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: "#e06c75" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#d19a66" },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "#98c379" },
  { tag: t.invalid, color: "#ff5555" },
]);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--oc-bg, #111)",
    color: "var(--oc-text, #eee)",
    fontSize: "13px",
  },
  ".cm-scroller": {
    fontFamily: "var(--oc-mono, ui-monospace, monospace)",
    lineHeight: "1.5",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "var(--oc-text, #eee)",
    padding: "8px 0",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--oc-text, #eee)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(97, 175, 239, 0.28)",
  },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
  ".cm-gutters": {
    backgroundColor: "var(--oc-bg, #111)",
    color: "var(--oc-muted, #666)",
    border: "none",
    borderRight: "1px solid var(--oc-border, #333)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(255,255,255,0.05)",
    color: "var(--oc-text, #eee)",
  },
  ".cm-foldGutter span": { color: "var(--oc-muted, #666)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "rgba(97, 175, 239, 0.2)",
    outline: "none",
  },
  ".cm-selectionMatch": { backgroundColor: "rgba(255,255,255,0.1)" },
});

const languageFor = (path: string): Extension => {
  const name = (path.split("/").pop() || path).toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ jsx: true });
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "json":
      return json();
    case "jsonc":
      return StreamLanguage.define(jsonLegacy);
    case "html":
    case "htm":
    case "vue":
      return html();
    case "css":
    case "scss":
    case "less":
      return css();
    case "md":
    case "markdown":
      return markdown();
    case "py":
    case "pyw":
      return python();
    case "yml":
    case "yaml":
      return StreamLanguage.define(yaml);
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return StreamLanguage.define(shell);
    case "toml":
      return StreamLanguage.define(toml);
    case "ini":
    case "properties":
    case "gitconfig":
    case "editorconfig":
      return StreamLanguage.define(properties);
    case "sql":
      return StreamLanguage.define(standardSQL);
    case "go":
      return StreamLanguage.define(go);
    case "rs":
      return StreamLanguage.define(rust);
    case "rb":
      return StreamLanguage.define(ruby);
    default:
      return [];
  }
};

const scheduleDraftSync = () => {
  if (draftSyncTimer) return;
  draftSyncTimer = setTimeout(() => {
    draftSyncTimer = null;
    const t = activeTab();
    if (!t || !cm || applyingDoc) return;
    t.draft = cm.state.doc.toString();
    t.synced = true;
    t.edited = t.draft !== t.raw;
    syncChrome(t);
    patchTreeState();
    paintStatus();
  }, 80);
};

const ensureCm = (tab: Tab) => {
  if (cm && cmHost && editorPath === tab.path && cmHost.isConnected) return cm;

  if (cm) {
    cm.destroy();
    cm = null;
  }
  if (cmHost) {
    cmHost.remove();
    cmHost = null;
  }

  editorPath = tab.path;
  bannerShown = false;

  cmHost = document.createElement("div");
  cmHost.className = "oc-cm-host";
  els.editor.appendChild(cmHost);

  applyingDoc = true;
  cm = new EditorView({
    parent: cmHost,
    state: EditorState.create({
      doc: tab.loading ? "" : tab.draft,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        foldGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(syntaxHighlight),
        EditorState.tabSize.of(2),
        indentUnit.of("  "),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              void saveFile();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        langCompartment.of(languageFor(tab.path)),
        readOnlyCompartment.of([
          EditorState.readOnly.of(tab.loading || fileSaving),
          EditorView.editable.of(!(tab.loading || fileSaving)),
        ]),
        editorTheme,
        EditorView.updateListener.of((u) => {
          if (applyingDoc) return;
          if (u.docChanged) {
            const t = activeTab();
            if (!t) return;
            const was = isDirty(t);
            t.edited = true;
            t.synced = false;
            if (!was) {
              t.draft = u.state.doc.toString();
              t.synced = true;
              if (t.draft === t.raw) {
                t.edited = false;
              }
            }
            syncChrome(t);
            patchTreeState();
            paintStatus();
            scheduleDraftSync();
          }
        }),
      ],
    }),
  });
  applyingDoc = false;
  const view = cm;
  // The view is often created in the same frame its container unhides;
  // re-measure after layout settles so first paint isn't blank.
  requestAnimationFrame(() => {
    if (cm === view) view.requestMeasure();
  });
  return cm;
};

const showEditor = (show: boolean) => {
  els.editor.classList.add("oc-files-editor");
  els.editor.style.display = show ? "flex" : "none";
  els.splitter.style.display = show ? "block" : "none";
  if (split === "vertical") {
    if (show) {
      const rootW = rootEl!.clientWidth || 900;
      const maxTree = Math.max(200, Math.floor(rootW * 0.6));
      const treeW = Math.min(maxTree, Math.max(160, treeWidth));
      els.tree.style.flex = `0 0 ${treeW}px`;
      els.tree.style.width = `${treeW}px`;
      els.tree.style.height = "auto";
      els.tree.style.minWidth = "160px";
      els.tree.style.maxWidth = `${maxTree}px`;
      els.tree.style.minHeight = "0";
      els.tree.style.maxHeight = "none";
      els.editor.style.flex = "1 1 auto";
      els.editor.style.width = "auto";
      els.editor.style.height = "auto";
      els.editor.style.minWidth = "0";
      els.editor.style.minHeight = "0";
      els.editor.style.overflow = "hidden";
      cm?.requestMeasure();
      requestAnimationFrame(() => cm?.requestMeasure());
    } else {
      els.tree.style.flex = "1 1 auto";
      els.tree.style.width = "auto";
      els.tree.style.minWidth = "0";
      els.tree.style.maxWidth = "none";
      els.editor.style.flex = "0 0 auto";
      els.editor.style.width = "0px";
      els.editor.style.minWidth = "0px";
      els.editor.style.overflow = "hidden";
    }
    return;
  }
  if (show) {
    const rootH = rootEl!.clientHeight || 800;
    const maxTree = Math.max(120, Math.floor(rootH * 0.75));
    const treeH = Math.min(maxTree, Math.max(80, treeHeight));
    els.tree.style.flex = `0 0 ${treeH}px`;
    els.tree.style.height = `${treeH}px`;
    els.tree.style.width = "auto";
    els.tree.style.minHeight = "80px";
    els.tree.style.maxHeight = `${maxTree}px`;
    els.tree.style.minWidth = "0";
    els.tree.style.maxWidth = "none";
    els.editor.style.flex = "1 1 auto";
    els.editor.style.height = "auto";
    els.editor.style.minHeight = "200px";
    els.editor.style.overflow = "hidden";
    cm?.requestMeasure();
    requestAnimationFrame(() => cm?.requestMeasure());
  } else {
    els.tree.style.flex = "1 1 auto";
    els.tree.style.height = "auto";
    els.tree.style.minHeight = "60px";
    els.tree.style.maxHeight = "none";
    els.editor.style.flex = "0 0 auto";
    els.editor.style.height = "0px";
    els.editor.style.minHeight = "0px";
    els.editor.style.overflow = "hidden";
  }
};

const splitLabel = () =>
  split === "vertical" ? "Layout: Side-by-side" : "Layout: Stacked";

// Apply split orientation to the body container + splitter chrome, then relayout.
const applySplit = () => {
  const vertical = split === "vertical";
  els.body.style.flexDirection = vertical ? "row" : "column";
  els.splitter.style.width = vertical ? "6px" : "auto";
  els.splitter.style.height = vertical ? "auto" : "6px";
  els.splitter.style.flex = "0 0 6px";
  els.splitter.style.cursor = vertical ? "col-resize" : "row-resize";
  els.editor.style.borderTop = vertical
    ? "none"
    : "1px solid var(--oc-border, #333)";
  splitBtn?.update({ label: splitLabel() });
  showEditor(Boolean(activeTab()));
};

const styleUi = () => {
  if (document.getElementById("oc-files-css")) return;
  const style = document.createElement("style");
  style.id = "oc-files-css";
  style.textContent = `
.ft-row { display:flex; align-items:center; gap:6px; padding:4px 10px; cursor:pointer; user-select:none; font-size:13px; line-height:1.35; min-width:0; }
.ft-row:hover { background: var(--oc-hover, rgba(255,255,255,0.06)); }
.ft-row.is-active { background: var(--oc-hover, rgba(255,255,255,0.08)); border-radius:6px; }
.ft-row.is-dir .ft-tw { color: var(--oc-muted, #888); opacity:1; font-size:10px; }
.ft-row.is-dir .ft-ic-dir { font-size:12px; opacity:0.9; min-width:1.5em; }
.ft-label-dir { font-weight:600; color: var(--oc-text, #eee); }
.ft-tw { width:1em; flex:0 0 auto; opacity:0.7; font-size:11px; }
.ft-ic { flex:0 0 auto; font-size:10px; opacity:0.65; min-width:1.4em; text-align:center; font-family:var(--oc-mono, monospace); }
.ft-label { flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ft-dot { width:7px; height:7px; border-radius:50%; background:var(--oc-primary, #6af); flex:0 0 auto; }
.oc-files-editor { display:flex; flex-direction:column; min-height:0; }
.oc-files-editor .oc-tabstrip { display:flex; align-items:center; gap:2px; overflow-x:auto; flex:0 0 auto; padding:4px 0 0; min-height:28px; }
.oc-files-editor .oc-chip { display:flex; align-items:center; gap:6px; max-width:180px; padding:3px 6px 3px 8px; border-radius:6px 6px 0 0; font-size:12px; cursor:pointer; font-family:var(--oc-mono, monospace); border:1px solid transparent; border-bottom:none; opacity:0.75; }
.oc-files-editor .oc-chip.is-active { background:var(--oc-panel, #1a1a1a); border-color:var(--oc-border,#333); opacity:1; }
.oc-files-editor .oc-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding-top:6px; flex:0 0 auto; }
.oc-cm-host { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; overflow:hidden; border-top:1px solid var(--oc-border, #333); }
.oc-cm-host .cm-editor { flex:1 1 auto; min-height:0; height:100%; }
.oc-cm-host .cm-editor.cm-focused { outline:none; }
.oc-cm-host[hidden] { display:none; }
.oc-crumbs { display:flex; align-items:center; gap:4px; flex:1 1 auto; flex-wrap:wrap; font-size:12px; min-width:0; }
.oc-crumb { border:none; background:transparent; color:inherit; cursor:pointer; padding:2px 4px; border-radius:4px; font:inherit; opacity:0.85; }
.oc-crumb:hover { background: var(--oc-hover, rgba(255,255,255,0.08)); }
`;
  document.head.appendChild(style);
};

const paintStatus = () => {
  const bits: string[] = [];
  if (rootKind === "home") bits.push("~ (home)");
  else if (directory) bits.push(directory);
  else bits.push("no project");
  const tab = activeTab();
  if (tab) {
    bits.push(`editing: ${hostPath(tab.path)}`);
    if (isDirty(tab)) bits.push("unsaved");
  }
  if (fileSaving) bits.push("saving…");
  els.status.textContent = bits.join("  ·  ");
};

const dirtyPaths = (): Set<string> => {
  const s = new Set<string>();
  for (const t of tabs) if (isDirty(t)) s.add(t.path);
  return s;
};

const patchTreeState = () => {
  const dirty = dirtyPaths();
  for (const row of Array.from(els.tree.querySelectorAll<HTMLElement>(".ft-row"))) {
    const path = row.dataset.path || "";
    const isDir = row.dataset.dir === "1";
    row.classList.toggle("is-active", !isDir && path === activePath);
    const existing = row.querySelector(".ft-dot");
    const want = !isDir && dirty.has(path);
    if (want && !existing) {
      const dot = document.createElement("span");
      dot.className = "ft-dot";
      row.appendChild(dot);
    } else if (!want && existing) {
      existing.remove();
    }
  }
};

const collectNeeded = (): Set<string> => {
  const needed = new Set<string>([""]);
  const addAncestors = (path: string) => {
    const norm = normalizePath(path);
    if (!norm) return;
    let acc = "";
    for (const part of norm.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      needed.add(acc);
    }
  };
  for (const path of expanded) addAncestors(path);
  addAncestors(currentPath);
  return needed;
};

const renderTree = () => {
  const dirty = dirtyPaths();
  const filter = query.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  let anyVisible = false;

  const renderLevel = (path: string, depth: number) => {
    const entries = listings.get(path) ?? [];
    const visible = filter
      ? entries.filter((e) => e.name.toLowerCase().includes(filter))
      : entries;
    for (const entry of visible) {
      anyVisible = true;
      const childPath = joinPath(path, entry.name);
      const isDir = entry.kind === "directory";
      const isOpen = isDir && expanded.has(childPath);
      const isActive = !isDir && activePath === childPath;

      const row = document.createElement("div");
      row.className =
        "ft-row" + (isActive ? " is-active" : "") + (isDir ? " is-dir" : "");
      row.dataset.path = childPath;
      row.dataset.dir = isDir ? "1" : "0";
      row.title = hostPath(childPath);
      row.style.paddingLeft = `${10 + depth * 14}px`;

      const tw = document.createElement("span");
      tw.className = "ft-tw";
      tw.textContent = isDir ? (isOpen ? "▾" : "▸") : "";
      row.appendChild(tw);

      const ic = document.createElement("span");
      ic.className = "ft-ic" + (isDir ? " ft-ic-dir" : "");
      ic.textContent = kindIcon(entry.kind, entry.name);
      row.appendChild(ic);

      const label = document.createElement("span");
      label.className = "ft-label";
      label.textContent = entry.name;
      if (isDir) label.classList.add("ft-label-dir");
      row.appendChild(label);

      if (!isDir && dirty.has(childPath)) {
        const dot = document.createElement("span");
        dot.className = "ft-dot";
        row.appendChild(dot);
      }

      frag.appendChild(row);

      if (isDir && isOpen) renderLevel(childPath, depth + 1);
    }
  };

  renderLevel("", 0);

  clear(els.tree);
  els.tree.appendChild(frag);

  if (!anyVisible) {
    const box = document.createElement("div");
    box.style.padding = "12px";
    els.tree.appendChild(box);
    if (filter) {
      mountEmpty(box, {
        title: "No matches",
        body: `Nothing matches “${query.trim()}”.`,
      });
    } else {
      mountEmpty(box, {
        title: rootKind === "home" ? "Home is empty" : "Empty folder",
        body:
          rootKind === "home"
            ? "No entries under ~."
            : "This project has no files at the root.",
      });
    }
  }
};

const paintTree = async () => {
  const gen = ++paintGen;
  const needed = collectNeeded();
  const missing = [...needed].filter((p) => !listings.has(p));

  if (missing.length > 0) {
    const spinnerBox = document.createElement("div");
    spinnerBox.style.padding = "12px";
    const existing = els.tree.firstElementChild;
    // Keep prior rows visible; only inject spinner if tree is empty-ish
    if (!existing || els.tree.querySelectorAll(".ft-row").length === 0) {
      clear(els.tree);
      els.tree.appendChild(spinnerBox);
    } else {
      spinnerBox.style.display = "none";
      els.tree.appendChild(spinnerBox);
    }
    const spinner = mountSpinner(spinnerBox, { label: "Loading…" });
    try {
      await Promise.all(missing.map((p) => loadListing(p)));
    } catch (error) {
      if (gen !== paintGen) return;
      spinner.dispose();
      clear(els.tree);
      const box = document.createElement("div");
      box.style.padding = "12px";
      els.tree.appendChild(box);
      mountBanner(box, {
        tone: "error",
        title: "Could not list directory",
        body: errorText(error),
        action: { label: "Retry", onClick: () => void paintTree() },
      });
      return;
    }
    if (gen !== paintGen) return;
    spinner.dispose();
  }

  if (gen !== paintGen) return;
  renderTree();
};

const onTreeClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  const row = target?.closest<HTMLElement>(".ft-row");
  if (!row || !els.tree.contains(row)) return;
  const path = row.dataset.path;
  if (!path) return;
  const isDir = row.dataset.dir === "1";
  void (async () => {
    if (isDir) {
      if (expanded.has(path)) expanded.delete(path);
      else expanded.add(path);
      currentPath = path;
      paintToolbar();
      await paintTree();
    } else {
      await openFileAt(path);
    }
  })();
};

const buildTabStrip = () => {
  stripEl = document.createElement("div");
  stripEl.className = "oc-tabstrip";
  els.editor.appendChild(stripEl);
  paintStrip();
};

const paintStrip = () => {
  if (!stripEl) return;
  clear(stripEl);
  const dirty = dirtyPaths();
  for (const t of tabs) {
    const isActive = t.path === activePath;
    const chip = document.createElement("div");
    chip.className = "oc-chip" + (isActive ? " is-active" : "");
    chip.dataset.path = t.path;

    const name = t.path.split("/").pop() || t.path;
    const label = document.createElement("span");
    label.style.cssText =
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    label.textContent = name;
    label.title = hostPath(t.path);
    chip.appendChild(label);

    if (dirty.has(t.path)) {
      const dot = document.createElement("span");
      dot.className = "ft-dot";
      chip.appendChild(dot);
    }

    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = "Close";
    x.style.cssText =
      "border:none;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;opacity:0.7;";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(t.path);
    });
    chip.appendChild(x);
    chip.addEventListener("click", () => {
      void activateTab(t.path);
    });
    stripEl.appendChild(chip);
  }
};

const destroyEditorDom = () => {
  if (cm) {
    cm.destroy();
    cm = null;
  }
  cmHost = null;
  editorPath = null;
  stripEl = null;
  titleEl = null;
  saveBtn = undefined;
  reloadBtn = undefined;
  bannerShown = false;
  clear(els.editor);
};

const showReadError = (tab: Tab) => {
  destroyEditorDom();
  editorPath = tab.path;
  bannerShown = true;
  buildTabStrip();

  const head = document.createElement("div");
  head.className = "oc-head";
  els.editor.appendChild(head);
  titleEl = document.createElement("div");
  titleEl.style.cssText =
    "flex:1 1 auto;font-size:12px;opacity:0.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--oc-mono, monospace);";
  titleEl.textContent = hostPath(tab.path);
  head.appendChild(titleEl);

  mountBanner(els.editor, {
    tone: "error",
    title: "Could not read file",
    body: tab.error || "Unknown error",
    action: {
      label: "Retry",
      onClick: () => void openFileAt(tab.path, true),
    },
  });
};

const buildEditorChrome = (tab: Tab) => {
  clear(els.editor);
  if (cm) {
    cm.destroy();
    cm = null;
  }
  cmHost = null;
  editorPath = tab.path;
  bannerShown = false;

  buildTabStrip();

  const head = document.createElement("div");
  head.className = "oc-head";
  els.editor.appendChild(head);

  titleEl = document.createElement("div");
  titleEl.style.cssText =
    "flex:1 1 auto;font-size:12px;opacity:0.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--oc-mono, monospace);";
  titleEl.textContent = hostPath(tab.path);
  head.appendChild(titleEl);

  saveBtn = mountButton(head, {
    label: "Save",
    size: "xs",
    variant: "default",
    disabled: !isDirty(tab) || fileSaving || tab.loading,
    loading: fileSaving,
    onClick: () => void saveFile(),
  });
  reloadBtn = mountButton(head, {
    label: "Reload",
    size: "xs",
    variant: "ghost",
    disabled: fileSaving || tab.loading || !isDirty(tab),
    onClick: () => {
      void openFileAt(tab.path, true);
    },
  });
  mountButton(head, {
    label: "Close",
    size: "xs",
    variant: "ghost",
    onClick: () => closeTab(tab.path),
  });

  ensureCm(tab);
};

const syncChrome = (tab: Tab) => {
  if (titleEl) titleEl.textContent = hostPath(tab.path);
  const dirty = isDirty(tab);
  saveBtn?.update({ disabled: !dirty || fileSaving || tab.loading, loading: fileSaving });
  reloadBtn?.update({ disabled: fileSaving || tab.loading || !dirty });
  if (cm) {
    const ro = tab.loading || fileSaving;
    cm.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(ro),
        EditorView.editable.of(!ro),
      ]),
    });
  }
  if (stripEl) paintStrip();
};

const paintEditor = () => {
  const tab = activeTab();

  if (!tab) {
    destroyEditorDom();
    showEditor(false);
    paintStatus();
    return;
  }

  showEditor(true);

  if (tab.error) {
    if (!bannerShown || editorPath !== tab.path) {
      showReadError(tab);
    } else {
      paintStrip();
    }
    paintStatus();
    return;
  }

  const needChrome =
    !cm ||
    editorPath !== tab.path ||
    bannerShown ||
    !stripEl ||
    !titleEl;
  if (needChrome) {
    buildEditorChrome(tab);
  } else {
    syncChrome(tab);
  }
  paintStatus();
};

const setDoc = (view: EditorView, text: string, path: string) => {
  applyingDoc = true;
  try {
    const cur = view.state.doc.toString();
    view.dispatch({
      changes:
        cur === text
          ? {}
          : { from: 0, to: view.state.doc.length, insert: text },
      effects: [
        langCompartment.reconfigure(languageFor(path)),
        readOnlyCompartment.reconfigure([
          EditorState.readOnly.of(false),
          EditorView.editable.of(true),
        ]),
      ],
    });
  } finally {
    applyingDoc = false;
  }
};

const openFileAt = async (path: string, force = false) => {
  let tab = tabs.find((t) => t.path === path);
  const isNew = !tab;

  if (activePath && activePath !== path) flushDraft(activePath);

  if (!tab) {
    tab = {
      path,
      raw: "",
      draft: "",
      loading: true,
      error: null,
      edited: false,
      synced: true,
    };
    tabs = [...tabs, tab];
  }

  activePath = path;
  const mustRead = force || isNew || tab.loading;

  if (force) {
    tab.loading = true;
    tab.error = null;
    tab.raw = "";
    tab.draft = "";
    tab.edited = false;
    tab.synced = true;
  } else if (isNew || tab.loading) {
    tab.loading = true;
    tab.error = null;
  }

  paintEditor();
  patchTreeState();

  if (!mustRead) {
    paintStrip();
    return;
  }

  try {
    const { content } = await host.readFile(hostPath(path));
    tab.raw = content;
    tab.draft = content;
    tab.loading = false;
    tab.error = null;
    tab.edited = false;
    tab.synced = true;
  } catch (error) {
    tab.loading = false;
    tab.error = errorText(error);
    tab.raw = "";
    tab.draft = "";
    tab.edited = false;
    tab.synced = true;
  }

  if (activePath === path) {
    paintEditor();
    const view = cm;
    if (view && !tab.error) {
      setDoc(view, tab.draft, tab.path);
      view.dispatch({ selection: { anchor: 0 } });
      view.requestMeasure();
    }
    paintStatus();
    patchTreeState();
  }
};

const activateTab = async (path: string) => {
  if (activePath === path) return;
  flushDraft(activePath);
  activePath = path;
  const tab = activeTab();
  paintEditor();
  if (tab && cm && !tab.error) {
    setDoc(cm, tab.draft, tab.path);
    cm.requestMeasure();
  }
  patchTreeState();
  paintStatus();
};

const closeTab = (path: string) => {
  if (activePath === path) flushDraft(path);
  tabs = tabs.filter((t) => t.path !== path);
  if (activePath === path) {
    activePath = tabs.length ? tabs[tabs.length - 1]!.path : null;
  }
  paintEditor();
  const tab = activeTab();
  if (tab && cm && !tab.error) {
    setDoc(cm, tab.draft, tab.path);
    cm.requestMeasure();
  }
  patchTreeState();
  paintStatus();
};

const saveFile = async () => {
  const tab = activeTab();
  if (!tab || fileSaving) return;
  if (cm) {
    tab.draft = cm.state.doc.toString();
    tab.synced = true;
    tab.edited = tab.draft !== tab.raw;
  }
  const path = tab.path;
  const written = tab.draft;
  fileSaving = true;
  syncChrome(tab);
  paintStatus();
  try {
    await host.writeFile(hostPath(path), written);
    tab.raw = written;
    tab.edited = false;
    tab.synced = true;
    await host.toast({ kind: "success", message: `Saved ${path}` });
  } catch (error) {
    await host.toast({ kind: "error", message: errorText(error) });
  } finally {
    fileSaving = false;
    syncChrome(tab);
    paintStatus();
    patchTreeState();
    paintStrip();
  }
};

let toolbarBuilt = false;
let rootToggleWrap: HTMLSpanElement | null = null;

const buildToolbar = () => {
  if (toolbarBuilt) return;
  toolbarBuilt = true;
  clear(els.toolbar);

  rootToggleWrap = document.createElement("span");
  rootToggleWrap.style.display = "contents";
  els.toolbar.appendChild(rootToggleWrap);
  rootToggleBtn = mountButton(rootToggleWrap, {
    label: "Home",
    size: "xs",
    variant: "ghost",
    onClick: () => {
      applyRootKind(rootKind === "project" ? "home" : "project");
      updateToolbar();
      void paintTree();
      paintStatus();
    },
  });

  upBtn = mountButton(els.toolbar, {
    label: "↑",
    size: "xs",
    variant: "outline",
    disabled: !currentPath,
    onClick: () => {
      currentPath = parentPath(currentPath);
      expandTo(currentPath);
      updateToolbar();
      void paintTree();
    },
  });

  crumbsEl = document.createElement("span");
  crumbsEl.className = "oc-crumbs";
  els.toolbar.appendChild(crumbsEl);

  mountButton(els.toolbar, {
    label: "Refresh",
    size: "xs",
    variant: "ghost",
    onClick: () => {
      listings.clear();
      inflight.clear();
      void paintTree();
    },
  });

  splitBtn = mountButton(els.toolbar, {
    label: splitLabel(),
    size: "xs",
    variant: "ghost",
    onClick: () => {
      split = split === "horizontal" ? "vertical" : "horizontal";
      void host.storage.set("split", split);
      applySplit();
    },
  });
};

const updateToolbar = () => {
  buildToolbar();

  const showRoot = Boolean(directory && !isSessionDirectory(directory));
  rootToggleWrap!.style.display = showRoot ? "contents" : "none";
  if (showRoot) {
    rootToggleBtn!.update({
      label: rootKind === "project" ? "Home" : "Project",
      variant: rootKind === "project" ? "ghost" : "secondary",
      size: "xs",
      disabled: false,
    });
  }

  upBtn!.update({ disabled: !currentPath });

  splitBtn!.update({ label: splitLabel() });

  clear(crumbsEl!);
  for (const crumb of breadcrumbPaths(currentPath)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "oc-crumb";
    btn.textContent = crumb.label;
    btn.title = crumb.path ? hostPath(crumb.path) : hostPath("");
    btn.addEventListener("click", () => {
      currentPath = crumb.path;
      expandTo(currentPath);
      updateToolbar();
      void paintTree();
    });
    crumbsEl!.appendChild(btn);
  }
};

const paintToolbar = () => updateToolbar();

const styleEls = () => {
  const css = (el: HTMLElement, styles: Record<string, string>) => {
    Object.assign(el.style, styles);
  };
  css(els.toolbar, {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 10px",
    borderBottom: "1px solid var(--oc-border, #333)",
    flexWrap: "wrap",
    minHeight: "40px",
  });
  css(els.search, {
    padding: "8px 10px",
    borderBottom: "1px solid var(--oc-border, #333)",
  });
  css(els.body, {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minHeight: "0",
    minWidth: "0",
    overflow: "hidden",
  });
  css(els.tree, {
    flex: "1 1 auto",
    overflow: "auto",
    padding: "6px 0",
    minHeight: "60px",
    minWidth: "0",
  });
  css(els.splitter, {
    display: "none",
    height: "6px",
    flex: "0 0 6px",
    cursor: "row-resize",
    background: "var(--oc-border, #333)",
    touchAction: "none",
    userSelect: "none",
  });
  css(els.editor, {
    display: "none",
    flexDirection: "column",
    flex: "1 1 auto",
    height: "auto",
    minHeight: "200px",
    borderTop: "1px solid var(--oc-border, #333)",
    overflow: "hidden",
    minWidth: "0",
  });
  css(els.status, {
    padding: "4px 10px",
    fontSize: "12px",
    opacity: "0.75",
    borderTop: "1px solid var(--oc-border, #333)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });

  els.tree.addEventListener("click", onTreeClick);

  els.splitter.addEventListener("pointerenter", () => {
    if (!els.splitter.dataset.dragging) {
      els.splitter.style.background = "var(--oc-primary, #6af)";
    }
  });
  els.splitter.addEventListener("pointerleave", () => {
    if (!els.splitter.dataset.dragging) {
      els.splitter.style.background = "var(--oc-border, #333)";
    }
  });
  els.splitter.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    els.splitter.dataset.dragging = "1";
    els.splitter.style.background = "var(--oc-primary, #6af)";
    try {
      els.splitter.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const vertical = split === "vertical";
    const startPos = vertical ? event.clientX : event.clientY;
    const startSize = vertical
      ? Number.parseFloat(els.tree.style.width) ||
        treeWidth ||
        Math.round((rootEl!.clientWidth || 900) * 0.3)
      : Number.parseFloat(els.tree.style.height) ||
        treeHeight ||
        Math.round((rootEl!.clientHeight || 800) * 0.32);
    const total = vertical
      ? rootEl!.clientWidth || 900
      : rootEl!.clientHeight || 800;
    const max = vertical
      ? Math.max(200, Math.floor(total * 0.6))
      : Math.max(120, Math.floor(total * 0.75));
    const min = vertical ? 160 : 80;
    let raf = 0;
    let lastPos = startPos;
    const apply = () => {
      raf = 0;
      const size = Math.min(max, Math.max(min, startSize + (lastPos - startPos)));
      els.tree.style.flex = `0 0 ${size}px`;
      if (vertical) {
        treeWidth = size;
        els.tree.style.width = `${size}px`;
      } else {
        treeHeight = size;
        els.tree.style.height = `${size}px`;
      }
    };
    const onMove = (move: PointerEvent) => {
      lastPos = vertical ? move.clientX : move.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onUp = (up: PointerEvent) => {
      delete els.splitter.dataset.dragging;
      els.splitter.style.background = "var(--oc-border, #333)";
      try {
        els.splitter.releasePointerCapture(up.pointerId);
      } catch {
        /* ignore */
      }
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        apply();
      }
      els.splitter.removeEventListener("pointermove", onMove);
      els.splitter.removeEventListener("pointerup", onUp);
      els.splitter.removeEventListener("pointercancel", onUp);
      cm?.requestMeasure();
      void host.storage.set(
        vertical ? "treeWidth" : "editorHeight",
        vertical ? treeWidth : treeHeight,
      );
      paintStatus();
    };
    els.splitter.addEventListener("pointermove", onMove);
    els.splitter.addEventListener("pointerup", onUp);
    els.splitter.addEventListener("pointercancel", onUp);
  });
};

let searchTimer: ReturnType<typeof setTimeout> | null = null;

const mountOnce = () => {
  styleUi();
  styleEls();
  rootEl!.appendChild(els.toolbar);
  rootEl!.appendChild(els.search);
  rootEl!.appendChild(els.body);
  els.body.appendChild(els.tree);
  els.body.appendChild(els.splitter);
  els.body.appendChild(els.editor);
  rootEl!.appendChild(els.status);

  searchHandle = mountSearchField(els.search, {
    value: query,
    placeholder: "Search files…",
    onChange: (next) => {
      query = next;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchTimer = null;
        void paintTree();
      }, 120);
    },
  });

  void host.storage
    .get("editorHeight")
    .then((value) => {
      if (typeof value === "number" && value >= 80 && value <= 2000) {
        treeHeight = value;
      }
      showEditor(Boolean(activeTab()));
    })
    .catch(() => {});

  void host.storage
    .get("treeWidth")
    .then((value) => {
      if (typeof value === "number" && value >= 160 && value <= 1600) {
        treeWidth = value;
      }
    })
    .catch(() => {});

  void host.storage
    .get("split")
    .then((value) => {
      if (value === "vertical" || value === "horizontal") {
        split = value;
      }
      applySplit();
    })
    .catch(() => {});

  paintToolbar();
  void paintTree();
  paintStatus();
};

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  document.body.dataset.surface = ctx.surface;
  if (!didMount) {
    didMount = true;
    mountOnce();
  }
});

host.onDirectory(async (next) => {
  const changed = next !== directory;
  const prevKind = rootKind;
  directory = next;
  const kind = resolveRootKind(next);
  rootKind = kind;

  if (changed || prevKind !== kind) {
    if (prevKind !== kind) {
      tabs = [];
      activePath = null;
      destroyEditorDom();
      showEditor(false);
    }
    resetNavigation();
    paintToolbar();
    await paintTree();
    paintStatus();
  }
});
