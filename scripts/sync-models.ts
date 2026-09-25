/**
 * Refresh the vendored model catalog used by the form's model pickers.
 *
 *   bun run sync:models
 *
 * models.dev/api.json is ~4.9 MB with pricing, limits, and per-variant detail.
 * The pickers only need identity + capability flags, so this trims it to a
 * lazy-loaded asset. The panel never fetches it at build time and never
 * fetches it over the network at runtime: it is served same-origin from the
 * extension package and pulled in only when a picker opens.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "panel", "data");
const SOURCE = "https://models.dev/api.json";

type Json = unknown;
const isRecord = (value: Json): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Model = {
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  release_date?: string;
  status?: string;
  modalities?: { input?: string[]; output?: string[] };
};

type Provider = {
  name?: string;
  npm?: string;
  env?: string[];
  models?: Record<string, Model>;
};

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} -> HTTP ${res.status}`);
const api = (await res.json()) as Record<string, Provider>;

const providers: Record<string, unknown> = {};
let modelCount = 0;

for (const id of Object.keys(api).sort()) {
  const provider = api[id];
  if (!isRecord(provider)) continue;
  const models: Record<string, unknown> = {};
  const entries = Object.entries(provider.models ?? {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [modelId, model] of entries) {
    if (!isRecord(model)) continue;
    modelCount += 1;
    // Keep identity + capability flags; drop pricing/limits/variants, which
    // the form can still express as per-model overrides. `release_date` goes
    // too: snapshot model ids already encode it, and it was 10% of the file.
    const trimmed: Record<string, Json> = { id: modelId };
    if (model.name) trimmed.name = model.name;
    if (model.family) trimmed.family = model.family;
    if (model.attachment !== undefined) trimmed.attachment = model.attachment;
    if (model.reasoning !== undefined) trimmed.reasoning = model.reasoning;
    if (model.tool_call !== undefined) trimmed.tool_call = model.tool_call;
    if (model.temperature !== undefined) trimmed.temperature = model.temperature;
    if (model.status) trimmed.status = model.status;
    if (model.modalities) trimmed.modalities = model.modalities;
    models[modelId] = trimmed;
  }
  providers[id] = {
    id,
    name: provider.name ?? id,
    npm: provider.npm,
    env: provider.env,
    models,
  };
}

await mkdir(OUT_DIR, { recursive: true });
const body = JSON.stringify(providers);
await writeFile(join(OUT_DIR, "models.json"), body);
await writeFile(
  join(OUT_DIR, "models.meta.json"),
  `${JSON.stringify(
    {
      source: SOURCE,
      fetchedAt: new Date().toISOString(),
      providerCount: Object.keys(providers).length,
      modelCount,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `models.json: ${Object.keys(providers).length} providers, ${modelCount} models, ` +
    `${(body.length / 1024).toFixed(0)} KB`,
);
