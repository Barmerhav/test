import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { rpc, supabase } from "../lib/supabase";

interface Building {
  id: string;
  city: string;
  street: string;
  house_number: string;
  bin_qr_id: string;
  bin_location_note: string | null;
  paused: boolean;
}

interface MeterRow {
  building_id: string;
  active_doors: number;
}

export default function Buildings() {
  const [rows, setRows] = useState<Building[]>([]);
  const [meter, setMeter] = useState<MeterRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    const [b, m] = await Promise.all([
      supabase.from("buildings").select("id, city, street, house_number, bin_qr_id, bin_location_note, paused").order("city").order("street"),
      supabase.from("building_meter").select("*"),
    ]);
    setRows((b.data as Building[]) ?? []);
    setMeter((m.data as MeterRow[]) ?? []);
  }
  useEffect(() => {
    void load();
  }, []);

  async function togglePause(b: Building) {
    const { error } = await rpc.rpc("admin_set_building_paused", {
      p_building_id: b.id,
      p_paused: !b.paused,
    });
    setStatus(error ? `✗ ${error.message}` : `✓ ${b.street} ${b.house_number} ${b.paused ? "resumed" : "paused"}`);
    await load();
  }

  async function setCode(b: Building) {
    const code = window.prompt(`New entry code for ${b.street} ${b.house_number} (empty clears):`);
    if (code === null) return;
    const { error } = await rpc.rpc("set_building_entry_code", {
      p_building_id: b.id,
      p_entry_code: code,
    });
    setStatus(error ? `✗ ${error.message}` : "✓ code updated (encrypted at rest)");
  }

  /** Print one building's bin QR. Poster copy comes from the strings table
   *  (picker-facing Hebrew → admin-editable, prime directive). */
  async function printQr(b: Building) {
    const { data: strs } = await supabase
      .from("strings")
      .select("key, value")
      .eq("locale", "he")
      .in("key", ["app_name", "qr_poster.scan_hint"]);
    const lookup = new Map((strs ?? []).map((s: { key: string; value: string }) => [s.key, s.value]));
    const appName = lookup.get("app_name") ?? "";
    const scanHint = lookup.get("qr_poster.scan_hint") ?? "";

    const dataUrl = await QRCode.toDataURL(b.bin_qr_id, { width: 480, margin: 2 });
    const w = window.open("", "_blank", "width=600,height=760");
    if (!w) return;
    w.document.write(`<!doctype html><html dir="rtl"><head><title>${b.bin_qr_id}</title>
<style>body{font-family:Arial;display:flex;flex-direction:column;align-items:center;margin-top:40px}
h1{font-size:26px;margin:0} p{color:#444} img{margin:24px 0}</style></head><body>
<h1>${b.street} ${b.house_number}, ${b.city}</h1>
<p>${scanHint} · ${appName}</p>
<img src="${dataUrl}" alt="QR">
<p style="font-family:monospace">${b.bin_qr_id}</p>
<script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  return (
    <>
      <h2>Buildings</h2>
      <p className="sub">
        Per-building service pause (kill switch), entry-code management (write-only —
        codes are never displayed), and the printable bin QR each building gets.{" "}
        {status && <b className="mono">{status}</b>}
      </p>
      <table className="grid">
        <thead>
          <tr><th>Address</th><th>Active doors</th><th>Bin QR</th><th>Service</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} style={{ opacity: b.paused ? 0.6 : 1 }}>
              <td dir="rtl">{b.street} {b.house_number}, {b.city}</td>
              <td className="mono">{meter.find((m) => m.building_id === b.id)?.active_doors ?? 0}</td>
              <td className="mono">{b.bin_qr_id.slice(0, 12)}…</td>
              <td className="mono">{b.paused ? "⏸ paused" : "● live"}</td>
              <td>
                <button className="ghost" onClick={() => void printQr(b)}>Print QR</button>{" "}
                <button className="ghost" onClick={() => void setCode(b)}>Set code</button>{" "}
                <button className="ghost" onClick={() => void togglePause(b)}>
                  {b.paused ? "Resume" : "Pause"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
