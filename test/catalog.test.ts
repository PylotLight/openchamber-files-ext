/**
 * Catalog search behaviour, with a fixture loader so the tests don't depend on
 * a DOM or on the 1.8 MB generated file.
 */
import { describe, expect, test } from "bun:test";
import {
  catalogState,
  configureCatalogLoader,
  endpointProviderIds,
  loadCatalog,
  OPENAI_COMPATIBLE_NPM,
  providersForNpm,
  searchModels,
  searchProviders,
  type Catalog,
} from "../panel/form/catalog";

const FIXTURE: Catalog = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    npm: "@ai-sdk/anthropic",
    env: ["ANTHROPIC_API_KEY"],
    models: {
      "claude-sonnet-4-5": {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        family: "claude-4-5",
        reasoning: true,
        tool_call: true,
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
      },
      "claude-haiku-4-5": { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
      "retired-model": { id: "retired-model", name: "Retired", status: "deprecated" },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    env: ["OPENAI_API_KEY"],
    models: {
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o",
        family: "gpt-4o",
        tool_call: true,
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    },
  },
  "my-proxy": {
    id: "my-proxy",
    name: "My Proxy",
    npm: OPENAI_COMPATIBLE_NPM,
    models: {
      "llama-3.3-70b": { id: "llama-3.3-70b", name: "Llama 3.3 70B", family: "llama" },
    },
  },
};

const withFixture = async () => {
  configureCatalogLoader(async () => structuredClone(FIXTURE));
  return loadCatalog();
};

describe("catalog loading", () => {
  test("loads through the injected loader and reports ready", async () => {
    const catalog = await withFixture();
    expect(catalog).not.toBeNull();
    expect(catalogState().status).toBe("ready");
  });

  test("surfaces a loader failure without throwing", async () => {
    configureCatalogLoader(async () => {
      throw new Error("offline");
    });
    const catalog = await loadCatalog();
    expect(catalog).toBeNull();
    expect(catalogState()).toEqual({ status: "error", error: "offline" });
    configureCatalogLoader(null);
  });

  test("rejects a non-object payload", async () => {
    configureCatalogLoader(async () => [1, 2, 3]);
    expect(await loadCatalog()).toBeNull();
    configureCatalogLoader(null);
  });

  test("reuses the in-flight promise", async () => {
    configureCatalogLoader(async () => structuredClone(FIXTURE));
    const [a, b] = await Promise.all([loadCatalog(), loadCatalog()]);
    expect(a).toBe(b);
  });
});

describe("provider search", () => {
  test("ranks an exact id match first", async () => {
    const catalog = (await withFixture())!;
    const hits = searchProviders(catalog, "anthropic", 5);
    expect(hits[0]!.id).toBe("anthropic");
    expect(hits[0]!.hint).toContain("3 models");
  });

  test("matches on npm package and display name", async () => {
    const catalog = (await withFixture())!;
    // The exact package beats the compatible fork that merely contains it.
    expect(searchProviders(catalog, "@ai-sdk/openai", 5)[0]!.id).toBe("openai");
    expect(searchProviders(catalog, "My Proxy", 5)[0]!.id).toBe("my-proxy");
  });

  test("a bare id match outranks an npm substring match", async () => {
    const catalog = (await withFixture())!;
    expect(searchProviders(catalog, "openai", 5).map((hit) => hit.id)).toEqual(["openai", "my-proxy"]);
  });

  test("returns nothing for a miss", async () => {
    const catalog = (await withFixture())!;
    expect(searchProviders(catalog, "zzzznotathing", 5)).toHaveLength(0);
  });

  test("resolves providers by npm package", async () => {
    const catalog = (await withFixture())!;
    expect(providersForNpm(catalog, "@ai-sdk/anthropic").map((p) => p.id)).toEqual(["anthropic"]);
    expect(providersForNpm(catalog, undefined)).toEqual([]);
  });

  test("offers endpoint-friendly provider ids", async () => {
    const catalog = (await withFixture())!;
    const ids = endpointProviderIds(catalog);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
  });
});

describe("model search", () => {
  test("finds a model by id and reports the provider/model ref", async () => {
    const catalog = (await withFixture())!;
    const hits = searchModels(catalog, "claude-sonnet-4-5");
    expect(hits[0]!.ref).toBe("anthropic/claude-sonnet-4-5");
    expect(hits[0]!.hint).toContain("reasoning");
  });

  test("finds models by display name and family", async () => {
    const catalog = (await withFixture())!;
    expect(searchModels(catalog, "GPT-4o")[0]!.modelId).toBe("gpt-4o");
    expect(searchModels(catalog, "claude-4-5")[0]!.modelId).toBe("claude-sonnet-4-5");
  });

  test("scopes to the given providers", async () => {
    const catalog = (await withFixture())!;
    const hits = searchModels(catalog, "llama", { providerIds: ["my-proxy"] });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.providerId).toBe("my-proxy");
    expect(searchModels(catalog, "llama", { providerIds: ["openai"] })).toHaveLength(0);
  });

  test("hides deprecated models unless asked", async () => {
    const catalog = (await withFixture())!;
    expect(searchModels(catalog, "retired")).toHaveLength(0);
    expect(searchModels(catalog, "retired", { includeDeprecated: true })).toHaveLength(1);
  });

  test("respects the result limit", async () => {
    const catalog = (await withFixture())!;
    expect(searchModels(catalog, "", { limit: 2 })).toHaveLength(2);
  });
});
