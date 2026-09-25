/**
 * Provider + model editors.
 *
 * This is the part of opencode's config people actually edit: point at an
 * endpoint, hand it a key, add the models it serves, and describe what those
 * models can do. The generic renderer would technically render all of it, but
 * as a pile of nested cards — these editors make the common path two clicks.
 */
import { mountSwitch, mountTextField } from "@openchamber/sdk/ui";
import { isObject, type Json, type Path } from "./core";
import { type FormContext } from "./context";
import {
  endpointProviderIds,
  loadCatalog,
  OPENAI_COMPATIBLE_NPM,
  providersForNpm,
  searchModels,
  searchProviders,
  type Catalog,
  type CatalogModel,
} from "./catalog";
import { multiEnumField } from "./fields";
import { deref, mapValueSchema, properties, type Schema } from "./schema";
import {
  button,
  card,
  confirmButton,
  el,
  fullWidth,
  grid,
  hint,
  openModal,
  span,
} from "./ui";

const catalogOf = (ctx: FormContext): Catalog | null => {
  const state = ctx.catalog();
  return state.status === "ready" ? state.catalog : null;
};

const renameKey = (ctx: FormContext, path: Path, from: string, to: string) => {
  const parent = path.slice(0, -1);
  const container = ctx.get(parent);
  if (!isObject(container)) return;
  const next: Record<string, Json> = {};
  let inserted = false;
  for (const [key, value] of Object.entries(container)) {
    if (key === from) {
      next[to] = value;
      inserted = true;
    } else {
      next[key] = value;
    }
  }
  if (!inserted) return;
  ctx.set(parent, next);
};

/** Model ids offered first for a provider, based on its npm/id. */
const providerHints = (ctx: FormContext, provider: Record<string, Json>): string[] => {
  const catalog = catalogOf(ctx);
  if (!catalog) return [];
  const npm = typeof provider.npm === "string" ? provider.npm : undefined;
  const direct = providersForNpm(catalog, npm).map((entry) => entry.id);
  if (direct.length > 0) return direct;
  const id = String(provider.id ?? "");
  if (catalog[id]) return [id];
  // An openai-compatible endpoint is usually a front for one of these.
  if (npm === OPENAI_COMPATIBLE_NPM) return endpointProviderIds(catalog);
  return [];
};

const modelSeed = (model: CatalogModel, existing: Json | undefined): Record<string, Json> => {
  const seed: Record<string, Json> = isObject(existing) ? { ...existing } : {};
  if (seed.name === undefined && model.name && model.name !== model.id) seed.name = model.name;
  const modalities = model.modalities ?? {};
  if (seed.modalities === undefined && (modalities.input?.length || modalities.output?.length)) {
    seed.modalities = {
      ...(modalities.input?.length ? { input: [...modalities.input] } : {}),
      ...(modalities.output?.length ? { output: [...modalities.output] } : {}),
    };
  }
  if (seed.attachment === undefined && model.attachment) seed.attachment = true;
  if (seed.reasoning === undefined && model.reasoning) seed.reasoning = true;
  if (seed.tool_call === undefined && model.tool_call) seed.tool_call = true;
  return seed;
};

