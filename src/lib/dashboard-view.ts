export type DashboardRecord = Record<string, unknown>;

export type CollectionAction = {
  label: string;
  run: () => Promise<void> | void;
  tone?: "default" | "danger";
};

export type CollectionColumn = {
  label: string;
  keys: string[];
  format?: (value: unknown, row: DashboardRecord) => string;
  mono?: boolean;
};

export type CollectionDefinition = {
  name: string;
  title?: string;
  rows: DashboardRecord[];
  columns?: CollectionColumn[];
  emptyMessage?: string;
  actions?: (row: DashboardRecord, index: number) => CollectionAction[];
  inspect?: (row: DashboardRecord, index: number) => Promise<void> | void;
};

type CollectionSchema = {
  title: string;
  identity: string[];
  columns: CollectionColumn[];
};

const field = (label: string, keys: string[], mono = false): CollectionColumn => ({ label, keys, mono });
const date = (label: string, keys: string[]): CollectionColumn => ({ label, keys, format: formatDate, mono: true });

const schemas: Record<string, CollectionSchema> = {
  projects: {
    title: "Project scopes",
    identity: ["reference", "project_id"],
    columns: [
      field("Reference", ["reference", "project_id"], true),
      { label: "Scope", keys: ["project_id"], format: (value) => value === null || value === undefined ? "Unscoped" : "Project" },
      field("Records", ["record_count"], true),
      field("Subjects", ["subject_count"], true),
      date("Last write", ["last_write"]),
    ],
  },
  subjects: {
    title: "Subject identities",
    identity: ["label", "subject_id"],
    columns: [
      field("Identity", ["label", "subject_id"]),
      field("Type", ["type", "subject_type"]),
      field("References", ["reference_count"], true),
      date("Created", ["created_at"]),
    ],
  },
  references: {
    title: "Normalized references",
    identity: ["value", "namespace"],
    columns: [field("Namespace", ["namespace"], true), field("Reference", ["value"], true)],
  },
  leases: {
    title: "Active leases",
    identity: ["resource_id", "lease_id"],
    columns: [
      field("Lease ID", ["lease_id"], true),
      field("Resource", ["resource_id", "lease_id"], true),
      field("Type", ["resource_type"]),
      field("Holder", ["holder_id"], true),
      field("Status", ["status"]),
      date("Expires", ["expires_at"]),
    ],
  },
  handoffs: {
    title: "Handoffs",
    identity: ["subject_id", "handoff_id"],
    columns: [
      field("Handoff ID", ["handoff_id"], true),
      field("Subject", ["subject_id", "handoff_id"], true),
      field("From", ["from_principal"], true),
      field("To", ["to_principal"], true),
      field("Status", ["status"]),
      date("Created", ["created_at"]),
    ],
  },
  entries: {
    title: "Metadata activity",
    identity: ["action", "id", "audit_id"],
    columns: [
      field("Action", ["action"]),
      field("Actor", ["actor_id", "principal_id"], true),
      field("Target", ["target_id", "resource_id", "subject_id"], true),
      date("Time", ["created_at", "occurred_at"]),
      field("ID", ["id", "audit_id"], true),
    ],
  },
  events: {
    title: "Domain events",
    identity: ["kind", "event_id"],
    columns: [
      field("Kind", ["kind"]),
      field("Actor", ["actor_id", "principal_id"], true),
      field("Subject", ["subject_id", "resource_id"], true),
      date("Time", ["created_at", "occurred_at"]),
      field("Event ID", ["event_id", "id"], true),
    ],
  },
  policies: {
    title: "Policies",
    identity: ["policy_id", "kind"],
    columns: [field("Policy", ["policy_id", "id"], true), field("Kind", ["kind"]), field("Scope", ["scope_type"]), field("Scope ID", ["scope_id"], true), field("Enabled", ["enabled"]), field("Version", ["version"], true)],
  },
  approvals: {
    title: "Approval queue",
    identity: ["claim_id", "approval_id"],
    columns: [field("Claim", ["claim_id", "approval_id"], true), field("Status", ["status"]), field("Version", ["version"], true), field("Submitted by", ["submitted_by"], true), date("Submitted", ["submitted_at"])],
  },
  releases: {
    title: "Release lifecycle",
    identity: ["release_id", "label"],
    columns: [field("Release", ["release_id", "label"], true), field("Channel", ["channel_id"], true), field("Claim", ["claim_id"], true), field("Audience", ["audience"]), field("Status", ["status"]), field("Version", ["version"], true), date("Updated", ["updated_at", "created_at"])],
  },
  principals: {
    title: "Principals",
    identity: ["username", "principal_id"],
    columns: [field("Principal", ["username", "principal_id"]), field("Kind", ["principal_kind"]), field("Role", ["organization_role", "role"]), field("Trust ceiling", ["max_trust"]), field("Status", ["status"])],
  },
  grants: {
    title: "Active grants",
    identity: ["grant_id", "principal_id"],
    columns: [field("Grant ID", ["grant_id"], true), field("Principal", ["principal_id"], true), field("Target", ["target_type"]), field("Target ID", ["target_id"], true), field("Permissions", ["permissions"]), field("Status", ["status", "revoked_at"])],
  },
  key_clamp_preview: {
    title: "Key clamp preview",
    identity: ["label", "key_id"],
    columns: [field("Key", ["label", "key_id"]), field("Principal", ["principal_id", "issued_by"], true), field("Scopes", ["scopes"]), field("Trust ceiling", ["max_trust"]), field("Target", ["data_target_id", "data_target_type"], true)],
  },
  keys: {
    title: "API keys",
    identity: ["label", "key_id"],
    columns: [field("Key", ["label", "key_id"]), field("Principal", ["principal_id", "issued_by"], true), field("Scopes", ["scopes"]), field("Trust ceiling", ["max_trust"]), field("Status", ["status"])],
  },
  peers: {
    title: "Federation peers",
    identity: ["name", "peer_id"],
    columns: [
      field("Peer", ["name", "peer_id"]),
      field("Endpoint", ["endpoint"], true),
      field("Direction", ["direction"]),
      field("Source organization", ["source_org_id"], true),
      field("Status", ["status"]),
      date("Last sync", ["last_sync_at"]),
    ],
  },
  federation_entries: {
    title: "Exchange log",
    identity: ["id", "resource_id"],
    columns: [field("ID", ["id"], true), field("Direction", ["direction"]), field("Resource", ["resource_type"]), field("Resource ID", ["resource_id"], true), field("Status", ["status"]), date("Time", ["created_at"])],
  },
  items: {
    title: "Selected context items",
    identity: ["statement", "claim_id", "id"],
    columns: [field("Statement", ["statement", "claim_id", "id"]), field("Kind", ["kind"]), field("Trust", ["trust"]), field("Score", ["score"], true), field("Source", ["source_id", "source_ref"], true)],
  },
  conflicts: {
    title: "Conflicts",
    identity: ["statement", "claim_id", "id"],
    columns: [field("Claim", ["statement", "claim_id", "id"]), field("Relation", ["relation"]), field("Status", ["status"]), field("Confidence", ["confidence"], true)],
  },
  instructions: {
    title: "Instructions",
    identity: ["instruction", "text", "value", "id"],
    columns: [field("Instruction", ["instruction", "text", "value", "id"]), field("Source", ["source", "source_id"], true), field("Priority", ["priority"], true)],
  },
};

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstValue(row: DashboardRecord, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function fallbackSchema(name: string, rows: DashboardRecord[]): CollectionSchema {
  const keys = Object.keys(rows[0] ?? {}).filter((key) => {
    const value = rows[0]?.[key];
    return value === null || ["string", "number", "boolean"].includes(typeof value);
  }).slice(0, 5);
  const resolved = keys.length ? keys : ["value"];
  return {
    title: humanize(name),
    identity: ["label", "name", "statement", "id", ...resolved],
    columns: resolved.map((key) => field(humanize(key), [key], key.endsWith("_id") || key.endsWith("_at"))),
  };
}

function recordLabel(row: DashboardRecord, schema: CollectionSchema, index: number): string {
  return formatValue(firstValue(row, schema.identity)) === "—" ? `Item ${index + 1}` : formatValue(firstValue(row, schema.identity));
}

function createTechnicalPayload(value: unknown): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "technical-payload";
  const summary = document.createElement("summary");
  summary.textContent = "Technical payload";
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(value, null, 2);
  details.append(summary, pre);
  return details;
}

