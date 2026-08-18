/**
 * payout-export — renders a payout batch into bank + tax artifacts:
 *  - CSV (bank_details + amounts) for manual transfer / reconciliation
 *  - MASAV-style fixed-width TXT (מס"ב) — best-effort standard layout; the
 *    founder's bank may require field tweaks before first live run
 *  - one self-billed invoice per payout as print-ready RTL HTML stored in the
 *    private `invoices` bucket (browser print → PDF; a headless-PDF adapter
 *    can replace the renderer without touching this flow)
 *
 * POST { batch_id? } — defaults to the latest 'created' batch.
 */
import { formatILS } from "../../../packages/shared/src/money/index.ts";
import { HttpError, handle, json, readString, serviceClient } from "../_shared/env.ts";

interface BatchPayload {
  batch: { id: string; period_end: string; run_at: string } | null;
  payouts: Array<{
    payout: {
      id: string; total_units: number; amount_exvat_agorot: number;
      vat_rate: string; vat_agorot: number; total_agorot: number; period_end: string;
    };
    invoice: { id: string; invoice_number: string; tax_status_snapshot: string };
    picker: {
      user_id: string; tax_status: string; vat_id: string | null;
      bank_details: { bank?: string; branch?: string; account?: string } | null;
      full_name: string | null; phone: string;
    };
  }>;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(p: BatchPayload): string {
  const header = "payout_id,picker_name,phone,tax_status,vat_id,bank,branch,account,units,amount_exvat_agorot,vat_agorot,total_agorot,invoice_number";
  const rows = p.payouts.map((row) =>
    [
      row.payout.id, row.picker.full_name ?? "", row.picker.phone, row.picker.tax_status,
      row.picker.vat_id ?? "", row.picker.bank_details?.bank ?? "", row.picker.bank_details?.branch ?? "",
      row.picker.bank_details?.account ?? "", row.payout.total_units, row.payout.amount_exvat_agorot,
      row.payout.vat_agorot, row.payout.total_agorot, row.invoice.invoice_number,
    ].map(csvEscape).join(","),
  );
  return "﻿" + [header, ...rows].join("\n");
}

/** Best-effort MASAV fixed-width record set (header, K-records, trailer). */
function buildMasav(p: BatchPayload, periodEnd: string, headerName: string): string {
  const pad = (s: string, len: number) => s.slice(0, len).padStart(len, "0");
  const padTxt = (s: string, len: number) => s.slice(0, len).padEnd(len, " ");
  const ymd = periodEnd.replace(/-/g, "").slice(2); // YYMMDD
  const lines: string[] = [];
  lines.push(`K${ymd}${pad("", 8)}${padTxt(headerName, 20)}`);
  let totalAgorot = 0;
  for (const row of p.payouts) {
    const bank = pad(row.picker.bank_details?.bank ?? "0", 2);
    const branch = pad(row.picker.bank_details?.branch ?? "0", 3);
    const account = pad(row.picker.bank_details?.account ?? "0", 9);
    const amount = pad(String(row.payout.total_agorot), 13);
    lines.push(`1${bank}${branch}${account}${amount}${padTxt(row.picker.full_name ?? row.picker.phone, 16)}`);
    totalAgorot += row.payout.total_agorot;
  }
  lines.push(`9${pad(String(p.payouts.length), 7)}${pad(String(totalAgorot), 15)}`);
  return lines.join("\n");
}

/** All invoice copy comes from the strings table (admin-editable). */
async function invoiceStrings(): Promise<Record<string, string>> {
  const keys = [
    "invoice.title", "invoice.issued_note", "invoice.supplier", "invoice.vat_dealer",
    "invoice.col_item", "invoice.col_amount", "invoice.line_pickups",
    "invoice.vat_label", "invoice.total_due", "invoice.print_hint",
  ];
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = await readString(k);
  return out;
}

const fill = (tpl: string, params: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));

