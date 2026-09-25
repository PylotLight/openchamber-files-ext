/**
 * The contract renderers use to read and mutate the document.
 *
 * Edits are path-scoped writes into the file text (see `core.ts`); the view
 * owns the state, the AJV pass, and the DOM lifecycle.
 */
import { type Json, type Path } from "./core";
import { type CatalogState } from "./catalog";

export type ErrorSink = (message: string | undefined) => void;

export type FormContext = {
  /** Current parsed document. */
  data: Json;
  get(path: Path): Json | undefined;
  /** True when the key exists, even if its value is `false`/`0`/`""`. */
  has(path: Path): boolean;
  set(path: Path, value: Json): void;
  remove(path: Path): void;
  errorAt(path: Path): string | undefined;
  /** Register a control's error setter so validation can update it in place. */
  onError(path: Path, sink: ErrorSink): void;
  /** Structural re-render (after add/remove/variant switches). */
  requestRender(): void;
  catalog(): CatalogState;
  ensureCatalog(): void;
};
