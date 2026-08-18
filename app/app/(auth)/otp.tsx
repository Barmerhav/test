import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { routeForState } from "@/lib/routing";
import { supabase } from "@/lib/supabase";
import { useAppState, useStr } from "@/state/AppState";
import { Screen } from "@/ui/Screen";
import { colors, fonts, radii, spacing, TAP } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

export default function OtpScreen() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh } = useAppState();
  const params = useLocalSearchParams<{ phone?: string }>();
  const phone = typeof params.phone === "string" ? params.phone : "";

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setResendIn((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const verify = async (token: string) => {
    if (verifying) return;
    setVerifying(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: "sms",
      });
      if (error) throw error;
      const st = await refresh();
      if (st && (st.residency || st.subscription)) {
        // Returning user — straight to wherever their state points.
        router.replace(routeForState(st).href);
      } else {
        router.replace("/(auth)/mode");
      }
    } catch (err) {
      setCode("");
      rpcErrorToast(err);
    } finally {
      setVerifying(false);
    }
  };

  const onChange = (t: string) => {
    const digits = t.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setCode(digits);
    if (digits.length === OTP_LENGTH) void verify(digits);
  };

  const resend = async () => {
    setResendIn(RESEND_SECONDS);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) throw error;
    } catch (err) {
      rpcErrorToast(err);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen title={str("auth.otp_title")}>
        <Pressable onPress={() => inputRef.current?.focus()}>
          {/* 6 visual digit boxes, LTR order (digits are LTR even in Hebrew UI) */}
          <View
            style={{
              flexDirection: "row",
              gap: spacing.sm,
              justifyContent: "center",
              direction: "ltr",
            }}
          >
            {Array.from({ length: OTP_LENGTH }).map((_, i) => {
              const filled = i < code.length;
              const active = i === code.length;
              return (
                <View
                  key={i}
                  style={{
                    width: TAP,
                    height: TAP + 10,
                    borderRadius: radii.chip,
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? colors.accent : colors.line,
                    backgroundColor: colors.card,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MonoText bold size={24}>
                    {filled ? code[i] : ""}
                  </MonoText>
                </View>
              );
            })}
          </View>
        </Pressable>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          autoFocus
          caretHidden
          style={{
            position: "absolute",
            opacity: 0,
            height: 1,
            width: 1,
            fontFamily: fonts.mono,
          }}
        />
        <View style={{ alignItems: "center", marginTop: spacing.xl }}>
          {resendIn > 0 ? (
            <MonoText size={16} color={colors.muted} center>
              {`00:${String(resendIn).padStart(2, "0")}`}
            </MonoText>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => void resend()}
              style={{ minHeight: TAP, justifyContent: "center" }}
            >
              <AppText weight="medium" size={16} color={colors.success}>
                {str("auth.otp_resend")}
              </AppText>
            </Pressable>
          )}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
