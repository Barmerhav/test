import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, Share, View } from "react-native";
import { formatILS, shekelsToAgorot } from "@pinui/shared";
import { formatCountdown } from "@/lib/dates";
import { rpc } from "@/lib/supabase";
import type { RequestRow } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { colors, spacing, TAP } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = new Date(expiresAt).getTime() - now;
  return (
    <MonoText bold size={28} color={colors.ink} center>
      {formatCountdown(remaining)}
    </MonoText>
  );
}

function DismissX({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
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
      }}
    >
      <Ionicons name="close" size={20} color={colors.muted} />
    </Pressable>
  );
}

/** Live status card under the big button, driven by request.status + Realtime. */
export function ActiveRequestCard({ request }: { request: RequestRow }) {
  const str = useStr();
  const { refresh, dismissRequest, setActiveRequest, myState } = useAppState();
  const backstop = useConfig("backstop");
  const referral = useConfig("referral");
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    setBusy(true);
    try {
      await rpc<RequestRow>("cancel_request", { p_request_id: request.id });
      setActiveRequest(null);
      await refresh();
    } catch {
      // if cancel raced a claim, the realtime update repaints the card
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const shareReferral = async () => {
    const code = myState?.user?.referral_code ?? "";
    const message = `${str("request.referral_moment", {
      units: referral.reward_units_each_side,
    })} ${code}`;
    try {
      await Share.share({ message });
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  };

  switch (request.status) {
    case "submitted":
    case "open":
      return (
        <Card style={{ alignItems: "center", gap: spacing.sm }}>
          <AppText weight="medium" size={16}>
            {str("request.waiting")}
          </AppText>
          <Countdown expiresAt={request.expires_at} />
          <Pressable
            accessibilityRole="button"
            onPress={() => void cancel()}
            disabled={busy}
            style={{ minHeight: TAP, justifyContent: "center" }}
          >
            <AppText weight="medium" size={15} color={colors.danger}>
              {str("request.cancel")}
            </AppText>
          </Pressable>
        </Card>
      );

    case "claimed":
      return (
        <Card style={{ alignItems: "center", gap: spacing.xs }}>
          <AppText weight="medium" size={16} center>
            {str("request.claimed")}
          </AppText>
        </Card>
      );

    case "resident_approval":
      // TODO(slice-3): api.approve_pickup / api.decline_eta RPCs do not exist
      // yet — render the state read-only until they land.
      return (
        <Card style={{ alignItems: "center", gap: spacing.xs }}>
          <AppText weight="medium" size={16} center>
            {str("request.claimed")}
          </AppText>
        </Card>
      );

    case "put_out_prompt":
      // TODO(slice-3): api.confirm_bag_out RPC does not exist yet — the CTA is
      // rendered disabled until the backend ships it.
      return (
        <Card style={{ alignItems: "center", gap: spacing.md }}>
          <AppText weight="medium" size={16} center>
            {str("request.put_out_prompt")}
          </AppText>
          <Button
            label={str("request.bag_out_cta")}
            onPress={() => undefined}
            disabled
            style={{ alignSelf: "stretch" }}
          />
        </Card>
      );

    case "collected":
    case "verified":
      return (
        <Card style={{ alignItems: "center", gap: spacing.sm }}>
          <Ionicons name="checkmark-circle" size={36} color={colors.success} />
          <AppText weight="medium" size={16} center>
            {str("request.collected")}
          </AppText>
        </Card>
      );

    case "paid":
      return (
        <Card accent style={{ gap: spacing.md }}>
          <DismissX onPress={dismissRequest} />
          <View style={{ alignItems: "center", gap: spacing.xs }}>
            <Ionicons name="sparkles" size={32} color={colors.accent} />
            <AppText weight="bold" size={20} center>
              {str("request.done_title")}
            </AppText>
          </View>
          {referral.enabled ? (
            <View style={{ gap: spacing.sm, alignItems: "center" }}>
              <AppText size={14} color={colors.muted} center>
                {str("request.referral_moment", {
                  units: referral.reward_units_each_side,
                })}
              </AppText>
              <MonoText bold size={30} center>
                {myState?.user?.referral_code ?? ""}
              </MonoText>
              <Pressable
                accessibilityRole="button"
                onPress={() => void shareReferral()}
                style={{
                  minHeight: TAP,
                  minWidth: TAP,
                  borderRadius: TAP / 2,
                  backgroundColor: colors.ink,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: spacing.lg,
                }}
              >
                <Ionicons name="share-social-outline" size={22} color={colors.card} />
              </Pressable>
            </View>
          ) : null}
        </Card>
      );

    case "expired":
      return (
        <Card style={{ gap: spacing.sm }}>
          <DismissX onPress={dismissRequest} />
          <AppText weight="bold" size={17}>
            {str("request.expired_title")}
          </AppText>
          <AppText size={14} color={colors.muted}>
            {str("request.expired_body")}
          </AppText>
          {backstop.enabled ? (
            // TODO(later slice): backstop purchase flow — no RPC/edge action
            // exists yet, so the button is disabled.
            <Button
              label={str("request.backstop_cta", {
                price: formatILS(shekelsToAgorot(backstop.user_price)),
              })}
              onPress={() => undefined}
              disabled
              compact
            />
          ) : null}
        </Card>
      );

    case "declined_leak":
      return (
        <Card style={{ gap: spacing.sm }}>
          <DismissX onPress={dismissRequest} />
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
            <Ionicons name="water-outline" size={22} color={colors.danger} />
            <AppText size={14} style={{ flex: 1, lineHeight: 21 }}>
              {str("request.declined_leak")}
            </AppText>
          </View>
        </Card>
      );

    default:
      return null;
  }
}
