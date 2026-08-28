import { useRouter } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { isCompleteILPhone, normalizeILPhone } from "@/lib/phone";
import { supabase } from "@/lib/supabase";
import { useStr } from "@/state/AppState";
import { Brand } from "@/ui/Brand";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { colors, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

/** Phone entry per artboard 01a: brand, hook line, +972 prefix input. */
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
      <Screen>
        <View style={{ gap: spacing.xl, paddingTop: spacing.xl }}>
          <Brand size={30} />
          <AppText weight="heavy" size={24} style={{ lineHeight: 33 }}>
            {str("auth.phone_title")}
          </AppText>
          <View style={{ gap: spacing.lg }}>
            <Field
              label={str("auth.phone_label")}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              mono
              prefix="+972"
              placeholder="50-000-0000"
              maxLength={14}
              autoFocus
            />
            <Button
              label={str("auth.send_cta")}
              onPress={() => void sendOtp()}
              disabled={!isCompleteILPhone(phone)}
              loading={sending}
              haptic="medium"
            />
            <AppText size={11.5} color={colors.muted} center>
              {str("auth.terms_note")}
            </AppText>
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
