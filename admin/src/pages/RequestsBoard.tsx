import { useCallback, useEffect, useState } from "react";
import { rpc, supabase } from "../lib/supabase";

interface BoardRow {
  id: string;
  status: string;
  units: number;
  units_final: number | null;
  created_at: string;
  expires_at: string;
  repost_count: number;
  boost_agorot: number;
  city: string;
  street: string;
  house_number: string;
  building_id: string;
  building_paused: boolean;
  resident_phone: string;
  on_demand: boolean;
  claim: { picker_id: string; status: string; deadline_at: string; picker_phone: string } | null;
}

interface PickerOption {
  user_id: string;
  phone: string;
}

const LIVE = ["open", "claimed", "resident_approval", "put_out_prompt", "collected"];

export default function RequestsBoard() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [pickers, setPickers] = useState<PickerOption[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [liveOnly, setLiveOnly] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await rpc.rpc("admin_requests_board");
    if (!error) setRows((data as BoardRow[]) ?? []);
    const { data: pk } = await supabase
      .from("pickers")
      .select("user_id, users!inner(phone)")
      .eq("status", "active");
    setPickers(
      ((pk as unknown as Array<{ user_id: string; users: { phone: string } }>) ?? []).map((p) => ({
        user_id: p.user_id,
        phone: p.users.phone,
      })),
    );
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("board")
      .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, () => void load())
      .subscribe();
    const t = setInterval(() => void load(), 15000);
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(t);
    };
  }, [load]);

  async function assign(requestId: string, pickerId: string) {
    const { error } = await rpc.rpc("admin_assign_request", {
      p_request_id: requestId,
      p_picker_id: pickerId,
    });
    setStatus(error ? `✗ ${error.message}` : "✓ assigned");
    setAssigning(null);
    await load();
  }

  async function force(requestId: string) {
    const to = window.prompt("Force status to (open/expired/canceled/paid…):");
    if (!to) return;
    const { error } = await rpc.rpc("admin_force_transition", {
      p_request_id: requestId,
      p_to: to,
      p_note: "manual from board",
    });
    setStatus(error ? `✗ ${error.message}` : `✓ forced → ${to} (audited)`);
    await load();
  }

  const visible = rows.filter((r) => !liveOnly || LIVE.includes(r.status));

  return (
    <>
      <h2>Live requests</h2>
      <p className="sub">
        Zero-touch runs the show — this board is for watching, and for the manual
        dispatch lever when you need it. {status && <b className="mono">{status}</b>}
      </p>
      <label style={{ display: "block", marginBottom: 12 }}>
        <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} /> live only
      </label>
      <table className="grid">
        <thead>
          <tr>
            <th>Status</th><th>Address</th><th>Units</th><th>TTL</th><th>Picker</th><th>Flags</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.status}</td>
              <td dir="rtl">{r.street} {r.house_number}, {r.city}</td>
              <td className="mono">{r.units_final ?? r.units}</td>
              <td className="mono">{new Date(r.expires_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</td>
              <td className="mono">{r.claim ? `${r.claim.picker_phone} (${r.claim.status})` : "—"}</td>
              <td className="mono">
                {r.on_demand && "on-demand "}
                {r.repost_count > 0 && `repost×${r.repost_count} `}
                {r.boost_agorot > 0 && `boost+₪${(r.boost_agorot / 100).toFixed(0)} `}
                {r.building_paused && "⏸ building"}
              </td>
              <td>
                {r.status === "open" &&
                  (assigning === r.id ? (
                    <select autoFocus onChange={(e) => e.target.value && void assign(r.id, e.target.value)}>
                      <option value="">pick a picker…</option>
                      {pickers.map((p) => (
                        <option key={p.user_id} value={p.user_id}>{p.phone}</option>
                      ))}
                    </select>
                  ) : (
                    <button className="ghost" onClick={() => setAssigning(r.id)}>Dispatch</button>
                  ))}{" "}
                <button className="ghost" onClick={() => void force(r.id)}>Force</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
