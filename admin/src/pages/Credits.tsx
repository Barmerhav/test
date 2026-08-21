import { useState } from "react";
import { rpc, supabase } from "../lib/supabase";

interface UserRow {
  id: string;
  phone: string;
  full_name: string | null;
}

interface CreditRow {
  id: string;
  units_granted: number;
  units_consumed: number;
  reason: string;
  status: string;
  granted_at: string;
  expires_at: string | null;
}

export default function Credits() {
  const [phone, setPhone] = useState("");
  const [user, setUser] = useState<UserRow | null>(null);
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [units, setUnits] = useState(1);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function lookup() {
    setStatus(null);
    const normalized = phone.replace(/[^0-9]/g, "").replace(/^0/, "972");
    const { data } = await supabase
      .from("users")
      .select("id, phone, full_name")
      .ilike("phone", `%${normalized || phone}%`)
      .limit(1)
      .maybeSingle();
    if (!data) {
      setUser(null);
      setStatus("✗ user not found");
      return;
    }
    setUser(data as UserRow);
    const { data: cr } = await supabase
      .from("credits")
      .select("id, units_granted, units_consumed, reason, status, granted_at, expires_at")
      .eq("user_id", (data as UserRow).id)
      .order("granted_at", { ascending: false });
    setCredits((cr as CreditRow[]) ?? []);
  }

  async function grant() {
    if (!user) return;
    const { error } = await rpc.rpc("admin_grant_credit", {
      p_user_id: user.id,
      p_units: units,
      p_note: note || null,
    });
    setStatus(error ? `✗ ${error.message}` : "✓ granted (audited)");
    await lookup();
  }

  return (
    <>
      <h2>Credits override</h2>
      <p className="sub">
        Zero-touch grants credits automatically (expiry, no-show, referral, meter).
        This override is for goodwill/support cases — every grant is audited.
      </p>
      <div className="card">
        <div className="kv-row">
          <input
            type="text"
            placeholder="Phone (05x… or 9725x…)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void lookup()}
          />
          <button className="ghost" onClick={() => void lookup()}>Find</button>
          {status && <span className="mono">{status}</span>}
        </div>
        {user && (
          <>
            <p className="mono">{user.phone} · {user.full_name ?? "—"}</p>
            <div className="kv-row">
              <label>units</label>
              <input type="number" min={1} value={units} onChange={(e) => setUnits(Number(e.target.value))} />
              <input type="text" placeholder="Note (audit log)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
              <button className="primary" disabled={!(units >= 1)} onClick={() => void grant()}>Grant</button>
            </div>
          </>
        )}
      </div>

      {user && (
        <table className="grid">
          <thead>
            <tr><th>Granted</th><th>Used</th><th>Reason</th><th>Status</th><th>Expires</th></tr>
          </thead>
          <tbody>
            {credits.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.units_granted}</td>
                <td className="mono">{c.units_consumed}</td>
                <td className="mono">{c.reason}</td>
                <td className="mono">{c.status}</td>
                <td className="mono">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "∞"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
