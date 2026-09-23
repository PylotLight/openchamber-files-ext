import { readFileSync } from "node:fs";
import { parseManifestJson } from "@openchamber/sdk/schemas";

const result = parseManifestJson(readFileSync("package.json", "utf8"));
if (!result.ok) {
  console.error("manifest INVALID:", result);
  process.exit(1);
}
console.log(
  `manifest ok: panel=${result.manifest.contributes?.panel?.id ?? "(none)"} version=${result.version ?? "(none)"}`,
);
