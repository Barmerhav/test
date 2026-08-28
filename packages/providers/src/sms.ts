/**
 * SmsProvider — behind Supabase Auth's "Send SMS" hook. The hook edge
 * function delegates OTP delivery here; a real Israeli gateway (019 / InforU /
 * Twilio) drops in without touching auth flow or call sites.
 */

export interface SmsProvider {
  name: string;
  send(input: { phone: string; body: string }): Promise<{ messageId: string }>;
}

export interface SentSms {
  phone: string;
  body: string;
  sentAt: string;
}

/**
 * Mock SMS: records messages via the sink callback (the sms-hook function
 * writes them to the local `mock_sms_log` table so the e2e script and local
 * dev can read OTPs).
 */
export function createMockSmsProvider(
  sink: (sms: SentSms) => Promise<void>,
): SmsProvider {
  return {
    name: "mock",
    async send({ phone, body }) {
      await sink({ phone, body, sentAt: new Date().toISOString() });
      return { messageId: `mock_sms_${crypto.randomUUID()}` };
    },
  };
}
