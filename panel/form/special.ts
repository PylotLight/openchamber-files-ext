/**
 * Editors for the two remaining union-heavy parts of the config: MCP servers
 * (local vs remote) and permissions (one global action vs per-tool rules).
 */
import { mountSelect, mountSwitch, mountTextField, type SelectOption } from "@openchamber/sdk/ui";
import { isObject, type Json, type Path } from "./core";
import { type FormContext } from "./context";
import { deref, properties, variants, type Schema } from "./schema";
import { button, card, confirmButton, el, grid, hint, openModal, span } from "./ui";

/** One input per argv entry, because arguments contain spaces. */
const argvEditor = (ctx: FormContext, path: Path, schema: Schema): HTMLElement => {
  const wrap = el("div", "ocf-span");
  wrap.appendChild(span("ocf-hint", "Command"));
  const args = Array.isArray(ctx.get(path)) ? (ctx.get(path) as Json[]).map(String) : [];
  const list = el("div", "ocf-list");

  args.forEach((arg, index) => {
    const rowEl = el("div", "ocf-row");
    const host = el("div", "ocf-grow");
    mountTextField(host, {
      value: arg,
      mono: true,
      placeholder: index === 0 ? "npx" : "argument",
      onChange: (next) => {
        const next_args = [...args];
        next_args[index] = next;
        ctx.set(path, next_args);
      },
    });
    rowEl.append(host);
    rowEl.appendChild(
      button("Remove", {
        onClick: () => {
          const next = args.filter((_, i) => i !== index);
          if (next.length === 0) ctx.remove(path);
          else ctx.set(path, next);
          ctx.requestRender();
        },
      }),
    );
    list.appendChild(rowEl);
  });
  wrap.appendChild(list);
  wrap.appendChild(
    button("+ Add argument", {
      variant: "secondary",
      onClick: () => {
        ctx.set(path, [...args, ""]);
        ctx.requestRender();
      },
    }),
  );
  const help = hint(typeof schema.description === "string" ? schema.description : undefined);
  if (help) wrap.appendChild(help);
  return wrap;
};

const mapEditor = (ctx: FormContext, path: Path, label: string, helper?: string): HTMLElement => {
  const wrap = el("div", "ocf-span");
  wrap.appendChild(span("ocf-hint", label));
  const map = isObject(ctx.get(path)) ? ({ ...(ctx.get(path) as Record<string, Json>) }) : {};
  const list = el("div", "ocf-list");

  const commit = (next: Record<string, Json>) => {
    if (Object.keys(next).length === 0) ctx.remove(path);
    else ctx.set(path, next);
  };

  for (const [key, value] of Object.entries(map)) {
    const rowEl = el("div", "ocf-kv");
    const keyHost = el("div");
    mountTextField(keyHost, {
      value: key,
      mono: true,
      onChange: (next) => {
        if (!next || next === key) return;
        const renamed: Record<string, Json> = {};
        for (const [k, v] of Object.entries(map)) renamed[k === key ? next : k] = v;
        commit(renamed);
        ctx.requestRender();
      },
    });
    const valueHost = el("div");
    mountTextField(valueHost, {
      value: typeof value === "string" ? value : JSON.stringify(value),
      mono: true,
      onChange: (next) => {
        commit({ ...map, [key]: next });
      },
    });
    const actions = el("div", "ocf-actions");
    actions.appendChild(
      button("Remove", {
        onClick: () => {
          const next = { ...map };
          delete next[key];
          commit(next);
          ctx.requestRender();
        },
      }),
    );
    rowEl.append(keyHost, valueHost, actions);
    list.appendChild(rowEl);
  }
  wrap.appendChild(list);

  const addRow = el("div", "ocf-row");
  let draftKey = "";
  let draftValue = "";
  const keyHost = el("div", "ocf-grow");
  mountTextField(keyHost, {
    value: "",
    placeholder: "NAME",
    mono: true,
    onChange: (next) => {
      draftKey = next;
    },
  });
  const valueHost = el("div", "ocf-grow");
  mountTextField(valueHost, {
    value: "",
    placeholder: "value",
    mono: true,
    onChange: (next) => {
      draftValue = next;
    },
  });
  addRow.append(keyHost, valueHost);
  addRow.appendChild(
    button("+ Add", {
      variant: "secondary",
      onClick: () => {
        const name = draftKey.trim();
        if (!name) return;
        commit({ ...map, [name]: draftValue });
        ctx.requestRender();
      },
    }),
  );
  wrap.appendChild(addRow);
  const helpNote = hint(helper);
  if (helpNote) wrap.appendChild(helpNote);
  return wrap;
};

