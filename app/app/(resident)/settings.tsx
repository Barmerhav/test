import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Share, Switch, View } from "react-native";
import { LANGUAGE_ENDONYMS, LOCALES } from "@/lib/locales";
import { rpc, supabase } from "@/lib/supabase";
import type { Locale, MyStateUser } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { ConfirmButton } from "@/ui/Button";
import { Card, Divider } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/Field";
import { Pressy } from "@/ui/Pressy";
import { Screen } from "@/ui/Screen";
import { colors, radii, spacing, TAP } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

interface PaymentMethodRow {
  brand: string | null;
  last4: string | null;
}

function Row({
  title,
  note,
  end,
  children,
}: {
  title: string;
  note?: string;
  end?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ gap: spacing.sm, paddingVertical: 6 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.sm,
          minHeight: 30,
        }}
      >
        <View style={{ flexShrink: 1, gap: 1 }}>
          <AppText weight="bold" size={14.5}>
            {title}
          </AppText>
          {note !== undefined ? (
            <AppText size={11.5} color={colors.muted}>
              {note}
            </AppText>
          ) : null}
        </View>
        {end}
      </View>
      {children}
    </View>
  );
}

/** Settings per artboard 08 — the full rows list, opened from the HOME gear. */
export default function SettingsScreen() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { myState, refresh, patchUser, signOut } = useAppState();
  const referral = useConfig("referral");

  const user = myState?.user ?? null;
  const residency = myState?.residency ?? null;
  const sub = myState?.subscription ?? null;

  const [entryCode, setEntryCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [confirmFirstBusy, setConfirmFirstBusy] = useState(false);
  const [payment, setPayment] = useState<PaymentMethodRow | null>(null);

  // payment method row — RLS-readable own payment_methods
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("brand,last4")
        .eq("status", "active")
        .limit(1);
      const row = (data as PaymentMethodRow[] | null)?.[0];
      if (alive && !error && row) setPayment(row);
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

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
      await refresh(); // root layout redirects into the picker flow
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setModeBusy(false);
    }
  };

  const shareReferral = async () => {
    if (!user) return;
    try {
      await Share.share({
        message: `${str("settings.referral_share", {
          units: referral.reward_units_each_side,
        })} ${user.referral_code}`,
      });
    } catch {
      // share sheet dismissed
    }
  };

  return (
    <Screen
      title={str("settings.title")}
      headerEnd={
        <Pressy
          accessibilityRole="button"
          onPress={() => router.back()}
          haptic="light"
          hitSlop={8}
          style={{
            width: 38,
            height: 38,
            borderRadius: 99,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.lineSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="close" size={19} color={colors.text2} />
        </Pressy>
      }
    >
      <View style={{ gap: spacing.md }}>
        <Card big style={{ paddingVertical: 12 }}>
          {/* address */}
          {residency ? (
            <Row
              title={str("settings.address")}
              end={
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <AppText size={13} color={colors.text2} numberOfLines={1}>
                    {residency.street}
                  </AppText>
                  <MonoText size={13} color={colors.text2}>
                    {residency.house_number}
                  </MonoText>
                </View>
              }
            />
          ) : null}
          <Divider />
          {/* building entry code */}
          {residency ? (
            <Row title={str("settings.entry_code")} note={str("settings.entry_code_note")}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Field
                  value={entryCode}
                  onChangeText={setEntryCode}
                  keyboardType="number-pad"
                  mono
                  style={{ flex: 1 }}
                />
                <Pressy
                  accessibilityRole="button"
                  disabled={codeBusy || entryCode.trim().length === 0}
                  onPress={() => void saveEntryCode()}
                  haptic="medium"
                  style={{
                    width: TAP + 4,
                    height: TAP + 4,
                    borderRadius: radii.field,
                    backgroundColor:
                      entryCode.trim().length === 0 ? colors.surface : colors.green,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name="checkmark"
                    size={24}
                    color={entryCode.trim().length === 0 ? colors.faint : colors.onGreen}
                  />
                </Pressy>
              </View>
            </Row>
          ) : null}
          <Divider />
          {/* payment method */}
          <Row
            title={str("settings.payment")}
            end={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="card-outline" size={17} color={colors.muted} />
                <MonoText weight="bold" size={13.5} color={colors.text2}>
                  {payment ? `${payment.brand ?? ""} ••••${payment.last4 ?? ""}` : "—"}
                </MonoText>
              </View>
            }
          />
          <Divider />
          {/* invite code */}
          {user ? (
            <Row
              title={str("settings.referral")}
              end={
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <MonoText weight="heavy" size={15} style={{ letterSpacing: 1 }}>
                    {user.referral_code}
                  </MonoText>
                  <Pressy
                    accessibilityRole="button"
                    onPress={() => void shareReferral()}
                    haptic="light"
                    hitSlop={8}
                    style={{
                      minHeight: 34,
                      borderRadius: radii.pill,
                      backgroundColor: colors.ink,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 14,
                    }}
                  >
                    <AppText weight="bold" size={12} color={colors.card}>
                      {str("settings.share_cta")}
                    </AppText>
                  </Pressy>
                </View>
              }
            />
          ) : null}
          <Divider />
          {/* language */}
          <Row title={str("settings.language")} note={str("settings.language_note")}>
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
          </Row>
        </Card>

        {/* vacation mode */}
        {sub ? (
          <Card style={{ gap: spacing.xs }}>
            <Row title={str("settings.pause")} note={str("settings.pause_note")} />
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
          <Card style={{ gap: spacing.xs }}>
            <Row
              title={str("settings.confirm_first")}
              end={
                <Switch
                  value={user.confirm_first}
                  disabled={confirmFirstBusy}
                  onValueChange={(v) => void setConfirmFirst(v)}
                  trackColor={{ false: colors.line, true: colors.green }}
                  thumbColor={colors.card}
                />
              }
            />
            <AppText size={11.5} color={colors.muted} style={{ lineHeight: 17 }}>
              {str("settings.confirm_first_hint")}
            </AppText>
          </Card>
        ) : null}

        {/* mode switch + sign out */}
        <Card style={{ gap: spacing.sm }}>
          <ConfirmButton
            label={str("settings.switch_mode")}
            kind="primary"
            onPress={() => void switchToPicker()}
            loading={modeBusy}
          />
          <ConfirmButton
            label={str("settings.sign_out")}
            kind="danger"
            onPress={() => void signOut()}
          />
        </Card>
      </View>
    </Screen>
  );
}
