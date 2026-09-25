/**
 * Layout primitives for the form view.
 *
 * Controls come from `@openchamber/sdk/ui` so the form inherits host styling;
 * this module only supplies the card/grid/row scaffolding around them.
 */
import { mountButton, type ButtonSize, type ButtonVariant } from "@openchamber/sdk/ui";

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let cssInjected = false;

export const injectFormCss = (): void => {
  if (cssInjected || document.getElementById("oc-form-css")) {
    cssInjected = true;
    return;
  }
  cssInjected = true;
  const style = document.createElement("style");
  style.id = "oc-form-css";
  style.textContent = `
.ocf-scroll { flex:1 1 auto; min-height:0; overflow:auto; padding:10px 12px 24px; }
.ocf-bar { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 0 10px; background:linear-gradient(var(--oc-bg,#111) 78%, transparent); }
.ocf-bar-note { font-size:12px; opacity:0.8; display:flex; align-items:center; gap:6px; }
.ocf-card { border:1px solid var(--oc-border,#333); border-radius:10px; background:var(--oc-panel,#1a1a1a); margin-bottom:10px; overflow:hidden; }
.ocf-card-head { display:flex; align-items:center; gap:8px; padding:8px 10px; cursor:pointer; user-select:none; }
.ocf-card-head:hover { background:var(--oc-hover,rgba(255,255,255,0.05)); }
.ocf-card-twisty { flex:0 0 auto; font-size:11px; }
.ocf-card-title { font-size:13px; font-weight:600; flex:0 0 auto; }
.ocf-card-sub { font-size:11px; opacity:0.65; flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ocf-card-body { padding:4px 10px 12px; border-top:1px solid var(--oc-border,#333); display:flex; flex-direction:column; gap:10px; }
.ocf-card[data-collapsed="true"] .ocf-card-body { display:none; }
.ocf-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:10px 12px; align-items:start; }
.ocf-span { grid-column:1 / -1; }
.ocf-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ocf-grow { flex:1 1 180px; min-width:0; }
.ocf-hint { font-size:11px; opacity:0.62; line-height:1.45; }
.ocf-note { font-size:12px; opacity:0.8; line-height:1.5; }
.ocf-mono { font-family:var(--oc-mono, ui-monospace, monospace); font-size:12px; }
.ocf-actions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.ocf-segment { display:inline-flex; align-items:center; gap:4px; padding:2px; border:1px solid var(--oc-border,#333); border-radius:8px; background:var(--oc-bg,#111); }
.ocf-chip { display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:999px; border:1px solid var(--oc-border,#333); font-size:11px; font-family:var(--oc-mono, monospace); }
.ocf-chip-dot { width:6px; height:6px; border-radius:50%; background:var(--oc-primary,#6af); }
.ocf-x { border:none; background:transparent; color:inherit; cursor:pointer; opacity:0.6; padding:0 1px; line-height:1; font-size:12px; }
.ocf-x:hover { opacity:1; }
.ocf-list { display:flex; flex-direction:column; gap:6px; }
.ocf-item { border:1px solid var(--oc-border,#333); border-radius:8px; padding:8px 10px; background:var(--oc-bg,#111); display:flex; flex-direction:column; gap:8px; }
.ocf-item-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ocf-item-name { font-family:var(--oc-mono, monospace); font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ocf-subcard { border:1px dashed var(--oc-border,#333); border-radius:8px; padding:8px 10px; display:flex; flex-direction:column; gap:8px; }
.ocf-inline-add { border:1px dashed var(--oc-border,#444); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px; background:transparent; }
.ocf-results { max-height:220px; overflow:auto; border:1px solid var(--oc-border,#333); border-radius:8px; background:var(--oc-bg,#111); }
.ocf-result { display:flex; align-items:center; gap:8px; width:100%; text-align:left; border:none; background:transparent; color:inherit; cursor:pointer; padding:6px 8px; font:inherit; border-bottom:1px solid var(--oc-border,#2a2a2a); }
.ocf-result:last-child { border-bottom:none; }
.ocf-result:hover { background:var(--oc-hover,rgba(255,255,255,0.07)); }
.ocf-result-main { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; }
.ocf-result-title { font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ocf-result-hint { font-size:10px; opacity:0.6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ocf-kv { display:grid; grid-template-columns:minmax(90px, 0.8fr) minmax(120px, 1.4fr) auto; gap:6px; align-items:center; }
.ocf-modal-backdrop { position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,0.55); }
.ocf-modal { width:min(560px, 100%); max-height:min(80vh, 720px); overflow:auto; border:1px solid var(--oc-border,#333); border-radius:12px; background:var(--oc-panel,#1a1a1a); padding:14px; display:flex; flex-direction:column; gap:10px; box-shadow:0 18px 50px rgba(0,0,0,0.45); }
.ocf-modal-title { font-size:14px; font-weight:600; }
.ocf-danger { color:var(--oc-error,#f66); }
`;
  document.head.appendChild(style);
};

