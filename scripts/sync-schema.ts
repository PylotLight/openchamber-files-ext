/**
 * Refresh the vendored opencode config schema.
 *
 *   bun run sync:schema
 *
 * The published schema is JSON Schema draft 2020-12. It `$ref`s
 * models.dev/model-schema.json for model ids, which we cannot resolve at
 * runtime (the guest sandbox is cross-origin and neither host sends CORS
 * headers), so remote refs are dropped: every use site already carries
 * `"type": "string"` alongside the `$ref`, so dropping it leaves a valid,
 * self-contained schema.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "panel", "data");
const SOURCE = "https://opencode.ai/config.json";

type Json = unknown;

const isRecord = (value: Json): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Delete non-local `$ref`s so the schema compiles standalone. */
const stripRemoteRefs = (node: Json, stats: { stripped: string[] }): Json => {
  if (Array.isArray(node)) return node.map((item) => stripRemoteRefs(item, stats));
  if (!isRecord(node)) return node;
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string" && !value.startsWith("#")) {
      stats.stripped.push(value);
      continue;
    }
    out[key] = stripRemoteRefs(value, stats);
  }
  return out;
};

const countRefs = (node: Json): number => {
  if (Array.isArray(node)) return node.reduce<number>((sum, item) => sum + countRefs(item), 0);
  if (!isRecord(node)) return 0;
  let total = 0;
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") total += 1;
    else total += countRefs(value);
  }
  return total;
};

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} -> HTTP ${res.status}`);
const upstream = (await res.json()) as Json;

const stats = { stripped: [] as string[] };
const schema = stripRemoteRefs(upstream, stats);
if (!isRecord(schema)) throw new Error("schema root is not an object");

const localRefs = countRefs(schema);
if (localRefs === 0) throw new Error("no local $refs survived; refusing to write");

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, "opencode-schema.json"), `${JSON.stringify(schema, null, 2)}\n`);
await writeFile(
  join(OUT_DIR, "opencode-schema.meta.json"),
  `${JSON.stringify(
    {
      source: SOURCE,
      fetchedAt: new Date().toISOString(),
      strippedRemoteRefs: [...new Set(stats.stripped)],
      localRefCount: localRefs,
    },
    null,
    2,
  )}\n`,
);

const defs = isRecord(schema.$defs) ? Object.keys(schema.$defs).length : 0;
console.log(
  `opencode-schema.json: ${defs} defs, ${localRefs} local $refs, ` +
    `stripped ${new Set(stats.stripped).size} remote ref target(s)`,
);
