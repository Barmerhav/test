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
import { Sheet } from "@/ui/Sheet";
import { colors, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";
import { useRpcErrorToast, useToast } from "@/ui/Toast";
import { stringsKeyForError } from "@pinui/shared";

export interface PaymentSheetProps {
  visible: boolean;
  subscriptionId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Mock-mode card sheet: pretends to collect a card (accepts anything after
 * ~1s), then tokenize → attach_payment_method → charge → poll until active.
 * When a real PSP lands this swaps for its hosted fields, same flow.
 */
export function PaymentSheet({
  visible,
  subscriptionId,
  onClose,
  onSuccess,
}: PaymentSheetProps) {
  const str = useStr();
  const { refresh } = useAppState();
  const { show } = useToast();
  const rpcErrorToast = useRpcErrorToast();
  // Card fields are cosmetic in mock mode — masks, not user-facing copy.
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [processing, setProcessing] = useState(false);

  const pay = async () => {
    if (!subscriptionId) return;
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
      await payForSubscription(subscriptionId);
      const active = await waitForSubscriptionActive();
      await refresh();
      if (active) {
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
          <ActivityIndicator size="large" color={colors.success} />
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
          <Button label={str("plan.pay_cta")} onPress={() => void pay()} />
        </View>
      )}
    </Sheet>
  );
}
