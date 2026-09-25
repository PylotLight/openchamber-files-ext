/**
 * Unit tests for the form's document model, schema helpers, and validation.
 * These import the modules directly — no DOM needed.
 */
import { describe, expect, test } from "bun:test";
import {
  detectFormatting,
  parseDoc,
  pathKey,
  writeValue,
  type Json,
} from "../panel/form/core";
import {
  activeVariant,
  defaultForSchema,
  deref,
  enumValues,
  isMap,
  mapValueSchema,
  properties,
  schemaType,
  seedForSchema,
  variants,
} from "../panel/form/schema";
import { pointerToPath, validate } from "../panel/form/validate";

const CONFIG = `{
  // opencode config
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5", // default model
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://localhost:11434/v1" }
    }
  }
}
`;

describe("jsonc document model", () => {
  test("parses comments and trailing commas", () => {
    const parsed = parseDoc(CONFIG);
    expect(parsed.error).toBeNull();
    expect((parsed.data as Record<string, Json>).model).toBe("anthropic/claude-sonnet-4-5");
  });

  test("reports parse errors instead of throwing", () => {
    const parsed = parseDoc('{ "a": }');
    expect(parsed.error).toBeTruthy();
    expect(parsed.error).toContain("line 1");
    expect(parsed.errorOffset).toBeGreaterThan(0);
  });

  test("parse errors name the line and column", () => {
    const parsed = parseDoc('{\n  "a": 1,\n  "b": tru\n}');
    expect(parsed.error).toBe('Unexpected character near “tru” (line 3, column 8)');
  });

  test("distinguishes unterminated strings from unclosed objects", () => {
    expect(parseDoc('{ "a": "oops }').error).toContain("Unterminated string");
    expect(parseDoc('{ "a": 1').error).toContain("Expected “}”");
  });

  test("empty file is an empty object, not an error", () => {
    expect(parseDoc("")).toEqual({ data: {}, error: null, errorOffset: -1 });
    expect(parseDoc("   \n ")).toEqual({ data: {}, error: null, errorOffset: -1 });
  });

  test("detects indentation and line endings", () => {
    expect(detectFormatting('{\n    "a": 1\n}')).toMatchObject({ insertSpaces: true, tabSize: 4, eol: "\n" });
    expect(detectFormatting('{\r\n\t"a": 1\r\n}')).toMatchObject({ insertSpaces: false, eol: "\r\n" });
    expect(detectFormatting("{}")).toMatchObject({ insertSpaces: true, tabSize: 2 });
  });

  test("an edit preserves comments, order, and untouched keys", () => {
    const fmt = detectFormatting(CONFIG);
    const next = writeValue(CONFIG, ["model"], "openai/gpt-5", fmt);
    expect(next).toContain("// opencode config");
    expect(next).toContain("// default model");
    expect(next).toContain("openai/gpt-5");
    expect(next).toContain("http://localhost:11434/v1");
    // Key order is untouched: $schema still comes first.
    expect(next.indexOf("$schema")).toBeLessThan(next.indexOf("provider"));
  });

  test("nested writes reuse the file's indentation", () => {
    const four = `{\n    "provider": {\n        "ollama": { "npm": "x" }\n    }\n}`;
    const next = writeValue(four, ["provider", "ollama", "options", "baseURL"], "http://x", detectFormatting(four));
    expect(next).toContain('"baseURL": "http://x"');
    expect(next).toContain("\n        ");
  });

  test("removing a key deletes it and can empty its parent", () => {
    const fmt = detectFormatting(CONFIG);
    const withoutModel = writeValue(CONFIG, ["model"], undefined, fmt);
    expect(parseDoc(withoutModel).data).not.toHaveProperty("model");
    const withoutProvider = writeValue(CONFIG, ["provider"], undefined, fmt);
    expect(parseDoc(withoutProvider).data).not.toHaveProperty("provider");
    expect(parseDoc(withoutProvider).data).toHaveProperty("model");
  });

  test("creates missing intermediate objects", () => {
    const next = writeValue("{}", ["provider", "local", "options", "apiKey"], "k", detectFormatting("{}"));
    expect(parseDoc(next).data).toEqual({ provider: { local: { options: { apiKey: "k" } } } });
  });

  test("writes arrays by index and appends", () => {
    const base = '{ "instructions": ["a"] }';
    const fmt = detectFormatting(base);
    expect(parseDoc(writeValue(base, ["instructions", 1], "b", fmt)).data).toEqual({ instructions: ["a", "b"] });
    expect(parseDoc(writeValue(base, ["instructions", 0], "z", fmt)).data).toEqual({ instructions: ["z"] });
  });

  test("pathKey is stable and collision-free", () => {
    expect(pathKey(["a", "b"])).not.toBe(pathKey(["a.b"]));
    expect(pathKey([])).toBe("[]");
  });
});

