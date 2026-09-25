/**
 * Thin layer over the vendored opencode config schema.
 *
 * The schema drives the boring parts of the form (types, enums, defaults,
 * descriptions, required-ness). The interesting parts — providers, models,
 * MCP servers, permissions — are hand-written editors registered as overrides.
 */
import rawSchema from "../data/opencode-schema.json";
import { type Json } from "./core";

export type Schema = {
  $ref?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  deprecated?: boolean;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  propertyNames?: Schema;
  patternProperties?: Record<string, Schema>;
  items?: Schema;
  prefixItems?: Schema[];
  minItems?: number;
  maxItems?: number;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  [key: string]: unknown;
};

export type JsonSchema = Schema;

export const ROOT_SCHEMA = rawSchema as Schema;

const MAX_REF_DEPTH = 32;

/** Follow local `#/$defs/...` references. Remote refs are stripped at sync time. */
export const deref = (schema: Schema | undefined): Schema | undefined => {
  let node = schema;
  for (let depth = 0; node?.$ref && depth < MAX_REF_DEPTH; depth += 1) {
    const ref = node.$ref;
    if (!ref.startsWith("#")) return { ...node, $ref: undefined };
    const pointer = ref.slice(1).split("/").filter(Boolean);
    let next: unknown = ROOT_SCHEMA;
    for (const rawSegment of pointer) {
      const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!isRecord(next)) return node;
      next = next[segment];
    }
    if (!isRecord(next)) return node;
    // Sibling keywords next to a `$ref` still apply in 2020-12.
    node = { ...(next as Schema), ...omit(node, ["$ref"]) };
  }
  return node;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const omit = (source: Schema, keys: string[]): Schema => {
  const out: Schema = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) (out as Record<string, unknown>)[key] = value;
  }
  return out;
};

export const schemaType = (schema: Schema | undefined): string | undefined => {
  const node = deref(schema);
  if (!node) return undefined;
  if (typeof node.type === "string") return node.type;
  if (Array.isArray(node.type)) return node.type.find((t) => t !== "null") ?? "null";
  if (node.const !== undefined) return typeof node.const;
  if (node.enum?.length) {
    const types = new Set(node.enum.map((value) => (value === null ? "null" : typeof value)));
    if (types.size === 1) return [...types][0];
  }
  if (node.properties || node.additionalProperties) return "object";
  if (node.items || node.prefixItems) return "array";
  return undefined;
};

export const properties = (schema: Schema | undefined): Record<string, Schema> =>
  deref(schema)?.properties ?? {};

export const isRequired = (schema: Schema | undefined, key: string): boolean =>
  Boolean(deref(schema)?.required?.includes(key));

/** Schema for the values of a free-form map (`provider.*`, `mcp.*`). */
export const mapValueSchema = (schema: Schema | undefined): Schema | undefined => {
  const node = deref(schema);
  if (!node) return undefined;
  if (isRecord(node.additionalProperties)) return deref(node.additionalProperties as Schema);
  const pattern = node.patternProperties && Object.values(node.patternProperties)[0];
  return deref(pattern as Schema | undefined);
};

export const isMap = (schema: Schema | undefined): boolean => {
  const node = deref(schema);
  if (!node) return false;
  if (isRecord(node.additionalProperties)) return true;
  return Boolean(node.patternProperties && Object.keys(node.patternProperties).length > 0);
};

export type Variant = {
  schema: Schema;
  label: string;
  /** Distinguishes `true`/`false`/const/enum-single-value branches. */
  tag: string;
  matches: (value: unknown) => boolean;
};

const tagOf = (schema: Schema, index: number): string => {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum?.length === 1) return JSON.stringify(schema.enum[0]);
  if (schema.type === "boolean") return "boolean";
  return `${schemaType(schema) ?? "any"}#${index}`;
};

const labelOf = (schema: Schema, tag: string, index: number): string => {
  if (schema.title) return schema.title;
  if (schema.const !== undefined) return String(schema.const);
  if (schema.enum?.length === 1) return String(schema.enum[0]);
  const type = schemaType(schema);
  if (type === "boolean") return "Enabled";
  if (type) return type[0]!.toUpperCase() + type.slice(1);
  return `Option ${index + 1} (${tag})`;
};

