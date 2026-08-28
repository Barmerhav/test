import { useCallback, useEffect, useState } from "react";
import { rpc, supabase } from "../lib/supabase";

/** Feature-flag keys whose value is an object holding an `enabled` boolean. */
const FLAG_KEYS = [
  "boost",
  "backstop",
  "on_demand_single",
  "extra_roll",
  "kartisiya",
  "referral",
  "building_meter",
] as const;

export default function KillSwitches() {
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [serviceEnabled, setServiceEnabled] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("config")
      .select("key, value")
      .in("key", [...FLAG_KEYS, "service_enabled"]);
    const map: Record<string, Record<string, unknown>> = {};
    for (const row of (data ?? []) as { key: string; value: unknown }[]) {
      if (row.key === "service_enabled") setServiceEnabled(Boolean(row.value));
      else map[row.key] = row.value as Record<string, unknown>;
    }
    setValues(map);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("kill-switches")
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [load]);

  async function setConfig(key: string, value: unknown, note: string) {
    const { error } = await rpc.rpc("admin_set_config", {
      p_key: key,
      p_value: value,
      p_note: note,
    });
    setStatus(error ? `✗ ${error.message}` : `✓ ${key} updated — live everywhere`);
    await load();
  }

  return (
    <>
      <h2>Kill switches</h2>
      <p className="sub">
        Feature flags with instant effect. In-flight requests always finish under the
        rules they started with. {status && <b className="mono">{status}</b>}
      </p>

      <div className="card" style={{ borderColor: serviceEnabled === false ? "var(--danger)" : undefined }}>
        <h3>service_enabled — GLOBAL</h3>
        <p className="desc">
          Master switch: OFF blocks all new request submissions everywhere.
        </p>
        <button
          className={serviceEnabled ? "ghost" : "primary"}
          onClick={() => void setConfig("service_enabled", !serviceEnabled, "kill switch")}
        >
          {serviceEnabled ? "⏸ Pause the whole service" : "▶ Resume service"}
        </button>
        <span className="badge" style={{ marginInlineStart: 10 }}>
          {serviceEnabled === null ? "…" : serviceEnabled ? "LIVE" : "PAUSED"}
        </span>
      </div>

      {FLAG_KEYS.map((key) => {
        const v = values[key];
        if (!v) return null;
        const enabled = Boolean(v.enabled);
        return (
          <div className="card" key={key}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3>{key}</h3>
              <label>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) =>
                    void setConfig(key, { ...v, enabled: e.target.checked }, "flag toggle")
                  }
                />{" "}
                enabled
              </label>
            </div>
            <p className="meta mono">{JSON.stringify(v)}</p>
          </div>
        );
      })}
    </>
  );
}
