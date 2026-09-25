/**
 * Schema-driven field renderer.
 *
 * Handles everything the opencode schema describes with plain JSON Schema
 * vocabulary. Paths with bespoke editors (providers, models, MCP, permissions)
 * are intercepted by the view before this runs.
 */
import {
  mountSelect,
  mountSwitch,
  mountTextField,
  type SelectOption,
} from "@openchamber/sdk/ui";
import { asNumber, asString, isObject, type Json, type Path } from "./core";
import { type FormContext } from "./context";
import {
  activeVariant,
  defaultForSchema,
  deref,
  enumValues,
  isDeprecated,
  isMap,
  isRequired,
  labelFor,
  mapValueSchema,
  properties,
  schemaType,
  seedForSchema,
  variants,
  type Schema,
} from "./schema";
import { button, card, el, fullWidth, grid, hint, row, span } from "./ui";

type ErrorUpdater = (message: string | undefined) => void;

type FieldOptions = {
  label?: string;
  helper?: string;
  full?: boolean;
  /** Suppress the control's own label (used when a parent already labels it). */
  bare?: boolean;
  /** Show a "Clear" button that removes the key entirely. */
  clearable?: boolean;
  /** Render into this node instead of a fresh grid cell. */
  wrap?: HTMLElement;
};
export type { FieldOptions };

/**
 * Bespoke editors register here and win over the generic renderer, at any
 * depth — that is how `agent.build.permission` gets the same matrix as the
 * top-level one without the object renderer knowing about it.
 */
export type Override = {
  id: string;
  match: (path: Path) => boolean;
  render: (ctx: FormContext, schema: Schema, path: Path, options: FieldOptions) => HTMLElement;
};

const overrides: Override[] = [];

export const registerOverride = (override: Override): void => {
  const index = overrides.findIndex((entry) => entry.id === override.id);
  if (index === -1) overrides.push(override);
  else overrides[index] = override;
};

const errorSlot = (): HTMLElement => {
  const node = el("div", "ocf-hint ocf-danger");
  node.style.marginTop = "2px";
  return node;
};

const SECRET_KEY = /(api[-_]?key|secret|token|password|credential)/i;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SIMPLE_STRING_ARRAY = new Set([
  "instructions",
  "disabled_providers",
  "enabled_providers",
  "urls",
  "paths",
  "ignore",
  "cors",
  "experimental.primary_tools",
]);

/** Field shell: mounts a control, wires its error sink, optional Clear. */
const field = (
  ctx: FormContext,
  path: Path,
  build: (host: HTMLElement) => ErrorUpdater,
  options: FieldOptions = {},
): HTMLElement => {
  const wrap = options.wrap ?? el("div", "");
  if (options.full) wrap.classList.add("ocf-span");
  const host = el("div");
  wrap.appendChild(host);
  const update = build(host);
  ctx.onError(path, update);
  update(ctx.errorAt(path));

  if (options.clearable && ctx.has(path)) {
    const actions = el("div", "ocf-actions");
    actions.style.marginTop = "2px";
    actions.appendChild(
      button("Clear", {
        variant: "ghost",
        title: `Remove ${path.join(".") || "this key"} from the file`,
        onClick: () => ctx.remove(path),
      }),
    );
    wrap.appendChild(actions);
  }
  return wrap;
};

const describe = (schema: Schema | undefined, key: string): string | undefined => {
  const node = deref(schema);
  if (!node) return undefined;
  const text = typeof node.description === "string" ? node.description : undefined;
  if (!text) return undefined;
  const deprecated = node.deprecated ? "Deprecated." : "";
  return `${deprecated}${deprecated && text ? " " : ""}${text}`.trim();
};

