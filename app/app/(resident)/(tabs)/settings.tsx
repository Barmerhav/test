import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, Share, Switch, View } from "react-native";
import { LANGUAGE_ENDONYMS, LOCALES } from "@/lib/locales";
import { rpc } from "@/lib/supabase";
import type { Locale, MyStateUser } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { ConfirmButton } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { colors, radii, spacing, TAP } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

function SectionTitle({ children }: { children: string }) {
  return (
    <AppText weight="bold" size={16} style={{ marginBottom: spacing.xs }}>
      {children}
    </AppText>
  );
}

export default function SettingsScreen() {
  const str = useStr();
  const rpcErrorToast = useRpcErrorToast();
  const { myState, refresh, patchUser } = useAppState();
  const referral = useConfig("referral");

  const user = myState?.user ?? null;
  const residency = myState?.residency ?? null;
  const sub = myState?.subscription ?? null;

  const [entryCode, setEntryCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [confirmFirstBusy, setConfirmFirstBusy] = useState(false);

  const saveEntryCode = async () => {
    if (!residency || entryCode.trim().length === 0) return;
    setCodeBusy(true);
    try {
      await rpc("set_building_entry_code", {
        p_building_id: residency.building_id,
        p_entry_code: entryCode.trim(),
      });
      setEntryCode("");
      await refresh();
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setCodeBusy(false);
    }
  };

  const togglePause = async () => {
    if (!sub) return;
    setPauseBusy(true);
    try {
      await rpc(sub.status === "paused" ? "resume_subscription" : "pause_subscription");
      await refresh();
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setPauseBusy(false);
    }
  };

  const setConfirmFirst = async (value: boolean) => {
    setConfirmFirstBusy(true);
    try {
      const updated = await rpc<MyStateUser>("update_profile", {
        p_confirm_first: value,
      });
      patchUser(updated);
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setConfirmFirstBusy(false);
    }
  };

  const setLocale = async (locale: Locale) => {
    if (user?.locale === locale) return;
    try {
      const updated = await rpc<MyStateUser>("update_profile", { p_locale: locale });
      patchUser(updated); // i18n store switches immediately via provider locale
    } catch (err) {
      rpcErrorToast(err);
    }
  };

  const switchToPicker = async () => {
    setModeBusy(true);
    try {
      const updated = await rpc<MyStateUser>("update_profile", {
        p_default_mode: "picker",
      });
      patchUser(updated);
      await refresh(); // root layout redirects to the picker placeholder
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setModeBusy(false);
    }
  };

  const shareReferral = async () => {
    if (!user) return;
    const message = `${str("settings.referral_share", {
      units: referral.reward_units_each_side,
    })} ${user.referral_code}`;
    try {
      await Share.share({ message });
    } catch {
      // share sheet dismissed
    }
  };

  return (
    <Screen title={str("settings.title")}>
      <View style={{ gap: spacing.lg }}>
        {/* address & entry code */}
        {residency ? (
          <Card style={{ gap: spacing.md }}>
            <SectionTitle>{str("settings.address")}</SectionTitle>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Ionicons name="home-outline" size={18} color={colors.muted} />
              <AppText size={15} style={{ flexShrink: 1 }}>
                {residency.street}
              </AppText>
              <MonoText size={15}>{residency.house_number}</MonoText>
              <AppText size={15} color={colors.muted} style={{ flexShrink: 1 }}>
                {residency.city}
              </AppText>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <AppText size={13} color={colors.muted}>
                {str("onboarding.floor")}
              </AppText>
              <MonoText size={14}>{String(residency.floor ?? "—")}</MonoText>
              <AppText size={13} color={colors.muted}>
                {str("onboarding.apartment")}
              </AppText>
              <MonoText size={14}>{residency.apartment ?? "—"}</MonoText>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
              <Field
                label={str("onboarding.entry_code_title")}
                value={entryCode}
                onChangeText={setEntryCode}
                keyboardType="number-pad"
                mono
                style={{ flex: 1 }}
              />
              {/* two-tap confirm, icon-only (universal), ≥48px target */}
              <Pressable
                accessibilityRole="button"
                disabled={codeBusy || entryCode.trim().length === 0}
                onPress={() => void saveEntryCode()}
                style={({ pressed }) => ({
                  width: TAP + 4,
                  height: TAP + 4,
                  borderRadius: radii.chip,
                  backgroundColor:
                    entryCode.trim().length === 0 ? colors.line : colors.success,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Ionicons
                  name="checkmark"
                  size={24}
                  color={entryCode.trim().length === 0 ? colors.muted : colors.card}
                />
              </Pressable>
            </View>
            {residency.has_entry_code ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.success} />
                <AppText size={12} color={colors.success}>
                  {str("trust.title")}
                </AppText>
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* payment method — own payment_methods rows aren't RLS-exposed to the
            app yet, so show the static mock marker while a subscription exists */}
        {sub ? (
          <Card style={{ gap: spacing.sm }}>
            <SectionTitle>{str("settings.payment")}</SectionTitle>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Ionicons name="card-outline" size={20} color={colors.muted} />
              <MonoText size={16}>mock ••••</MonoText>
            </View>
          </Card>
        ) : null}

        {/* referral */}
        {user ? (
          <Card style={{ gap: spacing.sm, alignItems: "center" }}>
            <SectionTitle>{str("settings.referral")}</SectionTitle>
            <MonoText bold size={30} center>
              {user.referral_code}
            </MonoText>
            <AppText size={13} color={colors.muted} center>
              {str("settings.referral_share", {
                units: referral.reward_units_each_side,
              })}
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => void shareReferral()}
              style={({ pressed }) => ({
                minHeight: TAP,
                minWidth: TAP * 2,
                borderRadius: TAP / 2,
                backgroundColor: colors.ink,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: spacing.lg,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="share-social-outline" size={22} color={colors.card} />
            </Pressable>
          </Card>
        ) : null}

        {/* pause / resume */}
        {sub ? (
          <Card style={{ gap: spacing.sm }}>
            <ConfirmButton
              label={str(sub.status === "paused" ? "settings.resume" : "settings.pause")}
              kind={sub.status === "paused" ? "success" : "danger"}
              onPress={() => void togglePause()}
              loading={pauseBusy}
            />
          </Card>
        ) : null}

        {/* confirm-first */}
        {user ? (
          <Card style={{ gap: spacing.sm }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: spacing.sm,
              }}
            >
              <AppText weight="medium" size={15} style={{ flexShrink: 1 }}>
                {str("settings.confirm_first")}
              </AppText>
              <Switch
                value={user.confirm_first}
                disabled={confirmFirstBusy}
                onValueChange={(v) => void setConfirmFirst(v)}
                trackColor={{ false: colors.line, true: colors.success }}
                thumbColor={colors.card}
              />
            </View>
            <AppText size={12} color={colors.muted}>
              {str("settings.confirm_first_hint")}
            </AppText>
          </Card>
        ) : null}

        {/* language */}
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>{str("settings.language")}</SectionTitle>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {LOCALES.map((locale) => (
              <Chip
                key={locale}
                label={LANGUAGE_ENDONYMS[locale]}
                selected={(user?.locale ?? "he") === locale}
                onPress={() => void setLocale(locale)}
                style={{ flex: 1 }}
              />
            ))}
          </View>
        </Card>

        {/* mode switch */}
        <Card>
          <ConfirmButton
            label={str("settings.switch_mode")}
            kind="primary"
            onPress={() => void switchToPicker()}
            loading={modeBusy}
          />
        </Card>
      </View>
    </Screen>
  );
}
