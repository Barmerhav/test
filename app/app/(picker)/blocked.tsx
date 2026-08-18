import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { routeForState } from "@/lib/routing";
import { rpc } from "@/lib/supabase";
import type { MyStateUser } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { PButton, PScreen } from "@/ui/PickerUI";
import { pickerColors as pc, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

/** Suspended (strikes) or rejected pickers land here. */
export default function PickerBlocked() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { myState, refresh, patchUser } = useAppState();
  const maxStrikes = useConfig("strikes_to_suspend");
  const [busy, setBusy] = useState(false);

  const picker = myState?.picker ?? null;
  const suspended = picker?.status === "suspended";

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
        <Ionicons name="hand-left-outline" size={64} color={pc.danger} />
        <AppText weight="medium" size={17} color={pc.text} center>
          {suspended ? str("error.picker_suspended") : str("picker.rejected")}
        </AppText>
        {suspended && picker ? (
          <AppText size={15} color={pc.muted} center>
            {str("earnings.strikes", { count: picker.strikes, max: maxStrikes })}
          </AppText>
        ) : null}
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