const boundsHint = (schema: Schema | undefined): string | undefined => {
  const node = deref(schema);
  if (!node) return undefined;
  const bits: string[] = [];
  const min = node.exclusiveMinimum ?? node.minimum;
  const max = node.exclusiveMaximum ?? node.maximum;
  if (typeof min === "number") bits.push(`min ${node.exclusiveMinimum !== undefined ? ">" : "≥"} ${min}`);
  if (typeof max === "number") bits.push(`max ${node.exclusiveMaximum !== undefined ? "<" : "≤"} ${max}`);
  if (typeof node.minLength === "number") bits.push(`length ≥ ${node.minLength}`);
  if (typeof node.pattern === "string") bits.push(`pattern ${node.pattern}`);
  return bits.length ? bits.join(" · ") : undefined;
};

const textField = (ctx: FormContext, path: Path, schema: Schema, options: FieldOptions): HTMLElement => {
  const node = deref(schema);
  const value = asString(ctx.get(path));
  const key = path[path.length - 1];
  const label = options.label ?? labelFor(String(key ?? ""), node);
  const multiline = options.label === undefined && (String(key) === "prompt" || value.includes("\n"));
  const help = [options.helper ?? describe(node, String(key)), boundsHint(node)].filter(Boolean).join(" · ");

  return field(
    ctx,
    path,
    (host) => {
      const handle = mountTextField(host, {
        label: options.bare ? "" : label,
        value,
        placeholder: typeof node?.default === "string" ? String(node.default) : undefined,
        password: SECRET_KEY.test(String(key)),
        multiline,
        rows: 5,
        mono: /^(npm|api|baseurl|url|path|id|command|cwd|model|variant)$/i.test(String(key)),
        helper: help || undefined,
        onChange: (next) => {
          if (next === "") ctx.remove(path);
          else ctx.set(path, next);
        },
      });
      return (message) => handle.update({ error: message });
    },
    { ...options, clearable: options.clearable ?? !isRequired(node, String(key)) },
  );
};

const colorField = (ctx: FormContext, path: Path, schema: Schema, options: FieldOptions): HTMLElement => {
  const wrap = textField(ctx, path, schema, options);
  const value = asString(ctx.get(path));
  if (!HEX_COLOR.test(value)) return wrap;
  const swatch = el("span", "ocf-chip");
  const dot = el("span", "ocf-chip-dot");
  dot.style.background = value;
  swatch.append(dot, span("ocf-mono", value));
  swatch.style.marginTop = "4px";
  wrap.appendChild(swatch);
  return wrap;
};

const numberField = (ctx: FormContext, path: Path, schema: Schema, options: FieldOptions): HTMLElement => {
  const node = deref(schema);
  const current = asNumber(ctx.get(path));
  const key = String(path[path.length - 1] ?? "");
  const label = options.label ?? labelFor(key, node);
  const help = [options.helper ?? describe(node, key), boundsHint(node)].filter(Boolean).join(" · ");

  return field(
    ctx,
    path,
    (host) => {
      const handle = mountTextField(host, {
        label: options.bare ? "" : label,
        value: current === null ? "" : String(current),
        placeholder: typeof node?.default === "number" ? String(node.default) : undefined,
        mono: true,
        helper: help || undefined,
        onChange: (next) => {
          if (next.trim() === "") {
            ctx.remove(path);
            return;
          }
          const parsed = Number(next);
          if (!Number.isFinite(parsed)) return;
          ctx.set(path, schemaType(node) === "integer" ? Math.trunc(parsed) : parsed);
        },
      });
      return (message) => handle.update({ error: message });
    },
    { ...options, clearable: options.clearable ?? !isRequired(node, key) },
  );
};

const enumField = (ctx: FormContext, path: Path, schema: Schema, options: FieldOptions): HTMLElement => {
  const node = deref(schema);
  const current = ctx.get(path);
  const key = String(path[path.length - 1] ?? "");
  const label = options.label ?? labelFor(key, node);
  const help = options.helper ?? describe(node, key);
  const wrap = el("div", options.full ? "ocf-span" : "");

  return field(
    ctx,
    path,
    (host) => {
      const selectOptions: SelectOption[] = enumValues(node).map((value) => ({
        id: String(value),
        label: String(value),
      }));
      mountSelect(host, {
        label: options.bare ? "" : label,
        value: current === undefined ? null : String(current),
        options: selectOptions,
        placeholder: "not set",
        searchable: selectOptions.length > 8,
        onChange: (id) => {
          const match = enumValues(node).find((value) => String(value) === id);
          ctx.set(path, (match ?? id) as Json);
        },
      });
      const errorNode = errorSlot();
      host.appendChild(errorNode);
      return (message) => {
        errorNode.textContent = message ?? "";
      };
    },
    { ...options, clearable: options.clearable ?? !isRequired(node, key), wrap },
  );
};

