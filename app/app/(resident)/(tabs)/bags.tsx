import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { BuildingMeterCard } from "@/components/BuildingMeterCard";
import { supabase } from "@/lib/supabase";
import type { BagRollRow } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { QueryState } from "@/ui/QueryState";
import { Screen } from "@/ui/Screen";
import { colors, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";

/** Bags per artboard 07: roll status, what-counts-as-a-bag rules
 * (config-parameterized), building meter with invite CTA. */
export default function BagsScreen() {
  const str = useStr();
  const router = useRouter();
  const { myState, refresh } = useAppState();
  const unitRules = useConfig("unit_rules");
  const [rolls, setRolls] = useState<BagRollRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("bag_rolls")
      .select("*")
      .order("ordered_at", { ascending: false });
    if (!error && data) {
      setRolls(data as BagRollRow[]);
      setLoadError(false);
    } else if (error) {
      setLoadError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), refresh()]);
    setRefreshing(false);
  };

  const pendingRoll = rolls?.find((r) => r.status === "ordered") ?? null;
  const latestDelivered = rolls?.find((r) => r.status === "delivered") ?? null;
  const unitsUsed = myState?.subscription?.units_used ?? 0;
  /** rough bags-left estimate: latest delivered roll minus this month's use */
  const leftInRoll = latestDelivered
    ? Math.max(0, latestDelivered.roll_count - unitsUsed)
    : null;

  const rules: { key: string; text: string }[] = [
    { key: "tied", text: str("bags.rule_tied") },
    { key: "weight", text: str("bags.rule_weight", { kg: unitRules.max_kg_per_unit }) },
    {
      key: "oversized",
      text: str("bags.rule_oversized", { mult: unitRules.oversized_multiplier }),
    },
    { key: "leak", text: str("bags.rule_leak") },
  ];

  return (
    <Screen
      title={str("bags.title")}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
    >
      <View style={{ gap: spacing.lg }}>
        {/* roll status */}
        {rolls === null ? (
          <QueryState
            loading={!loadError}
            error={loadError}
            onRetry={() => void load()}
            rows={1}
            rowHeight={92}
          />
        ) : (
          <Card big style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  backgroundColor: colors.mint,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name={pendingRoll ? "cube-outline" : "bag-handle-outline"}
                  size={21}
                  color={colors.greenDeep}
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                {pendingRoll ? (
                  <>
                    <AppText weight="heavy" size={15}>
                      {str("bags.next_roll")}
                    </AppText>
                    <AppText size={12} color={colors.muted}>
                      {str("usage.order_roll_note")}
                    </AppText>
                  </>
                ) : leftInRoll !== null ? (
                  <AppText weight="heavy" size={15}>
                    {str("bags.left_in_roll", { count: leftInRoll })}
                  </AppText>
                ) : (
                  <AppText weight="heavy" size={15}>
                    {str("bags.next_roll")}
                  </AppText>
                )}
              </View>
              {latestDelivered ? (
                <MonoText weight="heavy" size={18} color={colors.greenDeep}>
                  {leftInRoll ?? latestDelivered.roll_count}
                </MonoText>
              ) : null}
            </View>
          </Card>
        )}

        {/* what counts as a bag */}
        <Card style={{ gap: spacing.md }}>
          <AppText weight="heavy" size={16}>
            {str("bags.rules_title")}
          </AppText>
          {rules.map((rule) => (
            <View
              key={rule.key}
              style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 99,
                  backgroundColor: colors.mint,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 1,
                }}
              >
                <Ionicons name="checkmark" size={12} color={colors.greenDeep} />
              </View>
              <AppText size={13.5} color={colors.text2} style={{ flex: 1, lineHeight: 20 }}>
                {rule.text}
              </AppText>
            </View>
          ))}
        </Card>

        {/* building meter + invite tie-in */}
        <BuildingMeterCard
          footer={
            <Button
              label={str("meter.invite_cta")}
              onPress={() => router.push("/(resident)/(tabs)/invite")}
              compact
              style={{ marginTop: spacing.xs }}
            />
          }
        />
      </View>
    </Screen>
  );
}
