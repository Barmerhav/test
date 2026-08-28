import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { routeForState } from "@/lib/routing";
import { rpc } from "@/lib/supabase";
import type { MyStateUser } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { PButton, PScreen } from "@/ui/PickerUI";
import { pickerColors as pc, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

/** Waiting for admin verification. */
export default function PickerPending() {
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
    <PScreen scroll={false} contentStyle={{ justifyContent: "center" }}>
      <View style={{ alignItems: "center", gap: spacing.lg }}>
        <Ionicons name="hourglass-outline" size={64} color={pc.money} />
        <AppText weight="medium" size={17} color={pc.text} center>
          {str("picker.pending_verification")}
        </AppText>
        <PButton
          label={str("settings.switch_mode_resident")}
          kind="ghost"
          onPress={() => void backToResident()}
          loading={busy}
        />
      </View>
    </PScreen>
  );
}
