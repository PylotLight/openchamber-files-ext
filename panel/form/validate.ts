/**
 * AJV-backed validation of the whole config document.
 *
 * The schema is the same one the CLI uses, so "valid" here means "opencode
 * will accept this file". Errors are indexed by field path so each control can
 * show its own message.
 */
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import { ROOT_SCHEMA } from "./schema";
import { type Json, type Path, pathKey } from "./core";

export type ValidationResult = {
  /** pathKey -> first message. Controls read this to show inline errors. */
  byField: Map<string, string>;
  /** Paths (not fields) with an error, for section-level badges. */
  errorPaths: Set<string>;
  count: number;
  /** False when the schema could not be compiled; the form stays editable. */
  available: boolean;
  compileError?: string;
};

const MAX_MESSAGES = 80;

let compiled: ValidateFunction | null = null;
let compileError: string | null = null;

const validator = (): ValidateFunction | null => {
  if (compiled || compileError) return compiled;
  try {
    const ajv = new Ajv2020({
      allErrors: true,
      // The published schema carries non-standard keywords (`allowComments`,
      // `allowTrailingCommas`) and sibling `$ref`s; strict mode rejects both.
      strict: false,
      allowUnionTypes: true,
      validateFormats: false,
      // Already vetted at sync time; don't pay for re-checking a 39 KB schema.
      validateSchema: false,
    });
    compiled = ajv.compile(ROOT_SCHEMA);
  } catch (error) {
    compileError = error instanceof Error ? error.message : String(error);
    compiled = null;
  }
  return compiled;
};

export const pointerToPath = (pointer: string): Path => {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
};

const describe = (error: ErrorObject): string => {
  const message = error.message ?? "invalid value";
  if (error.keyword === "additionalProperties") {
    const key = (error.params as { additionalProperty?: string }).additionalProperty;
    return key ? `unexpected key “${key}”` : message;
  }
  if (error.keyword === "enum") {
    const allowed = (error.params as { allowedValues?: unknown[] }).allowedValues ?? [];
    const shown = allowed.slice(0, 6).map((value) => JSON.stringify(value));
    return `${message} (${shown.join(", ")}${allowed.length > shown.length ? ", …" : ""})`;
  }
  return message;
};

export const validate = (data: Json): ValidationResult => {
  const validateFn = validator();
  if (!validateFn) {
    return {
      byField: new Map(),
      errorPaths: new Set(),
      count: 0,
      available: false,
      compileError: compileError ?? "validator unavailable",
    };
  }

  const valid = validateFn(data);
  if (valid) return { byField: new Map(), errorPaths: new Set(), count: 0, available: true };

  const errors = validateFn.errors ?? [];
  const candidates = new Map<string, { path: Path; message: string; weak: boolean }>();

  for (const error of errors) {
    const base = pointerToPath(error.instancePath);
    // A missing required key is reported on the parent; move it onto the key.
    const missing = (error.params as { missingProperty?: string }).missingProperty;
    const path = error.keyword === "required" && missing ? [...base, missing] : base;
    const key = pathKey(path);
    if (candidates.has(key)) continue;
    // Union failures are noise when a branch already reported something sharper.
    const weak = error.keyword === "anyOf" || error.keyword === "oneOf";
    candidates.set(key, { path, message: describe(error), weak });
  }

  const byField = new Map<string, string>();
  const errorPaths = new Set<string>();
  for (const [key, entry] of candidates) {
    if (entry.weak && [...candidates.values()].some((other) => !other.weak && pathKey(other.path) === key)) {
      continue;
    }
    if (byField.size >= MAX_MESSAGES) break;
    byField.set(key, entry.message);
    let parent = entry.path.slice(0, -1);
    while (parent.length > 0) {
      errorPaths.add(pathKey(parent));
      parent = parent.slice(0, -1);
    }
  }

  return { byField, errorPaths, count: byField.size, available: true };
};

export const validationAvailable = (): boolean => validator() !== null;
