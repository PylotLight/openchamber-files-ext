/**
 * Minimal mock OpenChamber host for driving the real panel bundle under Bun.
 *
 * Runs panel/main.js (IIFE) via indirect eval with a happy-dom Window's
 * globals installed on globalThis, fakes `window.parent`, and answers the
 * guest wire protocol ({channel:"openchamber.sdk", v:1}) like the host would.
 *
 * Run: bun test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHANNEL = "openchamber.sdk";

const THEME_TOKENS: Record<string, string> = Object.fromEntries(
  [
    "background", "elevated", "foreground", "muted", "subtle", "border",
    "hover", "selection", "focus", "primary", "mutedSurface",
    "elevatedForeground", "active", "selectionForeground", "primaryForeground",
    "primaryText", "successText", "warningText", "errorText", "infoText",
    "success", "warning", "error", "info", "font", "mono", "radius",
  ].map((k) => [k, k === "font" || k === "mono" ? "monospace" : "#000"]),
);

export type FileNode =
  | { kind: "directory"; entries: string[] }
  | { kind: "file"; content: string };

export interface BootOptions {
  files: Record<string, FileNode>;
  /** host directory string (session-like => home root "~") */
  directory: string;
  /** hook for storage.get (may delay to simulate a slow host) */
  onStorageGet?: (key: string) => Promise<unknown>;
}

// Globals the bundle + CodeMirror need from the DOM window.
const BASE_KEYS = [
  "window", "self", "document", "navigator", "location", "Window",
  "MutationObserver", "ResizeObserver", "MessageEvent", "MouseEvent",
  "KeyboardEvent", "PointerEvent", "Event", "CustomEvent", "FocusEvent",
  "HTMLElement", "Element", "Node", "Text", "Document", "DocumentFragment",
  "Range", "Selection",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
  "matchMedia", "DOMParser", "fetch",
];

