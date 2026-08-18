import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { formatDate } from "@/lib/dates";
import { supabase } from "@/lib/supabase";
import type { BagRollRow } from "@/lib/types";
import { useStr } from "@/state/AppState";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { colors, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";

export default function BagsScreen() {
  const str = useStr();
  const [rolls, setRolls] = useState<BagRollRow[]>([]);

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

        {/* Building meter — placeholder until the meter view lands.
            TODO(later slice): read the building_meter view for live doors
            count + tiers; '—' stands in for the unknown count meanwhile. */}
        <Card style={{ gap: spacing.sm }}>
          <AppText weight="bold" size={17}>
            {str("meter.title")}
          </AppText>
          <AppText size={14} color={colors.muted}>
            {str("meter.progress", { doors: "—" })}
          </AppText>
        </Card>
      </View>
    </Screen>
  );
}