export const hint = (text: string | undefined): HTMLElement | null => {
  if (!text) return null;
  return el("div", "ocf-hint", text);
};

export const span = (className: string, text?: string): HTMLElement => el("span", className, text);

/** `mountButton` returns a handle, not a node; this wraps it in a real element. */
export const button = (
  label: string,
  options: {
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    title?: string;
    onClick: () => void;
  },
): HTMLElement => {
  const host = el("span");
  mountButton(host, {
    label,
    size: options.size ?? "xs",
    variant: options.variant ?? "ghost",
    disabled: options.disabled,
    onClick: options.onClick,
  });
  if (options.title) host.title = options.title;
  return host;
};

export const row = (...children: Array<HTMLElement | null>): HTMLElement => {
  const node = el("div", "ocf-row");
  for (const child of children) if (child) node.appendChild(child);
  return node;
};

export const grid = (...children: Array<HTMLElement | null>): HTMLElement => {
  const node = el("div", "ocf-grid");
  for (const child of children) if (child) node.appendChild(child);
  return node;
};

export const fullWidth = (child: HTMLElement): HTMLElement => {
  child.classList.add("ocf-span");
  return child;
};

export type CardOptions = {
  title: string;
  subtitle?: string;
  collapsed?: boolean;
  headExtra?: HTMLElement | null;
  actions?: HTMLElement | null;
  onToggle?: (next: boolean) => void;
};

export type Card = {
  root: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
  setSubtitle: (text: string) => void;
  setCollapsed: (collapsed: boolean) => void;
};

export const card = (options: CardOptions): Card => {
  const root = el("div", "ocf-card");
  const head = el("div", "ocf-card-head");
  const twisty = span("ocf-card-twisty", options.collapsed ? "▸" : "▾");
  twisty.style.opacity = "0.6";
  const title = span("ocf-card-title", options.title);
  const subtitle = span("ocf-card-sub", options.subtitle ?? "");
  const actions = el("div", "ocf-actions");
  head.append(twisty, title, subtitle);
  if (options.headExtra) head.appendChild(options.headExtra);
  head.appendChild(actions);

  const body = el("div", "ocf-card-body");
  root.append(head, body);
  root.dataset.collapsed = options.collapsed ? "true" : "false";

  const setCollapsed = (collapsed: boolean) => {
    root.dataset.collapsed = collapsed ? "true" : "false";
    twisty.textContent = collapsed ? "▸" : "▾";
  };

  head.addEventListener("click", (event) => {
    // Let buttons inside the header do their own thing.
    if ((event.target as HTMLElement).closest("button")) return;
    const next = root.dataset.collapsed !== "true";
    setCollapsed(next);
    options.onToggle?.(!next);
  });

  return {
    root,
    body,
    actions,
    setSubtitle: (text: string) => {
      subtitle.textContent = text;
    },
    setCollapsed,
  };
};

/** Modal overlay. Returns a closer; Esc and backdrop clicks both dismiss. */
export const openModal = (options: {
  title: string;
  build: (body: HTMLElement, close: () => void) => void;
}): (() => void) => {
  const backdrop = el("div", "ocf-modal-backdrop");
  const modal = el("div", "ocf-modal");
  const body = el("div", "ocf-list");
  modal.append(span("ocf-modal-title", options.title), body);
  backdrop.appendChild(modal);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  options.build(body, close);
  document.body.appendChild(backdrop);
  // Focus the first control so keyboard users land inside the dialog.
  const first = modal.querySelector<HTMLElement>("input, textarea, button");
  first?.focus();
  return close;
};

/** Two-step destructive button: first click arms, second click fires. */
export const confirmButton = (label: string, onConfirm: () => void): HTMLElement => {
  const host = el("span");
  let armed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => {
    armed = false;
    if (timer) clearTimeout(timer);
    timer = null;
    handle.update({ label, variant: "ghost" });
  };
  const handle = mountButton(host, {
    label,
    size: "xs",
    variant: "ghost",
    onClick: () => {
      if (!armed) {
        armed = true;
        handle.update({ label: `Confirm ${label.toLowerCase()}`, variant: "destructive" });
        timer = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      onConfirm();
    },
  });
  return host;
};
