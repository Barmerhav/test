import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { formatILS } from "@pinui/shared";
import { PaymentSheet } from "@/components/PaymentSheet";
import { recommendPlan } from "@/lib/recommendPlan";
import { rpc } from "@/lib/supabase";
import type { BagFormat, MySubscription, PlanRow } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Screen } from "@/ui/Screen";
import { colors, radii, shadow, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

/** Tailoring chips: label ranges + weekly-bags midpoints (pure survey UX —
 * the recommendation math lives in src/lib/recommendPlan.ts). */
const HOUSEHOLD_CHIPS = ["1–2", "3–4", "5+"] as const;
const BAGS_WEEK_CHIPS: { label: string; midpoint: number }[] = [
  { label: "1–3", midpoint: 2 },
  { label: "4–7", midpoint: 5.5 },
  { label: "8+", midpoint: 9 },
];

export default function PlanScreen() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { plans, myState, refresh } = useAppState();

  const [household, setHousehold] = useState<number | null>(null);
  const [bagsIdx, setBagsIdx] = useState<number | null>(null);
  const [format, setFormat] = useState<BagFormat>("large");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [paySubId, setPaySubId] = useState<string | null>(null);

  const signupPlans = useMemo(
    () =>
      plans
        .filter((p) => p.active_for_signup)
        .sort((a, b) => a.units_per_month - b.units_per_month),
    [plans],
  );

  const recommended = useMemo(() => {
    if (bagsIdx === null) return null;
    const midpoint = BAGS_WEEK_CHIPS[bagsIdx]?.midpoint;
    if (midpoint === undefined) return null;
    return recommendPlan(signupPlans, midpoint);
  }, [bagsIdx, signupPlans]);

  // Preselect the recommended card whenever the answers change.
  useEffect(() => {
    if (recommended) setSelectedPlanId(recommended.id);
  }, [recommended]);

  // If a pending_payment subscription already exists (relaunch mid-flow),
  // jump straight back into the payment sheet.
  useEffect(() => {
    const sub = myState?.subscription;
    if (sub && sub.status === "pending_payment") setPaySubId(sub.id);
  }, [myState?.subscription]);

  const selectedPlan: PlanRow | null =
    signupPlans.find((p) => p.id === selectedPlanId) ?? null;

  const startAndPay = async () => {
    const residencyId = myState?.residency?.id;
    if (!selectedPlan || !residencyId) return;
    setStarting(true);
    try {
      const existing = myState?.subscription;
      if (existing && existing.status === "pending_payment") {
        setPaySubId(existing.id);
      } else {
        const sub = await rpc<MySubscription>("start_subscription", {
          p_plan_id: selectedPlan.id,
          p_residency_id: residencyId,
          p_bag_format: format,
        });
        setPaySubId(sub.id);
      }
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen title={str("plan.title")}>
      <View style={{ gap: spacing.lg }}>
        {/* tailoring questions */}
        <View style={{ gap: spacing.sm }}>
          <AppText weight="medium" size={15}>
            {str("plan.q_household")}
          </AppText>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {HOUSEHOLD_CHIPS.map((label, i) => (
              <Chip
                key={label}
                label={label}
                selected={household === i}
                onPress={() => setHousehold(i)}
                style={{ flex: 1 }}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <AppText weight="medium" size={15}>
            {str("plan.q_bags_week")}
          </AppText>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {BAGS_WEEK_CHIPS.map((chip, i) => (
              <Chip
                key={chip.label}
                label={chip.label}
                selected={bagsIdx === i}
                onPress={() => setBagsIdx(i)}
                style={{ flex: 1 }}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <AppText weight="medium" size={15}>
            {str("plan.q_format")}
          </AppText>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Chip
              label={str("plan.format_large")}
              selected={format === "large"}
              onPress={() => setFormat("large")}
              style={{ flex: 1 }}
            />
            <Chip
              label={str("plan.format_small")}
              selected={format === "small"}
              onPress={() => setFormat("small")}
              style={{ flex: 1 }}
            />
          </View>
        </View>

        {/* plan cards */}
        <View style={{ gap: spacing.md }}>
          {signupPlans.map((plan) => {
            const selected = plan.id === selectedPlanId;
            const isRecommended = recommended?.id === plan.id;
            return (
              <Pressable
                key={plan.id}
                accessibilityRole="button"
                onPress={() => setSelectedPlanId(plan.id)}
                style={{
                  backgroundColor: colors.card,
                  borderRadius: radii.card,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? colors.accent : colors.line,
                  padding: spacing.md,
                  gap: spacing.sm,
                  ...shadow,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <AppText weight="bold" size={18}>
                      {str(plan.name_strings_key)}
                    </AppText>
                    {isRecommended ? (
                      <View
                        style={{
                          backgroundColor: colors.accent,
                          borderRadius: radii.chip,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 3,
                        }}
                      >
                        <AppText weight="bold" size={12}>
                          {str("plan.recommended")}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <MonoText bold size={22}>
                      {formatILS(plan.price_agorot)}
                    </MonoText>
                    <AppText size={12} color={colors.muted}>
                      {str("plan.per_month")}
                    </AppText>
                  </View>
                </View>
                <AppText size={14}>
                  {str("plan.units_included", { units: plan.units_per_month })}
                </AppText>
                {plan.bags_included ? (
                  <AppText size={13} color={colors.success}>
                    {str("plan.bags_included")}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* legal: no rollover */}
        <AppText size={12} color={colors.muted} center>
          {str("plan.no_rollover")}
        </AppText>

        <Button
          label={str("plan.pay_cta")}
          onPress={() => void startAndPay()}
          disabled={!selectedPlan}
          loading={starting}
        />
      </View>

      <PaymentSheet
        visible={paySubId !== null}
        subscriptionId={paySubId}
        onClose={() => setPaySubId(null)}
        onSuccess={() => {
          setPaySubId(null);
          void refresh();
          router.replace("/(resident)");
        }}
      />
    </Screen>
  );
}
