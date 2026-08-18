import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { formatILS, rpcErrorCode } from "@pinui/shared";
import { rpc } from "@/lib/supabase";
import type { VerifyResult } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { PButton, PScreen } from "@/ui/PickerUI";
import { pickerColors as pc, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast, useToast } from "@/ui/Toast";

/** Bin-QR scan → verify → full-screen celebration. One scan closes every
 * collected door in the claim group (server-side). */
export default function FinishScreen() {
  const str = useStr();
  const router = useRouter();
  const { show } = useToast();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh } = useAppState();
  const params = useLocalSearchParams<{ claimId?: string }>();
  const claimId = typeof params.claimId === "string" ? params.claimId : "";

  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const scanningRef = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const onScanned = async (payload: string) => {
    if (scanningRef.current || result || !claimId) return;
    scanningRef.current = true;
    try {
      const res = await rpc<VerifyResult>("verify_bin_scan", {
        p_claim_id: claimId,
        p_qr_payload: payload,
      });
      setResult(res);
      void refresh();
    } catch (err) {
      if (rpcErrorCode(err) === "invalid_qr") {
        show(str("finish.wrong_qr"), "error");
      } else {
        rpcErrorToast(err);
      }
      // allow another scan after a short pause
      setTimeout(() => {
        scanningRef.current = false;
      }, 2000);
    }
  };

  // ── celebration ──────────────────────────────────────────────────────
  if (result) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: pc.amber,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xl,
          gap: spacing.lg,
        }}
      >
        <Ionicons name="sparkles" size={64} color={pc.ink} />
        <MonoText bold size={64} color={pc.ink} center>
          {formatILS(result.amount_agorot)}
        </MonoText>
        <AppText weight="bold" size={18} color={pc.ink} center>
          {str("finish.celebration", {
            amount: formatILS(result.amount_agorot),
            total: formatILS(result.today_total_agorot),
          })}
        </AppText>
        <PButton
          label={str("common.continue")}
          kind="ghost"
          onPress={() => router.replace("/(picker)/(tabs)")}
          style={{ alignSelf: "stretch", borderColor: pc.ink }}
        />
      </View>
    );
  }

  // ── scanner ──────────────────────────────────────────────────────────
  return (
    <PScreen scroll={false} title={str("finish.scan_title")} contentStyle={{ gap: spacing.lg }}>
      {permission?.granted ? (
        <View style={{ flex: 1, borderRadius: 20, overflow: "hidden" }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => void onScanned(data)}
          />
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg }}>
          <Ionicons name="camera-outline" size={56} color={pc.muted} />
          <AppText size={15} color={pc.muted} center>
            {str("common.camera_permission")}
          </AppText>
          <PButton
            label={str("common.continue")}
            kind="ghost"
            onPress={() => void requestPermission()}
          />
        </View>
      )}
    </PScreen>
  );
}
