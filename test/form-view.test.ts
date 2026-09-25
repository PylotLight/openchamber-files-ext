/**
 * Form view tests: drive the real bundle in the mock host, open an opencode
 * config, and exercise the paths users actually take.
 *
 * The catalog is served from panel/data/models.json by the harness, so the
 * pickers run their real code.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { bootPanel } from "./harness";
import { parseDoc } from "../panel/form/core";

const CONFIG = `{
  // opencode config — keep this comment
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://localhost:11434/v1" }
    }
  }
}
`;

const boot = async (config = CONFIG) =>
  bootPanel({
    directory: "/home/light/.config/openchamber/chats/session-abc123",
    files: {
      "": { kind: "directory", entries: ["opencode.json"] },
      "opencode.json": { kind: "file", content: config },
    },
  });

const openConfig = async (config?: string) => {
  const panel = await boot(config);
  const row = await panel.waitFor(() =>
    panel.doc.querySelector<HTMLElement>('.ft-row[data-path="opencode.json"]'),
  );
  row.dispatchEvent(new panel.win.MouseEvent("click", { bubbles: true }));
  // Wait for the read to land, not just for the tab chip: the Form view is
  // deliberately not mounted against an empty buffer.
  await panel.waitFor(() => panel.doc.querySelector(".cm-content"));
  return panel;
};

const clickForm = async (panel: Awaited<ReturnType<typeof openConfig>>) => {
  const button = await panel.waitFor(() =>
    [...panel.doc.querySelectorAll<HTMLElement>(".oc-head button")].find((node) =>
      node.textContent?.trim() === "Form",
    ),
  );
  button.dispatchEvent(new panel.win.MouseEvent("click", { bubbles: true }));
  await panel.waitFor(() => panel.doc.querySelector(".ocf-scroll"));
  return panel;
};

const buttons = (panel: Awaited<ReturnType<typeof openConfig>>): HTMLElement[] =>
  [...panel.doc.querySelectorAll<HTMLElement>("button")];

const clickButton = (panel: Awaited<ReturnType<typeof openConfig>>, text: string) => {
  const node = buttons(panel).find((candidate) => candidate.textContent?.trim() === text);
  if (!node) {
    const labels = buttons(panel).map((n) => n.textContent?.trim()).filter(Boolean);
    throw new Error(`no button “${text}”; saw: ${labels.slice(0, 30).join(" | ")}`);
  }
  node.dispatchEvent(new panel.win.MouseEvent("click", { bubbles: true }));
  return node;
};

const fieldLabels = (panel: Awaited<ReturnType<typeof openConfig>>): string[] =>
  [...panel.doc.querySelectorAll<HTMLElement>(".ocf-card-title")].map((node) => node.textContent ?? "");

const inputValues = (panel: Awaited<ReturnType<typeof openConfig>>): string[] =>
  [...panel.doc.querySelectorAll<HTMLInputElement>("input, textarea")].map((node) => node.value);

/** Find a labelled input by its visible label text. */
const inputByLabel = (
  panel: Awaited<ReturnType<typeof openConfig>>,
  label: string,
  root: ParentNode = panel.doc,
): HTMLInputElement => {
  for (const field of root.querySelectorAll<HTMLElement>(".oc-sdk-field")) {
    const caption = field.querySelector(".oc-sdk-field-label")?.textContent?.trim();
    if (caption !== label) continue;
    const input = field.querySelector<HTMLInputElement>("input, textarea");
    if (input) return input;
  }
  const labels = [...root.querySelectorAll(".oc-sdk-field-label")].map((n) => n.textContent?.trim());
  throw new Error(`no field “${label}”; saw: ${labels.slice(0, 40).join(" | ")}`);
};

const type = (
  panel: Awaited<ReturnType<typeof openConfig>>,
  input: HTMLInputElement,
  value: string,
) => {
  input.value = value;
  input.dispatchEvent(new panel.win.Event("input", { bubbles: true }));
};

const openPanel: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (openPanel.length) await openPanel.pop()!.close();
});

