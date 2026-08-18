import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Linking, View } from "react-native";
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
import { pickerColors as pc, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

interface StopData {
  claims: ClaimRow[];
  requests: Map<string, StopRequestRow>;
  residencies: Map<string, StopResidencyRow>;
  building: StopBuildingRow | null;
}

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

export default function StopScreen() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { session, refresh } = useAppState();
  const now = useNow();

  const [data, setData] = useState<StopData | null>(null);
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

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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

  const collectedClaim = claims.find(
    (c) => data?.requests.get(c.request_id)?.status === "collected",
  );
  const revealExpired =
    reveal?.reveal_expires_at !== null &&
    reveal?.reveal_expires_at !== undefined &&
    new Date(reveal.reveal_expires_at).getTime() <= now;

  const doReveal = async () => {
    const first = claims[0];
    if (!first) return;
    setRevealing(true);
    try {
      const result = await rpc<RevealResult>("reveal_entry_code", {
        p_claim_id: first.id,
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
    } catch (err) {
      rpcErrorToast(err);
      await load();
    } finally {
      setReleasing(false);
    }
  };

  if (claims.length === 0) {
    return (
      <PScreen scroll={false} title={str("stop.title")} contentStyle={{ justifyContent: "center" }}>
        <View style={{ alignItems: "center", gap: spacing.lg }}>
          <Ionicons name="navigate-outline" size={56} color={pc.muted} />
          <AppText size={15} color={pc.muted} center>
            {str("stop.empty")}
          </AppText>
        </View>
      </PScreen>
    );
  }

  return (
    <PScreen title={str("stop.title")}>
      <View style={{ gap: spacing.lg }}>
        {/* building + navigate + deadline */}
        {building ? (
          <PCard style={{ gap: spacing.sm }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: spacing.sm,
              }}
            >
              <AppText weight="bold" size={18} color={pc.text} style={{ flexShrink: 1 }}>
                {`${building.street} ${building.house_number}`}
              </AppText>
              <AppText size={14} color={pc.muted}>
                {building.city}
              </AppText>
            </View>
            {building.bin_location_note ? (
              <AppText size={13} color={pc.muted}>
                {building.bin_location_note}
              </AppText>
            ) : null}
            {minDeadline !== null ? (
              <AppText size={14} color={pc.amber}>
                {str("stop.deadline", { time: formatCountdown(minDeadline - now) })}
              </AppText>
            ) : null}
            {building.lat !== null && building.lng !== null ? (
              <PButton
                label={str("stop.navigate")}
                kind="ghost"
                onPress={() => void navigateTo(building.lat as number, building.lng as number)}
              />
            ) : null}
          </PCard>
        ) : null}

        {/* entry code — the trust choke point */}
        <PCard paper style={{ gap: spacing.sm, alignItems: "center" }}>
          <AppText weight="bold" size={16} color={pc.ink}>
            {str("stop.entry_code")}
          </AppText>
          {reveal && reveal.code === null ? (
            <AppText size={15} color={pc.ink} center>
              {str("stop.no_code")}
            </AppText>
          ) : reveal && reveal.code !== null && !revealExpired ? (
            <>
              <MonoText bold size={64} color={pc.ink} center>
                {reveal.code}
              </MonoText>
              {reveal.reveal_expires_at ? (
                <AppText size={13} color={pc.muted} center>
                  {(() => {
                    const remain = Math.max(
                      0,
                      new Date(reveal.reveal_expires_at).getTime() - now,
                    );
                    const totalSec = Math.floor(remain / 1000);
                    return str("stop.code_expires", {
                      minutes: String(Math.floor(totalSec / 60)).padStart(2, "0"),
                      seconds: String(totalSec % 60).padStart(2, "0"),
                    });
                  })()}
                </AppText>
              ) : null}
            </>
          ) : (
            <PButton
              label={str("stop.entry_code")}
              onPress={() => void doReveal()}
              loading={revealing}
              style={{ alignSelf: "stretch" }}
            />
          )}
        </PCard>

        {/* per-door checklist */}
        {claims.map((claim) => {
          const req = data?.requests.get(claim.request_id);
          const res = req ? data?.residencies.get(req.residency_id) : undefined;
          const collected = req?.status === "collected";
          const waitingResident =
            req?.status === "resident_approval" || req?.status === "put_out_prompt";
          return (
            <PCard key={claim.id} style={{ gap: spacing.sm }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: spacing.sm,
                }}
              >
                <AppText weight="medium" size={15} color={pc.text} style={{ flexShrink: 1 }}>
                  {str("stop.floor_apt", {
                    floor: res?.floor ?? "—",
                    apartment: res?.apartment ?? "—",
                  })}
                </AppText>
                <MonoText bold size={18} color={pc.text}>
                  {req?.units_requested ?? "—"}
                </MonoText>
              </View>
              {res?.door_note ? (
                <AppText size={13} color={pc.muted}>
                  {res.door_note}
                </AppText>
              ) : null}
              {req?.notes ? (
                <AppText size={13} color={pc.muted}>
                  {req.notes}
                </AppText>
              ) : null}
              {collected ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                  <Ionicons name="checkmark-circle" size={22} color={pc.success} />
                  <MonoText size={14} color={pc.success}>
                    {claim.units_collected ?? req?.units_requested ?? 0}
                  </MonoText>
                </View>
              ) : waitingResident ? (
                <AppText size={13} color={pc.muted}>
                  {str("stop.waiting_resident")}
                </AppText>
              ) : (
                <PButton
                  label={str("collect.title")}
                  onPress={() => router.push(`/(picker)/collect/${claim.id}`)}
                />
              )}
            </PCard>
          );
        })}

        {/* one scan closes every collected door in the group */}
        {collectedClaim ? (
          <PButton
            label={str("finish.scan_title")}
            onPress={() =>
              router.push({
                pathname: "/(picker)/finish",
                params: { claimId: collectedClaim.id },
              })
            }
          />
        ) : null}

        <PConfirmButton
          label={str("stop.release")}
          kind="danger"
          onPress={() => void releaseAll()}
          loading={releasing}
        />
      </View>
    </PScreen>
  );
}