function renderInspector(target: HTMLElement, title: string, row: DashboardRecord) {
  target.replaceChildren();
  target.hidden = false;
  const header = document.createElement("header");
  const eyebrow = document.createElement("span");
  eyebrow.textContent = "Selected record";
  const heading = document.createElement("h4");
  heading.textContent = title;
  header.append(eyebrow, heading);
  const facts = document.createElement("dl");
  for (const [key, value] of Object.entries(row)) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = humanize(key);
    description.textContent = key.endsWith("_at") ? formatDate(value) : formatValue(value);
    facts.append(term, description);
  }
  target.append(header, facts, createTechnicalPayload(row));
}

export function renderCollection(target: HTMLElement, definition: CollectionDefinition, append = false): HTMLElement {
  if (!append) target.replaceChildren();
  const schema = definition.columns
    ? { title: definition.title ?? humanize(definition.name), identity: ["label", "name", "statement", "id"], columns: definition.columns }
    : (schemas[definition.name] ?? fallbackSchema(definition.name, definition.rows));
  const section = document.createElement("section");
  section.className = "operator-collection";
  section.dataset.collection = definition.name;

  const header = document.createElement("header");
  const heading = document.createElement("h3");
  heading.textContent = definition.title ?? schema.title;
  const count = document.createElement("span");
  count.textContent = `${definition.rows.length.toLocaleString()} authorized ${definition.rows.length === 1 ? "record" : "records"}`;
  header.append(heading, count);
  section.append(header);

  if (!definition.rows.length) {
    const empty = document.createElement("p");
    empty.className = "collection-empty";
    empty.textContent = definition.emptyMessage ?? "No authorized records returned.";
    section.append(empty, createTechnicalPayload(definition.rows));
    target.append(section);
    return section;
  }

  const wrap = document.createElement("div");
  wrap.className = "operator-table-wrap";
  const table = document.createElement("table");
  table.className = "operator-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of schema.columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column.label;
    headRow.append(cell);
  }
  const actionHead = document.createElement("th");
  actionHead.scope = "col";
  actionHead.textContent = "Action";
  headRow.append(actionHead);
  head.append(headRow);
  const body = document.createElement("tbody");
  const inspector = document.createElement("section");
  inspector.className = "collection-inspector";
  inspector.hidden = true;

  definition.rows.forEach((row, index) => {
    const tableRow = document.createElement("tr");
    const label = recordLabel(row, schema, index);
    for (const column of schema.columns) {
      const value = firstValue(row, column.keys);
      const cell = document.createElement("td");
      cell.dataset.label = column.label;
      cell.textContent = column.format ? column.format(value, row) : formatValue(value);
      if (column.mono) cell.className = "mono-value";
      tableRow.append(cell);
    }
    const actionsCell = document.createElement("td");
    actionsCell.dataset.label = "Action";
    actionsCell.className = "collection-actions";
    const inspect = document.createElement("button");
    inspect.type = "button";
    inspect.className = "text-button";
    inspect.textContent = `Inspect ${label}`;
    inspect.addEventListener("click", async () => {
      for (const selected of body.querySelectorAll("tr[aria-selected]")) selected.removeAttribute("aria-selected");
      tableRow.setAttribute("aria-selected", "true");
      renderInspector(inspector, label, row);
      await definition.inspect?.(row, index);
    });
    actionsCell.append(inspect);
    for (const action of definition.actions?.(row, index) ?? []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `text-button${action.tone === "danger" ? " danger-action" : ""}`;
      button.textContent = action.label;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await action.run(); } finally { button.disabled = false; }
      });
      actionsCell.append(button);
    }
    tableRow.append(actionsCell);
    body.append(tableRow);
  });
  table.append(head, body);
  wrap.append(table);
  section.append(wrap, inspector, createTechnicalPayload(definition.rows));
  target.append(section);
  return section;
}

