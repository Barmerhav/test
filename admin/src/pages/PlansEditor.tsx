import { useEffect, useState } from "react";
import { rpc, supabase } from "../lib/supabase";

interface PlanRow {
  id: string;
  code: string;
  version: number;
  price_agorot: number;
  units_per_month: number;
  bags_included: boolean;
  active_for_signup: boolean;
  created_at: string;
}

export default function PlansEditor() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [code, setCode] = useState("");
  const [price, setPrice] = useState<number>(0);
  const [units, setUnits] = useState<number>(1);
  const [bags, setBags] = useState(true);
  const [status, setStatus] = useState<{ kind: "ok" | "err" | "warn"; msg: string } | null>(null);

  async function load() {
    const { data } = await supabase
      .from("plans")
      .select("*")
      .order("code")
      .order("version", { ascending: false });
    setPlans((data as PlanRow[]) ?? []);
  }
  useEffect(() => {
    void load();
  }, []);

  function startEdit(p: PlanRow) {
    setCode(p.code);
    setPrice(p.price_agorot / 100);
    setUnits(p.units_per_month);
    setBags(p.bags_included);
    setStatus(null);
  }

  async function save() {
    setStatus(null);
    const { data, error } = await rpc.rpc("admin_upsert_plan", {
      p_code: code.trim(),
      p_price_shekels: price,
      p_units: units,
      p_bags_included: bags,
    });
    if (error) {
      setStatus({ kind: "err", msg: error.message });
      return;
    }
    const warning = (data as { warning?: string } | null)?.warning;
    setStatus(
      warning === "price_above_ceiling"
        ? { kind: "warn", msg: "Saved — note: price is above the configured ceiling (allowed, just flagging)." }
        : { kind: "ok", msg: "Saved as a new version. Existing subscribers keep their current terms until they accept." },
    );
    await load();
  }

  async function retire(planCode: string) {
    const { error } = await rpc.rpc("admin_retire_plan", { p_code: planCode });
    setStatus(error ? { kind: "err", msg: error.message } : { kind: "ok", msg: `${planCode} retired from signup.` });
    await load();
  }

  return (
    <>
      <h2>Plans</h2>
      <p className="sub">
        Editing a plan creates a NEW VERSION — existing subscribers are grandfathered on
        the exact version they signed (it's a foreign key, not a policy). New signups see
        only the latest active version per code.
      </p>

      <div className="card">
        <h3>New version / new plan</h3>
        <div className="kv-row">
          <label>code</label>
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="S / M / L / XL…" />
        </div>
        <div className="kv-row">
          <label>price (₪ / month)</label>
          <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </div>
        <div className="kv-row">
          <label>units / month</label>
          <input type="number" value={units} onChange={(e) => setUnits(Number(e.target.value))} />
        </div>
        <div className="kv-row">
          <label>bag roll included</label>
          <input type="checkbox" checked={bags} onChange={(e) => setBags(e.target.checked)} />
        </div>
        <div className="kv-row">
          <button className="primary" disabled={!code.trim() || units < 1} onClick={save}>
            Save new version
          </button>
        </div>
        {status && (
          <p className={status.kind === "err" ? "error" : status.kind === "warn" ? "mono" : "success"}>
            {status.msg}
          </p>
        )}
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>Code</th><th>Version</th><th>Price</th><th>Units</th><th>Bags</th><th>Signup</th><th></th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id} style={{ opacity: p.active_for_signup ? 1 : 0.55 }}>
              <td className="mono">{p.code}</td>
              <td className="mono">v{p.version}</td>
              <td className="mono">₪{(p.price_agorot / 100).toFixed(0)}</td>
              <td className="mono">{p.units_per_month}</td>
              <td>{p.bags_included ? "✓" : "—"}</td>
              <td>{p.active_for_signup ? "visible" : "retired"}</td>
              <td>
                <button className="ghost" onClick={() => startEdit(p)}>Edit → new version</button>{" "}
                {p.active_for_signup && (
                  <button className="ghost" onClick={() => void retire(p.code)}>Retire</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