describe("form eligibility", () => {
  test("Form toggle appears for an opencode config", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    const has = await panel.waitFor(() =>
      [...panel.doc.querySelectorAll<HTMLElement>(".oc-head button")].find((node) =>
        node.textContent?.trim() === "Form",
      ),
    );
    expect(has).toBeTruthy();
  });

  test("Form toggle appears for any config declaring $schema", async () => {
    const panel = await openConfig('{"$schema":"https://opencode.ai/config.json"}');
    openPanel.push(panel);
    await panel.waitFor(() =>
      [...panel.doc.querySelectorAll<HTMLElement>(".oc-head button")].some((node) =>
        node.textContent?.trim() === "Form",
      ),
    );
    expect(true).toBe(true);
  });

  test("Form toggle is hidden for an unrelated json file", async () => {
    const panel = await bootPanel({
      directory: "/home/light/.config/openchamber/chats/session-abc123",
      files: {
        "": { kind: "directory", entries: ["package.json"] },
        "package.json": { kind: "file", content: '{ "name": "demo" }' },
      },
    });
    openPanel.push(panel);
    const row = await panel.waitFor(() =>
      panel.doc.querySelector<HTMLElement>('.ft-row[data-path="package.json"]'),
    );
    row.dispatchEvent(new panel.win.MouseEvent("click", { bubbles: true }));
    await panel.waitFor(() => panel.doc.querySelector(".oc-chip"));
    await panel.sleep(120);
    const labels = [...panel.doc.querySelectorAll<HTMLElement>(".oc-head button")].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).not.toContain("Form");
    expect(panel.doc.querySelector(".ocf-scroll")).toBeNull();
  });
});

describe("form view rendering", () => {
  test("shows the curated sections", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);
    const titles = fieldLabels(panel);
    expect(titles).toContain("Providers");
    expect(titles).toContain("Models");
    expect(titles).toContain("MCP servers");
    expect(titles).toContain("Permissions");
  });

  test("renders configured providers with their endpoint details", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);
    await panel.waitFor(() =>
      [...panel.doc.querySelectorAll<HTMLElement>(".ocf-card-title")].some(
        (node) => node.textContent === "ollama",
      ),
    );
    // Field values live on inputs, not in textContent.
    const values = inputValues(panel).join("\n");
    expect(values).toContain("http://localhost:11434/v1");
    expect(values).toContain("@ai-sdk/openai-compatible");
    expect(panel.doc.body.textContent).toContain("ollama");
  });

  test("collapses map entries instead of expanding every agent form", async () => {
    const panel = await openConfig(
      '{"$schema":"https://opencode.ai/config.json","agent":{"build":{"model":"anthropic/claude-sonnet-4-5"}}}',
    );
    openPanel.push(panel);
    await clickForm(panel);
    await panel.waitFor(() => (panel.doc.body.textContent ?? "").includes("build"));
    await panel.sleep(150);

    // The configured agent is a collapsed card, not an expanded form.
    const agentCard = [...panel.doc.querySelectorAll<HTMLElement>(".ocf-card")].find(
      (node) => node.querySelector(".ocf-card-title")?.textContent === "build",
    );
    expect(agentCard?.dataset.collapsed).toBe("true");

    // The seven built-in agent names are not materialised as forms.
    const text = panel.doc.body.textContent ?? "";
    for (const name of ["general", "explore", "compaction"]) {
      expect(text).not.toContain(`▾${name}`);
    }
    // Unset map keys collapse too: at most a couple of permission matrices.
    const expandedPermissions = [...panel.doc.querySelectorAll<HTMLElement>(".ocf-card")].filter(
      (node) =>
        node.querySelector(".ocf-card-title")?.textContent === "Permissions" &&
        node.dataset.collapsed !== "true",
    ).length;
    expect(expandedPermissions).toBeLessThanOrEqual(1);
    expect(panel.errors).toEqual([]);
  }, 20000);

  test("reports a valid config", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);
    await panel.waitFor(() => (panel.doc.body.textContent ?? "").includes("valid opencode config"));
    expect(panel.doc.body.textContent).toContain("valid opencode config");
  });

  test("surfaces schema errors for a broken config", async () => {
    const panel = await openConfig(
      '{"$schema":"https://opencode.ai/config.json","server":{"port":"not-a-number"}}',
    );
    openPanel.push(panel);
    await clickForm(panel);
    await panel.waitFor(() => (panel.doc.body.textContent ?? "").includes("schema issue"));
    expect(panel.doc.body.textContent).toContain("schema issue");
  });

  test("shows a parse error for malformed json instead of a stack trace", async () => {
    const panel = await openConfig('{"$schema": "https://opencode.ai/config.json", "model": }');
    openPanel.push(panel);
    await clickForm(panel);
    await panel.waitFor(() => (panel.doc.body.textContent ?? "").includes("line 1"));
    expect(panel.errors).toEqual([]);
  });
});

