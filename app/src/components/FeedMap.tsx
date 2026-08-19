/**
 * Feed map view ("פינים של כסף", artboard 10b) — react-native-maps with the
 * default provider, loaded lazily so environments without the native module
 * degrade gracefully (the feed screen falls back to the list).
 */
import React from "react";
import { View } from "react-native";
import type { FeedRow } from "@/lib/types";
import { Pressy } from "@/ui/Pressy";
import { darkGreenShadow, pickerColors as pc, radii } from "@/ui/theme";
import { MonoText } from "@/ui/Text";
import { formatILS } from "@pinui/shared";

type MapsModule = typeof import("react-native-maps");

let maps: MapsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  maps = require("react-native-maps") as MapsModule;
} catch {
  maps = null;
}

/** True when the native maps module is present in this build. */
export const MAPS_AVAILABLE = maps !== null;

export interface FeedMapProps {
  rows: FeedRow[];
  userCoords: { lat: number; lng: number } | null;
  /** a claim is in flight — freeze all pins */
  disabled?: boolean;
  onPressRow: (row: FeedRow) => void;
}

export function FeedMap({ rows, userCoords, disabled, onPressRow }: FeedMapProps) {
  if (!maps) return null;
  const MapView = maps.default;
  const Marker = maps.Marker;

  const located = rows.filter((r) => r.lat !== null && r.lng !== null);
  const first = located[0];
  const centerLat = userCoords?.lat ?? first?.lat ?? null;
  const centerLng = userCoords?.lng ?? first?.lng ?? null;
  if (centerLat === null || centerLng === null) return null;

  return (
    <View style={{ flex: 1, borderRadius: radii.card, overflow: "hidden" }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={{
          latitude: centerLat,
          longitude: centerLng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        showsUserLocation
      >
        {located.map((row) => (
          <Marker
            key={row.request_id}
            coordinate={{ latitude: row.lat as number, longitude: row.lng as number }}
            onPress={() => {
              if (!disabled) onPressRow(row);
            }}
            tracksViewChanges={false}
          >
            <Pressy
              disabled={disabled}
              onPress={() => onPressRow(row)}
              style={{
                opacity: disabled ? 0.6 : 1,
                backgroundColor: pc.green,
                borderRadius: 11,
                paddingHorizontal: 11,
                paddingVertical: 7,
                ...darkGreenShadow,
              }}
            >
              <MonoText weight="heavy" size={13} color={pc.onGreen}>
                {formatILS(row.payout_agorot)}
              </MonoText>
            </Pressy>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}