const boolField = (ctx: FormContext, path: Path, schema: Schema, options: FieldOptions): HTMLElement => {
  const node = deref(schema);
  const key = String(path[path.length - 1] ?? "");
  const label = options.label ?? labelFor(key, node);
  const help = options.helper ?? describe(node, key);

  return field(
    ctx,
    path,
    (host) => {
      mountSwitch(host, {
        label: options.bare ? "" : label,
        checked: ctx.get(path) === true,
        description: help,
        onChange: (checked) => {
          if (checked) ctx.set(path, true);
          else ctx.remove(path);
        },
      });
      const errorNode = errorSlot();
      host.appendChild(errorNode);
      return (message) => {
        errorNode.textContent = message ?? "";
      };
    },
    { ...options, clearable: false },
  );
};

/** Free-form subtree: a JSON textarea, so nothing is ever dropped. */
const jsonField = (ctx: FormContext, path: Path, schema: Schema, options: FieldOptions): HTMLElement => {
  const key = String(path[path.length - 1] ?? "");
  const label = options.label ?? labelFor(key, schema);
  const initial = ctx.get(path);
  const help = options.helper ?? describe(schema, key);

  return field(
    ctx,
    path,
    (host) => {
      let error: string | undefined;
      const handle = mountTextField(host, {
        label,
        value: initial === undefined ? "" : JSON.stringify(initial, null, 2),
        placeholder: "{}",
        multiline: true,
        rows: 6,
        mono: true,
        helper: help,
        onChange: (next) => {
          if (next.trim() === "") {
            ctx.remove(path);
            return;
          }
          try {
            ctx.set(path, JSON.parse(next) as Json);
            handle.update({ error: undefined });
          } catch (parseError) {
            handle.update({ error: (parseError as Error).message });
            error = (parseError as Error).message;
          }
        },
      });
      return (message) => {
        if (error) return;
        handle.update({ error: message });
      };
    },
    { ...options, full: options.full ?? true },
  );
};

/** Chip list for arrays of plain strings. */
const stringListField = (ctx: FormContext, path: Path, schema: Schema, options: FieldOptions): HTMLElement => {
  const key = String(path[path.length - 1] ?? "");
  const label = options.label ?? labelFor(key, schema);
  const wrap = el("div", options.full ? "ocf-span" : "");
  const list = el("div", "ocf-row");
  const items = Array.isArray(ctx.get(path)) ? (ctx.get(path) as Json[]) : [];

  const commit = (next: string[]) => {
    if (next.length === 0) ctx.remove(path);
    else ctx.set(path, next);
  };

  items.forEach((item, index) => {
    const chip = el("span", "ocf-chip");
    chip.append(span("ocf-mono", String(item)));
    const remove = el("button", "ocf-x", "×");
    remove.type = "button";
    remove.title = "Remove";
    remove.addEventListener("click", () => {
      const next = items.filter((_, i) => i !== index).map(String);
      commit(next);
      ctx.requestRender();
    });
    chip.appendChild(remove);
    list.appendChild(chip);
  });

  const add = el("div", "ocf-row");
  let draft = "";
  const handle = mountTextField(add, {
    value: "",
    placeholder: options.label === undefined ? "Add value…" : "Add…",
    mono: true,
    onChange: (next) => {
      draft = next;
    },
  });
  add.appendChild(
    button("Add", {
      variant: "secondary",
      onClick: () => {
        const value = draft.trim();
        if (!value) return;
        commit([...items.map(String), value]);
        handle.update({ value: "" });
        ctx.requestRender();
      },
    }),
  );

  wrap.append(
    label ? span("ocf-hint", label) : null,
    list,
    add,
    hint(describe(schema, key)),
  );
  return wrap;
};

