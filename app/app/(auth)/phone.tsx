import { useRouter } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { isCompleteILPhone, normalizeILPhone } from "@/lib/phone";
import { supabase } from "@/lib/supabase";
import { useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { spacing } from "@/ui/theme";
import { useRpcErrorToast } from "@/ui/Toast";

export default function PhoneScreen() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  const sendOtp = async () => {
    const normalized = normalizeILPhone(phone);
    if (!normalized) return;
    setSending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
      if (error) throw error;
      router.push({ pathname: "/(auth)/otp", params: { phone: normalized } });
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen title={str("auth.phone_title")}>
        <View style={{ gap: spacing.lg }}>
          <Field
            label={str("auth.phone_title")}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            mono
            placeholder="050-0000000"
            maxLength={14}
            autoFocus
          />
          <Button
            // NOTE: 'auth.send_cta' is not in the seed yet — until the strings
            // workstream adds it, str() renders the '!key' missing marker.
            label={str("auth.send_cta")}
            onPress={() => void sendOtp()}
            disabled={!isCompleteILPhone(phone)}
            loading={sending}
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
