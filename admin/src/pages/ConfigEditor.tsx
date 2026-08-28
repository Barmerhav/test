import { configEntries, type ConfigKey } from "@pinui/shared/config";
import { useCallback, useEffect, useMemo, useState } from "react";
import { rpc, supabase } from "../lib/supabase";

interface ConfigRow {
  key: string;
  value: unknown;
  schema: JsonSchema;
  description: string;
  version: number;
  updated_at: string;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
}

interface AuditRow {
  id: number;
  old_value: unknown;
  new_value: unknown;
  new_version: number;
  changed_by: string | null;
  changed_at: string;
  note: string | null;
}

/** Generic renderer: JSON Schema → form controls. Arrays and unknown shapes
 *  fall back to a validated JSON textarea. */
function SchemaField({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (schema.enum) {
    return (
      <select
        value={JSON.stringify(value)}
        onChange={(e) => onChange(JSON.parse(e.target.value))}
      >
        {schema.enum.map((opt) => (
          <option key={JSON.stringify(opt)} value={JSON.stringify(opt)}>
            {String(opt)}
          </option>
        ))}
      </select>
    );
  }
  switch (schema.type) {
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "number":
    case "integer":
      return (
        <input
          type="number"
          step={schema.type === "integer" ? 1 : "any"}
          value={value === null || value === undefined ? "" : Number(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      );
    case "string":
      return (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "object": {
      const obj = (value ?? {}) as Record<string, unknown>;
      const props = schema.properties ?? {};
      return (
        <div style={{ flex: 1 }}>
          {Object.entries(props).map(([k, sub]) => (
            <div className="kv-row" key={k}>
              <label>{k}</label>
              <SchemaField
                schema={sub}
                value={obj[k]}
                onChange={(v) => onChange({ ...obj, [k]: v })}
              />
            </div>
          ))}
        </div>
      );
    }
    default:
      return <JsonField value={value} onChange={onChange} />;
  }
}

function JsonField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  return (
    <div style={{ flex: 1 }}>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && <p className="error">Invalid JSON</p>}
    </div>
  );
}

function ConfigCard({ row, onSaved }: { row: ConfigRow; onSaved: () => void }) {
  const [draft, setDraft] = useState<unknown>(row.value);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(row.value), [row.value, row.version]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(row.value),
    [draft, row.value],
  );

  // client-side zod validation for known keys (DB re-validates regardless)
  const zodError = useMemo(() => {
    const entry = configEntries[row.key as ConfigKey];
    if (!entry || !dirty) return null;
    const parsed = entry.schema.safeParse(draft);
    return parsed.success ? null : parsed.error.issues[0]?.message ?? "invalid";
  }, [draft, dirty, row.key]);

  async function save() {
    setBusy(true);
    setStatus(null);
    const { error } = await rpc.rpc("admin_set_config", {
      p_key: row.key,
      p_value: draft,
      p_note: note || null,
    });
    if (error) setStatus({ kind: "err", msg: error.message });
    else {
      setStatus({ kind: "ok", msg: `Saved — now v${row.version + 1}. Live everywhere.` });
      setNote("");
      onSaved();
    }
    setBusy(false);
  }

  async function toggleAudit() {
    if (audit) {
      setAudit(null);
      return;
    }
    const { data } = await supabase
      .from("config_audit")
      .select("id, old_value, new_value, new_version, changed_by, changed_at, note")
      .eq("key", row.key)
      .order("id", { ascending: false })
      .limit(10);
    setAudit((data as AuditRow[]) ?? []);
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>{row.key}</h3>
        <span className="badge">v{row.version}</span>
      </div>
      <p className="desc">{row.description}</p>
      <SchemaField schema={row.schema} value={draft} onChange={setDraft} />
      {zodError && <p className="error">⚠ {zodError}</p>}
      <div className="kv-row" style={{ marginTop: 10 }}>
        <input
          type="text"
          placeholder="Change note (for the audit log)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="primary" disabled={!dirty || busy || Boolean(zodError)} onClick={save}>
          Save
        </button>
        <button className="ghost" disabled={!dirty} onClick={() => setDraft(row.value)}>
          Reset
        </button>
        <button className="ghost" onClick={toggleAudit}>
          {audit ? "Hide history" : "History"}
        </button>
      </div>
      {status && <p className={status.kind === "ok" ? "success" : "error"}>{status.msg}</p>}
      {audit && (
        <div className="audit">
          {audit.length === 0 && <div className="row">No changes yet.</div>}
          {audit.map((a) => (
            <div className="row" key={a.id}>
              <b>v{a.new_version}</b> · {new Date(a.changed_at).toLocaleString()} ·{" "}
              {JSON.stringify(a.old_value)} → <b>{JSON.stringify(a.new_value)}</b>
              {a.note ? ` · "${a.note}"` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ConfigEditor() {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("config")
      .select("key, value, schema, description, version, updated_at")
      .order("key");
    setRows((data as ConfigRow[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
    // instant effect works both ways: edits from anywhere update this screen
    const channel = supabase
      .channel("config-editor")
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [load]);

  const visible = rows.filter(
    (r) =>
      r.key.includes(filter.toLowerCase()) ||
      r.description.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <>
      <h2>Config</h2>
      <p className="sub">
        Every business value lives here. Changes are versioned, audited, and live on
        every device within seconds — no deploy. In-flight requests keep the values
        they were created with.
      </p>
      <input
        type="text"
        placeholder="Filter keys…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 16, width: 320 }}
      />
      {visible.map((row) => (
        <ConfigCard key={row.key} row={row} onSaved={load} />
      ))}
    </>
  );
}