/** "Add model": search the catalog, or type an id for a private endpoint. */
const openAddModel = (ctx: FormContext, providerPath: Path, provider: Record<string, Json>) => {
  const hints = providerHints(ctx, provider);
  openModal({
    title: "Add model",
    build: (body, close) => {
      const search = el("div");
      let query = "";
      let allProviders = hints.length === 0;
      const results = el("div", "ocf-results");
      const custom = el("div", "ocf-row");

      const commitModel = (modelId: string, seed: Record<string, Json>) => {
        const models = isObject(provider.models) ? { ...(provider.models as Record<string, Json>) } : {};
        models[modelId] = { ...(models[modelId] as Record<string, Json> | undefined), ...seed };
        ctx.set([...providerPath, "models"], models);
        close();
        ctx.requestRender();
      };

      const paint = () => {
        const catalog = catalogOf(ctx);
        results.replaceChildren();
        if (!catalog) {
          results.appendChild(
            span("ocf-hint", "Loading model catalog… (you can still add an id below)"),
          );
          return;
        }
        const providerIds = allProviders ? undefined : hints;
        const hits = searchModels(catalog, query, { providerIds, limit: 60 });
        if (hits.length === 0) {
          results.appendChild(span("ocf-hint", "No catalog match — add the id manually below."));
          return;
        }
        for (const hit of hits) {
          const item = el("button", "ocf-result");
          item.type = "button";
          const main = el("div", "ocf-result-main");
          main.append(span("ocf-result-title", hit.label), span("ocf-result-hint", hit.hint));
          const ref = span("ocf-mono", hit.ref);
          ref.style.opacity = "0.65";
          item.append(main, ref);
          item.addEventListener("click", () => {
            commitModel(hit.modelId, modelSeed(hit.model, undefined));
          });
          results.appendChild(item);
        }
      };

      mountTextField(search, {
        label: "Search models",
        value: "",
        placeholder: hints.length ? `e.g. ${hints[0]}` : "gpt-4o, claude-sonnet…",
        onChange: (next) => {
          query = next;
          paint();
        },
      });
      body.append(search);

      if (hints.length > 0) {
        const scope = el("div", "ocf-row");
        const toggle = el("button", "ocf-chip");
        toggle.type = "button";
        const paintToggle = () => {
          const total = Object.keys(catalogOf(ctx) ?? {}).length;
          toggle.textContent = allProviders
            ? `Searching all ${total} providers`
            : `Scoped to ${hints.length} matching provider(s)`;
          toggle.style.borderColor = "var(--oc-primary, #6af)";
        };
        toggle.addEventListener("click", () => {
          allProviders = !allProviders;
          paintToggle();
          paint();
        });
        paintToggle();
        scope.append(toggle, hint(`Matched from npm ${String(provider.npm ?? "")}`));
        body.appendChild(scope);
        ctx.ensureCatalog();
        void loadCatalog().then(() => {
          paintToggle();
          paint();
        });
      } else {
        ctx.ensureCatalog();
        void loadCatalog().then(paint);
      }

      body.appendChild(results);

      let customId = "";
      mountTextField(custom, {
        label: "Or enter a model id",
        value: "",
        placeholder: "my-private-model",
        mono: true,
        helper: "For endpoints the catalog doesn't know about.",
        onChange: (next) => {
          customId = next;
        },
      });
      custom.appendChild(
        button("Add model", {
          variant: "secondary",
          onClick: () => {
            const id = customId.trim();
            if (!id) return;
            commitModel(id, {});
          },
        }),
      );
      body.append(custom);

      paint();
    },
  });
};

