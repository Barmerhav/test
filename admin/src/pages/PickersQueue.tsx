import { useEffect, useState } from "react";
import { rpc, supabase } from "../lib/supabase";

interface PickerRow {
  user_id: string;
  status: string;
  tax_status: string;
  vat_id: string | null;
  strikes: number;
  available: boolean;
  poa_consent_at: string;
  poa_version: string;
  created_at: string;
  users: { phone: string; full_name: string | null };
}

export default function PickersQueue() {
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("pickers")
      .select("*, users!inner(phone, full_name)")
      .order("created_at", { ascending: false });
    setRows((data as unknown as PickerRow[]) ?? []);
  }
  useEffect(() => {
    void load();
  }, []);

  async function verify(userId: string, approve: boolean) {
    const { error } = await rpc.rpc("admin_verify_picker", {
      p_user_id: userId,
      p_approve: approve,
    });
    setStatus(error ? `✗ ${error.message}` : approve ? "✓ approved" : "✓ rejected");
    await load();
  }

  const pending = rows.filter((r) => r.status === "pending_verification");
  const rest = rows.filter((r) => r.status !== "pending_verification");

  return (
    <>
      <h2>Pickers</h2>
      <p className="sub">
        Verification queue first, everyone else below. ID numbers are stored only as
        salted hashes — verify identity out-of-band. {status && <b className="mono">{status}</b>}
      </p>

      {pending.length > 0 && (
        <div className="card">
          <h3>Verification queue ({pending.length})</h3>
          {pending.map((p) => (
            <div className="kv-row" key={p.user_id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
              <span className="mono">{p.users.phone}</span>
              <span>{p.users.full_name ?? "—"}</span>
              <span className="badge">{p.tax_status}{p.vat_id ? ` · ${p.vat_id}` : ""}</span>
              <span className="mono" title={`PoA ${p.poa_version}`}>
                PoA ✓ {new Date(p.poa_consent_at).toLocaleDateString()}
              </span>
              <button className="primary" onClick={() => void verify(p.user_id, true)}>Approve</button>
              <button className="ghost" onClick={() => void verify(p.user_id, false)}>Reject</button>
            </div>
          ))}
        </div>
      )}

      <table className="grid">
        <thead>
          <tr><th>Phone</th><th>Name</th><th>Status</th><th>Tax</th><th>Strikes</th><th>Available</th></tr>
        </thead>
        <tbody>
          {rest.map((p) => (
            <tr key={p.user_id}>
              <td className="mono">{p.users.phone}</td>
              <td>{p.users.full_name ?? "—"}</td>
              <td className="mono">{p.status}</td>
              <td className="mono">{p.tax_status}</td>
              <td className="mono">{p.strikes}</td>
              <td>{p.available ? "✓" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