const mcpServerCard = (
  ctx: FormContext,
  path: Path,
  name: string,
  server: Record<string, Json>,
  valueSchema: Schema | undefined,
) => {
  const box = card({
    title: name,
    subtitle: server.type === "remote" ? String(server.url ?? "remote") : String((server.command as Json[])?.join(" ") ?? "local"),
    collapsed: true,
  });
  box.root.classList.add("ocf-item");
  box.actions.appendChild(
    confirmButton("Remove server", () => {
      const container = { ...((ctx.get(path) as Record<string, Json>) ?? {}) };
      delete container[name];
      if (Object.keys(container).length === 0) ctx.remove(path);
      else ctx.set(path, container);
      ctx.requestRender();
    }),
  );

  const resolved = valueSchema ? variants(valueSchema)?.[0]?.schema : undefined;
  const localProps = properties(deref(resolved));
  const kind = server.type === "remote" ? "remote" : "local";

  // Type switcher: converting replaces the shape, which is what the schema demands.
  const switcher = el("div", "ocf-segment");
  for (const [id, label] of [
    ["local", "Local command"],
    ["remote", "Remote URL"],
  ] as const) {
    switcher.appendChild(
      button(label, {
        variant: kind === id ? "secondary" : "ghost",
        onClick: () => {
          if (kind === id) return;
          const next: Record<string, Json> = { ...server, type: id };
          if (id === "remote") {
            delete next.command;
            delete next.cwd;
            delete next.environment;
            next.url = "https://";
          } else {
            delete next.url;
            delete next.headers;
            delete next.oauth;
            next.command = ["npx", "-y", "mcp-server"];
          }
          ctx.set([...path, name], next);
          ctx.requestRender();
        },
      }),
    );
  }
  box.body.appendChild(switcher);

  const fields = grid();
  const enabledHost = el("div");
  mountSwitch(enabledHost, {
    label: "Enabled",
    checked: server.enabled !== false,
    onChange: (checked) => {
      const next = { ...server };
      if (checked) delete next.enabled;
      else next.enabled = false;
      ctx.set([...path, name], next);
    },
  });
  fields.appendChild(enabledHost);

  const timeoutHost = el("div");
  const timeoutValue = typeof server.timeout === "number" ? String(server.timeout) : "";
  mountTextField(timeoutHost, {
    label: "Timeout (ms)",
    value: timeoutValue,
    placeholder: localProps.timeout ? String(localProps.timeout.default ?? 5000) : "",
    mono: true,
    onChange: (next) => {
      const parsed = Number(next);
      const target = { ...server };
      if (next.trim() === "" || !Number.isFinite(parsed)) delete target.timeout;
      else target.timeout = parsed;
      ctx.set([...path, name], target);
    },
  });
  fields.appendChild(timeoutHost);
  box.body.appendChild(fields);

  if (kind === "remote") {
    const urlHost = el("div", "ocf-span");
    mountTextField(urlHost, {
      label: "URL",
      value: typeof server.url === "string" ? server.url : "",
      placeholder: "https://mcp.example.com/mcp",
      mono: true,
      onChange: (next) => {
        ctx.set([...path, name], { ...server, url: next });
      },
    });
    box.body.appendChild(urlHost);
    if (server.headers !== undefined || true) {
      box.body.appendChild(
        mapEditor(ctx, [...path, name, "headers"], "Headers", "Sent with every request."),
      );
    }
    if (isObject(server.oauth)) {
      const oauthSchema = localProps.oauth;
      const oauthBox = el("div", "ocf-subcard");
      oauthBox.appendChild(span("ocf-hint", "OAuth"));
      const oauthFields = grid();
      const oauthProps = properties(deref(oauthSchema));
      for (const [key, propSchema] of Object.entries(oauthProps)) {
        const host = el("div");
        const current = (server.oauth as Record<string, Json>)[key];
        if (propSchema.type === "boolean") {
          mountSwitch(host, {
            label: key,
            checked: current === true,
            onChange: (checked) => {
              const oauth = { ...(server.oauth as Record<string, Json>) };
              if (checked) oauth[key] = true;
              else delete oauth[key];
              ctx.set([...path, name], { ...server, oauth });
            },
          });
        } else {
          mountTextField(host, {
            label: key,
            value: typeof current === "string" ? current : typeof current === "number" ? String(current) : "",
            mono: true,
            password: /secret/i.test(key),
            onChange: (next) => {
              const oauth = { ...(server.oauth as Record<string, Json>) };
              if (next.trim() === "") delete oauth[key];
              else oauth[key] = /port/i.test(key) ? Number(next) || next : next;
              ctx.set([...path, name], { ...server, oauth });
            },
          });
        }
        oauthFields.appendChild(host);
      }
      oauthBox.appendChild(oauthFields);
      box.body.appendChild(oauthBox);
    }
  } else {
    box.body.appendChild(argvEditor(ctx, [...path, name, "command"], localProps.command ?? {}));
    const cwdHost = el("div");
    mountTextField(cwdHost, {
      label: "Working directory",
      value: typeof server.cwd === "string" ? server.cwd : "",
      placeholder: "relative to the workspace",
      mono: true,
      helper: "Relative paths resolve from the project directory.",
      onChange: (next) => {
        const target = { ...server };
        if (next.trim() === "") delete target.cwd;
        else target.cwd = next;
        ctx.set([...path, name], target);
      },
    });
    box.body.appendChild(cwdHost);
    box.body.appendChild(
      mapEditor(ctx, [...path, name, "environment"], "Environment", "Set when the server starts."),
    );
  }

  return box.root;
};

