/**
 * Document model for the form view.
 *
 * The form never re-serializes the file. Every edit is a surgical
 * `jsonc-parser` modification of the *text*, so comments, key order, and
 * formatting survive, and any key the form does not understand is preserved
 * byte-for-byte because it is never touched.
 */
import {
  applyEdits,
  modify,
  parse,
  ParseErrorCode,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Path = Array<string | number>;

export const isObject = (value: unknown): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const pathKey = (path: Path): string => JSON.stringify(path);

export type Parsed = {
  data: Json;
  error: string | null;
  errorOffset: number;
};

/**
 * jsonc-parser reports an error *code* and an offset, and leaves `errorText`
 * empty in several common cases. Turn that into something worth showing.
 */
const PARSE_MESSAGES: Record<number, string> = {
  [ParseErrorCode.InvalidSymbol]: "Unexpected character",
  [ParseErrorCode.InvalidNumberFormat]: "Malformed number",
  [ParseErrorCode.PropertyNameExpected]: "Expected a property name",
  [ParseErrorCode.ValueExpected]: "Expected a value",
  [ParseErrorCode.ColonExpected]: "Expected “:” after the property name",
  [ParseErrorCode.CommaExpected]: "Expected “,” or “}”",
  [ParseErrorCode.CloseBraceExpected]: "Expected “}”",
  [ParseErrorCode.CloseBracketExpected]: "Expected “]”",
  [ParseErrorCode.EndOfFileExpected]: "Unexpected end of file",
  [ParseErrorCode.InvalidCommentToken]: "Expected “//” or “/*” to start a comment",
  [ParseErrorCode.UnexpectedEndOfComment]: "Unterminated block comment",
  [ParseErrorCode.UnexpectedEndOfString]: "Unterminated string",
  [ParseErrorCode.UnexpectedEndOfNumber]: "Unterminated number",
  [ParseErrorCode.InvalidUnicode]: "Invalid unicode escape",
  [ParseErrorCode.InvalidEscapeCharacter]: "Invalid escape character",
  [ParseErrorCode.InvalidCharacter]: "Invalid character",
};

const lineColumn = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
};

export const describeParseError = (error: ParseError, text: string): string => {
  const base = PARSE_MESSAGES[error.error] ?? error.errorText ?? "Invalid JSON";
  const { line, column } = lineColumn(text, error.offset);
  const tail = error.length > 0 ? text.slice(error.offset, error.offset + Math.min(error.length, 12)) : "";
  const near = tail.trim() ? ` near “${tail.trim()}”` : "";
  return `${base}${near} (line ${line}, column ${column})`;
};

export const parseDoc = (text: string): Parsed => {
  if (!text.trim()) return { data: {}, error: null, errorOffset: -1 };
  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
    allowEmptyContent: true,
  });
  const first = errors[0];
  if (first) {
    return {
      data: (value ?? {}) as Json,
      error: describeParseError(first, text),
      errorOffset: first.offset,
    };
  }
  return { data: (value ?? {}) as Json, error: null, errorOffset: -1 };
};

/** Match the file's existing indentation so edits look native. */
export const detectFormatting = (text: string): FormattingOptions => {
  let width = 0;
  let tabs = false;
  for (const line of text.split(/\r?\n/)) {
    const match = /^([\t ]+)\S/.exec(line);
    if (!match) continue;
    const indent = match[1]!;
    if (indent.includes("\t")) {
      tabs = true;
      break;
    }
    const size = indent.length;
    if (width === 0 || size < width) width = size;
  }
  return {
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    insertSpaces: !tabs,
    tabSize: tabs ? 1 : Math.min(8, Math.max(2, width || 2)),
  };
};

/** `value === undefined` removes the key. */
export const writeValue = (
  text: string,
  path: Path,
  value: Json | undefined,
  fmt: FormattingOptions,
): string => applyEdits(text, modify(text, path, value, { formattingOptions: fmt }));

export const readValue = (data: Json, path: Path): Json | undefined => {
  let node: Json | undefined = data;
  for (const key of path) {
    if (Array.isArray(node)) {
      if (typeof key !== "number") return undefined;
      node = node[key];
    } else if (isObject(node)) {
      node = node[key];
    } else {
      return undefined;
    }
  }
  return node;
};

/** True when the key exists, even if its value is `false`/`0`/`""`. */
export const hasPath = (data: Json, path: Path): boolean => {
  let node: Json | undefined = data;
  for (const key of path) {
    if (Array.isArray(node)) {
      if (typeof key !== "number" || key >= node.length) return false;
      node = node[key];
    } else if (isObject(node)) {
      if (!Object.hasOwn(node, key)) return false;
      node = node[key];
    } else {
      return false;
    }
  }
  return true;
};

export const asString = (value: Json | undefined, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

/** Best-effort number parse that keeps empty input empty instead of 0. */
export const asNumber = (value: Json | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