const modelCard = (
  ctx: FormContext,
  providerPath: Path,
  modelId: string,
  model: Record<string, Json>,
  modelSchema: Schema | undefined,
) => {
  const path = [...providerPath, "models", modelId];
  const box = card({
    title: model.name ? `${modelId} — ${String(model.name)}` : modelId,
    subtitle: describeModel(model),
    collapsed: true,
  });
  box.root.classList.add("ocf-item");
  box.actions.appendChild(
    button("Remove", {
      variant: "ghost",
      onClick: () => {
        const models = { ...((ctx.get([...providerPath, "models"]) as Record<string, Json>) ?? {}) };
        delete models[modelId];
        if (Object.keys(models).length === 0) ctx.remove([...providerPath, "models"]);
        else ctx.set([...providerPath, "models"], models);
        ctx.requestRender();
      },
    }),
  );

  const modelProps = properties(deref(modelSchema));
  const body = box.body;
  const fields = grid();

  // Identity
  const nameHost = el("div");
  mountTextField(nameHost, {
    label: "Display name",
    value: typeof model.name === "string" ? model.name : "",
    placeholder: modelId,
    onChange: (next) => {
      const updated = { ...model };
      if (next.trim() === "") delete updated.name;
      else updated.name = next;
      ctx.set(path, updated);
    },
  });
  fields.appendChild(nameHost);

  // Capabilities
  const capabilityHost = el("div", "ocf-span");
  capabilityHost.appendChild(span("ocf-hint", "Capabilities"));
  const capabilityRow = el("div", "ocf-row");
  for (const [flag, title, help] of [
    ["reasoning", "Reasoning", "Extended thinking"],
    ["tool_call", "Tool calls", "Can call tools"],
    ["attachment", "Vision", "Accepts image input"],
    ["temperature", "Temperature", "Supports temperature"],
  ] as const) {
    const host = el("div");
    mountSwitch(host, {
      label: title,
      checked: model[flag] === true,
      description: help,
      onChange: (next) => {
        const updated = { ...model };
        if (next) updated[flag] = true;
        else delete updated[flag];
        ctx.set(path, updated);
      },
    });
    capabilityRow.appendChild(host);
  }
  capabilityHost.appendChild(capabilityRow);
  fields.appendChild(capabilityHost);

  // Modalities
  if (modelProps.modalities) {
    for (const side of ["input", "output"] as const) {
      const sideSchema = modelProps.modalities.properties?.[side];
      if (!sideSchema) continue;
      fields.appendChild(
        multiEnumField(ctx, [...path, "modalities", side], sideSchema, { label: `${side} modalities` }),
      );
    }
  }

  // Limits
  if (modelProps.limit) {
    const limitHost = el("div", "ocf-span");
    limitHost.appendChild(span("ocf-hint", "Limits"));
    const limitGrid = el("div", "ocf-grid");
    for (const key of ["context", "input", "output"] as const) {
      const limitSchema = modelProps.limit?.properties?.[key];
      if (!limitSchema) continue;
      const host = el("div");
      const current = isObject(model.limit) ? (model.limit as Record<string, Json>)[key] : undefined;
      mountTextField(host, {
        label: key,
        value: typeof current === "number" ? String(current) : "",
        placeholder: "inherit",
        mono: true,
        onChange: (next) => {
          const limit = { ...((model.limit as Record<string, Json>) ?? {}) };
          if (next.trim() === "") delete limit[key];
          else {
            const parsed = Number(next);
            if (Number.isFinite(parsed)) limit[key] = parsed;
          }
          const updated = { ...model };
          if (Object.keys(limit).length === 0) delete updated.limit;
          else updated.limit = limit;
          ctx.set(path, updated);
        },
      });
      limitGrid.appendChild(host);
    }
    limitHost.appendChild(limitGrid);
    fields.appendChild(limitHost);
  }

  body.appendChild(fields);

  // Everything else (cost, options, headers, variants, …) stays reachable as JSON.
  const known = new Set(["name", "modalities", "reasoning", "tool_call", "attachment", "temperature", "limit"]);
  const extras = Object.keys(model).filter((key) => !known.has(key));
  const extraHost = el("div");
  if (extras.length > 0) {
    const boxEl = el("div", "ocf-subcard");
    boxEl.appendChild(span("ocf-hint", `${extras.length} more field(s): ${extras.join(", ")}`));
    mountTextField(boxEl, {
      label: "Raw JSON",
      value: JSON.stringify(
        Object.fromEntries(extras.map((key) => [key, model[key]])),
        null,
        2,
      ),
      multiline: true,
      rows: 5,
      mono: true,
      onChange: (next) => {
        try {
          const parsed = JSON.parse(next) as Record<string, Json>;
          const updated = { ...model };
          for (const key of extras) delete updated[key];
          ctx.set(path, { ...updated, ...parsed });
        } catch {
          /* keep last valid; the textarea still shows what was typed */
        }
      },
    });
    extraHost.appendChild(boxEl);
  }
  body.appendChild(extraHost);
  return box.root;
};

const describeModel = (model: Record<string, Json>): string => {
  const bits: string[] = [];
  const modalities = isObject(model.modalities) ? (model.modalities as Record<string, Json>) : {};
  const input = Array.isArray(modalities.input) ? modalities.input.map(String).join("/") : "";
  const output = Array.isArray(modalities.output) ? modalities.output.map(String).join("/") : "";
  if (input) bits.push(`in: ${input}`);
  if (output) bits.push(`out: ${output}`);
  const limit = isObject(model.limit) ? model.limit : undefined;
  if (limit && typeof limit.context === "number") bits.push(`ctx: ${limit.context}`);
  if (model.reasoning === true) bits.push("reasoning");
  if (model.tool_call === true) bits.push("tools");
  return bits.join(" · ");
};

