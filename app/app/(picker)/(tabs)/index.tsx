import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { formatILS, rpcErrorCode } from "@pinui/shared";
import { FeedMap, MAPS_AVAILABLE } from "@/components/FeedMap";
import { formatTime } from "@/lib/dates";
import { rpc, supabase } from "@/lib/supabase";
import type { ClaimResult, FeedRow } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import {
  PAvailabilityPill,
  PButton,
  PCard,
  PScreen,
  PSegmented,
} from "@/ui/PickerUI";
import { fireHaptic, Pressy } from "@/ui/Pressy";
import { SkeletonList } from "@/ui/Skeleton";
import { pickerColors as pc, radii, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast, useToast } from "@/ui/Toast";

/** Feed refresh cadence (UX polling; Realtime broadcast can replace it later). */
const FEED_POLL_MS = 30_000;

// TODO(later slice): subscribe to a Realtime broadcast channel for instant
// new-request pings instead of (in addition to) polling.

type ViewMode = "list" | "map";

/** Feed per artboards 10/10b: money pins, one-tap claims, building groups. */
export default function FeedScreen() {
  const str = useStr();
  const router = useRouter();
  const { show } = useToast();
  const rpcErrorToast = useRpcErrorToast();
  const { session, myState, patchPicker, refresh } = useAppState();

  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [activeStops, setActiveStops] = useState(0);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const available = myState?.picker?.available ?? false;
  const uid = session?.user.id ?? null;

  const load = useCallback(async () => {
    try {
      // best-effort foreground location → distances + map centering
      if (!coordsRef.current) {
        try {
          const perm = await Location.requestForegroundPermissionsAsync();
          if (perm.granted) {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            coordsRef.current = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            };
          }
        } catch {
          // no location — the feed works without distances
        }
      }
      const args = coordsRef.current
        ? { p_lat: coordsRef.current.lat, p_lng: coordsRef.current.lng }
        : {};
      const data = await rpc<FeedRow[]>("open_feed", args);
      setRows(data ?? []);
      if (uid) {
        const { count } = await supabase
          .from("claims")
          .select("id", { count: "exact", head: true })
          .eq("picker_id", uid)
          .eq("status", "active");
        setActiveStops(count ?? 0);
      }
    } catch (err) {
      setRows((prev) => prev ?? []);
      if (rpcErrorCode(err) !== "unknown") rpcErrorToast(err);
    }
  }, [rpcErrorToast, uid]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const t = setInterval(() => void load(), FEED_POLL_MS);
      return () => clearInterval(t);
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleAvailability = async (value: boolean) => {
    patchPicker({ available: value }); // optimistic
    try {
      await rpc("set_picker_availability", { p_available: value });
    } catch (err) {
      patchPicker({ available: !value });
      rpcErrorToast(err);
    }
  };

  const claim = async (row: FeedRow) => {
    setClaimingId(row.request_id);
    try {
      await rpc<ClaimResult>("claim_request", { p_request_id: row.request_id });
      void fireHaptic("success");
      void refresh();
      router.push("/(picker)/stop");
    } catch (err) {
      if (rpcErrorCode(err) === "already_claimed") {
        show(str("feed.already_claimed"), "info");
        void load();
      } else {
        rpcErrorToast(err);
      }
    } finally {
      setClaimingId(null);
    }
  };

  /** Effective feed radius = the farthest visible request (live data). */
  const radius = useMemo(() => {
    const dists = (rows ?? [])
      .map((r) => r.distance_m)
      .filter((d): d is number => d !== null);
    return dists.length > 0 ? Math.max(...dists) : null;
  }, [rows]);

  const groupLeaders = useMemo(() => {
    // one card per building: the earliest request carries the group CTA
    const seen = new Set<string>();
    return (rows ?? []).filter((r) => {
      if (seen.has(r.building_id)) return false;
      seen.add(r.building_id);
      return true;
    });
  }, [rows]);

  const groupPayout = useCallback(
    (leader: FeedRow) =>
      (rows ?? [])
        .filter((r) => r.building_id === leader.building_id)
        .reduce((sum, r) => sum + r.payout_agorot, 0),
    [rows],
  );

  const groupUnits = useCallback(
    (leader: FeedRow) =>
      (rows ?? [])
        .filter((r) => r.building_id === leader.building_id)
        .reduce((sum, r) => sum + r.units, 0),
    [rows],
  );

  const renderCard = (item: FeedRow) => {
    const grouped = item.building_open_count > 1;
    const payout = grouped ? groupPayout(item) : item.payout_agorot;
    const units = grouped ? groupUnits(item) : item.units;
    return (
      <PCard style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
          <View style={{ flex: 1, gap: 6 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                flexWrap: "wrap",
              }}
            >
              <AppText weight="heavy" size={17} color={pc.text}>
                {`${item.street} ${item.house_number}`}
              </AppText>
              {grouped ? (
                <View
                  style={{
                    backgroundColor: pc.chip,
                    borderRadius: radii.pill,
                    paddingHorizontal: 9,
                    paddingVertical: 3,
                  }}
                >
                  <AppText weight="bold" size={10.5} color={pc.soft}>
                    {str("feed.building_group", { count: item.building_open_count })}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText size={12} color={pc.muted}>
              {str("feed.card", {
                distance: item.distance_m ?? "—",
                units,
                deadline: formatTime(item.expires_at),
              })}
            </AppText>
            {grouped ? (
              <AppText size={11.5} color={pc.faint}>
                {str("feed.code_after_claim")}
              </AppText>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end", gap: 3 }}>
            <MonoText weight="heavy" size={grouped ? 27 : 22} color={pc.money}>
              {formatILS(payout)}
            </MonoText>
          </View>
        </View>
        <PButton
          label={grouped ? str("feed.claim_all_cta") : str("feed.claim_cta")}
          onPress={() => void claim(item)}
          loading={claimingId === item.request_id}
          compact={!grouped}
          haptic="medium"
        />
      </PCard>
    );
  };

  const subtitle = (
    <AppText size={12} color={pc.muted}>
      {str("feed.subtitle", {
        count: rows?.length ?? 0,
        radius: radius ?? "—",
      })}
    </AppText>
  );

  return (
    <PScreen
      scroll={false}
      title={str("feed.title")}
      subtitle={subtitle}
      headerEnd={
        <PAvailabilityPill
          label={str("feed.available_toggle")}
          on={available}
          onToggle={(v) => void toggleAvailability(v)}
        />
      }
    >
      {/* list / map segmented control (map hidden when the module is absent) */}
      {MAPS_AVAILABLE ? (
        <PSegmented
          options={[
            { key: "list", label: str("feed.view_list") },
            { key: "map", label: str("feed.view_map") },
          ]}
          value={viewMode}
          onChange={(k) => setViewMode(k as ViewMode)}
          style={{ marginBottom: spacing.md }}
        />
      ) : null}

      {/* active stop shortcut */}
      {activeStops > 0 ? (
        <Pressy
          accessibilityRole="button"
          onPress={() => router.push("/(picker)/stop")}
          haptic="light"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            backgroundColor: pc.timerBg,
            borderRadius: radii.card,
            padding: 14,
            marginBottom: spacing.md,
          }}
        >
          <Ionicons name="navigate" size={18} color={pc.timerText} />
          <AppText weight="heavy" size={14.5} color={pc.timerText} style={{ flex: 1 }}>
            {str("stop.title")}
          </AppText>
          <Ionicons name="chevron-back" size={18} color={pc.timerText} />
        </Pressy>
      ) : null}

      {viewMode === "map" && MAPS_AVAILABLE && rows !== null ? (
        <FeedMap
          rows={rows}
          userCoords={coordsRef.current}
          onPressRow={(row) => void claim(row)}
        />
      ) : rows === null ? (
        <SkeletonList rows={4} height={110} dark />
      ) : (
        <FlatList
          data={groupLeaders}
          keyExtractor={(row) => row.request_id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={pc.green}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          contentContainerStyle={{ paddingBottom: spacing.xl, flexGrow: 1 }}
          ListEmptyComponent={
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
              }}
            >
              <AppText size={40}>🌙</AppText>
              <AppText size={14} color={pc.muted} center style={{ maxWidth: 260 }}>
                {str("feed.empty")}
              </AppText>
            </View>
          }
          renderItem={({ item }) => renderCard(item)}
        />
      )}
    </PScreen>
  );
}