async function buildInvoiceHtml(row: BatchPayload["payouts"][number], appName: string): Promise<string> {
  const inv = row.invoice;
  const p = row.payout;
  const s = await invoiceStrings();
  const money = (agorot: number) => formatILS(agorot, { isolate: false, withAgorot: true });
  const vatLine = inv.tax_status_snapshot === "murshe"
    ? `<tr><td>${fill(s["invoice.vat_label"]!, { pct: (Number(p.vat_rate) * 100).toFixed(0) })}</td><td class="num">${money(p.vat_agorot)}</td></tr>`
    : "";
  const taxLabel = await readString(`picker.tax_${inv.tax_status_snapshot}`).catch(() => inv.tax_status_snapshot);
  const dealer = row.picker.vat_id
    ? " · " + fill(s["invoice.vat_dealer"]!, { vat_id: row.picker.vat_id })
    : "";
  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<title>${inv.invoice_number}</title>
<style>
 body{font-family:'Heebo',Arial,sans-serif;margin:40px;color:#161616}
 h1{font-size:20px} .muted{color:#777;font-size:13px}
 table{border-collapse:collapse;width:100%;margin-top:24px}
 td,th{border:1px solid #ddd;padding:8px 12px;text-align:right}
 td.num{font-family:'JetBrains Mono',monospace;direction:ltr;text-align:left}
 .total td{font-weight:700;background:#faf7ee}
 @media print {.noprint{display:none}}
</style></head><body>
<h1>${s["invoice.title"]} · ${inv.invoice_number}</h1>
<p class="muted">${appName} · ${s["invoice.issued_note"]} · ${p.period_end}</p>
<p>${s["invoice.supplier"]}: ${row.picker.full_name ?? row.picker.phone} · ${taxLabel}${dealer}</p>
<table>
<tr><th>${s["invoice.col_item"]}</th><th>${s["invoice.col_amount"]}</th></tr>
<tr><td>${fill(s["invoice.line_pickups"]!, { units: p.total_units })}</td><td class="num">${money(p.amount_exvat_agorot)}</td></tr>
${vatLine}
<tr class="total"><td>${s["invoice.total_due"]}</td><td class="num">${money(p.total_agorot)}</td></tr>
</table>
<p class="muted noprint">${s["invoice.print_hint"]}</p>
</body></html>`;
}

Deno.serve(
  handle(async (req) => {
    const svc = serviceClient();
    const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as { batch_id?: string }) : {};

    let batchId = body.batch_id;
    if (!batchId) {
      const { data } = await svc
        .from("payout_batches").select("id").eq("status", "created")
        .order("run_at", { ascending: false }).limit(1).maybeSingle();
      batchId = (data as { id: string } | null)?.id;
    }
    if (!batchId) return json({ error: "no batch to export" }, 404);

    const { data, error } = await svc.schema("api").rpc("service_payout_batch", { p_batch_id: batchId });
    if (error) throw new HttpError(500, error.message);
    const payload = data as BatchPayload;
    if (!payload.batch) return json({ error: "batch not found" }, 404);

    const stamp = payload.batch.period_end;
    const appName = await readString("app_name");

    const upload = async (path: string, content: string, type: string) => {
      const { error: upErr } = await svc.storage
        .from("exports")
        .upload(path, new Blob([content], { type }), { upsert: true, contentType: type });
      if (upErr) throw new HttpError(500, `upload ${path}: ${upErr.message}`);
      return path;
    };

    const masavHeader = await readString("invoice.masav_header", "en");
    const csvPath = await upload(`${stamp}/payouts-${batchId}.csv`, buildCsv(payload), "text/csv; charset=utf-8");
    const masavPath = await upload(`${stamp}/masav-${batchId}.txt`, buildMasav(payload, stamp, masavHeader), "text/plain");

    const invoicePaths: Record<string, string> = {};
    for (const row of payload.payouts) {
      const html = await buildInvoiceHtml(row, appName);
      const path = `${stamp}/${row.invoice.invoice_number}.html`;
      const { error: upErr } = await svc.storage
        .from("invoices")
        .upload(path, new Blob([html], { type: "text/html" }), { upsert: true, contentType: "text/html; charset=utf-8" });
      if (upErr) throw new HttpError(500, `invoice upload: ${upErr.message}`);
      invoicePaths[row.payout.id] = path;
    }

    const { error: markErr } = await svc.schema("api").rpc("service_mark_batch_exported", {
      p_batch_id: batchId,
      p_csv_path: csvPath,
      p_masav_path: masavPath,
      p_invoice_paths: invoicePaths,
    });
    if (markErr) throw new HttpError(500, markErr.message);

    return json({ batch_id: batchId, csv: csvPath, masav: masavPath, invoices: Object.values(invoicePaths) });
  }),
);
