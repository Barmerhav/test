import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { LANGUAGE_ENDONYMS, LOCALES } from "@/lib/locales";
import { routeForState } from "@/lib/routing";
import { rpc } from "@/lib/supabase";
import type { Locale, MyStateUser } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { PAvailabilityPill, PCard, PChip, PConfirmButton, PScreen } from "@/ui/PickerUI";
import { pickerColors as pc, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

/** Profile tab: availability, strikes, language, mode switch, sign out. */
export default function PickerProfile() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { myState, refresh, patchUser, patchPicker, signOut } = useAppState();
  const maxStrikes = useConfig("strikes_to_suspend");
  const [modeBusy, setModeBusy] = useState(false);

  const user = myState?.user ?? null;
  const picker = myState?.picker ?? null;
  const available = picker?.available ?? false;
  const strikes = picker?.strikes ?? 0;

  const toggleAvailability = async (value: boolean) => {
    patchPicker({ available: value }); // optimistic
    try {
      await rpc("set_picker_availability", { p_available: value });
    } catch (err) {
      patchPicker({ available: !value });
      rpcErrorToast(err);
    }
  };

  const setLocale = async (locale: Locale) => {
    if (user?.locale === locale) return;
    try {
      const updated = await rpc<MyStateUser>("update_profile", { p_locale: locale });
      patchUser(updated);
    } catch (err) {
      rpcErrorToast(err);
    }
  };

  const backToResident = async () => {
    setModeBusy(true);
    try {
      const updated = await rpc<MyStateUser>("update_profile", {
        p_default_mode: "resident",
      });
      patchUser(updated);
      const st = await refresh();
      if (st) router.replace(routeForState(st).href);
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setModeBusy(false);
    }
  };

  return (
    <PScreen title={str("profile.tab")}>
      <View style={{ gap: spacing.md }}>
        {/* availability */}
        <PCard
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.sm,
          }}
        >
          <MonoText weight="bold" size={14} color={pc.text} numberOfLines={1} style={{ flexShrink: 1 }}>
            {user?.phone ?? ""}
          </MonoText>
          <PAvailabilityPill
            label={str("feed.available_toggle")}
            on={available}
            onToggle={(v) => void toggleAvailability(v)}
          />
        </PCard>

        {/* strikes */}
        <PCard style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Ionicons
            name="warning-outline"
            size={19}
            color={strikes > 0 ? pc.danger : pc.faint}
          />
          <AppText size={13.5} color={strikes > 0 ? pc.danger : pc.muted} style={{ flex: 1 }}>
            {str("earnings.strikes", { count: strikes, max: maxStrikes })}
          </AppText>
        </PCard>

        {/* language */}
        <PCard style={{ gap: spacing.sm }}>
          <AppText weight="heavy" size={15} color={pc.text}>
            {str("settings.language")}
          </AppText>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {LOCALES.map((locale) => (
              <PChip
                key={locale}
                label={LANGUAGE_ENDONYMS[locale]}
                selected={(user?.locale ?? "he") === locale}
                onPress={() => void setLocale(locale)}
                style={{ flex: 1 }}
              />
            ))}
          </View>
        </PCard>

        {/* switch back + sign out */}
        <PCard style={{ gap: spacing.sm }}>
          <PConfirmButton
            label={str("settings.switch_mode_resident")}
            kind="green"
            onPress={() => void backToResident()}
            loading={modeBusy}
          />
          <PConfirmButton
            label={str("settings.sign_out")}
            kind="danger"
            onPress={() => void signOut()}
          />
        </PCard>
      </View>
    </PScreen>
  );
}
