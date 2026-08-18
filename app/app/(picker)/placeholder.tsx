import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { routeForState } from "@/lib/routing";
import { rpc } from "@/lib/supabase";
import type { MyStateUser } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { colors, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

/** Picker mode arrives in the next build — slice 3 owns everything here. */
export default function PickerPlaceholder() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh, patchUser } = useAppState();
  const [busy, setBusy] = useState(false);

  const backToResident = async () => {
    setBusy(true);
    try {
      const user = await rpc<MyStateUser>("update_profile", {
        p_default_mode: "resident",
      });
      patchUser(user);
      const st = await refresh();
      if (st) router.replace(routeForState(st).href);
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false} contentStyle={{ justifyContent: "center" }}>
      <View style={{ alignItems: "center", gap: spacing.lg }}>
        <Ionicons name="walk-outline" size={64} color={colors.muted} />
        <AppText weight="medium" size={17} color={colors.muted} center>
          {str("picker.coming_soon")}
        </AppText>
        <Button
          label={str("settings.switch_mode_resident")}
          onPress={() => void backToResident()}
          loading={busy}
          kind="ghost"
          compact
        />
      </View>
    </Screen>
  );
}
