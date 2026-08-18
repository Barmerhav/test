/**
 * PushProvider — drained from notification_outbox by the notify-worker edge
 * function. Templates are resolved against the `strings` table AT SEND TIME,
 * so push copy is admin-editable. Payloads NEVER contain entry codes or
 * apartment-level addresses.
 */

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushProvider {
  name: string;
  send(msg: PushMessage): Promise<{ delivered: number }>;
}

/** Expo Push Service adapter — the correct default for an Expo app. */
export function createExpoPushProvider(fetchImpl: typeof fetch = fetch): PushProvider {
  return {
    name: "expo",
    async send({ tokens, title, body, data }) {
      if (tokens.length === 0) return { delivered: 0 };
      const messages = tokens.map((to) => ({ to, title, body, data, sound: "default" }));
      const res = await fetchImpl("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(messages),
      });
      if (!res.ok) throw new Error(`expo push failed: ${res.status}`);
      return { delivered: tokens.length };
    },
  };
}

/** Mock push for tests/local: collects messages in memory. */
export function createMockPushProvider(): PushProvider & { sent: PushMessage[] } {
  const sent: PushMessage[] = [];
  return {
    name: "mock",
    sent,
    async send(msg) {
      sent.push(msg);
      return { delivered: msg.tokens.length };
    },
  };
}
