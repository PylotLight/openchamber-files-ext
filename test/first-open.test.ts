/**
 * Regression test: first file open must render editor chrome (tab strip,
 * title, CodeMirror host) — including when host.storage answers slowly.
 *
 * Run: bun test
 */
import { describe, test, expect } from "bun:test";
import { bootPanel, type FileNode } from "./harness";

const FILES: Record<string, FileNode> = {
  "": { kind: "directory", entries: ["a.txt", "sub"] },
  sub: { kind: "directory", entries: ["b.md"] },
  "a.txt": { kind: "file", content: "hello world\nsecond line\n" },
  "sub/b.md": { kind: "file", content: "# Title\n" },
};
// Session-like dir => home root ("~").
const DIRECTORY = "/Data/home/light/.config/openchamber/chats/2026-09-22/session-1234";

const clickRow = (doc: Document, path: string) => {
  const row = doc.querySelector(`.ft-row[data-path="${path}"]`);
  expect(row).not.toBeNull();
  row!.dispatchEvent(new doc.defaultView!.MouseEvent("click", { bubbles: true }));
};

const expectEditorOpen = (doc: Document, name: string) => {
  const editor = [...doc.querySelectorAll("div")].find(
    (d) => d.className === "oc-files-editor",
  );
  expect(editor).toBeDefined();
  expect(editor!.style.display).toBe("flex");
  // Stacked (default) split: tree gets a fixed basis, editor fills the rest.
  const tree = doc.querySelector(".ft-row")?.parentElement as HTMLElement | null;
  expect(tree).toBeDefined();
  expect(tree!.style.flex).toMatch(/^0 0 \d+px$/);
  expect(tree!.style.height).toMatch(/^\d+px$/);
  const splitter = [...doc.querySelectorAll("div")].find(
    (d) => d.style.cursor === "row-resize" || d.style.cursor === "col-resize",
  );
  expect(splitter).toBeDefined();
  expect(splitter!.style.display).toBe("block");
  const chip = doc.querySelector(".oc-tabstrip .oc-chip");
  expect(chip).not.toBeNull();
  expect(chip!.textContent).toContain(name);
  expect(doc.querySelector(".oc-head")).not.toBeNull();
  expect(doc.querySelector(".oc-cm-host")).not.toBeNull();
  expect(doc.querySelector(".cm-editor")).not.toBeNull();
  expect(doc.querySelector(".cm-content")).not.toBeNull();
};

describe("first file open", () => {
  test("renders editor chrome with fast storage", async () => {
    const panel = await bootPanel({ files: FILES, directory: DIRECTORY });
    await panel.waitFor(() => panel.doc.querySelector('.ft-row[data-path="a.txt"]'));
    clickRow(panel.doc, "a.txt");
    await panel.waitFor(() => panel.doc.querySelector(".oc-tabstrip .oc-chip"), 8000);
    await panel.sleep(200);
    expectEditorOpen(panel.doc, "a.txt");
    expect(panel.errors).toEqual([]);
    await panel.win.happyDOM.close();
  });

  test("renders editor chrome when open races slow storage", async () => {
    let releaseStorage!: () => void;
    const storageHeld = new Promise<void>((r) => (releaseStorage = r));
    const panel = await bootPanel({
      files: FILES,
      directory: DIRECTORY,
      onStorageGet: async () => {
        await storageHeld;
        return undefined;
      },
    });
    await panel.waitFor(() => panel.doc.querySelector('.ft-row[data-path="a.txt"]'));
    clickRow(panel.doc, "a.txt");
    // Open the file BEFORE storage answers, then let storage resolve.
    await panel.sleep(200);
    releaseStorage();
    await panel.waitFor(() => panel.doc.querySelector(".oc-tabstrip .oc-chip"), 8000);
    await panel.sleep(200);
    expectEditorOpen(panel.doc, "a.txt");
    expect(panel.errors).toEqual([]);
    await panel.win.happyDOM.close();
  });
});