export const bootPanel = async (opts: BootOptions) => {
  const errors: string[] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const fetches: string[] = [];
  const win = new Window({ url: "https://host/panel" }) as unknown as Record<string, unknown>;
  const doc = win.document as Document;
  doc.body.innerHTML = '<div id="root"></div>';

  const ElementCtor = win.Element as unknown as { prototype: { scrollIntoView?: () => void } };
  ElementCtor.prototype.scrollIntoView ??= function () {};

  const toUi = (hostPath: string): string => {
    if (hostPath === "~" || hostPath === ".") return "";
    return hostPath.startsWith("~/") ? hostPath.slice(2) : hostPath;
  };
  const entriesFor = (uiPath: string) => {
    const node = opts.files[uiPath];
    if (!node || node.kind !== "directory") return [];
    return node.entries.map((name) => {
      const child = uiPath ? `${uiPath}/${name}` : name;
      const kind = opts.files[child]?.kind ?? "file";
      return { name, kind: kind === "directory" ? "directory" : "file" };
    });
  };

  const store = new Map<string, unknown>();
  const dispatch = win.dispatchEvent.bind(win);
  const MessageEventCtor = win.MessageEvent as new (type: string, init: Record<string, unknown>) => Event;
  const postToGuest = (msg: unknown) =>
    dispatch(new MessageEventCtor("message", { data: msg, source: fakeParent }));

  const fakeParent = {
    postMessage: (msg: Record<string, unknown>) => {
      if (!msg || msg.channel !== CHANNEL || msg.v !== 1) return;
      void (async () => {
        if (msg.type === "hello") {
          postToGuest({
            channel: CHANNEL, v: 1, type: "ready",
            payload: {
              directory: opts.directory,
              session: null,
              surface: "panel",
              connection: { connected: true, account: {} },
              settings: {},
              item: null,
              theme: { mode: "dark", tokens: THEME_TOKENS },
            },
          });
          return;
        }
        const id = msg.id as string;
        if (!id) return;
        const answer = (payload: unknown) =>
          postToGuest({ channel: CHANNEL, v: 1, type: "result", id, ok: true, payload });
        const payload = msg.payload as Record<string, string>;
        switch (msg.type) {
          case "file-list":
            answer({ entries: entriesFor(toUi(payload.path)) });
            break;
          case "file-read": {
            const node = opts.files[toUi(payload.path)];
            if (!node || node.kind !== "file") {
              postToGuest({ channel: CHANNEL, v: 1, type: "result", id, ok: false, code: "FILE_NOT_FOUND", error: "nope" });
            } else {
              answer({ content: node.content });
            }
            break;
          }
          case "file-write": {
            const target = toUi(payload.path);
            const content = (msg.payload as Record<string, string>).content ?? "";
            writes.push({ path: target, content });
            if (opts.files[target]) opts.files[target] = { kind: "file", content };
            answer({ written: true });
            break;
          }
          case "storage": {
            const op = payload.op;
            if (op === "get") {
              const value = opts.onStorageGet
                ? await opts.onStorageGet(payload.key)
                : store.get(payload.key);
              answer({ op: "get", storage: {}, found: value !== undefined, value });
            } else if (op === "set") {
              store.set(payload.key, (msg.payload as Record<string, unknown>).value);
              answer({ op: "set", storage: {} });
            } else {
              answer({ op, storage: {} });
            }
            break;
          }
          case "toast":
          case "badge":
            answer({});
            break;
          default:
            break;
        }
      })();
    },
  };
  Object.defineProperty(win, "parent", { value: fakeParent, configurable: true });

  // Install window globals, eval the IIFE bundle, then restore.
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  const get = (o: object, k: string) => (o as Record<string, unknown>)[k];
  const INSTALL_KEYS = [...BASE_KEYS];
  for (const key of Object.getOwnPropertyNames(win)) {
    if (/^(HTML|SVG)[A-Za-z]*Element$/.test(key) && !INSTALL_KEYS.includes(key)) {
      INSTALL_KEYS.push(key);
    }
  }
  for (const key of INSTALL_KEYS) {
    saved.set(key, g[key]);
    const value = get(win, key);
    if (key === "getComputedStyle" && typeof value === "function") {
      g[key] = (value as Function).bind(win);
    } else if (value !== undefined) {
      g[key] = value;
    }
  }
  g.window = win;
  g.self = win;
  g.document = doc;

  // The form lazily fetches panel/data/models.json same-origin; serve it from
  // disk so the real catalog code path runs under test.
  const realFetch = globalThis.fetch;
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    fetches.push(url);
    if (url.includes("data/models.json")) {
      const body = readFileSync(join(root, "panel", "data", "models.json"), "utf8");
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (realFetch) return realFetch(input as RequestInfo, init);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const onError = (e: Event) => {
    errors.push(`window.onerror: ${(e as ErrorEvent).message ?? e}`);
  };
  (win.addEventListener as Function).call(win, "error", onError);

  try {
    const js = readFileSync(join(root, "panel", "main.js"), "utf8");
    (0, eval)(`${js}\n//# sourceURL=panel-main.js`);
  } catch (e) {
    errors.push(`bundle eval threw: ${(e as Error)?.stack ?? e}`);
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async <T>(fn: () => T | null | undefined, timeout = 5000): Promise<T> => {
    const start = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - start > timeout) throw new Error("waitFor timed out");
      await sleep(25);
    }
  };

  return {
    win, doc, sleep, waitFor, errors, store, writes, fetches,
    close: async () => {
      // Restore previous globals only after the guest is done (its async
      // continuations resolve document/window lazily).
      for (const key of INSTALL_KEYS) {
        const prev = saved.get(key);
        if (prev === undefined) delete g[key];
        else g[key] = prev;
      }
      if (g.window === win) delete g.window;
      if (g.self === win) delete g.self;
      if (g.document === doc) delete g.document;
      await (win.happyDOM as { close: () => Promise<void> }).close();
    },
  };
};
