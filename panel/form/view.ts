/**
 * The form view: state, layout, and the bridge between the file's text and the
 * rendered controls.
 *
 * The document is the source of truth and it lives as *text*. Controls mutate
 * it through surgical JSONC edits, so the text editor, the dirty state, Save,
 * and Reload all keep working exactly as before — the form is just another view
 * onto the same buffer.
 */
import { mountSearchField, mountSwitch } from "@openchamber/sdk/ui";
import {
  detectFormatting,
  hasPath,
  isObject,
  parseDoc,
  pathKey,
  readValue,
  writeValue,
  type Json,
  type Path,
} from "./core";
import { type ErrorSink, type FormContext } from "./context";
import { onCatalog, catalogState, loadCatalog, type CatalogState } from "./catalog";
import { registerOverride, renderField } from "./fields";
import { modelRefField, providerSection } from "./provider";
import { mcpSection, permissionSection, pluginSection } from "./special";
import { isDeprecated, properties, ROOT_SCHEMA, type Schema } from "./schema";
import { validate, type ValidationResult } from "./validate";
import { card, el, grid, injectFormCss, span } from "./ui";

const CONFIG_SCHEMA_URL = "opencode.ai/config.json";

type SectionSpec =
  | { kind: "custom"; key: string; title: string }
  | { kind: "group"; title: string; keys: string[]; note?: string };

/** Reading order for a config file: the things people edit, first. */
const SECTIONS: SectionSpec[] = [
  { kind: "custom", key: "provider", title: "Providers" },
  { kind: "group", title: "Models", keys: ["model", "small_model"] },
  { kind: "group", title: "Agents", keys: ["agent", "default_agent", "subagent_depth"] },
  { kind: "custom", key: "mcp", title: "MCP servers" },
  { kind: "custom", key: "permission", title: "Permissions" },
  { kind: "group", title: "Commands", keys: ["command"] },
  { kind: "custom", key: "plugin", title: "Plugins" },
  { kind: "group", title: "Formatter & LSP", keys: ["formatter", "lsp"] },
  {
    kind: "group",
    title: "Server & sharing",
    keys: ["server", "share", "autoupdate", "username", "shell", "logLevel"],
  },
  {
    kind: "group",
    title: "Skills & references",
    keys: ["skills", "references", "watcher", "instructions", "snapshot", "layout"],
  },
  {
    kind: "group",
    title: "Attachments & output",
    keys: ["attachment", "tool_output", "compaction", "experimental"],
  },
];

const CUSTOM_RENDERERS: Record<string, (ctx: FormContext, path: Path, schema: Schema) => HTMLElement> = {
  provider: (ctx, path, schema) => providerSection(ctx, path, schema),
  mcp: (ctx, path, schema) => mcpSection(ctx, path, schema),
  permission: (ctx, path, schema) => permissionSection(ctx, path, schema),
  plugin: (ctx, path, schema) => pluginSection(ctx, path, schema),
};

let overridesRegistered = false;

const registerOverrides = () => {
  if (overridesRegistered) return;
  overridesRegistered = true;
  for (const [key, render] of Object.entries(CUSTOM_RENDERERS)) {
    registerOverride({
      id: `custom:${key}`,
      match: (path) => path.length === 1 && path[0] === key,
      render: (ctx, schema, path) => render(ctx, path, schema),
    });
  }
  // `permission` is meaningful at any depth (per-agent rules).
  registerOverride({
    id: "custom:permission-anywhere",
    match: (path) => path[path.length - 1] === "permission",
    render: (ctx, schema, path) => permissionSection(ctx, path, schema),
  });
  registerOverride({
    id: "model-ref",
    match: (path) => {
      const last = path[path.length - 1];
      return last === "model" || last === "small_model";
    },
    render: (ctx, schema, path) => modelRefField(ctx, path, schema),
  });
};

export type FormViewOptions = {
  /** Current file text. */
  getText: () => string;
  /** Called with new text after every edit; the host writes it to the tab. */
  setText: (text: string) => void;
  loadExpanded?: () => Promise<string[]>;
  saveExpanded?: (keys: string[]) => void;
};

export type FormView = {
  element: HTMLElement;
  /** Re-read the text and repaint. */
  sync: (options?: { repaint?: boolean }) => void;
  /** Repaint from current state. */
  refresh: () => void;
  destroy: () => void;
  debug: {
    text: () => string;
    data: () => Json;
    errorCount: () => number;
    parseError: () => string | null;
    expanded: () => string[];
  };
};

