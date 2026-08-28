import React, { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import {
  payForSubscription,
  tokenizeCard,
  waitForSubscriptionActive,
} from "@/lib/payments";
import { rpc } from "@/lib/supabase";
import { useAppState, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { fireHaptic } from "@/ui/Pressy";
import { Sheet } from "@/ui/Sheet";
import { colors, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";
import { useRpcErrorToast, useToast } from "@/ui/Toast";
import { formatILS, stringsKeyForError } from "@pinui/shared";

export interface PaymentSheetProps {
  visible: boolean;
  subscriptionId: string | null;
  /** price being paid (drives the CTA label) */
  priceAgorot: number | null;
  onClose: () => void;
  onSuccess: () => void;
  /**
   * Custom charge flow (e.g. one-off on-demand pickup): runs after
   * tokenize + attach_payment_method instead of the subscription charge;
   * resolves true on confirmed success. When set, subscriptionId is unused.
   */
  charge?: () => Promise<boolean>;
}

/**
 * Mock-mode card sheet: pretends to collect a card (accepts anything after
 * ~1s), then tokenize → attach_payment_method → charge → poll until active.
 * When a real PSP lands this swaps for its hosted fields, same flow.
 */
export function PaymentSheet({
  visible,
  subscriptionId,
  priceAgorot,
  onClose,
  onSuccess,
  charge,
}: PaymentSheetProps) {
  const str = useStr();
  const { refresh, myState } = useAppState();
  // fall back to the pending subscription's plan price on recovery flows
  const effectivePrice = priceAgorot ?? myState?.subscription?.plan.price_agorot ?? null;
  const { show } = useToast();
  const rpcErrorToast = useRpcErrorToast();
  // Card fields are cosmetic in mock mode — masks, not user-facing copy.
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [processing, setProcessing] = useState(false);

  const pay = async () => {
    if (!charge && !subscriptionId) return;
    setProcessing(true);
    try {
      // pretend the form is being validated/collected by the PSP
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const card = await tokenizeCard();
      await rpc<string>("attach_payment_method", {
        p_provider: "mock",
        p_token: card.token,
        p_brand: card.brand,
        p_last4: card.last4,
      });
      let ok: boolean;
      if (charge) {
        ok = await charge();
      } else {
        await payForSubscription(subscriptionId as string);
        ok = await waitForSubscriptionActive();
      }
      await refresh();
      if (ok) {
        void fireHaptic("success");
        onSuccess();
      } else {
        show(str(stringsKeyForError("unknown")), "error");
      }
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={processing ? () => undefined : onClose}>
      <AppText weight="bold" size={20}>
        {str("settings.payment")}
      </AppText>
      {processing ? (
        <View style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.md }}>
          <ActivityIndicator size="large" color={colors.green} />
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          <Field
            // card-number mask — numeric format hint, not translatable copy
            label="• • • •"
            value={cardNumber}
            onChangeText={setCardNumber}
            keyboardType="number-pad"
            mono
            placeholder="0000 0000 0000 0000"
            maxLength={19}
          />
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <Field
              label="MM/YY"
              value={expiry}
              onChangeText={setExpiry}
              keyboardType="number-pad"
              mono
              placeholder="MM/YY"
              maxLength={5}
              style={{ flex: 1 }}
            />
            <Field
              label="CVV"
              value={cvv}
              onChangeText={setCvv}
              keyboardType="number-pad"
              mono
              placeholder="CVV"
              maxLength={4}
              style={{ flex: 1 }}
            />
          </View>
          <Button
            label={str("plan.pay_cta", {
              price: effectivePrice !== null ? formatILS(effectivePrice) : "—",
            })}
            onPress={() => void pay()}
            haptic="medium"
          />
        </View>
      )}
    </Sheet>
  );
}
