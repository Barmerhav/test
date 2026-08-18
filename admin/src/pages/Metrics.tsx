import { useEffect, useState } from "react";
import { rpc } from "../lib/supabase";

interface MetricsBlob {
  requests_30d: Record<string, number>;
  claim_rate_30d: number | null;
  median_seconds_to_claim_30d: number | null;
  expiry_rate_30d: number | null;
  utilization_pct: number | null;
  active_subscriptions: number;
  active_pickers_7d: number;
  pending_verification: number;
  unswept_payout_agorot: number;
  buildings: Array<{
    building_id: string;
    city: string;
    street: string;
    house_number: string;
    paused: boolean;
    active_doors: number;
    requests_30d: number;
  }>;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ minWidth: 170, textAlign: "center" }}>
      <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
      <div className="meta">{label}</div>
    </div>
  );
}

export default function Metrics() {
  const [m, setM] = useState<MetricsBlob | null>(null);

  useEffect(() => {
    void rpc.rpc("admin_metrics").then(({ data }) => setM(data as MetricsBlob));
  }, []);

  if (!m) return <p>Loading…</p>;

  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  const mins = (s: number | null) => (s === null ? "—" : `${Math.round(s / 60)}m`);
  const totalRequests = Object.values(m.requests_30d ?? {}).reduce((a, b) => a + b, 0);

  return (
    <>
      <h2>Metrics</h2>
      <p className="sub">Last 30 days unless noted.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Tile label="requests (30d)" value={String(totalRequests)} />
        <Tile label="claim rate" value={pct(m.claim_rate_30d)} />
        <Tile label="median time-to-claim" value={mins(m.median_seconds_to_claim_30d)} />
        <Tile label="expiry rate" value={pct(m.expiry_rate_30d)} />
        <Tile label="allowance utilization" value={m.utilization_pct === null ? "—" : `${m.utilization_pct}%`} />
        <Tile label="active subscriptions" value={String(m.active_subscriptions)} />
        <Tile label="active pickers (7d)" value={String(m.active_pickers_7d)} />
        <Tile label="pickers awaiting verify" value={String(m.pending_verification)} />
        <Tile label="unswept payouts" value={`₪${(m.unswept_payout_agorot / 100).toFixed(0)}`} />
      </div>

      <h3 style={{ marginTop: 24 }}>By status (30d)</h3>
      <table className="grid" style={{ maxWidth: 420 }}>
        <tbody>
          {Object.entries(m.requests_30d ?? {}).map(([k, v]) => (
            <tr key={k}><td className="mono">{k}</td><td className="mono">{v}</td></tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>Buildings</h3>
      <table className="grid">
        <thead>
          <tr><th>Address</th><th>Active doors</th><th>Requests 30d</th><th>Service</th></tr>
        </thead>
        <tbody>
          {m.buildings.map((b) => (
            <tr key={b.building_id}>
              <td dir="rtl">{b.street} {b.house_number}, {b.city}</td>
              <td className="mono">{b.active_doors}</td>
              <td className="mono">{b.requests_30d}</td>
              <td className="mono">{b.paused ? "⏸" : "●"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
