import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Share, View } from "react-native";
import { formatILS, shekelsToAgorot } from "@pinui/shared";
import { formatCountdown, formatTime } from "@/lib/dates";
import { chargeBackstop } from "@/lib/payments";
import { rpc, supabase } from "@/lib/supabase";
import type { RequestRow } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { Button, ConfirmButton } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { fireHaptic, Pressy } from "@/ui/Pressy";
import { pillKindForStatus, StatusPill } from "@/ui/StatusPill";
import { colors, radii, spacing, TAP } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast, useToast } from "@/ui/Toast";

function DeadlineHeader({ request }: { request: RequestRow }) {
  const kind = pillKindForStatus(request.status);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {kind ? <StatusPill kind={kind} /> : <View />}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <MonoText weight="bold" size={12.5} color={colors.text2}>
          {formatTime(request.expires_at)}
        </MonoText>
      </View>
    </View>
  );
}

/** Big live countdown + remaining-time progress bar (artboard 05a). */
function DeadlineTimer({ request }: { request: RequestRow }) {
  const now = useNow();
  const end = new Date(request.expires_at).getTime();
  const start = new Date(request.created_at).getTime();
  const total = Math.max(1, end - start);
  const remaining = Math.max(0, end - now);
  const fraction = Math.min(1, remaining / total);
  return (
    <View style={{ gap: spacing.md }}>
      <MonoText weight="heavy" size={52} center>
        {formatCountdown(remaining)}
      </MonoText>
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
            width: `${Math.round(fraction * 100)}%`,
            backgroundColor: colors.green,
          }}
        />
      </View>
    </View>
  );
}

function DismissX({ onPress }: { onPress: () => void }) {
  return (
    <Pressy
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={12}
      style={{
        position: "absolute",
        top: spacing.sm,
        end: spacing.sm,
        width: 32,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
      }}
    >
      <Ionicons name="close" size={20} color={colors.faint} />
    </Pressy>
  );
}

/** The referral moment (artboard 05c): mint card, dashed mono code, share. */
export function ReferralMomentCard() {
  const str = useStr();
  const { myState } = useAppState();
  const referral = useConfig("referral");
  if (!referral.enabled) return null;
  const code = myState?.user?.referral_code ?? "";

  const share = async () => {
    try {
      await Share.share({
        message: `${str("request.referral_moment")} ${code}`,
      });
    } catch {
      // share sheet dismissed
    }
  };

  return (
    <View
      style={{
        backgroundColor: colors.mintCard,
        borderWidth: 1,
        borderColor: colors.mintCardBorder,
        borderRadius: radii.card,
        padding: 20,
        gap: spacing.md,
        alignSelf: "stretch",
      }}
    >
      <AppText weight="heavy" size={16.5} color={colors.inkDeep}>
        {str("request.referral_moment", { units: referral.reward_units_each_side })}
      </AppText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View
          style={{
            flex: 1,
            borderWidth: 1.5,
            borderStyle: "dashed",
            borderColor: colors.mintDashed,
            borderRadius: 12,
            paddingVertical: 11,
            backgroundColor: colors.mintField,
          }}
        >
          <MonoText weight="heavy" size={16} center style={{ letterSpacing: 2 }}>
            {code}
          </MonoText>
        </View>
        <Button
          label={str("request.referral_cta")}
          onPress={() => void share()}
          compact
          haptic="medium"
        />
      </View>
    </View>
  );
}

/** Estimated minutes until the courier's collect-by deadline — resident can
 * read the active claim row on their own request (RLS claims_parties). */
function useEtaMinutes(requestId: string, enabled: boolean): number | null {
  const [deadline, setDeadline] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("claims")
        .select("deadline_at")
        .eq("request_id", requestId)
        .eq("status", "active")
        .limit(1);
      const row = (data as { deadline_at: string }[] | null)?.[0];
      if (alive && !error && row) setDeadline(row.deadline_at);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [requestId, enabled]);
  if (!deadline) return null;
  const mins = Math.round((new Date(deadline).getTime() - Date.now()) / 60000);
  return Math.max(1, mins);
}

