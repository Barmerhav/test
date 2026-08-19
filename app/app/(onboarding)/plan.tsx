import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { formatILS } from "@pinui/shared";
import { PaymentSheet } from "@/components/PaymentSheet";
import { perUnitAgorot } from "@/components/UpgradeSheet";
import { recommendPlan } from "@/lib/recommendPlan";
import { rpc } from "@/lib/supabase";
import type { BagFormat, MySubscription, PlanRow } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Pressy } from "@/ui/Pressy";
import { QueryState } from "@/ui/QueryState";
import { Screen } from "@/ui/Screen";
import { colors, radii, shadow, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

/** Tailoring chips per artboard 02 — survey ranges with weekly midpoints
 * (the recommendation math lives in src/lib/recommendPlan.ts). */
const HOUSEHOLD_CHIPS = ["1–2", "3–4", "5+"] as const;
const BAGS_WEEK_CHIPS: { label: string; midpoint: number }[] = [
  { label: "2–3", midpoint: 2.5 },
  { label: "4–6", midpoint: 5 },
  { label: "7+", midpoint: 8 },
];

/** Plan picker per artboard 02: two questions, one pre-selected answer. */
export default function PlanScreen() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { plans, myState, refresh, refreshPlans } = useAppState();

  const [household, setHousehold] = useState<number | null>(null);
  const [bagsIdx, setBagsIdx] = useState<number | null>(null);
  const [format, setFormat] = useState<BagFormat>("large");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [paySubId, setPaySubId] = useState<string | null>(null);
  const [payPrice, setPayPrice] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const signupPlans = useMemo(
    () =>
      plans
        .filter((p) => p.active_for_signup)
        .sort((a, b) => a.units_per_month - b.units_per_month),
    [plans],
  );

  // The one-shot hydration fetch can fail on flaky networks at the most
  // fragile point of the funnel — retry whenever we arrive with no plans.
  useEffect(() => {
    if (plans.length === 0) void refreshPlans();
  }, [plans.length, refreshPlans]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshPlans(), refresh()]);
    setRefreshing(false);
  };

  const recommended = useMemo(() => {
    if (bagsIdx === null) return null;
    const midpoint = BAGS_WEEK_CHIPS[bagsIdx]?.midpoint;
    if (midpoint === undefined) return null;
    return recommendPlan(signupPlans, midpoint);
  }, [bagsIdx, signupPlans]);

  // pre-select the recommendation whenever the answers change
  useEffect(() => {
    if (recommended) setSelectedPlanId(recommended.id);
  }, [recommended]);

  // relaunch mid-flow with a pending_payment subscription → back to payment,
  // with the pending plan pre-selected so the CTA price matches the charge.
  // Once the user closes the sheet for that sub, don't auto-reopen it — the
  // CTA below still resumes (or restarts with a different plan).
  const dismissedRecoveryRef = useRef<string | null>(null);
  useEffect(() => {
    const sub = myState?.subscription;
    if (
      sub &&
      sub.status === "pending_payment" &&
      dismissedRecoveryRef.current !== sub.id
    ) {
      setSelectedPlanId(sub.plan.id);
      setPayPrice(sub.plan.price_agorot);
      setPaySubId(sub.id);
    }
  }, [myState?.subscription]);

  const selectedPlan: PlanRow | null =
    signupPlans.find((p) => p.id === selectedPlanId) ?? null;

  const startAndPay = async () => {
    const residencyId = myState?.residency?.id;
    if (!selectedPlan || !residencyId) return;
    setStarting(true);
    try {
      const existing = myState?.subscription;
      if (
        existing &&
        existing.status === "pending_payment" &&
        existing.plan.id === selectedPlan.id
      ) {
        // same plan — resume the pending checkout
        setPayPrice(existing.plan.price_agorot);
        setPaySubId(existing.id);
      } else {
        // different (or no) plan — start fresh; the server auto-cancels a
        // stale pending_payment row inside start_subscription
        const sub = await rpc<MySubscription>("start_subscription", {
          p_plan_id: selectedPlan.id,
          p_residency_id: residencyId,
          p_bag_format: format,
        });
        setPayPrice(selectedPlan.price_agorot);
        setPaySubId(sub.id);
      }
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen
      title={str("plan.title")}
      subtitle={str("plan.subtitle")}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
    >
      <View style={{ gap: spacing.lg }}>
        {/* two tailoring questions */}
        <View style={{ gap: spacing.sm }}>
          <AppText weight="bold" size={14}>
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
          <AppText weight="bold" size={14}>
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

        {/* bag format (kept functional — start_subscription needs it) */}
        <View style={{ gap: spacing.sm }}>
          <AppText weight="bold" size={14}>
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

        {/* plan cards — explicit error/retry when the fetch failed */}
        {signupPlans.length === 0 ? (
          <QueryState
            loading={false}
            error
            onRetry={() => void onRefresh()}
            rows={2}
          />
        ) : null}
        <View style={{ gap: spacing.md }}>
          {signupPlans.map((plan) => {
            const selected = plan.id === selectedPlanId;
            const isRecommended = recommended?.id === plan.id;
            return (
              <Pressy
                key={plan.id}
                accessibilityRole="button"
                onPress={() => setSelectedPlanId(plan.id)}
                haptic="light"
                style={{
                  backgroundColor: colors.card,
                  borderRadius: radii.cardBig,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? colors.green : colors.lineSoft,
                  padding: 18,
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
                    <AppText weight="heavy" size={17}>
                      {str(plan.name_strings_key)}
                    </AppText>
                    {isRecommended ? (
                      <View
                        style={{
                          backgroundColor: colors.green,
                          borderRadius: radii.pill,
                          paddingHorizontal: 10,
                          paddingVertical: 3,
                        }}
                      >
                        <AppText weight="heavy" size={11} color={colors.onGreen}>
                          {str("plan.recommended")}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <MonoText weight="heavy" size={22}>
                      {formatILS(plan.price_agorot)}
                    </MonoText>
                    <AppText size={11.5} color={colors.muted}>
                      {str("plan.per_month")}
                    </AppText>
                  </View>
                </View>
                <AppText size={13.5}>
                  {str("plan.units_included", { units: plan.units_per_month })}
                </AppText>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  {plan.bags_included ? (
                    <AppText size={12.5} color={colors.greenDeep}>
                      {str("plan.bags_included")}
                    </AppText>
                  ) : (
                    <View />
                  )}
                  <AppText weight="bold" size={12} color={colors.muted}>
                    {str("plan.price_per_unit", {
                      price: formatILS(perUnitAgorot(plan)),
                    })}
                  </AppText>
                </View>
              </Pressy>
            );
          })}
        </View>

        {/* legal: no rollover */}
        <AppText size={11.5} color={colors.faint} center>
          {str("plan.no_rollover")}
        </AppText>

        <View style={{ gap: spacing.xs }}>
          <Button
            label={
              selectedPlan
                ? str("plan.pay_cta", { price: formatILS(selectedPlan.price_agorot) })
                : str("plan.pay_cta", { price: "—" })
            }
            onPress={() => void startAndPay()}
            disabled={!selectedPlan}
            loading={starting}
            big
            haptic="medium"
          />
          <AppText size={11.5} color={colors.muted} center>
            {str("plan.pay_note")}
          </AppText>
        </View>
      </View>

      <PaymentSheet
        visible={paySubId !== null}
        subscriptionId={paySubId}
        priceAgorot={payPrice}
        onClose={() => {
          dismissedRecoveryRef.current = paySubId;
          setPaySubId(null);
        }}
        onSuccess={() => {
          setPaySubId(null);
          void refresh();
          router.replace("/(resident)");
        }}
      />
    </Screen>
  );
}
