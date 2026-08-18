import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { formatILS } from "@pinui/shared";
import { rpc } from "@/lib/supabase";
import type { PlanRow } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Sheet } from "@/ui/Sheet";
import { colors, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

export interface UpgradeSheetProps {
  visible: boolean;
  onClose: () => void;
  onUpgraded: () => void;
}

/** Price-per-unit is computed live from the plans rows — never hardcoded. */
export function perUnitAgorot(plan: {
  price_agorot: number;
  units_per_month: number;
}): number {
  return plan.units_per_month > 0
    ? Math.round(plan.price_agorot / plan.units_per_month)
    : plan.price_agorot;
}

/** Offered when submit fails with insufficient_allowance: bigger plans
 * compared by live price-per-unit, one tap to change_plan. */
export function UpgradeSheet({ visible, onClose, onUpgraded }: UpgradeSheetProps) {
  const str = useStr();
  const { plans, myState, refresh } = useAppState();
  const rpcErrorToast = useRpcErrorToast();
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  const current = myState?.subscription?.plan ?? null;

  const candidates = useMemo(() => {
    if (!current) return [];
    return plans
      .filter(
        (p) =>
          p.active_for_signup &&
          p.id !== current.id &&
          p.units_per_month > current.units_per_month,
      )
      .sort((a, b) => a.units_per_month - b.units_per_month);
  }, [plans, current]);

  const upgrade = async (plan: PlanRow) => {
    setBusyPlanId(plan.id);
    try {
      await rpc("change_plan", { p_plan_id: plan.id });
      await refresh();
      onUpgraded();
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setBusyPlanId(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <AppText weight="bold" size={20}>
        {str("plan.upgrade_title")}
      </AppText>
      <AppText size={14} color={colors.muted}>
        {str("plan.upgrade_body")}
      </AppText>
      {current ? (
        <AppText size={13} color={colors.muted}>
          {str("plan.price_per_unit", {
            price: formatILS(perUnitAgorot(current)),
          })}
        </AppText>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        {candidates.map((plan) => (
          <Card key={plan.id} style={{ gap: spacing.sm }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <AppText weight="bold" size={16}>
                {str(plan.name_strings_key)}
              </AppText>
              <MonoText bold size={18}>
                {formatILS(plan.price_agorot)}
              </MonoText>
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <AppText size={13} color={colors.muted}>
                {str("plan.units_included", { units: plan.units_per_month })}
              </AppText>
              <AppText size={13} color={colors.success}>
                {str("plan.price_per_unit", { price: formatILS(perUnitAgorot(plan)) })}
              </AppText>
            </View>
            <Button
              label={str("plan.upgrade_cta")}
              onPress={() => void upgrade(plan)}
              loading={busyPlanId === plan.id}
              compact
            />
          </Card>
        ))}
      </View>
    </Sheet>
  );
}