const providerCard = (
  ctx: FormContext,
  selfPath: Path,
  provider: Record<string, Json>,
  providerSchema: Schema | undefined,
) => {
  const providerId = String(selfPath[selfPath.length - 1] ?? "");
  const parentPath = selfPath.slice(0, -1);
  const props = properties(deref(providerSchema));
  const npm = typeof provider.npm === "string" ? provider.npm : "";
  const models = isObject(provider.models) ? (provider.models as Record<string, Json>) : {};
  const modelSchema = mapValueSchema(props.models);

  const box = card({
    title: providerId,
    subtitle: [npm, `${Object.keys(models).length} model(s)`].filter(Boolean).join(" · "),
    collapsed: true,
  });
  box.root.classList.add("ocf-item");
  box.actions.appendChild(
    confirmButton("Remove provider", () => {
      const container = ctx.get(parentPath);
      if (!isObject(container)) return;
      const next = { ...container };
      delete next[providerId];
      if (Object.keys(next).length === 0) ctx.remove(parentPath);
      else ctx.set(parentPath, next);
      ctx.requestRender();
    }),
  );

  const fields = grid();

  const idHost = el("div");
  let idDraft = providerId;
  mountTextField(idHost, {
    label: "Provider id",
    value: providerId,
    mono: true,
    helper: "Used as the model prefix: provider/model",
    onChange: (next) => {
      idDraft = next;
    },
  });
  const idRow = el("div", "ocf-row");
  idRow.append(idHost);
  idRow.appendChild(
    button("Rename", {
      variant: "secondary",
      disabled: idDraft === providerId || idDraft.trim() === "",
      onClick: () => {
        const next = idDraft.trim();
        if (!next || next === providerId) return;
        renameKey(ctx, selfPath, providerId, next);
        ctx.requestRender();
      },
    }),
  );
  fields.appendChild(fullWidth(idRow));

  for (const key of ["npm", "name", "api"] as const) {
    const schema = props[key];
    if (!schema) continue;
    const host = el("div");
    const current = provider[key];
    mountTextField(host, {
      label: key === "npm" ? "SDK package" : key,
      value: typeof current === "string" ? current : "",
      placeholder: key === "npm" ? "@ai-sdk/openai-compatible" : undefined,
      mono: true,
      helper: typeof schema.description === "string" ? schema.description : undefined,
      onChange: (next) => {
        const updated = { ...provider };
        if (next.trim() === "") delete updated[key];
        else updated[key] = next;
        ctx.set(selfPath, updated);
      },
    });
    fields.appendChild(host);
  }
  box.body.appendChild(fields);

  // Connection
  const options = isObject(provider.options) ? (provider.options as Record<string, Json>) : {};
  const connection = el("div", "ocf-subcard");
  connection.appendChild(span("ocf-hint", "Connection"));
  const connectionGrid = el("div", "ocf-grid");

  const baseUrlHost = el("div");
  mountTextField(baseUrlHost, {
    label: "Base URL",
    value: typeof options.baseURL === "string" ? options.baseURL : "",
    placeholder: "https://api.example.com/v1",
    mono: true,
    helper: "Leave empty for the SDK default.",
    onChange: (next) => {
      const updatedOptions = { ...options };
      if (next.trim() === "") delete updatedOptions.baseURL;
      else updatedOptions.baseURL = next;
      const updated = { ...provider };
      if (Object.keys(updatedOptions).length === 0) delete updated.options;
      else updated.options = updatedOptions;
      ctx.set(selfPath, updated);
    },
  });
  connectionGrid.appendChild(baseUrlHost);

  const keyValue = typeof options.apiKey === "string" ? options.apiKey : "";
  const envTemplate = /^\{env:(.+)\}$/.exec(keyValue);
  const keyHost = el("div");
  mountTextField(keyHost, {
    label: "API key",
    value: envTemplate ? "" : keyValue,
    password: true,
    placeholder: envTemplate ? `{env:${envTemplate[1]}}` : "sk-…",
    mono: true,
    helper: envTemplate ? `Reads $${envTemplate[1]} at runtime.` : "Stored in this file.",
    onChange: (next) => {
      const updatedOptions = { ...options };
      if (next.trim() === "") delete updatedOptions.apiKey;
      else updatedOptions.apiKey = next;
      const updated = { ...provider };
      if (Object.keys(updatedOptions).length === 0) delete updated.options;
      else updated.options = updatedOptions;
      ctx.set(selfPath, updated);
    },
  });
  connectionGrid.appendChild(keyHost);
  connection.appendChild(connectionGrid);

  // Prefer env vars over literal secrets.
  const envRow = el("div", "ocf-row");
  const envSuggestions = new Set<string>();
  if (envTemplate?.[1]) envSuggestions.add(envTemplate[1]);
  const catalog = catalogOf(ctx);
  if (catalog) for (const id of providerHints(ctx, provider)) {
    for (const name of catalog[id]?.env ?? []) envSuggestions.add(name);
  }
  if (envSuggestions.size > 0) {
    for (const name of [...envSuggestions].slice(0, 4)) {
      envRow.appendChild(
        button(`use $${name}`, {
          variant: "ghost",
          title: `Write {env:${name}} instead of a literal key`,
          onClick: () => {
            const updatedOptions = { ...options, apiKey: `{env:${name}}` };
            ctx.set(selfPath, { ...provider, options: updatedOptions });
            ctx.requestRender();
          },
        }),
      );
    }
  }
  if (envRow.childElementCount > 0) connection.appendChild(envRow);
  box.body.appendChild(connection);

  // Models
  const modelsBox = el("div", "ocf-subcard");
  const modelsHead = el("div", "ocf-item-head");
  modelsHead.appendChild(
    span("ocf-hint", `Models (${Object.keys(models).length})${modelSchema ? "" : " — raw JSON"}`),
  );
  modelsHead.appendChild(
    button("+ Add model", {
      variant: "secondary",
      onClick: () => openAddModel(ctx, selfPath, { ...provider, id: providerId }),
    }),
  );
  modelsBox.appendChild(modelsHead);

  if (modelSchema) {
    if (Object.keys(models).length === 0) {
      modelsBox.appendChild(
        span("ocf-hint", "No models yet. opencode can still call models the provider advertises."),
      );
    }
    for (const [modelId, raw] of Object.entries(models)) {
      const model = isObject(raw) ? raw : {};
      modelsBox.appendChild(modelCard(ctx, selfPath, modelId, model, modelSchema));
    }
  } else {
    const rawHost = el("div");
    mountTextField(rawHost, {
      label: "models",
      value: JSON.stringify(provider.models ?? {}, null, 2),
      multiline: true,
      rows: 5,
      mono: true,
      onChange: (next) => {
        try {
          const parsed = JSON.parse(next) as Json;
          const updated = { ...provider };
          if (isObject(parsed) && Object.keys(parsed).length === 0) delete updated.models;
          else updated.models = parsed;
          ctx.set(selfPath, updated);
        } catch {
          /* keep last valid */
        }
      },
    });
    modelsBox.appendChild(rawHost);
  }
  box.body.appendChild(modelsBox);

  return box.root;
};