export const mcpSection = (ctx: FormContext, path: Path, schema: Schema): HTMLElement => {
  const value = ctx.get(path);
  const servers = isObject(value) ? (value as Record<string, Json>) : {};
  const valueSchema = (() => {
    const outer = variants(deref(schema));
    if (!outer) return undefined;
    const first = outer[0];
    if (!first) return undefined;
    const inner = variants(first.schema);
    return (inner?.[0]?.schema ?? first.schema) as Schema;
  })();

  const box = card({
    title: "MCP servers",
    subtitle:
      Object.keys(servers).length === 0
        ? "none configured"
        : `${Object.keys(servers).length} configured`,
  });
  box.actions.appendChild(
    button("+ Add server", {
      variant: "secondary",
      onClick: () =>
        openModal({
          title: "Add MCP server",
          build: (modalBody, close) => {
            let kind: "local" | "remote" = "local";
            const panel = el("div", "ocf-list");
            const paint = () => {
              panel.replaceChildren();
              const switcher = el("div", "ocf-segment");
              for (const [id, label] of [
                ["local", "Local command"],
                ["remote", "Remote URL"],
              ] as const) {
                switcher.appendChild(
                  button(label, {
                    variant: kind === id ? "secondary" : "ghost",
                    onClick: () => {
                      kind = id;
                      paint();
                    },
                  }),
                );
              }
              panel.appendChild(switcher);

              let serverName = "";
              const nameHost = el("div");
              mountTextField(nameHost, {
                label: "Name",
                value: "",
                placeholder: "my-server",
                mono: true,
                onChange: (next) => {
                  serverName = next;
                },
              });
              panel.appendChild(nameHost);

              if (kind === "local") {
                panel.appendChild(hint("Runs a command on your machine. opencode will ask before the first launch."));
              } else {
                let url = "";
                const urlHost = el("div");
                mountTextField(urlHost, {
                  label: "URL",
                  value: "",
                  placeholder: "https://mcp.example.com/mcp",
                  mono: true,
                  onChange: (next) => {
                    url = next;
                  },
                });
                panel.appendChild(urlHost);
                panel.appendChild(
                  button("Add server", {
                    variant: "secondary",
                    onClick: () => {
                      const name = serverName.trim();
                      if (!name) return;
                      const container = { ...((ctx.get(path) as Record<string, Json>) ?? {}) };
                      container[name] = { type: "remote", url: url.trim() || "https://" };
                      ctx.set(path, container);
                      close();
                      ctx.requestRender();
                    },
                  }),
                );
                return;
              }

              let command = "npx";
              let firstArg = "-y";
              let packageName = "";
              const cmdHost = el("div");
              mountTextField(cmdHost, {
                label: "Command",
                value: command,
                mono: true,
                onChange: (next) => {
                  command = next;
                },
              });
              const argHost = el("div");
              mountTextField(argHost, {
                label: "First argument",
                value: firstArg,
                mono: true,
                onChange: (next) => {
                  firstArg = next;
                },
              });
              const pkgHost = el("div");
              mountTextField(pkgHost, {
                label: "Package",
                value: "",
                placeholder: "@modelcontextprotocol/server-filesystem",
                mono: true,
                onChange: (next) => {
                  packageName = next;
                },
              });
              panel.append(cmdHost, argHost, pkgHost);
              panel.appendChild(
                button("Add server", {
                  variant: "secondary",
                  onClick: () => {
                    const name = serverName.trim();
                    if (!name || !command.trim()) return;
                    const args = [command.trim(), firstArg.trim(), packageName.trim()].filter(Boolean);
                    const container = { ...((ctx.get(path) as Record<string, Json>) ?? {}) };
                    container[name] = { type: "local", command: args };
                    ctx.set(path, container);
                    close();
                    ctx.requestRender();
                  },
                }),
              );
            };
            paint();
            modalBody.appendChild(panel);
          },
        }),
    }),
  );

  const errorNode = el("div", "ocf-hint ocf-danger");
  ctx.onError(path, (message) => {
    errorNode.textContent = message ?? "";
  });
  errorNode.textContent = ctx.errorAt(path) ?? "";
  box.body.appendChild(errorNode);

  if (Object.keys(servers).length === 0) {
    box.body.appendChild(span("ocf-hint", "No MCP servers. Add one to give opencode extra tools."));
  }
  for (const [name, raw] of Object.entries(servers)) {
    const server = isObject(raw) ? raw : {};
    box.body.appendChild(mcpServerCard(ctx, path, name, server, valueSchema));
  }
  return box.root;
};

