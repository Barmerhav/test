import { useEffect, useState } from "react";
import { rpc, supabase } from "../lib/supabase";

interface Batch {
  id: string;
  run_at: string;
  period_end: string;
  status: string;
  csv_path: string | null;
  masav_path: string | null;
}

interface Payout {
  id: string;
  batch_id: string;
  picker_id: string;
  total_units: number;
  amount_exvat_agorot: number;
  vat_agorot: number;
  total_agorot: number;
  status: string;
}

interface Invoice {
  payout_id: string;
  invoice_number: string;
  pdf_path: string | null;
}

const ILS = (agorot: number) => `₪${(agorot / 100).toFixed(2)}`;

export default function Payouts() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    const [b, p, i] = await Promise.all([
      supabase.from("payout_batches").select("*").order("run_at", { ascending: false }).limit(20),
      supabase.from("payouts").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("invoices_selfbilled").select("payout_id, invoice_number, pdf_path"),
    ]);
    setBatches((b.data as Batch[]) ?? []);
    setPayouts((p.data as Payout[]) ?? []);
    setInvoices((i.data as Invoice[]) ?? []);
  }
  useEffect(() => {
    void load();
  }, []);

  async function runNow() {
    const { data, error } = await rpc.rpc("admin_run_payout");
    if (error) setStatus(`✗ ${error.message}`);
    else if (!data) setStatus("Nothing to sweep — no unswept payout lines.");
    else setStatus(`✓ batch created. Run the export next.`);
    await load();
  }

  async function exportBatch(batchId: string) {
    setStatus("exporting…");
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payout-export`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ batch_id: batchId }),
      },
    );
    const body = (await res.json()) as { error?: string };
    setStatus(res.ok ? "✓ exported (CSV + MASAV + invoices in Storage)" : `✗ ${body.error}`);
    await load();
  }

  async function download(bucket: string, path: string) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
    if (error) setStatus(`✗ ${error.message}`);
    else window.open(data.signedUrl, "_blank");
  }

  return (
    <>
      <h2>Payouts</h2>
      <p className="sub">
        Lines accrue the moment a pickup is verified; the weekly run (or this button)
        sweeps them into per-picker payouts with tax-aware self-billed invoices.{" "}
        {status && <b className="mono">{status}</b>}
      </p>
      <button className="primary" onClick={() => void runNow()}>Run payout now</button>

      <h3 style={{ marginTop: 24 }}>Batches</h3>
      <table className="grid">
        <thead>
          <tr><th>Run</th><th>Period end</th><th>Status</th><th>Files</th><th></th></tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td className="mono">{new Date(b.run_at).toLocaleString()}</td>
              <td className="mono">{b.period_end}</td>
              <td className="mono">{b.status}</td>
              <td>
                {b.csv_path && (
                  <button className="ghost" onClick={() => void download("exports", b.csv_path!)}>CSV</button>
                )}{" "}
                {b.masav_path && (
                  <button className="ghost" onClick={() => void download("exports", b.masav_path!)}>מס"ב</button>
                )}
              </td>
              <td>
                {b.status === "created" && (
                  <button className="ghost" onClick={() => void exportBatch(b.id)}>Export</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>Payouts</h3>
      <table className="grid">
        <thead>
          <tr><th>Units</th><th>Ex-VAT</th><th>VAT</th><th>Total</th><th>Status</th><th>Invoice</th></tr>
        </thead>
        <tbody>
          {payouts.map((p) => {
            const inv = invoices.find((i) => i.payout_id === p.id);
            return (
              <tr key={p.id}>
                <td className="mono">{p.total_units}</td>
                <td className="mono">{ILS(p.amount_exvat_agorot)}</td>
                <td className="mono">{p.vat_agorot ? ILS(p.vat_agorot) : "—"}</td>
                <td className="mono">{ILS(p.total_agorot)}</td>
                <td className="mono">{p.status}</td>
                <td className="mono">
                  {inv?.pdf_path ? (
                    <button className="ghost" onClick={() => void download("invoices", inv.pdf_path!)}>
                      {inv.invoice_number}
                    </button>
                  ) : (
                    inv?.invoice_number ?? "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