/** "Add provider": known provider, OpenAI-compatible endpoint, or custom npm. */
const openAddProvider = (ctx: FormContext, path: Path, providerSchema: Schema | undefined) => {
  const props = properties(deref(providerSchema));
  openModal({
    title: "Add provider",
    build: (body, close) => {
      let mode: "endpoint" | "catalog" | "custom" = "endpoint";
      const panel = el("div", "ocf-list");

      const commit = (id: string, seed: Record<string, Json>) => {
        const trimmed = id.trim();
        if (!trimmed) return;
        const container = isObject(ctx.get(path)) ? (ctx.get(path) as Record<string, Json>) : {};
        if (container[trimmed] !== undefined) {
          panel.replaceChildren(span("ocf-hint ocf-danger", `“${trimmed}” already exists.`));
          return;
        }
        ctx.set(path, { ...container, [trimmed]: seed });
        close();
        ctx.requestRender();
      };

      const paint = () => {
        panel.replaceChildren();
        const switcher = el("div", "ocf-segment");
        for (const [id, label] of [
          ["endpoint", "Custom endpoint"],
          ["catalog", "Known provider"],
          ["custom", "Custom SDK package"],
        ] as const) {
          switcher.appendChild(
            button(label, {
              variant: mode === id ? "secondary" : "ghost",
              onClick: () => {
                mode = id;
                paint();
              },
            }),
          );
        }
        panel.appendChild(switcher);

        if (mode === "endpoint") {
          const idField = el("div", "ocf-row");
          let providerId = "my-endpoint";
          mountTextField(idField, {
            label: "Provider id",
            value: providerId,
            mono: true,
            helper: "Prefix for your models, e.g. my-endpoint/llama-3",
            onChange: (next) => {
              providerId = next;
            },
          });
          let baseUrl = "";
          const urlField = el("div", "ocf-row");
          mountTextField(urlField, {
            label: "Base URL",
            value: "",
            placeholder: "http://localhost:11434/v1",
            mono: true,
            onChange: (next) => {
              baseUrl = next;
            },
          });
          let apiKey = "";
          const keyField = el("div", "ocf-row");
          mountTextField(keyField, {
            label: "API key (optional)",
            value: "",
            password: true,
            helper: "Ollama and most local servers don't need one.",
            onChange: (next) => {
              apiKey = next;
            },
          });
          panel.append(idField, urlField, keyField);
          panel.appendChild(
            button("Add endpoint", {
              variant: "secondary",
              onClick: () =>
                commit(
                  providerId,
                  {
                    npm: OPENAI_COMPATIBLE_NPM,
                    options: {
                      ...(baseUrl.trim() ? { baseURL: baseUrl.trim() } : {}),
                      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                    },
                  },
                ),
            }),
          );
          panel.appendChild(
            hint("Writes provider.<id>.npm = @ai-sdk/openai-compatible plus options.baseURL."),
          );
          return;
        }

        if (mode === "custom") {
          const idField = el("div", "ocf-row");
          let providerId = "";
          mountTextField(idField, {
            label: "Provider id",
            value: "",
            mono: true,
            onChange: (next) => {
              providerId = next;
            },
          });
          let npm = "";
          const npmField = el("div", "ocf-row");
          mountTextField(npmField, {
            label: "SDK package",
            value: "",
            placeholder: "@ai-sdk/anthropic",
            mono: true,
            onChange: (next) => {
              npm = next;
            },
          });
          panel.append(idField, npmField);
          panel.appendChild(
            button("Add provider", {
              variant: "secondary",
              onClick: () => commit(providerId, { npm: npm.trim() }),
            }),
          );
          return;
        }

        // Known provider: searchable catalog list.
        const searchHost = el("div");
        const listHost = el("div", "ocf-results");
        let query = "";
        const paintList = () => {
          const catalog = catalogOf(ctx);
          listHost.replaceChildren();
          if (!catalog) {
            listHost.appendChild(span("ocf-hint", "Loading catalog…"));
            return;
          }
          const hits = searchProviders(catalog, query, 60);
          if (hits.length === 0) {
            listHost.appendChild(span("ocf-hint", "No match — use “Custom SDK package” instead."));
            return;
          }
          for (const hit of hits) {
            const item = el("button", "ocf-result");
            item.type = "button";
            const main = el("div", "ocf-result-main");
            main.append(span("ocf-result-title", hit.label), span("ocf-result-hint", hit.hint));
            const npmTag = span("ocf-mono", hit.provider.npm ?? "");
            npmTag.style.opacity = "0.65";
            item.append(main, npmTag);
            item.addEventListener("click", () => {
              const seed: Record<string, Json> = {};
              if (hit.provider.npm) seed.npm = hit.provider.npm;
              const envName = hit.provider.env?.[0];
              if (envName) seed.options = { apiKey: `{env:${envName}}` };
              commit(hit.id, seed);
            });
            listHost.appendChild(item);
          }
        };
        mountTextField(searchHost, {
          label: "Search providers",
          value: "",
          placeholder: "anthropic, openrouter, ollama…",
          onChange: (next) => {
            query = next;
            paintList();
          },
        });
        panel.append(searchHost, listHost);
        ctx.ensureCatalog();
        void loadCatalog().then(paintList);
        paintList();
      };

      paint();
      body.appendChild(panel);
    },
  });
};

