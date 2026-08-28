import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { formatILS, rpcErrorCode } from "@pinui/shared";
import { startOfToday } from "@/lib/dates";
import { rpc, supabase } from "@/lib/supabase";
import type { PayoutLineRow, VerifyResult } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { PButton, PScreen } from "@/ui/PickerUI";
import { fireHaptic } from "@/ui/Pressy";
import { pickerColors as pc, radii, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast, useToast } from "@/ui/Toast";

/** Static celebration sparkles (artboard 13). */
const SPARKLES: { x: number; y: number; s: number; o: number }[] = [
  { x: -110, y: -90, s: 10, o: 0.65 },
  { x: 120, y: -70, s: 6, o: 0.4 },
  { x: 95, y: 60, s: 8, o: 0.5 },
  { x: -95, y: 75, s: 7, o: 0.3 },
  { x: -40, y: 110, s: 5, o: 0.5 },
  { x: 45, y: -115, s: 9, o: 0.35 },
];

/** Bin-QR scan → verify → payday celebration. One scan closes every collected
 * door in the claim group (server-side). */
export default function FinishScreen() {
  const str = useStr();
  const router = useRouter();
  const { show } = useToast();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh } = useAppState();
  const params = useLocalSearchParams<{ claimId?: string; street?: string }>();
  const claimId = typeof params.claimId === "string" ? params.claimId : "";
  const street = typeof params.street === "string" ? params.street : "";

  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [lines, setLines] = useState<PayoutLineRow[]>([]);
  const scanningRef = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  // history for the daily-goal bar (best previous day = the goal)
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("payout_lines")
        .select("id,units,amount_agorot,created_at,payout_id")
        .order("created_at", { ascending: false })
        .limit(300);
      if (alive && !error && data) setLines(data as PayoutLineRow[]);
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  /** Daily goal derived from data, never hardcoded: the best previous day.
   * No history → no goal bar. */
  const bestPreviousDay = useMemo(() => {
    const today = startOfToday().getTime();
    const byDay = new Map<string, number>();
    for (const line of lines) {
      const d = new Date(line.created_at);
      if (d.getTime() >= today) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      byDay.set(key, (byDay.get(key) ?? 0) + line.amount_agorot);
    }
    let best = 0;
    for (const total of byDay.values()) best = Math.max(best, total);
    return best;
  }, [lines]);

  const onScanned = async (payload: string) => {
    if (scanningRef.current || result || !claimId) return;
    scanningRef.current = true;
    try {
      const res = await rpc<VerifyResult>("verify_bin_scan", {
        p_claim_id: claimId,
        p_qr_payload: payload,
      });
      void fireHaptic("success");
      setResult(res);
      void refresh();
    } catch (err) {
      if (rpcErrorCode(err) === "invalid_qr") {
        show(str("finish.wrong_qr"), "error");
      } else {
        rpcErrorToast(err);
      }
      setTimeout(() => {
        scanningRef.current = false;
      }, 2000);
    }
  };

  // ── celebration ──────────────────────────────────────────────────────
  if (result) {
    const goal = bestPreviousDay > 0 ? bestPreviousDay : null;
    const goalFraction = goal
      ? Math.min(1, result.today_total_agorot / goal)
      : null;
    return (
      <PScreen scroll={false}>
        <View style={{ alignItems: "center" }}>
          <View
            style={{
              backgroundColor: pc.badgeBg,
              borderRadius: radii.pill,
              paddingHorizontal: 14,
              paddingVertical: 7,
            }}
          >
            <AppText weight="bold" size={12.5} color={pc.greenSoft}>
              {str("finish.scanned", { street })}
            </AppText>
          </View>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {SPARKLES.map((sp, i) => (
            <View
              key={i}
              style={{
                position: "absolute",
                width: sp.s,
                height: sp.s,
                borderRadius: i % 3 === 2 ? 2 : 99,
                backgroundColor: pc.money,
                opacity: sp.o,
                transform: [{ translateX: sp.x }, { translateY: sp.y }],
              }}
            />
          ))}
          <MonoText weight="heavy" size={72} color={pc.money} center>
            {`+${formatILS(result.amount_agorot, { isolate: false })}`}
          </MonoText>
          <View
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              gap: spacing.sm,
              marginTop: spacing.md,
            }}
          >
            <AppText size={13.5} color={pc.muted}>
              {str("earnings.today")}
            </AppText>
            <MonoText weight="heavy" size={30} color={pc.text}>
              {formatILS(result.today_total_agorot)}
            </MonoText>
          </View>
          {goal && goalFraction !== null ? (
            <View style={{ width: "100%", maxWidth: 290, marginTop: spacing.lg }}>
              {/* goal = best previous day, derived from payout_lines */}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <AppText size={12} color={pc.muted}>
                  {str("finish.daily_goal")}
                </AppText>
                <MonoText size={11.5} color={pc.muted}>
                  {formatILS(goal)}
                </MonoText>
              </View>
              <View
                style={{
                  height: 8,
                  borderRadius: 99,
                  backgroundColor: pc.chip,
                  overflow: "hidden",
                  marginTop: 7,
                }}
              >
                <View
                  style={{
                    height: 8,
                    borderRadius: 99,
                    width: `${Math.round(goalFraction * 100)}%`,
                    backgroundColor: pc.green,
                  }}
                />
              </View>
            </View>
          ) : null}
        </View>
        <View style={{ gap: spacing.sm }}>
          <PButton
            label={str("finish.next_cta")}
            onPress={() => router.replace("/(picker)/(tabs)")}
            haptic="medium"
          />
          <PButton
            label={str("finish.enough_cta")}
            kind="ghost"
            onPress={() => router.replace("/(picker)/(tabs)")}
            compact
          />
        </View>
      </PScreen>
    );
  }

  // ── scanner ──────────────────────────────────────────────────────────
  return (
    <PScreen scroll={false} title={str("finish.scan_title")} contentStyle={{ gap: spacing.lg }}>
      {permission?.granted ? (
        <View style={{ flex: 1, borderRadius: radii.cardBig, overflow: "hidden" }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => void onScanned(data)}
          />
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg }}>
          <Ionicons name="camera-outline" size={56} color={pc.faint} />
          <AppText size={14.5} color={pc.muted} center>
            {str("common.camera_permission")}
          </AppText>
          {permission && !permission.canAskAgain ? (
            // permanently denied — the fix lives in system settings
            <PButton
              label={str("settings.title")}
              kind="ghost"
              onPress={() => void Linking.openSettings().catch(() => undefined)}
              compact
            />
          ) : (
            <PButton
              label={str("common.continue")}
              kind="ghost"
              onPress={() => void requestPermission()}
              compact
            />
          )}
        </View>
      )}
    </PScreen>
  );
}