const ACTION_OPTIONS: SelectOption[] = [
  { id: "", label: "inherit" },
  { id: "allow", label: "allow" },
  { id: "ask", label: "ask" },
  { id: "deny", label: "deny" },
];

const summarizeRules = (rules: Record<string, Json>): string => {
  const named = Object.entries(rules).filter(([, value]) => typeof value === "string");
  const bits = named.slice(0, 4).map(([key, value]) => `${key}=${String(value)}`);
  const patterns = Object.keys(rules).length - named.length;
  if (patterns > 0) bits.push(`+${patterns} pattern`);
  return bits.join(" · ");
};

export const permissionSection = (ctx: FormContext, path: Path, schema: Schema): HTMLElement => {
  const value = ctx.get(path);
  const isNested = path.length > 1;

  // A nested matrix is ~15 selects; keep it collapsed behind a summary.
  if (isNested) {
    const rules = isObject(value) ? (value as Record<string, Json>) : {};
    const nested = card({
      title: "Permissions",
      subtitle:
        typeof value === "string"
          ? `every tool: ${value}`
          : value === undefined
            ? "inherit"
            : summarizeRules(rules) || "inherit",
      collapsed: true,
    });
    nested.root.classList.add("ocf-item");
    nested.body.appendChild(permissionBody(ctx, path, schema));
    return nested.root;
  }

  const box = card({
    title: "Permissions",
    subtitle: typeof value === "string" ? `every tool: ${value}` : "per-tool rules",
  });
  box.body.appendChild(permissionBody(ctx, path, schema));
  return box.root;
};