export function renderFacts(target: HTMLElement, title: string, values: DashboardRecord, append = false): HTMLElement {
  if (!append) target.replaceChildren();
  const section = document.createElement("section");
  section.className = "operator-facts";
  const header = document.createElement("header");
  const heading = document.createElement("h3");
  heading.textContent = title;
  header.append(heading);
  const facts = document.createElement("dl");
  for (const [key, value] of Object.entries(values)) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = humanize(key);
    description.textContent = key.endsWith("_at") ? formatDate(value) : formatValue(value);
    facts.append(term, description);
  }
  section.append(header, facts, createTechnicalPayload(values));
  target.append(section);
  return section;
}

export function renderPayloadView(
  target: HTMLElement,
  data: DashboardRecord,
  options: {
    actions?: Record<string, (row: DashboardRecord, index: number) => CollectionAction[]>;
    inspect?: Record<string, (row: DashboardRecord, index: number) => Promise<void> | void>;
  } = {},
) {
  target.replaceChildren();
  const arrays = Object.entries(data).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]));
  for (const [name, values] of arrays) {
    const rows = values.map((value) => value && typeof value === "object" && !Array.isArray(value)
      ? value as DashboardRecord
      : { value });
    renderCollection(target, {
      name,
      rows,
      actions: options.actions?.[name],
      inspect: options.inspect?.[name],
    }, true);
  }
  const metadataEntries = Object.entries(data).filter(([, value]) => !Array.isArray(value));
  const nested = metadataEntries.filter((entry): entry is [string, DashboardRecord] =>
    Boolean(entry[1]) && typeof entry[1] === "object" && !Array.isArray(entry[1]));
  for (const [name, values] of nested) renderFacts(target, humanize(name), values, true);
  const metadata = Object.fromEntries(metadataEntries.filter(([, value]) => !value || typeof value !== "object"));
  if (Object.keys(metadata).length) renderFacts(target, arrays.length || nested.length ? "Response metadata" : "Configuration facts", metadata, true);
  if (!arrays.length && !nested.length && !Object.keys(metadata).length) renderFacts(target, "Response", {}, true);
}