describe("schema helpers", () => {
  test("deref resolves local refs and keeps siblings", () => {
    const agent = deref({ $ref: "#/$defs/AgentConfig", description: "hi" });
    expect(agent?.properties?.model).toBeDefined();
    expect(agent?.description).toBe("hi");
  });

  test("root config exposes its properties", () => {
    const props = properties(deref({ $ref: "#/$defs/Config" }));
    expect(Object.keys(props)).toContain("provider");
    expect(Object.keys(props)).toContain("mcp");
  });

  test("map schemas expose their value schema", () => {
    const provider = properties(deref({ $ref: "#/$defs/Config" })).provider!;
    expect(isMap(provider)).toBe(true);
    expect(mapValueSchema(provider)?.properties?.options).toBeDefined();
  });

  test("permission is a union of an action and an object", () => {
    const permission = properties(deref({ $ref: "#/$defs/Config" })).permission!;
    const list = variants(permission)!;
    expect(list).toHaveLength(2);
    expect(activeVariant(list, "ask")).toBe(0);
    expect(activeVariant(list, { bash: "deny" })).toBe(1);
  });

  test("mcp discriminates local, remote, and enabled-only", () => {
    const mcp = properties(deref({ $ref: "#/$defs/Config" })).mcp!;
    // The map's value schema is itself a union of (local|remote) | {enabled}.
    const valueSchema = mapValueSchema(mcp)!;
    const outer = variants(valueSchema)!;
    expect(outer).toHaveLength(2);
    const inner = variants(outer[0]!.schema)!;
    expect(inner).toHaveLength(2);
    expect(inner.find((variant) => variant.matches({ type: "remote", url: "x" }))).toBeDefined();
    expect(inner.find((variant) => variant.matches({ type: "local", command: ["npx"] }))).toBeDefined();
  });

  test("provider value schema derefs to ProviderConfig", () => {
    const provider = properties(deref({ $ref: "#/$defs/Config" })).provider!;
    const value = mapValueSchema(provider)!;
    expect(Object.keys(properties(value))).toContain("options");
    expect(Object.keys(properties(value))).toContain("models");
  });

  test("enumValues reads a scalar enum and an array-of-enum", () => {
    const config = properties(deref({ $ref: "#/$defs/Config" }));
    expect(enumValues(config.logLevel)).toEqual(["DEBUG", "INFO", "WARN", "ERROR"]);
    // The shape the modalities chips depend on: provider -> models -> model.
    const providerProps = properties(mapValueSchema(config.provider!)!);
    const modelProps = properties(mapValueSchema(providerProps.models!)!);
    const modalities = modelProps.modalities!;
    expect(enumValues(modalities.properties!.input)).toEqual([
      "text",
      "audio",
      "image",
      "video",
      "pdf",
    ]);
    expect(enumValues({ const: false })).toEqual([false]);
    expect(enumValues({ type: "string" })).toEqual([]);
  });

  test("seedForSchema fills required keys so a new item starts valid", () => {
    const remote = deref({ $ref: "#/$defs/McpRemoteConfig" })!;
    expect(remote.required).toEqual(["type", "url"]);
    const seed = seedForSchema({ $ref: "#/$defs/McpRemoteConfig" });
    // A new map entry gets `type`/`url` rather than an invalid `{}`, and the
    // single-value enum seeds itself.
    expect(seed).toEqual({ type: "remote", url: "" });
    expect(validate({ mcp: { x: seed } }).count).toBe(0);
    expect(validate({ mcp: { x: {} } }).count).toBeGreaterThan(0);
  });

  test("defaultForSchema matches the branch shape", () => {
    expect(defaultForSchema({ type: "object" })).toEqual({});
    expect(defaultForSchema({ type: "array" })).toEqual([]);
    expect(defaultForSchema({ type: "string" })).toBe("");
    expect(defaultForSchema({ type: "integer" })).toBe(0);
    expect(defaultForSchema({ enum: ["a", "b"] })).toBe("a");
    expect(defaultForSchema({ const: false })).toBe(false);
    // A union prefers a branch that can hold structure.
    expect(defaultForSchema({ anyOf: [{ type: "string" }, { type: "object" }] })).toEqual({});
  });
});

describe("validation", () => {
  test("a realistic config passes", () => {
    const result = validate(parseDoc(CONFIG).data);
    expect(result.available).toBe(true);
    expect(result.count).toBe(0);
  });

  test("reports unknown keys against their field path", () => {
    const result = validate({ ...(parseDoc(CONFIG).data as object), nope: 1 } as Json);
    expect(result.count).toBeGreaterThan(0);
    expect([...result.byField.values()].join(" ")).toContain("nope");
  });

  test("reports a wrong type on the exact field", () => {
    const data = parseDoc(CONFIG).data as Record<string, Json>;
    const result = validate({ ...data, model: 42 } as Json);
    expect(result.byField.get(pathKey(["model"]))).toBeTruthy();
    expect(result.errorPaths.has(pathKey(["model"]))).toBe(false);
  });

  test("reports a missing required key on the key itself", () => {
    const result = validate({
      provider: { local: { npm: "x", models: { broken: { modalities: { input: ["text"], output: "nope" } } } } },
    } as Json);
    const messages = [...result.byField.entries()].map(([key, message]) => `${key}: ${message}`);
    expect(messages.join("\n")).toContain("models");
  });

  test("nested provider errors surface under the provider path", () => {
    const result = validate({
      provider: { p: { models: { m: { modalities: { output: "text" } } } } },
    } as Json);
    expect(result.errorPaths.has(pathKey(["provider"]))).toBe(true);
  });

  test("pointerToPath unescapes JSON pointer segments", () => {
    expect(pointerToPath("/provider/my~1prov/models/gpt~14o")).toEqual([
      "provider",
      "my/prov",
      "models",
      "gpt/4o",
    ]);
  });
});