export const createFormView = (options: FormViewOptions): FormView => {
  registerOverrides();
  injectFormCss();

  const root = el("div", "ocf-scroll");
  const bar = el("div", "ocf-bar");
  const body = el("div", "ocf-body");
  root.append(bar, body);

  let text = options.getText();
  let data: Json = {};
  let fmt = detectFormatting(text);
  let parseError: string | null = null;
  let validation: ValidationResult = { byField: new Map(), errorPaths: new Set(), count: 0, available: true };
  const expanded = new Set<string>();
  let filter = "";
  let onlySet = false;
  let renderQueued = 0;
  const sinks = new Map<string, ErrorSink>();
  let catalog: CatalogState = catalogState();
  let disposed = false;

  // --- document plumbing -------------------------------------------------

  const reparse = () => {
    const parsed = parseDoc(text);
    data = parsed.data;
    parseError = parsed.error;
    validation = validate(data);
  };

  const pushErrors = () => {
    for (const [key, sink] of sinks) sink(validation.byField.get(key));
  };

  const commitText = (next: string) => {
    if (next === text) return;
    text = next;
    fmt = detectFormatting(text);
    reparse();
    pushErrors();
    options.setText(text);
  };

  const ctx: FormContext = {
    get data() {
      return data;
    },
    get: (path) => readValue(data, path),
    has: (path) => hasPath(data, path),
    set: (path, value) => commitText(writeValue(text, path, value, fmt)),
    remove: (path) => commitText(writeValue(text, path, undefined, fmt)),
    errorAt: (path) => validation.byField.get(pathKey(path)),
    onError: (path, sink) => {
      sinks.set(pathKey(path), sink);
    },
    requestRender: () => scheduleRender(),
    catalog: () => catalog,
    ensureCatalog: () => {
      void loadCatalog();
    },
  };

  const scheduleRender = () => {
    if (disposed || renderQueued) return;
    renderQueued = requestAnimationFrame(() => {
      renderQueued = 0;
      render();
    });
  };

  // --- painting ----------------------------------------------------------

  const sectionHaystack = (title: string, value: Json | undefined): string => {
    if (value === undefined) return title.toLowerCase();
    try {
      return `${title} ${JSON.stringify(value)}`.toLowerCase();
    } catch {
      return title.toLowerCase();
    }
  };

  const isEmptyValue = (value: Json | undefined): boolean => {
    if (value === undefined) return true;
    if (isObject(value)) return Object.keys(value).length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  };

  const errorCountFor = (paths: Path[]): number => {
    let count = 0;
    for (const key of validation.byField.keys()) {
      for (const path of paths) {
        const prefix = pathKey(path);
        if (key === prefix || key.startsWith(`${prefix},`)) {
          count += 1;
          break;
        }
      }
    }
    return count;
  };

  const renderBar = () => {
    bar.replaceChildren();

    const searchSlot = el("div", "ocf-grow");
    mountSearchField(searchSlot, {
      value: filter,
      placeholder: "Filter settings…",
      onChange: (next) => {
        filter = next;
        render();
      },
    });
    bar.appendChild(searchSlot);

    const onlySlot = el("div");
    mountSwitch(onlySlot, {
      label: "Only set",
      checked: onlySet,
      onChange: (checked) => {
        onlySet = checked;
        render();
      },
    });
    bar.appendChild(onlySlot);

    const status = el("div", "ocf-bar-note");
    if (parseError) {
      status.appendChild(span("ocf-danger", `⚠ ${parseError}`));
    } else if (!validation.available) {
      status.appendChild(span("", `validator unavailable: ${validation.compileError ?? "unknown"}`));
    } else if (validation.count > 0) {
      status.appendChild(
        span("ocf-danger", `${validation.count} schema ${validation.count === 1 ? "issue" : "issues"}`),
      );
    } else {
      status.appendChild(span("", "✓ valid opencode config"));
    }
    bar.appendChild(status);

    if (catalog.status === "loading") bar.appendChild(span("ocf-hint", "loading models…"));
  };

  const renderSchemaWarning = () => {
    if (!isObject(data)) return null;
    const declared = data.$schema;
    if (declared === undefined) {
      return el(
        "div",
        "ocf-item",
        "This file has no $schema key. The form is editing it as an opencode config; add \"$schema\": \"https://opencode.ai/config.json\" if it isn't one.",
      );
    }
    if (typeof declared === "string" && !declared.includes(CONFIG_SCHEMA_URL)) {
      return el(
        "div",
        "ocf-item",
        `Heads up: $schema points at ${declared}, not opencode's config schema. Field names below follow opencode's schema.`,
      );
    }
    return null;
  };

  const render = () => {
    if (disposed) return;
    const scrollTop = root.scrollTop;
    sinks.clear();
    renderBar();
    body.replaceChildren();

    const warning = renderSchemaWarning();
    if (warning) body.appendChild(warning);

    const topProps = properties(ROOT_SCHEMA);
    const covered = new Set<string>();
    for (const section of SECTIONS) {
      if (section.kind === "custom") covered.add(section.key);
      else for (const key of section.keys) covered.add(key);
    }
    covered.add("$schema");

    for (const section of SECTIONS) {
      if (section.kind === "custom") {
        const schema = topProps[section.key];
        if (!schema) continue;
        const value = ctx.get([section.key]);
        if (onlySet && isEmptyValue(value) && section.key !== "provider" && section.key !== "mcp") continue;
        if (filter && !sectionHaystack(section.title, value).includes(filter)) continue;
        const node = CUSTOM_RENDERERS[section.key]!(ctx, [section.key], schema);
        if (errorCountFor([[section.key]]) > 0) {
          node.querySelector(".ocf-card-sub")?.append(" ⚠");
        }
        body.appendChild(node);
        continue;
      }

      // Skip the deprecated `mode` map; `agent` supersedes it.
      const sectionKeys = section.keys.filter((key) => {
        if (key === "mode") return false;
        const schema = topProps[key];
        if (schema && isDeprecated(schema)) return false;
        if (onlySet && isEmptyValue(ctx.get([key]))) return false;
        return true;
      });

      const fields = grid();
      let count = 0;
      for (const key of sectionKeys) {
        const schema = topProps[key];
        if (!schema) continue;
        fields.appendChild(renderField(ctx, schema, [key]));
        count += 1;
      }
      if (count === 0) continue;
      const haystack = sectionHaystack(
        section.title,
        isObject(data) ? Object.fromEntries(section.keys.map((key) => [key, data[key]])) : undefined,
      );
      if (filter && !haystack.includes(filter)) continue;

      const isOpen = expanded.has(section.title) || (!filter && count > 0 && isOpenByDefault(section));
      const box = card({
        title: section.title,
        subtitle: section.note ?? "",
        collapsed: !isOpen,
        onToggle: (open) => {
          if (open) expanded.add(section.title);
          else expanded.delete(section.title);
          options.saveExpanded?.([...expanded]);
        },
      });
      if (errorCountFor(section.keys.map((key) => [key] as Path[])) > 0) {
        box.setSubtitle("⚠ has issues");
      }
      box.body.appendChild(fields);
      body.appendChild(box.root);
    }

    // Anything the section list doesn't mention, in schema order.
    const restKeys = Object.keys(topProps).filter((key) => !covered.has(key));
    if (restKeys.length > 0) {
      const fields = grid();
      let count = 0;
      for (const key of restKeys) {
        const schema = topProps[key];
        if (!schema) continue;
        if (isDeprecated(schema) && ctx.get([key]) === undefined) continue;
        if (onlySet && isEmptyValue(ctx.get([key]))) continue;
        fields.appendChild(renderField(ctx, schema, [key]));
        count += 1;
      }
      if (count > 0) {
        const box = card({ title: "Everything else", collapsed: !expanded.has("Everything else") });
        box.body.appendChild(fields);
        body.appendChild(box.root);
      }
    }

    if (body.childElementCount === 0) {
      const empty = el("div");
      empty.appendChild(span("ocf-hint", filter ? `Nothing matches “${filter}”.` : "This config is empty."));
      body.appendChild(empty);
    }

    root.scrollTop = scrollTop;
  };

  const isOpenByDefault = (section: SectionSpec): boolean => {
    if (section.kind === "group" && (section.title === "Models" || section.title === "Agents")) {
      return isObject(data) && Object.keys(data).length > 0;
    }
    return false;
  };

  // --- lifecycle ---------------------------------------------------------

  const offCatalog = onCatalog((next) => {
    catalog = next;
    if (next.status === "ready" && !disposed) scheduleRender();
  });

  reparse();
  render();
  void options.loadExpanded?.().then((keys) => {
    for (const key of keys) expanded.add(key);
    scheduleRender();
  }).catch(() => {});

  return {
    element: root,
    sync: ({ repaint = true } = {}) => {
      const next = options.getText();
      if (next === text) return;
      text = next;
      fmt = detectFormatting(text);
      reparse();
      if (repaint) render();
      else pushErrors();
    },
    refresh: () => render(),
    destroy: () => {
      disposed = true;
      offCatalog();
      if (renderQueued) cancelAnimationFrame(renderQueued);
      sinks.clear();
      root.remove();
    },
    debug: {
      text: () => text,
      data: () => data,
      errorCount: () => validation.count,
      parseError: () => parseError,
      expanded: () => [...expanded],
    },
  };
};