export const providerSection = (
  ctx: FormContext,
  path: Path,
  schema: Schema,
): HTMLElement => {
  const value = ctx.get(path);
  const providers = isObject(value) ? (value as Record<string, Json>) : {};
  const valueSchema = mapValueSchema(deref(schema));
  // Env-var hints and model pickers need the catalog; loading is idempotent and
  // the view repaints when it lands.
  ctx.ensureCatalog();
  const box = card({
    title: "Providers",
    subtitle:
      Object.keys(providers).length === 0
        ? "none configured — opencode uses built-ins and your auth store"
        : `${Object.keys(providers).length} configured`,
  });
  box.actions.appendChild(
    button("+ Add provider", {
      variant: "secondary",
      onClick: () => openAddProvider(ctx, path, valueSchema),
    }),
  );

  const errorNode = el("div", "ocf-hint ocf-danger");
  ctx.onError(path, (message) => {
    errorNode.textContent = message ?? "";
  });
  errorNode.textContent = ctx.errorAt(path) ?? "";
  box.body.appendChild(errorNode);

  if (Object.keys(providers).length === 0) {
    box.body.appendChild(
      span(
        "ocf-hint",
        "Add an endpoint to use a custom base URL, or pick a provider to pin versions and limits.",
      ),
    );
  }

  for (const [providerId, raw] of Object.entries(providers)) {
    const provider = isObject(raw) ? raw : {};
    box.body.appendChild(providerCard(ctx, [...path, providerId], provider, valueSchema));
  }
  return box.root;
};

