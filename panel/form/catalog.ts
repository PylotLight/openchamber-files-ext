/**
 * Model catalog: lazy-loaded from the extension package, never from the network.
 *
 * `panel/data/models.json` is served same-origin by the host's guest asset
 * route, so this is a local file read that happens only when a picker opens.
 */
import { type Json } from "./core";

export type CatalogModel = {
  id: string;
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  status?: string;
  modalities?: { input?: string[]; output?: string[] };
};

export type CatalogProvider = {
  id: string;
  name: string;
  npm?: string;
  env?: string[];
  models: Record<string, CatalogModel>;
};

export type Catalog = Record<string, CatalogProvider>;

export type CatalogState =
  | { status: "idle" | "loading" }
  | { status: "ready"; catalog: Catalog }
  | { status: "error"; error: string };

type Listener = (state: CatalogState) => void;

let state: CatalogState = { status: "idle" };
let inflight: Promise<Catalog | null> | null = null;
const listeners = new Set<Listener>();

const emit = (next: CatalogState) => {
  state = next;
  for (const listener of listeners) listener(state);
};

export const onCatalog = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
};

export const catalogState = (): CatalogState => state;

const defaultLoader = async (): Promise<unknown> => {
  const url = new URL("data/models.json", document.baseURI);
  // The host mints a scoped token for guest assets and propagates it onto
  // relative URLs in the document; carry it over for a raw fetch.
  try {
    const token = new URL(location.href).searchParams.get("oc_url_token");
    if (token) url.searchParams.set("oc_url_token", token);
  } catch {
    /* no location parsing in exotic hosts; the plain URL still works */
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

let loader: () => Promise<unknown> = defaultLoader;

/** Test seam: swap the transport without touching call sites. */
export const configureCatalogLoader = (next: (() => Promise<unknown>) | null): void => {
  loader = next ?? defaultLoader;
  state = { status: "idle" };
  inflight = null;
};

export const loadCatalog = (): Promise<Catalog | null> => {
  if (inflight) return inflight;
  emit({ status: "loading" });
  inflight = (async () => {
    try {
      const raw = (await loader()) as Json;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("catalog root is not an object");
      }
      const catalog = raw as Catalog;
      emit({ status: "ready", catalog });
      return catalog;
    } catch (error) {
      emit({ status: "error", error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  })();
  return inflight;
};

export type ProviderHit = {
  id: string;
  label: string;
  hint: string;
  score: number;
  provider: CatalogProvider;
};

/** 0 = no match, otherwise higher is better (exact > prefix > substring). */
const matchScore = (needle: string, text: string | undefined): number => {
  if (!text) return 0;
  const haystack = text.toLowerCase();
  if (haystack === needle) return 100;
  if (haystack.startsWith(needle)) return 80;
  if (haystack.includes(needle)) return 55;
  if (
    needle.length >= 3 &&
    haystack.split(/[^a-z0-9]+/).some((part) => part.startsWith(needle))
  ) {
    return 40;
  }
  return 0;
};

/**
 * Weighted match across fields. Weighting matters in practice: searching
 * "openai" must rank the `openai` provider above every provider whose npm
 * package is `@ai-sdk/openai-compatible`.
 */
const scoreFields = (query: string, fields: Array<[string | undefined, number]>): number => {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  let best = 0;
  for (const [text, weight] of fields) {
    const score = matchScore(needle, text);
    if (score > 0) best = Math.max(best, score * weight);
  }
  return best;
};

export const searchProviders = (
  catalog: Catalog,
  query: string,
  limit = 40,
): ProviderHit[] => {
  const hits: ProviderHit[] = [];
  for (const provider of Object.values(catalog)) {
    const score = scoreFields(query, [
      [provider.id, 3],
      [provider.name, 2],
      [provider.npm, 1],
    ]);
    if (score <= 0) continue;
    hits.push({
      id: provider.id,
      label: provider.name || provider.id,
      hint: `${provider.id} · ${Object.keys(provider.models).length} models`,
      score,
      provider,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
};

export type ModelHit = {
  providerId: string;
  modelId: string;
  /** `provider/model`, the form opencode expects. */
  ref: string;
  label: string;
  hint: string;
  score: number;
  model: CatalogModel;
  provider: CatalogProvider;
};

const modelHint = (model: CatalogModel, provider: CatalogProvider): string => {
  const bits: string[] = [provider.name || provider.id];
  const flags: string[] = [];
  if (model.reasoning) flags.push("reasoning");
  if (model.tool_call) flags.push("tools");
  if (model.attachment) flags.push("vision");
  if (flags.length) bits.push(flags.join(" · "));
  return bits.join(" — ");
};

export const searchModels = (
  catalog: Catalog,
  query: string,
  options: { providerIds?: string[]; limit?: number; includeDeprecated?: boolean } = {},
): ModelHit[] => {
  const limit = options.limit ?? 50;
  const providerIds = options.providerIds;
  const providers = providerIds
    ? providerIds.map((id) => catalog[id]).filter((value): value is CatalogProvider => Boolean(value))
    : Object.values(catalog);
  const hits: ModelHit[] = [];

  for (const provider of providers) {
    for (const model of Object.values(provider.models)) {
      if (!options.includeDeprecated && model.status === "deprecated") continue;
      const base = scoreFields(query, [
        [model.id, 4],
        [model.name, 2],
        [model.family, 1],
        [provider.id, providerIds?.length ? 2 : 1],
        [provider.name, 1],
      ]);
      if (base <= 0) continue;
      // Being in the provider's own catalog is a mild bonus, not a pass.
      const score = base + (providerIds?.length ? 10 : 0);
      hits.push({
        providerId: provider.id,
        modelId: model.id,
        ref: `${provider.id}/${model.id}`,
        label: model.name || model.id,
        hint: modelHint(model, provider),
        score,
        model,
        provider,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  return hits.slice(0, limit);
};

/** Catalog provider whose npm package matches, for `npm` → suggestions. */
export const providersForNpm = (catalog: Catalog, npm: string | undefined): CatalogProvider[] => {
  if (!npm) return [];
  const target = npm.trim().toLowerCase();
  if (!target) return [];
  return Object.values(catalog).filter((provider) => (provider.npm ?? "").toLowerCase() === target);
};

export const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";

/** Sensible provider pickers for a custom endpoint, most useful first. */
export const endpointProviderIds = (catalog: Catalog): string[] => {
  const preferred = ["openai", "anthropic", "google", "openrouter", "ollama-cloud", "lmstudio", "opencode"];
  const known = preferred.filter((id) => catalog[id]);
  return known;
};
