import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { FlatList, RefreshControl, Switch, View } from "react-native";
import { formatILS, rpcErrorCode } from "@pinui/shared";
import { formatTime } from "@/lib/dates";
import { rpc } from "@/lib/supabase";
import type { ClaimResult, FeedRow } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { PButton, PCard, PScreen } from "@/ui/PickerUI";
import { pickerColors as pc, radii, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast, useToast } from "@/ui/Toast";

/** Feed refresh cadence (UX polling; Realtime broadcast can replace it later). */
const FEED_POLL_MS = 30_000;

// TODO(later slice): subscribe to a Realtime broadcast channel for instant
// new-request pings instead of (in addition to) polling.

export default function FeedScreen() {
  const str = useStr();
  const router = useRouter();
  const { show } = useToast();
  const rpcErrorToast = useRpcErrorToast();
  const { myState, patchPicker, refresh } = useAppState();

  const [rows, setRows] = useState<FeedRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const available = myState?.picker?.available ?? false;

  const load = useCallback(async () => {
    try {
      // best-effort foreground location → distance sorting hint in the feed
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
          // no location — feed works without distances
        }
      }
      const args = coordsRef.current
        ? { p_lat: coordsRef.current.lat, p_lng: coordsRef.current.lng }
        : {};
      const data = await rpc<FeedRow[]>("open_feed", args);
      setRows(data ?? []);
    } catch (err) {
      // suspended/not-active toasts are meaningful here; stay quiet otherwise
      if (rpcErrorCode(err) !== "unknown") rpcErrorToast(err);
    }
  }, [rpcErrorToast]);

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
      void refresh();
      router.push("/(picker)/(tabs)/stop");
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

  return (
    <PScreen
      scroll={false}
      title={str("feed.title")}
      headerEnd={
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <AppText size={13} color={pc.muted}>
            {str("feed.available_toggle")}
          </AppText>
          <Switch
            value={available}
            onValueChange={(v) => void toggleAvailability(v)}
            trackColor={{ false: pc.line, true: pc.success }}
            thumbColor={pc.paper}
          />
        </View>
      }
    >
      <FlatList
        data={rows}
        keyExtractor={(row) => row.request_id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={pc.amber}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        contentContainerStyle={{ paddingBottom: spacing.xl, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <AppText size={15} color={pc.muted} center>
              {str("feed.empty")}
            </AppText>
          </View>
        }
        renderItem={({ item }) => (
          <PCard style={{ gap: spacing.sm }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: spacing.sm,
              }}
            >
              <AppText weight="bold" size={17} color={pc.text} numberOfLines={1} style={{ flexShrink: 1 }}>
                {`${item.street} ${item.house_number}`}
              </AppText>
              <MonoText bold size={26} color={pc.amber}>
                {formatILS(item.payout_agorot)}
              </MonoText>
            </View>
            <AppText size={14} color={pc.muted} style={{ lineHeight: 21 }}>
              {str("feed.card", {
                street: `${item.street} ${item.house_number}`,
                units: item.units,
                payout: formatILS(item.payout_agorot),
                distance: item.distance_m ?? "—",
                deadline: formatTime(item.expires_at),
              })}
            </AppText>
            {item.building_open_count > 1 ? (
              <View
                style={{
                  alignSelf: "flex-start",
                  backgroundColor: pc.bg,
                  borderColor: pc.amber,
                  borderWidth: 1,
                  borderRadius: radii.chip,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 4,
                }}
              >
                <AppText size={13} color={pc.amber}>
                  {str("feed.building_group", { count: item.building_open_count })}
                </AppText>
              </View>
            ) : null}
            <PButton
              label={str("feed.claim_cta")}
              onPress={() => void claim(item)}
              loading={claimingId === item.request_id}
            />
          </PCard>
        )}
      />
    </PScreen>
  );
}