const permissionBody = (ctx: FormContext, path: Path, schema: Schema): HTMLElement => {
  const value = ctx.get(path);
  const body = el("div");
  body.style.display = "contents";

  const globalRow = el("div", "ocf-row");
  globalRow.appendChild(span("ocf-hint", "Default for every tool"));
  const globalHost = el("div");
  const globalOptions: SelectOption[] = [
    { id: "", label: "use per-tool rules" },
    { id: "ask", label: "ask" },
    { id: "allow", label: "allow" },
    { id: "deny", label: "deny" },
  ];
  mountSelect(globalHost, {
    value: typeof value === "string" ? value : "",
    options: globalOptions,
    onChange: (id) => {
      if (id === "") ctx.remove(path);
      else ctx.set(path, id);
      ctx.requestRender();
    },
  });
  globalRow.appendChild(globalHost);
  body.appendChild(globalRow);

  if (typeof value === "string") {
    body.appendChild(hint("Pick “use per-tool rules” to allow or deny individual tools."));
    return body;
  }

  const rules = isObject(value) ? (value as Record<string, Json>) : {};
  const ruleSchema = (() => {
    const list = variants(deref(schema));
    return list?.find((variant) => variant.matches({}))?.schema;
  })();
  const toolProps = properties(deref(ruleSchema));

  const fields = grid();
  for (const [tool, propSchema] of Object.entries(toolProps)) {
    const host = el("div");
    const current = rules[tool];
    if (isObject(current)) {
      // Rule objects (pattern → action) stay raw rather than pretending to be simple.
      const raw = el("div");
      mountTextField(raw, {
        label: tool,
        value: JSON.stringify(current, null, 2),
        multiline: true,
        rows: 3,
        mono: true,
        helper: "Pattern rules",
        onChange: (next) => {
          try {
            ctx.set([...path, tool], JSON.parse(next) as Json);
          } catch {
            /* keep last valid */
          }
        },
      });
      host.appendChild(raw);
    } else {
      mountSelect(host, {
        label: tool,
        value: typeof current === "string" ? current : "",
        options: ACTION_OPTIONS,
        onChange: (id) => {
          const next = { ...rules };
          if (id === "") delete next[tool];
          else next[tool] = id;
          if (Object.keys(next).length === 0) ctx.remove(path);
          else ctx.set(path, next);
          ctx.requestRender();
        },
      });
      const help = typeof propSchema.description === "string" ? propSchema.description : undefined;
      if (help) host.appendChild(hint(help));
    }
    fields.appendChild(host);
  }
  body.appendChild(fields);

  // additionalProperties: pattern rules such as "bash": { "git *": "allow" }
  const extras = Object.keys(rules).filter((key) => !Object.hasOwn(toolProps, key));
  if (extras.length > 0 || ruleSchema) {
    const extraBox = el("div", "ocf-subcard");
    extraBox.appendChild(
      span("ocf-hint", `${extras.length} pattern rule(s): ${extras.join(", ") || "none"}`),
    );
    for (const key of extras) {
      const host = el("div", "ocf-row");
      const nameField = el("div", "ocf-grow");
      mountTextField(nameField, {
        value: key,
        mono: true,
        onChange: (next) => {
          if (!next || next === key) return;
          const renamed = { ...rules };
          const value_ = renamed[key];
          delete renamed[key];
          renamed[next] = value_;
          ctx.set(path, renamed);
          ctx.requestRender();
        },
      });
      const actionField = el("div", "ocf-grow");
      mountTextField(actionField, {
        value: typeof rules[key] === "string" ? String(rules[key]) : JSON.stringify(rules[key]),
        mono: true,
        onChange: (next) => {
          ctx.set([...path, key], next);
        },
      });
      host.append(nameField, actionField);
      host.appendChild(
        button("Remove", {
          onClick: () => {
            const next = { ...rules };
            delete next[key];
            if (Object.keys(next).length === 0) ctx.remove(path);
            else ctx.set(path, next);
            ctx.requestRender();
          },
        }),
      );
      extraBox.appendChild(host);
    }
    const addRow = el("div", "ocf-row");
    let pattern = "";
    let action = "allow";
    const patternField = el("div", "ocf-grow");
    mountTextField(patternField, {
      value: "",
      placeholder: "bash pattern, e.g. git *",
      mono: true,
      onChange: (next) => {
        pattern = next;
      },
    });
    const actionField = el("div", "ocf-grow");
    mountSelect(actionField, {
      value: action,
      options: ACTION_OPTIONS.slice(1),
      onChange: (id) => {
        action = id;
      },
    });
    addRow.append(patternField, actionField);
    addRow.appendChild(
      button("+ Add pattern rule", {
        variant: "secondary",
        onClick: () => {
          const key = pattern.trim();
          if (!key) return;
          ctx.set(path, { ...rules, [key]: action });
          ctx.requestRender();
        },
      }),
    );
    extraBox.appendChild(addRow);
    body.appendChild(extraBox);
  }

  const errorNode = el("div", "ocf-hint ocf-danger");
  ctx.onError(path, (message) => {
    errorNode.textContent = message ?? "";
  });
  errorNode.textContent = ctx.errorAt(path) ?? "";
  body.appendChild(errorNode);
  return body;
};