/** Live status card on HOME, driven by request.status + Realtime (05a–05d). */
export function ActiveRequestCard({ request }: { request: RequestRow }) {
  const str = useStr();
  const { show } = useToast();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh, dismissRequest, setActiveRequest } = useAppState();
  const backstop = useConfig("backstop");
  const [busy, setBusy] = useState(false);
  const [backstopBusy, setBackstopBusy] = useState(false);
  const etaMinutes = useEtaMinutes(request.id, request.status === "resident_approval");

  const cancel = async () => {
    setBusy(true);
    try {
      await rpc<RequestRow>("cancel_request", { p_request_id: request.id });
      setActiveRequest(null);
      await refresh();
    } catch {
      // cancel raced a claim — realtime repaints the card
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const runTransition = async (
    fn: "approve_pickup" | "decline_eta" | "confirm_bag_out",
  ) => {
    setBusy(true);
    try {
      const row = await rpc<RequestRow>(fn, { p_request_id: request.id });
      setActiveRequest(row);
      await refresh();
    } catch (err) {
      rpcErrorToast(err);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const sendBackstop = async () => {
    setBackstopBusy(true);
    try {
      const out = await chargeBackstop(request.id);
      const chargeId = typeof out.charge_id === "string" ? out.charge_id : null;
      // settlement arrives via webhook — poll for the ACTUAL outcome instead
      // of declaring success on a timer
      let outcome: "ok" | "failed" | "refunded" | "pending" = "pending";
      for (let i = 0; i < 8 && outcome === "pending"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const st = await refresh();
        if (st?.active_request) {
          outcome = "ok";
          break;
        }
        if (chargeId) {
          const [{ data: ch }, { data: rf }] = await Promise.all([
            supabase.from("charges").select("status").eq("id", chargeId).maybeSingle(),
            supabase.from("refunds").select("id").eq("charge_id", chargeId).limit(1),
          ]);
          const status = (ch as { status?: string } | null)?.status;
          if (status === "failed") outcome = "failed";
          else if ((rf ?? []).length > 0) outcome = "refunded";
        }
      }
      if (outcome === "ok") {
        void fireHaptic("success");
        show(str("request.backstop_hint"), "success");
      } else if (outcome === "failed") {
        show(str("request.backstop_failed"), "error");
      } else if (outcome === "refunded") {
        show(str("request.backstop_refunded"), "error");
      } else {
        // webhook still in flight — neutral message, never a false success
        show(str("request.backstop_processing"), "success");
      }
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setBackstopBusy(false);
    }
  };

  switch (request.status) {
    case "submitted":
    case "open":
      return (
        <Card big style={{ gap: spacing.md, padding: 22 }}>
          <DeadlineHeader request={request} />
          <View style={{ gap: 4 }}>
            <AppText weight="heavy" size={20}>
              {str("request.out_status", { time: formatTime(request.expires_at) })}
            </AppText>
            <AppText size={13} color={colors.text2}>
              {str("request.waiting_note")}
            </AppText>
          </View>
          <DeadlineTimer request={request} />
          <AppText size={12.5} color={colors.muted} center>
            {str("request.waiting")}
          </AppText>
          <Pressy
            accessibilityRole="button"
            onPress={() => void cancel()}
            disabled={busy}
            style={{
              alignSelf: "center",
              minHeight: TAP,
              justifyContent: "center",
              paddingHorizontal: 18,
              borderRadius: radii.pill,
              borderWidth: 1.5,
              borderColor: colors.lineAlt,
              backgroundColor: colors.card,
            }}
          >
            <AppText weight="semibold" size={12.5} color={colors.danger}>
              {str("request.cancel")}
            </AppText>
          </Pressy>
        </Card>
      );

    case "claimed":
      return (
        <Card big style={{ gap: spacing.md, padding: 22 }}>
          <DeadlineHeader request={request} />
          <AppText weight="heavy" size={21}>
            {str("request.claimed")}
          </AppText>
          {/* courier row — identity stays private; verified badge only */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              backgroundColor: colors.bg,
              borderRadius: 14,
              padding: 12,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 99,
                backgroundColor: colors.ink,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="person" size={20} color={colors.bg} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 99,
                  backgroundColor: colors.greenDeep,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="checkmark" size={9} color={colors.card} />
              </View>
              <AppText weight="semibold" size={12.5} color={colors.greenDeep}>
                {str("request.verified_courier")}
              </AppText>
            </View>
          </View>
          <AppText size={12.5} color={colors.muted} center>
            {str("request.claimed_note")}
          </AppText>
        </Card>
      );

    case "resident_approval":
      return (
        <Card big style={{ gap: spacing.md, padding: 22 }}>
          <DeadlineHeader request={request} />
          <AppText weight="heavy" size={17} center>
            {str("request.approve_eta", { minutes: etaMinutes ?? "—" })}
          </AppText>
          <Button
            label={str("request.approve_cta")}
            onPress={() => void runTransition("approve_pickup")}
            loading={busy}
            haptic="medium"
          />
          <ConfirmButton
            label={str("request.decline_cta")}
            kind="danger"
            onPress={() => void runTransition("decline_eta")}
            disabled={busy}
          />
        </Card>
      );

    case "put_out_prompt":
      return (
        <Card big style={{ gap: spacing.md, padding: 22 }}>
          <DeadlineHeader request={request} />
          <AppText weight="heavy" size={17} center>
            {str("request.put_out_prompt")}
          </AppText>
          <Button
            label={str("request.bag_out_cta")}
            onPress={() => void runTransition("confirm_bag_out")}
            loading={busy}
            haptic="medium"
          />
        </Card>
      );

    case "collected":
    case "verified":
      return (
        <Card big style={{ alignItems: "center", gap: spacing.sm, padding: 22 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 99,
              backgroundColor: colors.greenDeep,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="checkmark" size={30} color={colors.card} />
          </View>
          <AppText weight="heavy" size={17} center>
            {str("request.collected")}
          </AppText>
          <AppText size={12.5} color={colors.muted} center>
            {str("request.claimed_note")}
          </AppText>
        </Card>
      );

    case "paid":
      return (
        <Card big style={{ alignItems: "center", gap: spacing.md, padding: 22 }}>
          <DismissX onPress={dismissRequest} />
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: 99,
              backgroundColor: colors.greenDeep,
              alignItems: "center",
              justifyContent: "center",
              shadowColor: colors.greenDeep,
              shadowOpacity: 0.3,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 8 },
              elevation: 4,
            }}
          >
            <Ionicons name="checkmark" size={38} color={colors.card} />
          </View>
          <AppText weight="heavy" size={19} center>
            {str("request.done_title")}
          </AppText>
          <ReferralMomentCard />
          <AppText size={12} color={colors.muted} center>
            {str("request.done_note")}
          </AppText>
        </Card>
      );

    case "expired":
      return (
        <Card big style={{ gap: spacing.md, padding: 22 }}>
          <DismissX onPress={dismissRequest} />
          <StatusPill kind="credit" />
          <AppText weight="heavy" size={22}>
            {str("request.expired_title")}
          </AppText>
          <AppText size={13.5} color={colors.text2} style={{ lineHeight: 20 }}>
            {str("request.expired_body")}
          </AppText>
          {backstop.enabled ? (
            <View style={{ gap: spacing.xs }}>
              <Button
                label={str("request.backstop_cta", {
                  price: formatILS(shekelsToAgorot(backstop.user_price)),
                })}
                onPress={() => void sendBackstop()}
                loading={backstopBusy}
                haptic="medium"
              />
              <AppText size={11.5} color={colors.muted} center>
                {str("request.backstop_hint")}
              </AppText>
            </View>
          ) : null}
          <Pressy
            accessibilityRole="button"
            onPress={dismissRequest}
            style={{
              minHeight: TAP,
              borderRadius: radii.button,
              borderWidth: 1.5,
              borderColor: colors.line,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
            }}
          >
            <AppText weight="semibold" size={12.5} color={colors.text2} center>
              {str("request.expired_retry")}
            </AppText>
          </Pressy>
        </Card>
      );

    case "declined_leak":
      return (
        <Card big style={{ gap: spacing.sm, padding: 22 }}>
          <DismissX onPress={dismissRequest} />
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
            <Ionicons name="water-outline" size={22} color={colors.danger} />
            <AppText size={13.5} style={{ flex: 1, lineHeight: 20 }}>
              {str("request.declined_leak")}
            </AppText>
          </View>
        </Card>
      );

    default:
      return null;
  }
}