/** `model` / `small_model` / `agent.*.model`: text field + catalog browser. */
export const modelRefField = (
  ctx: FormContext,
  path: Path,
  schema: Schema,
  options: { label?: string; helper?: string; full?: boolean } = {},
): HTMLElement => {
  const node = deref(schema);
  const label = options.label ?? "Model";
  const value = ctx.get(path);
  const wrap = el("div", options.full === false ? "" : "ocf-span");
  const rowEl = el("div", "ocf-row");

  mountTextField(rowEl, {
    label,
    value: typeof value === "string" ? value : "",
    placeholder: "provider/model",
    mono: true,
    helper: options.helper ?? (typeof node?.description === "string" ? node.description : undefined),
    onChange: (next) => {
      if (next.trim() === "") ctx.remove(path);
      else ctx.set(path, next);
    },
  });
  rowEl.appendChild(
    button("Browse…", {
      variant: "secondary",
      title: "Pick from the models.dev catalog",
      onClick: () => openModelBrowser(ctx, path),
    }),
  );
  wrap.appendChild(rowEl);

  const errorNode = el("div", "ocf-hint ocf-danger");
  ctx.onError(path, (message) => {
    errorNode.textContent = message ?? "";
  });
  errorNode.textContent = ctx.errorAt(path) ?? "";
  wrap.appendChild(errorNode);
  return wrap;
};

const openModelBrowser = (ctx: FormContext, path: Path) => {
  openModal({
    title: "Choose a model",
    build: (body, close) => {
      const searchHost = el("div");
      const listHost = el("div", "ocf-results");
      let query = "";
      const paint = () => {
        const catalog = catalogOf(ctx);
        listHost.replaceChildren();
        if (!catalog) {
          listHost.appendChild(span("ocf-hint", "Loading catalog…"));
          return;
        }
        const hits = searchModels(catalog, query, { limit: 80 });
        if (hits.length === 0) {
          listHost.appendChild(span("ocf-hint", "No match."));
          return;
        }
        for (const hit of hits) {
          const item = el("button", "ocf-result");
          item.type = "button";
          const main = el("div", "ocf-result-main");
          main.append(span("ocf-result-title", hit.label), span("ocf-result-hint", hit.hint));
          item.append(main, span("ocf-mono", hit.ref));
          item.addEventListener("click", () => {
            ctx.set(path, hit.ref);
            close();
            ctx.requestRender();
          });
          listHost.appendChild(item);
        }
      };
      mountTextField(searchHost, {
        label: "Search",
        value: "",
        placeholder: "claude, gpt, gemini…",
        onChange: (next) => {
          query = next;
          paint();
        },
      });
      body.append(searchHost, listHost);
      ctx.ensureCatalog();
      void loadCatalog().then(paint);
      paint();
    },
  });
};

export { describeModel };
