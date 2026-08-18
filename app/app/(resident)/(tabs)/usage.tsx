import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { formatILS, shekelsToAgorot, type RequestStatus } from "@pinui/shared";
import { AllowanceRing } from "@/components/AllowanceRing";
import { perUnitAgorot } from "@/components/UpgradeSheet";
import { formatDate } from "@/lib/dates";
import { chargeExtraRoll } from "@/lib/payments";
import { rpc, supabase } from "@/lib/supabase";
import type { HistoryRequestRow, PlanRow } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { Button, ConfirmButton } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { colors, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

/** Reuse existing strings keys as short history labels per status. */
const STATUS_LABEL_KEY: Record<RequestStatus, string> = {
  submitted: "request.waiting",
  open: "request.waiting",
  claimed: "request.claimed",
  resident_approval: "request.claimed",
  put_out_prompt: "request.put_out_prompt",
  collected: "request.collected",
  verified: "request.collected",
  paid: "request.done_title",
  expired: "request.expired_title",
  declined_leak: "request.declined_leak",
  noshow: "request.expired_title",
  canceled: "request.cancel",
};

const STATUS_COLOR: Partial<Record<RequestStatus, string>> = {
  paid: colors.success,
  collected: colors.success,
  verified: colors.success,
  expired: colors.danger,
  declined_leak: colors.danger,
  noshow: colors.danger,
  canceled: colors.muted,
};

export default function UsageScreen() {
  const str = useStr();
  const rpcErrorToast = useRpcErrorToast();
  const { myState, plans, refresh, refreshPlans } = useAppState();
  const extraRoll = useConfig("extra_roll");

  const [history, setHistory] = useState<HistoryRequestRow[]>([]);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [rollBusy, setRollBusy] = useState(false);
  const [rollDone, setRollDone] = useState(false);

  const sub = myState?.subscription ?? null;

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const load = async () => {
        const { data, error } = await supabase
          .from("requests")
          .select("id,status,units_requested,units_final,created_at")
          .order("created_at", { ascending: false })
          .limit(50);
        if (alive && !error && data) setHistory(data as HistoryRequestRow[]);
        void refreshPlans();
      };
      void load();
      return () => {
        alive = false;
      };
    }, [refreshPlans]),
  );

  /** Founder repriced the plan: a newer active version of the same code. */
  const pendingPlanChange: PlanRow | null = useMemo(() => {
    if (!sub) return null;
    return (
      plans.find(
        (p) =>
          p.code === sub.plan.code &&
          p.version > sub.plan.version &&
          p.active_for_signup,
      ) ?? null
    );
  }, [plans, sub]);

  const upgradeCandidates = useMemo(() => {
    if (!sub) return [];
    return plans
      .filter(
        (p) =>
          p.active_for_signup &&
          p.id !== sub.plan.id &&
          p.units_per_month > sub.plan.units_per_month,
      )
      .sort((a, b) => a.units_per_month - b.units_per_month);
  }, [plans, sub]);

  const acceptChange = async () => {
    setAcceptBusy(true);
    try {
      await rpc("accept_plan_change");
      await refresh();
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setAcceptBusy(false);
    }
  };

  const changePlan = async (plan: PlanRow) => {
    setBusyPlanId(plan.id);
    try {
      await rpc("change_plan", { p_plan_id: plan.id });
      await refresh();
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setBusyPlanId(null);
    }
  };

  const orderRoll = async () => {
    if (!sub) return;
    setRollBusy(true);
    try {
      await chargeExtraRoll(sub.bag_format);
      setRollDone(true);
      void refresh();
    } catch (err) {
      // graceful when the payments function isn't deployed yet
      rpcErrorToast(err);
    } finally {
      setRollBusy(false);
    }
  };

  if (!sub) {
    return <Screen title={str("usage.title")}>{null}</Screen>;
  }

  return (
    <Screen title={str("usage.title")}>
      <View style={{ gap: spacing.lg }}>
        {/* plan + ring */}
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
          <AllowanceRing
            included={sub.units_included}
            used={sub.units_used}
            credits={myState?.credits_available ?? 0}
            size={120}
            strokeWidth={11}
          />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <AppText weight="bold" size={20}>
              {str(`plan.${sub.plan.code}.name`)}
            </AppText>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs }}>
              <MonoText bold size={22}>
                {formatILS(sub.plan.price_agorot)}
              </MonoText>
              <AppText size={13} color={colors.muted}>
                {str("plan.per_month")}
              </AppText>
            </View>
            <MonoText size={14} color={colors.muted}>
              {formatDate(sub.next_reset_at)}
            </MonoText>
          </View>
        </Card>

        {/* founder repriced this plan → accept the new version */}
        {pendingPlanChange ? (
          <Card accent style={{ gap: spacing.sm }}>
            <AppText weight="bold" size={16}>
              {/* NOTE: 'plan.change_title' not seeded yet — shows '!key' until added */}
              {str("plan.change_title")}
            </AppText>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs }}>
              <MonoText bold size={20}>
                {formatILS(pendingPlanChange.price_agorot)}
              </MonoText>
              <AppText size={13} color={colors.muted}>
                {str("plan.per_month")}
              </AppText>
            </View>
            <Button
              label={str("plan.change_cta")}
              onPress={() => void acceptChange()}
              loading={acceptBusy}
              compact
            />
          </Card>
        ) : null}

        {/* one-tap upgrades with live per-unit compare */}
        {upgradeCandidates.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <AppText weight="bold" size={17}>
              {str("plan.upgrade_title")}
            </AppText>
            {upgradeCandidates.map((plan) => (
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
                    {str("plan.price_per_unit", {
                      price: formatILS(perUnitAgorot(plan)),
                    })}
                  </AppText>
                </View>
                <ConfirmButton
                  label={str("plan.upgrade_cta")}
                  kind="success"
                  onPress={() => void changePlan(plan)}
                  loading={busyPlanId === plan.id}
                />
              </Card>
            ))}
          </View>
        ) : null}

        {/* extra bag roll (config-gated) */}
        {extraRoll.enabled ? (
          <Card style={{ gap: spacing.sm }}>
            <Button
              label={str("usage.order_roll", {
                price: formatILS(shekelsToAgorot(extraRoll.price)),
              })}
              onPress={() => void orderRoll()}
              loading={rollBusy}
              disabled={rollDone}
              kind="ghost"
              compact
            />
          </Card>
        ) : null}

        {/* history */}
        <View style={{ gap: spacing.sm }}>
          <AppText weight="bold" size={17}>
            {str("usage.history")}
          </AppText>
          {history.map((row) => (
            <Card key={row.id} padded style={{ paddingVertical: spacing.sm }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: STATUS_COLOR[row.status] ?? colors.accent,
                  }}
                />
                <AppText
                  weight="medium"
                  size={14}
                  numberOfLines={1}
                  style={{ flex: 1 }}
                >
                  {str(STATUS_LABEL_KEY[row.status] ?? "request.waiting")}
                </AppText>
                <MonoText size={14}>{row.units_final ?? row.units_requested}</MonoText>
                <MonoText size={13} color={colors.muted}>
                  {formatDate(row.created_at)}
                </MonoText>
              </View>
            </Card>
          ))}
        </View>
      </View>
    </Screen>
  );
}