const expandCard = async (
  panel: Awaited<ReturnType<typeof openConfig>>,
  title: string,
): Promise<HTMLElement> => {
  const node = await panel.waitFor(() =>
    [...panel.doc.querySelectorAll<HTMLElement>(".ocf-card")].find(
      (card) => card.querySelector(".ocf-card-title")?.textContent === title,
    ),
  );
  if (!node) throw new Error(`no card titled ${title}`);
  if (node.dataset.collapsed === "true") {
    node.querySelector<HTMLElement>(".ocf-card-head")?.dispatchEvent(
      new panel.win.MouseEvent("click", { bubbles: true }),
    );
    await panel.sleep(60);
  }
  return node;
};

/** Save, then read the written file back as data (the source is JSONC). */
const saveAndRead = async (panel: Awaited<ReturnType<typeof openConfig>>): Promise<any> => {
  clickButton(panel, "Save");
  await panel.waitFor(() => panel.writes.length > 0, 8000);
  const raw = panel.writes[panel.writes.length - 1]!.content;
  const parsed = parseDoc(raw);
  if (parsed.error) throw new Error(`written file is not parseable: ${parsed.error}\n${raw}`);
  return parsed.data;
};

describe("add provider flow", () => {
  test("adds an openai-compatible endpoint", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);

    clickButton(panel, "+ Add provider");
    const modal = await panel.waitFor(() => panel.doc.querySelector(".ocf-modal"));
    if (!modal) throw new Error("modal did not open");

    // Custom endpoint is the default mode.
    type(panel, inputByLabel(panel, "Provider id", modal), "my-proxy");
    type(panel, inputByLabel(panel, "Base URL", modal), "https://proxy.internal/v1");
    clickButton(panel, "Add endpoint");

    await panel.waitFor(() => inputValues(panel).some((value) => value.includes("proxy.internal")), 8000);
    expect(inputValues(panel)).toContain("my-proxy");
    expect(panel.errors).toEqual([]);
  });

  test("adds a model to a provider and prefills its modalities", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);

    await expandCard(panel, "ollama");
    clickButton(panel, "+ Add model");
    const modal = await panel.waitFor(() => panel.doc.querySelector(".ocf-modal"));
    if (!modal) throw new Error("model modal did not open");

    type(panel, inputByLabel(panel, "Search models", modal), "llama3");
    await panel.waitFor(() => modal.querySelector(".ocf-result"), 8000);

    const firstHit = modal.querySelector<HTMLElement>(".ocf-result")!;
    const modelId = firstHit.querySelector(".ocf-mono")?.textContent?.split("/").pop() ?? "";
    expect(modelId).not.toBe("");
    firstHit.dispatchEvent(new panel.win.MouseEvent("click", { bubbles: true }));

    // The model landed under its provider, with catalog modalities prefilled.
    const written = await saveAndRead(panel);
    const models = (written.provider as Record<string, Record<string, Record<string, unknown>>>)!
      .ollama!.models!;
    expect(Object.keys(models)).toContain(modelId);
    expect(models[modelId]!.modalities).toBeDefined();
    expect(panel.errors).toEqual([]);
  }, 20000);

  test("the added model is editable as a model card, not raw JSON", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);

    await expandCard(panel, "ollama");
    clickButton(panel, "+ Add model");
    const modal = await panel.waitFor(() => panel.doc.querySelector(".ocf-modal"));
    if (!modal) throw new Error("model modal did not open");
    type(panel, inputByLabel(panel, "Or enter a model id", modal), "my-private-model");
    clickButton(panel, "Add model");

    await panel.waitFor(() => (panel.doc.body.textContent ?? "").includes("my-private-model"), 8000);
    const text = panel.doc.body.textContent ?? "";
    expect(text).toContain("input modalities");
    expect(text).toContain("output modalities");
    expect(text).toContain("Capabilities");
    expect(text).toContain("Limits");
    expect(panel.errors).toEqual([]);
  }, 20000);

  test("writing through the form marks the tab dirty", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);

    clickButton(panel, "+ Add provider");
    const modal = await panel.waitFor(() => panel.doc.querySelector(".ocf-modal"));
    if (!modal) throw new Error("modal did not open");
    type(panel, inputByLabel(panel, "Provider id", modal), "my-proxy");
    clickButton(panel, "Add endpoint");

    await panel.waitFor(() => panel.doc.querySelector(".ft-dot"));
    // The tab chip shows the dirty dot too.
    expect(panel.doc.querySelector(".oc-chip .ft-dot")).toBeTruthy();
  });

  test("saving writes the file with comments intact", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);

    clickButton(panel, "+ Add provider");
    const modal = await panel.waitFor(() => panel.doc.querySelector(".ocf-modal"));
    if (!modal) throw new Error("modal did not open");
    type(panel, inputByLabel(panel, "Provider id", modal), "my-proxy");
    type(panel, inputByLabel(panel, "Base URL", modal), "https://proxy.internal/v1");
    clickButton(panel, "Add endpoint");
    await panel.waitFor(() => panel.doc.querySelector(".ft-dot"), 8000);

    clickButton(panel, "Save");
    await panel.waitFor(() => panel.writes.length > 0, 8000);
    const written = panel.writes[0]!.content;
    expect(written).toContain("// opencode config — keep this comment");
    expect(written).toContain("my-proxy");
    expect(written).toContain("https://proxy.internal/v1");
    // Pre-existing keys survive.
    expect(written).toContain("anthropic/claude-sonnet-4-5");
  }, 20000);

  test("editing an existing provider writes under that provider, not the map", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);

    await expandCard(panel, "ollama");
    type(panel, inputByLabel(panel, "Base URL"), "http://127.0.0.1:11434/v1");
    const written = await saveAndRead(panel);

    const provider = (written.provider as Record<string, Record<string, Record<string, unknown>>>)!;
    expect(provider.ollama!.options!.baseURL).toBe("http://127.0.0.1:11434/v1");
    // The regression this locks: options must not land on the map itself.
    expect(provider.options).toBeUndefined();
    expect(Object.keys(provider)).toEqual(["ollama"]);
  }, 20000);

  test("switching a model modality round-trips through the file", async () => {
    const panel = await openConfig(
      `{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "models": { "llama3": { "modalities": { "input": ["text"] } } }
    }
  }
}`,
    );
    openPanel.push(panel);
    await clickForm(panel);

    await expandCard(panel, "ollama");
    await expandCard(panel, "llama3");
    const imageChip = [...panel.doc.querySelectorAll<HTMLElement>(".ocf-chip")].find(
      (node) => node.textContent?.trim() === "image" && node.dataset.active !== "true",
    );
    expect(imageChip).toBeTruthy();
    imageChip!.dispatchEvent(new panel.win.MouseEvent("click", { bubbles: true }));

    const written = await saveAndRead(panel);
    const model = (
      written.provider as Record<
        string,
        Record<string, Record<string, Record<string, Record<string, string[]>>>>
      >
    )!.ollama!.models!.llama3!;
    expect(model.modalities!.input).toEqual(["text", "image"]);
  }, 20000);

  test("an API key can be stored as an env reference", async () => {
    const panel = await openConfig(
      `{
  "$schema": "https://opencode.ai/config.json",
  "provider": { "openai": { "npm": "@ai-sdk/openai" } }
}`,
    );
    openPanel.push(panel);
    await clickForm(panel);

    await expandCard(panel, "openai");
    const envButton = await panel.waitFor(() =>
      [...panel.doc.querySelectorAll<HTMLElement>("button")].find((node) =>
        node.textContent?.trim().startsWith("use $OPENAI_API_KEY"),
      ),
    );
    envButton.dispatchEvent(new panel.win.MouseEvent("click", { bubbles: true }));

    const written = await saveAndRead(panel);
    const provider = (written.provider as Record<string, Record<string, Record<string, unknown>>>)!;
    expect(provider.openai!.options!.apiKey).toBe("{env:OPENAI_API_KEY}");
  }, 20000);
});