/** Plugin entries are either `"name"` or `["name", options]`. */
export const pluginSection = (ctx: FormContext, path: Path, schema: Schema): HTMLElement => {
  const items = Array.isArray(ctx.get(path)) ? (ctx.get(path) as Json[]) : [];
  const box = card({
    title: "Plugins",
    subtitle: `${items.length} installed`,
  });

  const list = el("div", "ocf-list");
  items.forEach((item, index) => {
    const itemPath = [...path, index];
    const boxEl = el("div", "ocf-item");
    const head = el("div", "ocf-item-head");
    const isTuple = Array.isArray(item);
    head.appendChild(span("ocf-item-name", isTuple ? String(item[0]) : String(item)));
    head.appendChild(
      button("Remove", {
        onClick: () => {
          const next = items.filter((_, i) => i !== index);
          if (next.length === 0) ctx.remove(path);
          else ctx.set(path, next);
          ctx.requestRender();
        },
      }),
    );
    boxEl.appendChild(head);

    const nameHost = el("div");
    const currentName = isTuple ? String(item[0]) : String(item);
    mountTextField(nameHost, {
      label: "Plugin",
      value: currentName,
      mono: true,
      placeholder: "plugin-name",
      onChange: (next) => {
        if (isTuple) ctx.set([...itemPath, 0], next);
        else ctx.set(itemPath, next);
      },
    });
    boxEl.appendChild(nameHost);

    if (isTuple) {
      const optsHost = el("div");
      const current = item[1];
      mountTextField(optsHost, {
        label: "Options",
        value: JSON.stringify(current ?? {}, null, 2),
        multiline: true,
        rows: 4,
        mono: true,
        onChange: (next) => {
          try {
            ctx.set([...itemPath, 1], JSON.parse(next) as Json);
          } catch {
            /* keep last valid */
          }
        },
      });
      boxEl.appendChild(optsHost);
    }
    list.appendChild(boxEl);
  });
  box.body.appendChild(list);

  const addRow = el("div", "ocf-row");
  let pluginName = "";
  let withOptions = false;
  const nameField = el("div", "ocf-grow");
  mountTextField(nameField, {
    value: "",
    placeholder: "plugin-name",
    mono: true,
    onChange: (next) => {
      pluginName = next;
    },
  });
  const optsToggle = el("div");
  mountSwitch(optsToggle, {
    label: "With options",
    checked: false,
    onChange: (checked) => {
      withOptions = checked;
    },
  });
  addRow.append(nameField, optsToggle);
  addRow.appendChild(
    button("+ Add plugin", {
      variant: "secondary",
      onClick: () => {
        const name = pluginName.trim();
        if (!name) return;
        ctx.set(path, [...items, withOptions ? [name, {}] : name]);
        ctx.requestRender();
      },
    }),
  );
  box.body.appendChild(addRow);
  void schema;
  return box.root;
};

export { argvEditor, mapEditor };
