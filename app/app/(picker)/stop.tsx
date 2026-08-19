import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  AppState as RNAppState,
  Linking,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { formatILS } from "@pinui/shared";
import { formatCountdown } from "@/lib/dates";
import { rpc, supabase } from "@/lib/supabase";
import type {
  ClaimRow,
  RevealResult,
  StopBuildingRow,
  StopRequestRow,
  StopResidencyRow,
} from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { useAppState, useStr } from "@/state/AppState";
import { PButton, PCard, PConfirmButton, PScreen } from "@/ui/PickerUI";
import { Pressy } from "@/ui/Pressy";
import { QueryState } from "@/ui/QueryState";
import { pickerColors as pc, radii, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

interface StopData {
  claims: ClaimRow[];
  requests: Map<string, StopRequestRow>;
  residencies: Map<string, StopResidencyRow>;
  building: StopBuildingRow | null;
}

/** Poll cadence while the stop screen is focused (confirm-first unlocks). */
const STOP_POLL_MS = 20_000;

async function navigateTo(lat: number, lng: number): Promise<void> {
  const waze = `waze://?ll=${lat},${lng}&navigate=yes`;
  const geo = `geo:${lat},${lng}`;
  const web = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  try {
    await Linking.openURL(waze);
  } catch {
    try {
      await Linking.openURL(geo);
    } catch {
      await Linking.openURL(web).catch(() => undefined);
    }
  }
}

/** Stop per artboard 11 — HUGE time-boxed code, per-door checklist, sticky
 * payout footer, "I'm at the building" primary flow. */
export default function StopScreen() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { session, refresh } = useAppState();
  const now = useNow();

  const [data, setData] = useState<StopData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reveal, setReveal] = useState<RevealResult | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [releasing, setReleasing] = useState(false);

  const uid = session?.user.id ?? null;

  const load = useCallback(async () => {
    if (!uid) return;
    const claimsRes = await supabase
      .from("claims")
      .select("*")
      .eq("picker_id", uid)
      .eq("status", "active")
      .order("claimed_at", { ascending: true });
    if (claimsRes.error) {
      // a failed query must NEVER read as "you have no stops"
      setLoadError(true);
      return;
    }
    setLoadError(false);
    const claims = (claimsRes.data ?? []) as ClaimRow[];
    if (claims.length === 0) {
      setData({ claims: [], requests: new Map(), residencies: new Map(), building: null });
      return;
    }
    const requestIds = claims.map((c) => c.request_id);
    const reqRes = await supabase
      .from("requests")
      .select("id,units_requested,notes,residency_id,building_id,status")
      .in("id", requestIds);
    const requests = new Map<string, StopRequestRow>();
    for (const r of (reqRes.data ?? []) as StopRequestRow[]) requests.set(r.id, r);

    const residencyIds = [...requests.values()].map((r) => r.residency_id);
    const buildingIds = [...new Set([...requests.values()].map((r) => r.building_id))];

    const [resRes, bldRes] = await Promise.all([
      supabase
        .from("residencies")
        .select("id,floor,apartment,door_note")
        .in("id", residencyIds),
      supabase
        .from("buildings")
        .select("id,street,house_number,city,lat,lng,bin_location_note")
        .in("id", buildingIds),
    ]);
    const residencies = new Map<string, StopResidencyRow>();
    for (const r of (resRes.data ?? []) as StopResidencyRow[]) residencies.set(r.id, r);
    const building = ((bldRes.data ?? []) as StopBuildingRow[])[0] ?? null;

    setData({ claims, requests, residencies, building });
  }, [uid]);

  // refetch on focus + poll while focused + resync on app foreground, so
  // waiting-resident doors unlock the moment the resident approves
  useFocusEffect(
    useCallback(() => {
      void load();
      const interval = setInterval(() => void load(), STOP_POLL_MS);
      const sub = RNAppState.addEventListener("change", (next) => {
        if (next === "active") void load();
      });
      return () => {
        clearInterval(interval);
        sub.remove();
      };
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const claims = data?.claims ?? [];
  const building = data?.building ?? null;

  const minDeadline = useMemo(() => {
    let min: number | null = null;
    for (const c of claims) {
      const t = new Date(c.deadline_at).getTime();
      if (min === null || t < min) min = t;
    }
    return min;
  }, [claims]);

  /** payout for the whole stop, from claim snapshots (never config-live) */
  const stopPayout = useMemo(
    () =>
      claims.reduce((sum, c) => {
        const req = data?.requests.get(c.request_id);
        const units = c.units_collected ?? req?.units_requested ?? 0;
        return sum + units * (c.payout_per_unit_agorot + c.payout_boost_agorot);
      }, 0),
    [claims, data],
  );

  const collectedClaim = claims.find(
    (c) => data?.requests.get(c.request_id)?.status === "collected",
  );
  const nextCollectable = claims.find(
    (c) => data?.requests.get(c.request_id)?.status === "claimed",
  );
  /** reveal_entry_code only accepts a claim whose request is claimed/collected
   * — never point it at a door still waiting on the resident */
  const revealableClaim = claims.find((c) => {
    const s = data?.requests.get(c.request_id)?.status;
    return s === "claimed" || s === "collected";
  });
  const revealExpired =
    reveal?.reveal_expires_at !== null &&
    reveal?.reveal_expires_at !== undefined &&
    new Date(reveal.reveal_expires_at).getTime() <= now;

  const doReveal = async () => {
    if (!revealableClaim) return;
    setRevealing(true);
    try {
      const result = await rpc<RevealResult>("reveal_entry_code", {
        p_claim_id: revealableClaim.id,
      });
      setReveal(result);
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setRevealing(false);
    }
  };

  const releaseAll = async () => {
    setReleasing(true);
    try {
      for (const c of claims) {
        const reqStatus = data?.requests.get(c.request_id)?.status;
        if (
          reqStatus === "claimed" ||
          reqStatus === "resident_approval" ||
          reqStatus === "put_out_prompt"
        ) {
          await rpc("release_claim", { p_claim_id: c.id });
        }
      }
      setReveal(null);
      await load();
      void refresh();
      router.back();
    } catch (err) {
      rpcErrorToast(err);
      await load();
    } finally {
      setReleasing(false);
    }
  };

  // query failed with nothing to show → explicit error + retry (never the
  // "no active stop" empty state); loading → skeleton
  if (loadError && data === null) {
    return (
      <PScreen scroll={false} title={str("stop.title")} contentStyle={{ justifyContent: "center" }}>
        <QueryState loading={false} error onRetry={() => void load()} dark />
      </PScreen>
    );
  }

  if (data === null) {
    return (
      <PScreen scroll={false} title={str("stop.title")}>
        <QueryState loading error={false} onRetry={() => void load()} dark rows={3} />
      </PScreen>
    );
  }

  if (claims.length === 0) {
    return (
      <PScreen scroll={false} title={str("stop.title")} contentStyle={{ justifyContent: "center" }}>
        <View style={{ alignItems: "center", gap: spacing.md }}>
          <AppText size={40}>🧭</AppText>
          <AppText size={14} color={pc.muted} center>
            {str("stop.empty")}
          </AppText>
          <PButton
            label={str("feed.title")}
            kind="ghost"
            onPress={() => router.back()}
            compact
          />
        </View>
      </PScreen>
    );
  }

  return (
    <PScreen scroll={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={pc.green}
          />
        }
      >
        {/* header: street + meta + navigate */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.sm,
          }}
        >
          <View style={{ flexShrink: 1 }}>
            <AppText weight="black" size={22} color={pc.text}>
              {building ? `${building.street} ${building.house_number}` : str("stop.title")}
            </AppText>
            {minDeadline !== null ? (
              <AppText size={12.5} color={pc.muted} style={{ marginTop: 2 }}>
                {str("stop.deadline", { time: formatCountdown(minDeadline - now) })}
              </AppText>
            ) : null}
          </View>
          {building && building.lat !== null && building.lng !== null ? (
            <Pressy
              accessibilityRole="button"
              onPress={() =>
                void navigateTo(building.lat as number, building.lng as number)
              }
              haptic="light"
              style={{
                minHeight: 46,
                borderRadius: radii.chip,
                borderWidth: 1.5,
                borderColor: pc.green,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 16,
              }}
            >
              <AppText weight="heavy" size={14} color={pc.money}>
                {str("stop.navigate")}
              </AppText>
            </Pressy>
          ) : null}
        </View>

        {building?.bin_location_note ? (
          <AppText size={12} color={pc.faint} style={{ marginTop: 4 }}>
            {building.bin_location_note}
          </AppText>
        ) : null}

        {/* HUGE entry code — the audited reveal */}
        <PCard style={{ marginTop: spacing.md, alignItems: "center", padding: 22, gap: spacing.sm }}>
          <AppText weight="bold" size={11.5} color={pc.muted} style={{ letterSpacing: 0.5 }}>
            {str("stop.entry_code")}
          </AppText>
          {reveal && reveal.code === null ? (
            <AppText size={14.5} color={pc.text} center>
              {str("stop.no_code")}
            </AppText>
          ) : reveal && reveal.code !== null && !revealExpired ? (
            <>
              <MonoText weight="heavy" size={58} color={pc.money} center style={{ letterSpacing: 5 }}>
                {reveal.code}
              </MonoText>
              {reveal.reveal_expires_at ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                  <View
                    style={{
                      backgroundColor: pc.chip,
                      borderRadius: radii.pill,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                    }}
                  >
                    {(() => {
                      const remain = Math.max(
                        0,
                        new Date(reveal.reveal_expires_at).getTime() - now,
                      );
                      const totalSec = Math.floor(remain / 1000);
                      const minutes = String(Math.floor(totalSec / 60)).padStart(2, "0");
                      const seconds = String(totalSec % 60).padStart(2, "0");
                      return (
                        <AppText weight="semibold" size={12} color={pc.muted}>
                          {str("stop.code_expires", { minutes, seconds })}
                        </AppText>
                      );
                    })()}
                  </View>
                </View>
              ) : null}
            </>
          ) : revealableClaim ? (
            <PButton
              label={str("stop.entry_code")}
              onPress={() => void doReveal()}
              loading={revealing}
              style={{ alignSelf: "stretch" }}
              haptic="medium"
            />
          ) : (
            // every door is still waiting on its resident — no reveal yet
            <AppText size={13} color={pc.muted} center>
              {str("stop.waiting_resident")}
            </AppText>
          )}
        </PCard>

        {/* per-door checklist */}
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          {claims.map((claim) => {
            const req = data?.requests.get(claim.request_id);
            const res = req ? data?.residencies.get(req.residency_id) : undefined;
            const collected = req?.status === "collected";
            const waitingResident =
              req?.status === "resident_approval" || req?.status === "put_out_prompt";
            const units = claim.units_collected ?? req?.units_requested ?? 0;
            const payout = units * (claim.payout_per_unit_agorot + claim.payout_boost_agorot);
            return (
              <Pressy
                key={claim.id}
                accessibilityRole="button"
                disabled={collected || waitingResident}
                onPress={() => router.push(`/(picker)/collect/${claim.id}`)}
                haptic="light"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  backgroundColor: pc.surface,
                  borderWidth: waitingResident ? 1.5 : 1,
                  borderColor: waitingResident ? pc.lineStrong : pc.line,
                  borderStyle: waitingResident ? "dashed" : "solid",
                  borderRadius: 14,
                  paddingHorizontal: 14,
                  minHeight: 60,
                  opacity: waitingResident ? 0.85 : 1,
                }}
              >
                {collected ? (
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 99,
                      backgroundColor: pc.green,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="checkmark" size={16} color={pc.onGreen} />
                  </View>
                ) : (
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      borderWidth: 2,
                      borderColor: pc.lineStrong,
                    }}
                  />
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText weight="bold" size={14.5} color={pc.text}>
                    {str("stop.floor_apt", {
                      floor: res?.floor ?? "—",
                      apartment: res?.apartment ?? "—",
                    })}
                  </AppText>
                  {waitingResident ? (
                    <AppText size={11.5} color={pc.muted}>
                      {str("stop.waiting_resident")}
                    </AppText>
                  ) : res?.door_note ? (
                    <AppText size={11.5} color={pc.muted} numberOfLines={1}>
                      {res.door_note}
                    </AppText>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                  <MonoText weight="bold" size={13} color={pc.muted}>
                    {units}
                  </MonoText>
                  <MonoText weight="bold" size={13} color={pc.money}>
                    {formatILS(payout)}
                  </MonoText>
                </View>
              </Pressy>
            );
          })}
        </View>

        {/* release (two-tap) */}
        <PConfirmButton
          label={str("stop.release")}
          kind="danger"
          onPress={() => void releaseAll()}
          loading={releasing}
          style={{ marginTop: spacing.lg }}
        />
      </ScrollView>

      {/* sticky payout footer + primary flow CTA */}
      <View style={{ paddingTop: spacing.sm, gap: spacing.sm }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 4,
          }}
        >
          <AppText size={12.5} color={pc.muted}>
            {str("stop.payout_footer")}
          </AppText>
          <MonoText weight="heavy" size={20} color={pc.money}>
            {`+${formatILS(stopPayout, { isolate: false })}`}
          </MonoText>
        </View>
        {collectedClaim && !nextCollectable ? (
          <PButton
            label={str("collect.done_cta")}
            onPress={() =>
              router.push({
                pathname: "/(picker)/finish",
                params: {
                  claimId: collectedClaim.id,
                  street: building ? `${building.street} ${building.house_number}` : "",
                },
              })
            }
            haptic="medium"
          />
        ) : nextCollectable ? (
          <PButton
            label={str("stop.arrived_cta")}
            onPress={() => router.push(`/(picker)/collect/${nextCollectable.id}`)}
            haptic="medium"
          />
        ) : null}
      </View>
    </PScreen>
  );
}
