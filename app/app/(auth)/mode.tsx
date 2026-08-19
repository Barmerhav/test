import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { routeForState } from "@/lib/routing";
import { rpc } from "@/lib/supabase";
import type { MyStateUser, UserMode } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { Pressy } from "@/ui/Pressy";
import { Screen } from "@/ui/Screen";
import { colors, radii, shadow, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

export default function ModeScreen() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh, patchUser } = useAppState();
  const [busy, setBusy] = useState<UserMode | null>(null);

  const choose = async (mode: UserMode) => {
    setBusy(mode);
    try {
      const user = await rpc<MyStateUser>("update_profile", {
        p_default_mode: mode,
      });
      patchUser(user);
      const st = await refresh();
      if (st) router.replace(routeForState(st).href);
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setBusy(null);
    }
  };

  const cards: { mode: UserMode; icon: "home-outline" | "walk-outline"; label: string }[] = [
    { mode: "resident", icon: "home-outline", label: str("auth.mode_resident") },
    { mode: "picker", icon: "walk-outline", label: str("auth.mode_picker") },
  ];

  return (
    <Screen title={str("auth.mode_title")}>
      <View style={{ gap: spacing.lg }}>
        {cards.map((card) => (
          <Pressy
            key={card.mode}
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() => void choose(card.mode)}
            haptic="medium"
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.cardBig,
              borderWidth: 1.5,
              borderColor: busy === card.mode ? colors.green : colors.lineSoft,
              padding: spacing.xl,
              alignItems: "center",
              gap: spacing.md,
              ...shadow,
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 99,
                backgroundColor: colors.mint,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name={card.icon} size={30} color={colors.greenDeep} />
            </View>
            <AppText weight="heavy" size={16.5} center style={{ lineHeight: 24 }}>
              {card.label}
            </AppText>
          </Pressy>
        ))}
      </View>
    </Screen>
  );
}
