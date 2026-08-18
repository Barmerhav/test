import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { formatDate } from "@/lib/dates";
import { supabase } from "@/lib/supabase";
import type { BagRollRow } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { colors, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";

export default function BagsScreen() {
  const str = useStr();
  const { myState } = useAppState();
  const meterConfig = useConfig("building_meter");
  const [rolls, setRolls] = useState<BagRollRow[]>([]);

  const doors = myState?.residency?.meter_doors ?? 0;
  const tiers = [...meterConfig.tiers].sort((a, b) => a.doors - b.doors);
  const nextTier = tiers.find((t) => t.doors > doors) ?? null;
  const reachedTier = [...tiers].reverse().find((t) => t.doors <= doors) ?? null;

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const load = async () => {
        const { data, error } = await supabase
          .from("bag_rolls")
          .select("*")
          .order("ordered_at", { ascending: false });
        if (alive && !error && data) setRolls(data as BagRollRow[]);
      };
      void load();
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <Screen title={str("bags.title")}>
      <View style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          {rolls.map((roll) => {
            const delivered = roll.status === "delivered";
            return (
              <Card key={roll.id} style={{ gap: spacing.sm }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                  }}
                >
                  <Ionicons
                    name={delivered ? "checkmark-circle" : "time-outline"}
                    size={22}
                    color={delivered ? colors.success : colors.muted}
                  />
                  <AppText weight="medium" size={15} style={{ flex: 1 }}>
                    {str(
                      roll.format === "large"
                        ? "plan.format_large"
                        : "plan.format_small",
                    )}
                  </AppText>
                  <MonoText bold size={17}>
                    {roll.roll_count}
                  </MonoText>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <MonoText size={13} color={colors.muted}>
                    {formatDate(roll.ordered_at)}
                  </MonoText>
                  {roll.delivered_at ? (
                    <MonoText size={13} color={colors.success}>
                      {formatDate(roll.delivered_at)}
                    </MonoText>
                  ) : null}
                </View>
              </Card>
            );
          })}
        </View>

        {/* Building meter — live doors count + next tier from config */}
        {meterConfig.enabled ? (
          <Card style={{ gap: spacing.sm }}>
            <AppText weight="bold" size={17}>
              {str("meter.title")}
            </AppText>
            <AppText size={14}>{str("meter.progress", { doors })}</AppText>
            {nextTier ? (
              <>
                <View
                  style={{
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: colors.line,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: 10,
                      borderRadius: 5,
                      width: `${Math.min(100, Math.round((doors / nextTier.doors) * 100))}%`,
                      backgroundColor: colors.success,
                    }}
                  />
                </View>
                <AppText size={13} color={colors.muted}>
                  {str("meter.next_tier", {
                    missing: nextTier.doors - doors,
                    bonus: nextTier.bonus_units_all,
                  })}
                </AppText>
              </>
            ) : reachedTier ? (
              <AppText size={13} color={colors.success}>
                {str("meter.tier_reached", {
                  doors: reachedTier.doors,
                  bonus: reachedTier.bonus_units_all,
                })}
              </AppText>
            ) : null}
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