const matchesType = (schema: Schema, value: unknown): boolean => {
  const type = schemaType(schema);
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
};

/** `anyOf`/`oneOf` branches, labelled and tagged so the UI can switch between them. */
export const variants = (schema: Schema | undefined): Variant[] | null => {
  const node = deref(schema);
  const branches = node?.anyOf ?? node?.oneOf;
  if (!branches?.length) return null;
  return branches.map((branch, index) => {
    const resolved = deref(branch) ?? {};
    const tag = tagOf(resolved, index);
    return {
      schema: resolved,
      label: labelOf(resolved, tag, index),
      tag,
      matches: (value: unknown) => {
        if (resolved.const !== undefined) return value === resolved.const;
        if (resolved.enum?.length === 1) return value === resolved.enum[0];
        return matchesType(resolved, value);
      },
    };
  });
};

/** Index of the branch matching the current value, else the first plausible one. */
export const activeVariant = (list: Variant[], value: unknown, schema?: Schema): number => {
  const exact = list.findIndex((variant) => variant.matches(value));
  if (exact !== -1) return exact;
  if (value === undefined && schema) {
    const withDefault = list.findIndex((variant) => variant.schema.default !== undefined);
    if (withDefault !== -1) return withDefault;
  }
  return 0;
};

export const has = (schema: Schema | undefined): boolean => deref(schema) !== undefined;

/** Label for a property key: explicit title, else a humanized key. */export const labelFor = (key: string, schema?: Schema): string => {
  if (schema?.title) return schema.title;
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export const isDeprecated = (schema: Schema | undefined): boolean => deref(schema)?.deprecated === true;

/**
 * A schema-valid empty value, used when the user picks a shape for a key that
 * isn't in the file yet ("+ Add model" seeds an object, not `null`).
 */
/**
 * Allowed values for a scalar enum *or* an array whose items are an enum
 * (`modalities.input` is the second shape, and the one users care about).
 */
export const enumValues = (schema: Schema | undefined): unknown[] => {
  const node = deref(schema);
  if (!node) return [];
  if (node.const !== undefined) return [node.const];
  if (node.enum?.length) return node.enum;
  const item = deref(node.items);
  if (item?.const !== undefined) return [item.const];
  if (item?.enum?.length) return item.enum;
  // A union of single-value branches behaves like an enum.
  const branches = variants(node.items);
  if (branches?.length) {
    const values = branches
      .map((branch) =>
        branch.schema.const !== undefined
          ? branch.schema.const
          : branch.schema.enum?.length === 1
            ? branch.schema.enum[0]
            : undefined,
      )
      .filter((value) => value !== undefined);
    if (values.length === branches.length) return values;
  }
  return [];
};

export const defaultForSchema = (schema: Schema | undefined): Json => {
  const node = deref(schema);
  if (!node) return null;
  if (node.const !== undefined) return node.const as Json;
  if (node.enum?.length) return node.enum[0] as Json;
  if (node.default !== undefined) return node.default as Json;

  const branches = variants(node);
  if (branches?.length) {
    // Prefer a branch that declares a default; otherwise the first object-ish one.
    const withDefault = branches.find((variant) => variant.schema.default !== undefined);
    if (withDefault) return defaultForSchema(withDefault.schema);
    const objectish = branches.find((variant) => ["object", "array"].includes(schemaType(variant.schema) ?? ""));
    return defaultForSchema((objectish ?? branches[0])!.schema);
  }

  switch (schemaType(node)) {
    case "object":
      return {};
    case "array":
      return [];
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
    default: {
      if (node.properties || isRecord(node.additionalProperties)) return {};
      if (node.items || node.prefixItems) return [];
      return null;
    }
  }
};

/** A non-empty value for a newly added array item (seeded from the schema). */
export const seedForSchema = (schema: Schema | undefined): Json => {
  const seed = defaultForSchema(schema);
  if (isRecord(seed) && Object.keys(seed).length === 0) {
    // Give required children a value so the new item isn't born invalid.
    const node = deref(schema);
    for (const key of node?.required ?? []) {
      (seed as Record<string, Json>)[key] = defaultForSchema(node?.properties?.[key]);
    }
  }
  return seed;
};
