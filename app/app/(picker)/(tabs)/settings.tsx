import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Switch, View } from "react-native";
import { LANGUAGE_ENDONYMS, LOCALES } from "@/lib/locales";
import { routeForState } from "@/lib/routing";
import { rpc } from "@/lib/supabase";
import type { Locale, MyStateUser } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { PCard, PChip, PConfirmButton, PScreen } from "@/ui/PickerUI";
import { pickerColors as pc, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

/** Settings-lite for picker mode: availability, language, switch back. */
export default function PickerSettings() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { myState, refresh, patchUser, patchPicker } = useAppState();
  const [modeBusy, setModeBusy] = useState(false);

  const user = myState?.user ?? null;
  const available = myState?.picker?.available ?? false;

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
    <PScreen title={str("settings.title")}>
      <View style={{ gap: spacing.lg }}>
        {/* availability */}
        <PCard
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.sm,
          }}
        >
          <AppText weight="medium" size={15} color={pc.text} style={{ flexShrink: 1 }}>
            {str("feed.available_toggle")}
          </AppText>
          <Switch
            value={available}
            onValueChange={(v) => void toggleAvailability(v)}
            trackColor={{ false: pc.line, true: pc.success }}
            thumbColor={pc.paper}
          />
        </PCard>

        {/* language */}
        <PCard style={{ gap: spacing.sm }}>
          <AppText weight="bold" size={16} color={pc.text}>
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

        {/* back to resident mode */}
        <PCard>
          <PConfirmButton
            label={str("settings.switch_mode_resident")}
            kind="amber"
            onPress={() => void backToResident()}
            loading={modeBusy}
          />
        </PCard>
      </View>
    </PScreen>
  );
}
