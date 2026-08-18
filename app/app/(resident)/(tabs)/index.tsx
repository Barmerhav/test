import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, View } from "react-native";
import { ACTIVE_FOR_RESIDENT } from "@pinui/shared";
import { ActiveRequestCard } from "@/components/ActiveRequestCard";
import { AllowanceRing } from "@/components/AllowanceRing";
import { useAppState, useStr } from "@/state/AppState";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { colors, shadow, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";

const BIG_BUTTON_SIZE = 220;

export default function HomeScreen() {
  const str = useStr();
  const router = useRouter();
  const { myState, activeRequest } = useAppState();

  const sub = myState?.subscription ?? null;
  const residency = myState?.residency ?? null;

  const requestInFlight =
    activeRequest !== null &&
    (activeRequest.status === "submitted" ||
      (ACTIVE_FOR_RESIDENT as readonly string[]).includes(activeRequest.status));

  const disabled =
    requestInFlight ||
    (residency?.building_paused ?? false) ||
    sub?.status !== "active";

  return (
    <Screen scroll contentStyle={{ alignItems: "center", gap: spacing.lg }}>
      {/* (1) the one giant button */}
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => router.push("/(resident)/submit")}
        style={({ pressed }) => ({
          width: BIG_BUTTON_SIZE,
          height: BIG_BUTTON_SIZE,
          borderRadius: BIG_BUTTON_SIZE / 2,
          backgroundColor: disabled ? colors.line : colors.accent,
          alignItems: "center",
          justifyContent: "center",
          marginTop: spacing.lg,
          opacity: pressed ? 0.9 : 1,
          ...shadow,
          shadowOpacity: disabled ? 0 : 0.12,
        })}
      >
        <AppText
          weight="bold"
          size={28}
          color={disabled ? colors.muted : colors.ink}
          center
          style={{ paddingHorizontal: spacing.lg }}
        >
          {str("home.big_button")}
        </AppText>
      </Pressable>

      {/* live request status card, right under the button */}
      {activeRequest ? (
        <View style={{ alignSelf: "stretch" }}>
          <ActiveRequestCard request={activeRequest} />
        </View>
      ) : null}

      {/* (2) allowance ring */}
      {sub ? (
        <AllowanceRing
          included={sub.units_included}
          used={sub.units_used}
          credits={myState?.credits_available ?? 0}
        />
      ) : null}

      {/* (3) building strip — live doors count from get_my_state */}
      {residency ? (
        <Card
          style={{
            alignSelf: "stretch",
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <Ionicons name="home-outline" size={20} color={colors.muted} />
          <AppText weight="medium" size={15} style={{ flex: 1 }}>
            {str("home.building_strip", { doors: residency.meter_doors })}
          </AppText>
          <AppText size={13} color={colors.muted} numberOfLines={1} style={{ flexShrink: 1 }}>
            {residency.street}
          </AppText>
          <MonoText size={13} color={colors.muted}>
            {residency.house_number}
          </MonoText>
        </Card>
      ) : null}
    </Screen>
  );
}
