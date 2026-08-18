/**
 * sms-hook — target of Supabase Auth's "Send SMS" hook. Delegates delivery to
 * the SmsProvider adapter (mock locally: writes to mock_sms_log so dev/e2e can
 * read OTPs; a real Israeli gateway — 019/InforU — drops in without touching
 * auth flow). Also the choke point for anti-SMS-pumping counters.
 */
import { createMockSmsProvider } from "@pinui/providers/sms";
import { handle, json, readString, serviceClient } from "../_shared/env.ts";

const HOOK_SECRET = Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "";

async function verifyStandardWebhook(req: Request, rawBody: string): Promise<void> {
  if (!HOOK_SECRET) return; // local dev: unsigned
  const secret = HOOK_SECRET.replace(/^v1,whsec_/, "").replace(/^whsec_/, "");
  const id = req.headers.get("webhook-id") ?? "";
  const ts = req.headers.get("webhook-timestamp") ?? "";
  const sig = req.headers.get("webhook-signature") ?? "";
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  const provided = sig.split(" ").map((s) => s.split(",")[1] ?? s);
  if (!provided.includes(expected)) throw new Error("bad hook signature");
}

Deno.serve(
  handle(async (req) => {
    const raw = await req.text();
    await verifyStandardWebhook(req, raw);
    const payload = JSON.parse(raw) as { user?: { phone?: string }; sms?: { otp?: string } };

    const phone = payload.user?.phone ?? "";
    const otp = payload.sms?.otp ?? "";
    if (!phone || !otp) return json({ error: "bad payload" }, 400);

    // basic anti-pumping: Israeli numbers only (config-tunable gateway later)
    if (!/^9725\d{8}$/.test(phone.replace(/^\+/, ""))) {
      console.warn("sms-hook: refused non-IL phone");
      return json({ error: "unsupported region" }, 400);
    }

    const template = await readString("sms.otp_body");
    const body = template.replace("{otp}", otp);

    const svc = serviceClient();
    const sms = createMockSmsProvider(async (m) => {
      await svc.schema("api").rpc("service_log_sms", { p_phone: m.phone, p_body: m.body });
    });
    await sms.send({ phone, body });

    return json({});
  }),
);
