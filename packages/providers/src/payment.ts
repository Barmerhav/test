/**
 * PaymentProvider — the seam between business logic and any Israeli PSP
 * (PayPlus / Cardcom / Tranzila). The mock implements the SAME async contract
 * the real PSPs use: `chargeToken` never settles synchronously; settlement
 * always arrives as a webhook at the `payments-webhook` edge function, which
 * calls `internal.settle_charge`. Call sites never change when the adapter does.
 *
 * Adapter selection is by the `payment_provider` config key, resolved inside
 * edge functions (where secrets live).
 */

export type ChargeStatus = "pending" | "settled" | "failed";

export interface TokenizationSession {
  /** Hosted-fields / redirect URL the app opens to capture the card */
  redirectUrl: string;
  sessionId: string;
}

export interface ChargeResult {
  providerChargeId: string;
  status: ChargeStatus; // mock + real PSPs: always "pending" here
}

export interface RefundResult {
  providerRefundId: string;
  status: ChargeStatus;
}

export interface PaymentEvent {
  type: "charge.settled" | "charge.failed" | "refund.settled" | "refund.failed";
  providerChargeId: string;
  providerRefundId?: string;
  raw: unknown;
}

export interface PaymentProvider {
  name: string;
  createTokenizationSession(input: {
    userId: string;
    returnUrl: string;
  }): Promise<TokenizationSession>;
  chargeToken(input: {
    token: string;
    amountAgorot: number;
    currency: "ILS";
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<ChargeResult>;
  refund(input: {
    providerChargeId: string;
    amountAgorot: number;
    idempotencyKey: string;
  }): Promise<RefundResult>;
  /** Verify + parse an incoming webhook request. Throws on bad signature. */
  verifyWebhook(req: Request): Promise<PaymentEvent>;
}

export interface MockPaymentOptions {
  /** Where the simulated webhook is POSTed (the payments-webhook function). */
  webhookUrl: string;
  /** Shared secret echoed in the x-mock-signature header. */
  webhookSecret: string;
  /** From the mock_payment config key. */
  settleDelaySeconds: number;
  outcome: "settle" | "fail";
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Sandbox PSP. Tokenization "succeeds" immediately with a fake token;
 * charges/refunds return pending and later POST a signed webhook back,
 * exercising the exact async path a real PSP will use.
 */
export function createMockPaymentProvider(opts: MockPaymentOptions): PaymentProvider {
  const doFetch = opts.fetchImpl ?? fetch;

  async function emitWebhook(event: PaymentEvent) {
    const fire = async () => {
      await doFetch(opts.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mock-signature": opts.webhookSecret,
        },
        body: JSON.stringify(event),
      });
    };
    if (opts.settleDelaySeconds <= 0) {
      await fire();
    } else {
      setTimeout(() => {
        void fire().catch((e) => console.error("mock webhook delivery failed", e));
      }, opts.settleDelaySeconds * 1000);
    }
  }

  return {
    name: "mock",

    async createTokenizationSession({ userId }) {
      const sessionId = `mock_sess_${crypto.randomUUID()}`;
      return {
        sessionId,
        // The app treats this specially in mock mode: no browser hop, the
        // "card form" resolves instantly to token mock_tok_<sessionId>.
        redirectUrl: `pinui://mock-psp/tokenize?session=${sessionId}&user=${userId}`,
      };
    },

    async chargeToken({ idempotencyKey }) {
      const providerChargeId = `mock_ch_${idempotencyKey}`;
      await emitWebhook({
        type: opts.outcome === "settle" ? "charge.settled" : "charge.failed",
        providerChargeId,
        raw: { mock: true },
      });
      return { providerChargeId, status: "pending" };
    },

    async refund({ providerChargeId, idempotencyKey }) {
      const providerRefundId = `mock_re_${idempotencyKey}`;
      await emitWebhook({
        type: "refund.settled",
        providerChargeId,
        providerRefundId,
        raw: { mock: true },
      });
      return { providerRefundId, status: "pending" };
    },

    async verifyWebhook(req) {
      if (req.headers.get("x-mock-signature") !== opts.webhookSecret) {
        throw new Error("bad mock webhook signature");
      }
      return (await req.json()) as PaymentEvent;
    },
  };
}
