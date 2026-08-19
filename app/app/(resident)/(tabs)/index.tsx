import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { View } from "react-native";
import { ACTIVE_FOR_RESIDENT } from "@pinui/shared";
import { ActiveRequestCard } from "@/components/ActiveRequestCard";
import { AllowanceRing } from "@/components/AllowanceRing";
import { useAppState, useStr } from "@/state/AppState";
import { Pressy } from "@/ui/Pressy";
import { Brand } from "@/ui/Brand";
import { Screen } from "@/ui/Screen";
import { colors, greenShadow, radii, shadow, spacing, TAP } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";

/** Overlapping neighbor avatars (visual only — counts come from state). */
function NeighborAvatars({ doors }: { doors: number }) {
  const shown = Math.min(3, doors);
  const palette = [colors.greenDeep, colors.avatarSoft, colors.muted];
  return (
    <View style={{ flexDirection: "row" }}>
      {Array.from({ length: shown }).map((_, i) => (
        <View
          key={i}
          style={{
            width: 24,
            height: 24,
            borderRadius: 99,
            backgroundColor: palette[i % palette.length],
            borderWidth: 2,
            borderColor: colors.card,
            alignItems: "center",
            justifyContent: "center",
            marginStart: i === 0 ? 0 : -7,
          }}
        >
          <Ionicons name="person" size={11} color={colors.card} />
        </View>
      ))}
      {doors > shown ? (
        <View
          style={{
            minWidth: 24,
            height: 24,
            borderRadius: 99,
            backgroundColor: colors.mint,
            borderWidth: 2,
            borderColor: colors.card,
            alignItems: "center",
            justifyContent: "center",
            marginStart: -7,
            paddingHorizontal: 3,
          }}
        >
          <MonoText weight="bold" size={9.5} color={colors.greenDeep}>
            {`+${doors - shown}`}
          </MonoText>
        </View>
      ) : null}
    </View>
  );
}

/** HOME per artboard 03: greeting header + ring + neighbors strip + the one
 * giant green button. Active request replaces the middle with its live card. */
export default function HomeScreen() {
  const str = useStr();
  const router = useRouter();
  const { myState, activeRequest, refresh } = useAppState();
  const [refreshing, setRefreshing] = React.useState(false);

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

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => void onRefresh()}>
      {/* header: brand · active chip + settings gear */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: spacing.lg,
        }}
      >
        <Brand />
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {sub && !requestInFlight ? (
            <View
              style={{
                backgroundColor: colors.mint,
                borderRadius: radii.pill,
                paddingHorizontal: 11,
                paddingVertical: 5,
              }}
            >
              <AppText weight="bold" size={11.5} color={colors.greenDeep}>
                {str("home.active_sub")}
              </AppText>
            </View>
          ) : null}
          {sub && requestInFlight ? (
            <MonoText weight="bold" size={12} color={colors.text2}>
              {`${Math.max(0, sub.units_included - sub.units_used)}/${sub.units_included}`}
            </MonoText>
          ) : null}
          <Pressy
            accessibilityRole="button"
            onPress={() => router.push("/(resident)/settings")}
            haptic="light"
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
            <Ionicons name="settings-outline" size={19} color={colors.text2} />
          </Pressy>
        </View>
      </View>

      {activeRequest ? (
        <ActiveRequestCard request={activeRequest} />
      ) : (
        <View style={{ alignItems: "center", gap: spacing.lg, paddingTop: spacing.md }}>
          {sub ? (
            <AllowanceRing
              included={sub.units_included}
              used={sub.units_used}
              credits={myState?.credits_available ?? 0}
            />
          ) : null}
          {residency ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.lineSoft,
                borderRadius: radii.pill,
                paddingVertical: 9,
                paddingHorizontal: 16,
                ...shadow,
              }}
            >
              <NeighborAvatars doors={residency.meter_doors} />
              <AppText weight="bold" size={13}>
                {str("home.building_strip", { doors: residency.meter_doors })}
              </AppText>
            </View>
          ) : null}
        </View>
      )}

      {/* the one giant button (h96, r24, glow) */}
      {!requestInFlight ? (
        <Pressy
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => router.push("/(resident)/submit")}
          haptic="medium"
          style={{
            minHeight: 96,
            borderRadius: 24,
            backgroundColor: disabled ? colors.surface : colors.green,
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            marginTop: spacing.xl,
            ...(disabled ? null : { ...greenShadow, shadowOpacity: 0.42, shadowRadius: 16 }),
          }}
        >
          <AppText
            weight="black"
            size={28}
            color={disabled ? colors.faint : colors.onGreenAlt}
            center
          >
            {str("home.big_button")}
          </AppText>
          <AppText
            weight="semibold"
            size={12.5}
            color={disabled ? colors.faint : colors.onGreenDim}
            center
          >
            {str("home.big_button_hint")}
          </AppText>
        </Pressy>
      ) : null}
      {/* keep a comfortable thumb-reach dead zone under the button */}
      <View style={{ height: TAP / 2 }} />
    </Screen>
  );
}
