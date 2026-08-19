import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { formatILS, shekelsToAgorot } from "@pinui/shared";
import { AllowanceRing } from "@/components/AllowanceRing";
import { perUnitAgorot } from "@/components/UpgradeSheet";
import { formatDateIntl, formatMonthName } from "@/lib/dates";
import { chargeExtraRoll } from "@/lib/payments";
import { rpc, supabase } from "@/lib/supabase";
import type { HistoryRequestRow, PlanRow } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { Button, ConfirmButton } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { fireHaptic } from "@/ui/Pressy";
import { QueryState } from "@/ui/QueryState";
import { Screen } from "@/ui/Screen";
import { pillKindForStatus, StatusPill } from "@/ui/StatusPill";
import { colors, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

/** Usage per artboard 06: quota header, resets line, upgrade compare,
 * month history with status pills, extra-roll card. */
export default function UsageScreen() {
  const str = useStr();
  const rpcErrorToast = useRpcErrorToast();
  const { myState, plans, locale, session, refresh, refreshPlans } = useAppState();
  const extraRoll = useConfig("extra_roll");

  const [history, setHistory] = useState<HistoryRequestRow[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [rollBusy, setRollBusy] = useState(false);
  const [rollDone, setRollDone] = useState(false);

  const sub = myState?.subscription ?? null;
  const residency = myState?.residency ?? null;

  const uid = session?.user.id ?? null;

  const load = useCallback(async () => {
    if (!uid) return;
    // resident_id filter: dual-role users must not see requests they
    // collected as a courier in their own history (RLS ORs both policies)
    const { data, error } = await supabase
      .from("requests")
      .select("id,status,units_requested,units_final,created_at")
      .eq("resident_id", uid)
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error && data) {
      setHistory(data as HistoryRequestRow[]);
      setHistoryError(false);
    } else if (error) {
      setHistoryError(true);
    }
    void refreshPlans();
  }, [refreshPlans, uid]);

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

  /** Founder repriced this plan code → newer active version awaits accept. */
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
      void fireHaptic("success");
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
      void fireHaptic("success");
      void refresh();
    } catch (err) {
      // graceful when the payments function is unreachable
      rpcErrorToast(err);
    } finally {
      setRollBusy(false);
    }
  };

  if (!sub) {
    return <Screen title={str("usage.title")}>{null}</Screen>;
  }

  const remaining = Math.max(0, sub.units_included - sub.units_used);
  const street = residency ? `${residency.street} ${residency.house_number}` : "";

  return (
    <Screen
      title={str("usage.title")}
      subtitle={formatMonthName(locale)}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
    >
      <View style={{ gap: spacing.lg }}>
        {/* quota header */}
        <Card big style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
          <AllowanceRing
            included={sub.units_included}
            used={sub.units_used}
            credits={myState?.credits_available ?? 0}
            size={118}
            strokeWidth={11}
            compact
          />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <AppText weight="heavy" size={18}>
              {remaining === 1
                ? str("usage.left_single")
                : str("usage.left_many", { units: remaining })}
            </AppText>
            <AppText size={12.5} color={colors.text2} style={{ lineHeight: 19 }}>
              {str("usage.resets_at", {
                date: formatDateIntl(sub.next_reset_at, locale),
              })}
            </AppText>
            {(myState?.credits_available ?? 0) > 0 ? (
              // LTR isolation keeps the '+N' badge from bidi-flipping
              <AppText
                weight="bold"
                size={12.5}
                color={colors.greenDeep}
                style={{ writingDirection: "ltr" }}
              >
                {str("home.credits_left", { units: myState?.credits_available ?? 0 })}
              </AppText>
            ) : null}
          </View>
        </Card>

        {/* founder repriced this plan → accept */}
        {pendingPlanChange ? (
          <Card accent style={{ gap: spacing.sm }}>
            <AppText weight="heavy" size={15.5}>
              {str("plan.change_title")}
            </AppText>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs }}>
              <MonoText weight="heavy" size={20}>
                {formatILS(pendingPlanChange.price_agorot)}
              </MonoText>
              <AppText size={12.5} color={colors.muted}>
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

        {/* upgrade with live per-bag compare */}
        {upgradeCandidates.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <AppText weight="heavy" size={16}>
              {str("plan.upgrade_body")}
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
                  <AppText weight="heavy" size={15.5}>
                    {str(plan.name_strings_key)}
                  </AppText>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                    <MonoText weight="heavy" size={17}>
                      {formatILS(plan.price_agorot)}
                    </MonoText>
                    <AppText size={11.5} color={colors.muted}>
                      {str("plan.per_month")}
                    </AppText>
                  </View>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <AppText size={12.5} color={colors.muted}>
                    {str("plan.units_included", { units: plan.units_per_month })}
                  </AppText>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <MonoText size={12} color={colors.faint}>
                      {formatILS(perUnitAgorot(sub.plan))}
                    </MonoText>
                    <AppText size={12} color={colors.faint}>
                      ←
                    </AppText>
                    <AppText weight="bold" size={12.5} color={colors.greenDeep}>
                      {str("plan.price_per_unit", {
                        price: formatILS(perUnitAgorot(plan)),
                      })}
                    </AppText>
                  </View>
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
          <Card style={{ gap: spacing.xs }}>
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
            <AppText size={11.5} color={colors.muted} center>
              {str("usage.order_roll_note")}
            </AppText>
          </Card>
        ) : null}

        {/* month history (section hidden until there's something to show) */}
        {history === null || history.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <AppText weight="heavy" size={16}>
            {str("usage.history")}
          </AppText>
          {history === null ? (
            <QueryState
              loading={!historyError}
              error={historyError}
              onRetry={() => void load()}
              rows={3}
              rowHeight={58}
            />
          ) : (
            history.map((row) => {
              const kind = pillKindForStatus(row.status);
              return (
                <Card key={row.id} padded style={{ paddingVertical: 12 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                    }}
                  >
                    <MonoText weight="bold" size={12.5} color={colors.muted}>
                      {formatDateIntl(row.created_at, locale)}
                    </MonoText>
                    <AppText size={13.5} numberOfLines={1} style={{ flex: 1 }}>
                      {str("usage.history_line", {
                        units: row.units_final ?? row.units_requested,
                        street,
                      })}
                    </AppText>
                    {kind ? <StatusPill kind={kind} /> : null}
                  </View>
                </Card>
              );
            })
          )}
        </View>
        ) : null}
      </View>
    </Screen>
  );
}