const listField = (ctx: FormContext, path: Path, schema: Schema, options: FieldOptions): HTMLElement => {
  const node = deref(schema);
  const key = String(path[path.length - 1] ?? "");
  const label = options.label ?? labelFor(key, node);
  const wrap = el("div", "ocf-span");
  const items = Array.isArray(ctx.get(path)) ? (ctx.get(path) as Json[]) : [];
  const itemSchema = node?.items;
  const tuple = node?.prefixItems;

  if (label) wrap.appendChild(span("ocf-hint", label));
  const list = el("div", "ocf-list");

  items.forEach((item, index) => {
    const itemPath = [...path, index];
    const box = el("div", "ocf-item");
    const head = el("div", "ocf-item-head");
    head.appendChild(span("ocf-item-name", `${label || "item"} ${index + 1}`));
    const actions = el("div", "ocf-actions");
    if (index > 0) {
      actions.appendChild(
        button("↑", {
          title: "Move up",
          onClick: () => {
            const next = [...items];
            [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
            ctx.set(path, next);
            ctx.requestRender();
          },
        }),
      );
    }
    if (index < items.length - 1) {
      actions.appendChild(
        button("↓", {
          title: "Move down",
          onClick: () => {
            const next = [...items];
            [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
            ctx.set(path, next);
            ctx.requestRender();
          },
        }),
      );
    }
    actions.appendChild(
      button("Remove", {
        variant: "ghost",
        onClick: () => {
          const next = items.filter((_, i) => i !== index);
          if (next.length === 0) ctx.remove(path);
          else ctx.set(path, next);
          ctx.requestRender();
        },
      }),
    );
    head.appendChild(actions);
    box.appendChild(head);

    if (tuple?.[index]) {
      box.appendChild(renderField(ctx, tuple[index], [...itemPath, 0], { label: "value" }));
    } else if (itemSchema) {
      box.appendChild(renderField(ctx, itemSchema, itemPath, { label: options.label ? "value" : undefined }));
    } else {
      box.appendChild(jsonField(ctx, itemPath, node ?? {}, { label: "value" }));
    }
    list.appendChild(box);
  });

  wrap.appendChild(list);

  const addRow = el("div", "ocf-row");
  const addVariant = tuple?.[0] ?? itemSchema;
  addRow.appendChild(
    button(`+ Add ${label ? label.toLowerCase() : "item"}`, {
      variant: "secondary",
      onClick: () => {
        const next = [...items, addVariant ? seedForSchema(addVariant) : null];
        ctx.set(path, next);
        ctx.requestRender();
      },
    }),
  );
  wrap.appendChild(addRow);

  const help = hint(describe(node, key));
  if (help) wrap.appendChild(help);
  const errorNode = errorSlot();
  wrap.appendChild(errorNode);
  ctx.onError(path, (message) => {
    errorNode.textContent = message ?? "";
  });
  errorNode.textContent = ctx.errorAt(path) ?? "";
  return wrap;
};

/** One-line summary of a map entry, for collapsed card headers. */
const summarize = (value: Json): string => {
  if (value === null) return "null";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  const bits: string[] = [];
  for (const [key, inner] of Object.entries(value as Record<string, Json>)) {
    if (inner === null || typeof inner !== "object") bits.push(`${key}: ${String(inner)}`);
    if (bits.length >= 3) break;
  }
  return bits.join(" · ");
};

/** Generic `additionalProperties: {…}` map (agents, env vars, headers, …). */
const mapField = (ctx: FormContext, path: Path, schema: Schema, options: FieldOptions): HTMLElement => {
  const node = deref(schema);
  const valueSchema = mapValueSchema(node);
  const key = String(path[path.length - 1] ?? "");
  const label = options.label ?? labelFor(key, node);
  const wrap = el("div", "ocf-span");
  if (label && !options.bare) wrap.appendChild(span("ocf-hint", label));

  const map = isObject(ctx.get(path)) ? ({ ...(ctx.get(path) as Record<string, Json>) }) : {};
  const entries = Object.entries(map);

  const commit = (next: Record<string, Json>) => {
    if (Object.keys(next).length === 0) ctx.remove(path);
    else ctx.set(path, next);
  };

  const list = el("div", "ocf-list");
  for (const [mapKey, mapValue] of entries) {
    const itemPath = [...path, mapKey];
    // Maps can hold dozens of entries (agents, models, commands), so each one
    // is collapsed until asked for.
    const entry = card({
      title: mapKey,
      subtitle: summarize(mapValue),
      collapsed: true,
    });
    entry.root.classList.add("ocf-item");

    const removeHost = el("div", "ocf-actions");
    removeHost.appendChild(
      button("Remove", {
        onClick: () => {
          const next = { ...map };
          delete next[mapKey];
          commit(next);
          ctx.requestRender();
        },
      }),
    );

    const keyHost = el("div");
    mountTextField(keyHost, {
      label: "Key",
      value: mapKey,
      mono: true,
      onChange: (next) => {
        if (!next || next === mapKey) return;
        const renamed: Record<string, Json> = {};
        for (const [k, v] of Object.entries(map)) renamed[k === mapKey ? next : k] = v;
        commit(renamed);
        ctx.requestRender();
      },
    });
    entry.body.appendChild(keyHost);
    entry.actions.appendChild(removeHost);

    if (valueSchema) {
      const rendered = renderField(ctx, valueSchema, itemPath, { label: undefined, bare: false });
      rendered.classList.remove("ocf-span");
      entry.body.appendChild(rendered);
    } else {
      const valueField = el("div");
      mountTextField(valueField, {
        label: "Value",
        value: typeof mapValue === "string" ? mapValue : JSON.stringify(mapValue),
        mono: true,
        multiline: true,
        rows: 3,
        onChange: (next) => {
          // Keep whatever is typed; only normalize when it parses as JSON.
          if (next.trim() === "") {
            ctx.set(itemPath, "");
            return;
          }
          try {
            ctx.set(itemPath, JSON.parse(next) as Json);
          } catch {
            ctx.set(itemPath, next);
          }
        },
      });
      entry.body.appendChild(valueField);
    }
    list.appendChild(entry.root);
  }
  wrap.appendChild(list);

  const addRow = el("div", "ocf-row");
  let draftKey = "";
  let draftValue = "";
  const keyHost = el("div", "ocf-grow");
  mountTextField(keyHost, {
    value: "",
    placeholder: "key",
    mono: true,
    onChange: (next) => {
      draftKey = next;
    },
  });
  const valueHost = el("div", "ocf-grow");
  mountTextField(valueHost, {
    value: "",
    placeholder: "value",
    mono: true,
    onChange: (next) => {
      draftValue = next;
    },
  });
  addRow.append(keyHost, valueHost);
  addRow.appendChild(
    button("+ Add", {
      variant: "secondary",
      onClick: () => {
        const name = draftKey.trim();
        if (!name) return;
        const next = { ...map, [name]: draftValue } as Record<string, Json>;
        commit(next);
        draftKey = "";
        draftValue = "";
        ctx.requestRender();
      },
    }),
  );
  wrap.appendChild(addRow);

  // Well-known keys the schema names but the file doesn't use yet (`agent`
  // declares plan/build/general/…). Offer them as one-click adds.
  const declared = Object.keys(properties(node)).filter((propKey) => !Object.hasOwn(map, propKey));
  if (declared.length > 0) {
    const quick = el("div", "ocf-row");
    quick.appendChild(span("ocf-hint", "Common:"));
    for (const propKey of declared.slice(0, 10)) {
      quick.appendChild(
        button(`+ ${propKey}`, {
          onClick: () => {
            commit({ ...map, [propKey]: seedForSchema(properties(node)[propKey]) });
            ctx.requestRender();
          },
        }),
      );
    }
    wrap.appendChild(quick);
  }
  const help = hint(describe(node, key));
  if (help) wrap.appendChild(help);
  return wrap;
};

/** Nested object rendered as a labelled group of fields. */
const objectField = (
  ctx: FormContext,
  path: Path,
  schema: Schema,
  options: FieldOptions & { known?: string[] },
): HTMLElement => {
  const node = deref(schema);
  const key = String(path[path.length - 1] ?? "");
  const label = options.label ?? labelFor(key, node);
  const wrap = el("div", options.full ? "ocf-span" : "");
  if (label && !options.bare) wrap.appendChild(span("ocf-hint", label));

  const props = properties(node);
  const fields = grid();
  const known = options.known ?? Object.keys(props);
  for (const propKey of Object.keys(props)) {
    const propSchema = props[propKey]!;
    if (isDeprecated(propSchema) && ctx.get([...path, propKey]) === undefined) continue;
    fields.appendChild(renderField(ctx, propSchema, [...path, propKey]));
  }
  wrap.appendChild(fields);

  const value = ctx.get(path);
  if (isObject(value)) {
    const extras = Object.keys(value).filter((propKey) => !known.includes(propKey));
    if (extras.length > 0) {
      const extraBox = el("div", "ocf-subcard");
      extraBox.appendChild(span("ocf-hint", `${extras.length} key(s) not in the schema: ${extras.join(", ")}`));
      const handle = mountTextField(extraBox, {
        label: "Raw JSON (kept as-is)",
        value: JSON.stringify(
          Object.fromEntries(extras.map((propKey) => [propKey, value[propKey]])),
          null,
          2,
        ),
        multiline: true,
        rows: 5,
        mono: true,
        helper: "Saved verbatim; the form does not interpret these keys.",
        onChange: (next) => {
          try {
            const parsed = JSON.parse(next) as Record<string, Json>;
            const merged = { ...(value as Record<string, Json>), ...parsed };
            for (const propKey of extras) delete merged[propKey];
            ctx.set(path, merged);
            handle.update({ error: undefined });
          } catch (parseError) {
            handle.update({ error: (parseError as Error).message });
          }
        },
      });
      wrap.appendChild(extraBox);
    }
  }

  const help = hint(describe(node, key));
  if (help) wrap.appendChild(help);
  return wrap;
};

/** `anyOf`/`oneOf`: pick the branch, then render it. */
const variantField = (ctx: FormContext, path: Path, schema: Schema, options: FieldOptions): HTMLElement => {
  const list = variants(schema) ?? [];
  const value = ctx.get(path);
  const index = activeVariant(list, value, schema);
  const wrap = el("div", options.full ? "ocf-span" : "");
  const key = String(path[path.length - 1] ?? "");
  const label = options.label ?? labelFor(key, schema);

  const switcher = el("div", "ocf-segment");
  list.forEach((variant, i) => {
    switcher.appendChild(
      button(variant.label, {
        variant: i === index ? "secondary" : "ghost",
        onClick: () => {
          if (i === index) return;
          // Choosing a shape writes its empty value, so the file always has a
          // concrete, schema-valid branch.
          ctx.set(path, defaultForSchema(variant.schema));
          ctx.requestRender();
        },
      }),
    );
  });

  wrap.appendChild(row(span("ocf-hint", label), switcher));
  if (value === undefined) {
    wrap.appendChild(span("ocf-hint", "Not set — pick a shape to add it."));
    return wrap;
  }
  const chosen = list[index];
  if (chosen) wrap.appendChild(renderField(ctx, chosen.schema, path, { label: "", clearable: true }));
  return wrap;
};

export const renderField = (
  ctx: FormContext,
  schema: Schema,
  path: Path,
  options: FieldOptions = {},
): HTMLElement => {
  for (const override of overrides) {
    if (override.match(path)) return override.render(ctx, schema, path, options);
  }
  const node = deref(schema);
  if (!node) return jsonField(ctx, path, schema, options);

  if (variants(node)) return variantField(ctx, path, node, options);
  if (node.const !== undefined) return jsonField(ctx, path, node, options);

  const type = schemaType(node);

  if (type === "boolean") return boolField(ctx, path, node, options);
  if (node.enum?.length) return enumField(ctx, path, node, options);
  if (type === "string" || type === undefined) {
    if (typeof node.pattern === "string" && HEX_COLOR.test(String(node.pattern))) {
      return colorField(ctx, path, node, options);
    }
    if (type === undefined && !node.properties && !node.items) return jsonField(ctx, path, node, options);
    return textField(ctx, path, node, options);
  }
  if (type === "integer" || type === "number") return numberField(ctx, path, node, options);
  if (type === "array") {
    const key = String(path[path.length - 1] ?? "");
    const simple =
      SIMPLE_STRING_ARRAY.has(key) &&
      (schemaType(node.items) === "string" || (node.items?.enum?.length ?? 0) > 0) &&
      !node.prefixItems;
    if (simple && itemsAreStrings(ctx.get(path))) return stringListField(ctx, path, node, options);
    return listField(ctx, path, node, options);
  }
  if (type === "object") {
    // A schema with `additionalProperties` is a map even when it also names
    // well-known keys (`agent` declares plan/build/… but accepts any name), so
    // it gets the map editor: one collapsed card per entry.
    if (isMap(node)) return mapField(ctx, path, node, options);
    return objectField(ctx, path, node, options);
  }
  return jsonField(ctx, path, node, options);
};

const itemsAreStrings = (value: Json | undefined): boolean =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** Multi-select chips over an enum array, with room for future values. */
export const multiEnumField = (
  ctx: FormContext,
  path: Path,
  schema: Schema,
  options: FieldOptions = {},
): HTMLElement => {
  const node = deref(schema);
  const key = String(path[path.length - 1] ?? "");
  const label = options.label ?? labelFor(key, node);
  const wrap = el("div", options.full ? "ocf-span" : "");
  if (label && !options.bare) wrap.appendChild(span("ocf-hint", label));

  const current = Array.isArray(ctx.get(path)) ? (ctx.get(path) as Json[]).map(String) : [];
  const known = enumValues(node).map(String);
  const values = [...new Set([...known, ...current])];

  const commit = (next: string[]) => {
    if (next.length === 0) ctx.remove(path);
    else ctx.set(path, next);
  };

  const chips = el("div", "ocf-row");
  for (const value of values) {
    const active = current.includes(value);
    const chip = el("button", "ocf-chip");
    chip.type = "button";
    chip.dataset.active = active ? "true" : "false";
    chip.style.borderColor = active ? "var(--oc-primary, #6af)" : "";
    chip.style.background = active ? "color-mix(in srgb, var(--oc-primary, #6af) 18%, transparent)" : "";
    chip.append(span("ocf-mono", value));
    chip.addEventListener("click", () => {
      commit(active ? current.filter((item) => item !== value) : [...current, value]);
      ctx.requestRender();
    });
    chips.appendChild(chip);
  }
  wrap.appendChild(chips);

  const addRow = el("div", "ocf-row");
  let draft = "";
  const handle = mountTextField(addRow, {
    value: "",
    placeholder: "Other value…",
    mono: true,
    onChange: (next) => {
      draft = next;
    },
  });
  addRow.appendChild(
    button("Add", {
      variant: "secondary",
      onClick: () => {
        const value = draft.trim();
        if (!value || current.includes(value)) return;
        commit([...current, value]);
        handle.update({ value: "" });
        ctx.requestRender();
      },
    }),
  );
  wrap.appendChild(addRow);

  const help = hint(describe(node, key));
  if (help) wrap.appendChild(help);
  const errorNode = errorSlot();
  wrap.appendChild(errorNode);
  ctx.onError(path, (message) => {
    errorNode.textContent = message ?? "";
  });
  errorNode.textContent = ctx.errorAt(path) ?? "";
  return wrap;
};
