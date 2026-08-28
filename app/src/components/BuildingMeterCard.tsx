import React from "react";
import { View } from "react-native";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { Card } from "@/ui/Card";
import { colors, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";

/** Building meter per artboard 07/08: doors count, progress to next tier,
 * bags-only disclaimer. Shared by the bags + invite tabs. */
export function BuildingMeterCard({ footer }: { footer?: React.ReactNode }) {
  const str = useStr();
  const { myState } = useAppState();
  const meterConfig = useConfig("building_meter");

  if (!meterConfig.enabled) return null;

  const doors = myState?.residency?.meter_doors ?? 0;
  const tiers = [...meterConfig.tiers].sort((a, b) => a.doors - b.doors);
  const nextTier = tiers.find((t) => t.doors > doors) ?? null;
  const reachedTier = [...tiers].reverse().find((t) => t.doors <= doors) ?? null;

  return (
    <Card style={{ gap: spacing.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <AppText weight="heavy" size={16}>
          {str("meter.title")}
        </AppText>
        {nextTier ? (
          <MonoText weight="heavy" size={16} color={colors.greenDeep}>
            {`${doors}/${nextTier.doors}`}
          </MonoText>
        ) : (
          <MonoText weight="heavy" size={16} color={colors.greenDeep}>
            {doors}
          </MonoText>
        )}
      </View>
      <AppText size={13.5} color={colors.text2}>
        {str("meter.progress", { doors })}
      </AppText>
      {nextTier ? (
        <>
          <View
            style={{
              height: 8,
              borderRadius: 99,
              backgroundColor: colors.progressTrack,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 8,
                borderRadius: 99,
                width: `${Math.min(100, Math.round((doors / nextTier.doors) * 100))}%`,
                backgroundColor: colors.green,
              }}
            />
          </View>
          <AppText size={12.5} color={colors.muted}>
            {str("meter.next_tier", {
              missing: nextTier.doors - doors,
              bonus: nextTier.bonus_units_all,
            })}
          </AppText>
        </>
      ) : reachedTier ? (
        <AppText size={12.5} color={colors.greenDeep}>
          {str("meter.tier_reached", {
            doors: reachedTier.doors,
            bonus: reachedTier.bonus_units_all,
          })}
        </AppText>
      ) : null}
      <AppText size={11.5} color={colors.faint}>
        {str("meter.disclaimer")}
      </AppText>
      {footer}
    </Card>
  );
}
