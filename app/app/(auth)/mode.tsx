import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { routeForState } from "@/lib/routing";
import { rpc } from "@/lib/supabase";
import type { MyStateUser, UserMode } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
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
          <Pressable
            key={card.mode}
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() => void choose(card.mode)}
            style={({ pressed }) => ({
              backgroundColor: colors.card,
              borderRadius: radii.card,
              borderWidth: 1,
              borderColor: pressed || busy === card.mode ? colors.accent : colors.line,
              padding: spacing.xl,
              alignItems: "center",
              gap: spacing.md,
              opacity: pressed ? 0.9 : 1,
              ...shadow,
            })}
          >
            <Ionicons name={card.icon} size={44} color={colors.ink} />
            <AppText weight="bold" size={18} center>
              {card.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