describe("text <-> form round trip", () => {
  test("form edits appear in the text editor and survive switching back", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);

    // Form -> text.
    clickButton(panel, "+ Add provider");
    const modal = await panel.waitFor(() => panel.doc.querySelector(".ocf-modal"));
    if (!modal) throw new Error("modal did not open");
    type(panel, inputByLabel(panel, "Provider id", modal), "round-trip");
    clickButton(panel, "Add endpoint");
    await panel.waitFor(() => panel.doc.querySelector(".ft-dot"), 8000);

    clickButton(panel, "Text");
    await panel.waitFor(() => !panel.doc.querySelector(".ocf-scroll"), 8000);
    const editorText = panel.doc.querySelector(".cm-content")?.textContent ?? "";
    expect(editorText).toContain("round-trip");
    // The comment survived the form's surgical edit.
    expect(editorText).toContain("// opencode config — keep this comment");

    // Text -> form: the form is rebuilt from the same buffer, not from disk.
    clickButton(panel, "Form");
    await panel.waitFor(() => panel.doc.querySelector(".ocf-scroll"), 8000);
    expect(fieldLabels(panel)).toContain("round-trip");
    expect(panel.errors).toEqual([]);
  }, 20000);

  test("an external file change reaches the form on reload", async () => {
    const files = {
      "": { kind: "directory" as const, entries: ["opencode.json"] },
      "opencode.json": {
        kind: "file" as const,
        content: '{"$schema":"https://opencode.ai/config.json","username":"before"}',
      },
    };
    const panel = await bootPanel({
      directory: "/home/light/.config/openchamber/chats/session-abc123",
      files,
    });
    openPanel.push(panel);
    const row = await panel.waitFor(() =>
      panel.doc.querySelector<HTMLElement>('.ft-row[data-path="opencode.json"]'),
    );
    row.dispatchEvent(new panel.win.MouseEvent("click", { bubbles: true }));
    await panel.waitFor(() => panel.doc.querySelector(".cm-content"));
    clickButton(panel, "Form");
    await panel.waitFor(() => panel.doc.querySelector(".ocf-scroll"));

    // Make the tab dirty, then change the file underneath the panel.
    type(panel, inputByLabel(panel, "Username"), "typed-in-form");
    await panel.waitFor(() => panel.doc.querySelector(".ft-dot"), 8000);
    files["opencode.json"] = {
      kind: "file",
      content: '{"$schema":"https://opencode.ai/config.json","username":"after"}',
    };

    // Reload is the discard button, so it only acts on a dirty tab.
    clickButton(panel, "Text");
    await panel.waitFor(() => !panel.doc.querySelector(".ocf-scroll"), 8000);
    clickButton(panel, "Reload");
    await panel.waitFor(
      () => (panel.doc.querySelector(".cm-content")?.textContent ?? "").includes("after"),
      8000,
    );

    clickButton(panel, "Form");
    await panel.waitFor(() => panel.doc.querySelector(".ocf-scroll"), 8000);
    const values = inputValues(panel);
    expect(values).toContain("after");
    expect(values).not.toContain("typed-in-form");
  }, 20000);
});

describe("catalog", () => {
  test("loads the vendored catalog and searches it", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);

    // Opening the add-provider modal requests the catalog.
    clickButton(panel, "+ Add provider");
    const modal = await panel.waitFor(() => panel.doc.querySelector(".ocf-modal"));
    const modeButtons = [...modal.querySelectorAll<HTMLElement>("button")];
    modeButtons.find((node) => node.textContent?.trim() === "Known provider")?.dispatchEvent(
      new panel.win.MouseEvent("click", { bubbles: true }),
    );
    await panel.waitFor(() => (panel.doc.body.textContent ?? "").includes("models"));
    expect(panel.fetches.some((url) => url.includes("data/models.json"))).toBe(true);
  });

  test("model refs offer a browser", async () => {
    const panel = await openConfig();
    openPanel.push(panel);
    await clickForm(panel);
    await panel.waitFor(() => (panel.doc.body.textContent ?? "").includes("Browse…"));
    expect(panel.doc.body.textContent).toContain("Browse…");
  });
});


