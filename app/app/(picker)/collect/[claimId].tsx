import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, View } from "react-native";
import { countUnits } from "@pinui/shared";
import { base64ToArrayBuffer } from "@/lib/base64";
import { rpc, supabase } from "@/lib/supabase";
import type {
  ClaimRow,
  CollectAdjustment,
  StopBuildingRow,
  StopRequestRow,
  StopResidencyRow,
} from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { PButton, PCard, PScreen } from "@/ui/PickerUI";
import { fireHaptic, Pressy } from "@/ui/Pressy";
import { PICKER_TAP, pickerColors as pc, radii, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast, useToast } from "@/ui/Toast";

/** Collection per artboard 12: checklist per bag, ×2-oversized chips, leak
 * photo flow, one CTA that leads straight to the bin QR scan. */
export default function CollectScreen() {
  const str = useStr();
  const router = useRouter();
  const { show } = useToast();
  const rpcErrorToast = useRpcErrorToast();
  const { session } = useAppState();
  const unitRules = useConfig("unit_rules");
  const params = useLocalSearchParams<{ claimId?: string }>();
  const claimId = typeof params.claimId === "string" ? params.claimId : "";

  const [claim, setClaim] = useState<ClaimRow | null>(null);
  const [request, setRequest] = useState<StopRequestRow | null>(null);
  const [residency, setResidency] = useState<StopResidencyRow | null>(null);
  const [street, setStreet] = useState("");
  const [ticked, setTicked] = useState<boolean[]>([]);
  const [oversized, setOversized] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);

  // leak flow
  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const load = useCallback(async () => {
    if (!claimId) return;
    const cRes = await supabase.from("claims").select("*").eq("id", claimId).limit(1);
    const c = ((cRes.data ?? []) as ClaimRow[])[0] ?? null;
    setClaim(c);
    if (!c) return;
    const rRes = await supabase
      .from("requests")
      .select("id,units_requested,notes,residency_id,building_id,status")
      .eq("id", c.request_id)
      .limit(1);
    const r = ((rRes.data ?? []) as StopRequestRow[])[0] ?? null;
    setRequest(r);
    if (!r) return;
    setTicked(Array.from({ length: r.units_requested }, () => false));
    setOversized(Array.from({ length: r.units_requested }, () => false));
    const [resRes, bRes] = await Promise.all([
      supabase
        .from("residencies")
        .select("id,floor,apartment,door_note")
        .eq("id", r.residency_id)
        .limit(1),
      supabase
        .from("buildings")
        .select("id,street,house_number,city,lat,lng,bin_location_note")
        .eq("id", r.building_id)
        .limit(1),
    ]);
    setResidency(((resRes.data ?? []) as StopResidencyRow[])[0] ?? null);
    const b = ((bRes.data ?? []) as StopBuildingRow[])[0] ?? null;
    if (b) setStreet(`${b.street} ${b.house_number}`);
  }, [claimId]);

  useEffect(() => {
    void load();
  }, [load]);

  const oversizedCount = oversized.filter(Boolean).length;
  const tickedCount = ticked.filter(Boolean).length;
  const requested = request?.units_requested ?? 0;

  /** ×2 chips → adjustment; untouched → null (server counts as requested). */
  const adjustment: CollectAdjustment | null = useMemo(() => {
    if (oversizedCount === 0) return null;
    return {
      large_bags: Math.max(0, requested - oversizedCount),
      small_bags: 0,
      oversized_bags: oversizedCount,
    };
  }, [oversizedCount, requested]);

  const countedUnits = adjustment
    ? countUnits(unitRules, {
        largeBags: adjustment.large_bags,
        smallBags: adjustment.small_bags,
        oversizedBags: adjustment.oversized_bags,
      })
    : requested;

  const done = async () => {
    if (!claim) return;
    setBusy(true);
    try {
      await rpc("mark_collected", {
        p_claim_id: claim.id,
        p_adjustment: adjustment,
      });
      void fireHaptic("success");
      router.back();
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setBusy(false);
    }
  };

  const openLeakCamera = async () => {
    if (!permission?.granted) {
      const p = await requestPermission();
      if (!p.granted) {
        show(str("common.camera_permission"), "error");
        return;
      }
    }
    setCameraOpen(true);
  };

  const captureLeak = async () => {
    const uid = session?.user.id;
    if (!claim || !request || !uid || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        base64: true,
        quality: 0.6,
      });
      if (!photo?.base64) throw new Error("photo_required");
      // RLS: first path segment must be the picker's uid
      const path = `${uid}/${request.id}-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("leak-photos")
        .upload(path, base64ToArrayBuffer(photo.base64), {
          contentType: "image/jpeg",
        });
      if (upErr) throw upErr;
      await rpc("register_leak_photo", {
        p_request_id: request.id,
        p_storage_path: path,
      });
      await rpc("decline_leak", { p_claim_id: claim.id, p_photo_path: path });
      setCameraOpen(false);
      show(str("collect.leak_note"), "success");
      router.back();
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <PScreen
      title={str("collect.title", { street })}
      headerEnd={
        <MonoText weight="heavy" size={16} color={pc.money}>
          {`${tickedCount}/${requested}`}
        </MonoText>
      }
    >
      <View style={{ gap: spacing.md }}>
        {/* progress */}
        <View
          style={{
            height: 6,
            borderRadius: 99,
            backgroundColor: pc.chip,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: 6,
              borderRadius: 99,
              width: `${requested > 0 ? Math.round((tickedCount / requested) * 100) : 0}%`,
              backgroundColor: pc.green,
            }}
          />
        </View>

        {residency?.door_note || request?.notes ? (
          <AppText size={12} color={pc.faint}>
            {[residency?.door_note, request?.notes].filter(Boolean).join(" · ")}
          </AppText>
        ) : null}

        {/* per-bag checklist with ×2 chips */}
        <View style={{ gap: spacing.sm }}>
          {ticked.map((t, i) => {
            const over = oversized[i] ?? false;
            return (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  backgroundColor: pc.surface,
                  borderWidth: 1,
                  borderColor: pc.line,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  minHeight: 64,
                }}
              >
                <Pressy
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: t }}
                  onPress={() =>
                    setTicked((prev) => prev.map((v, j) => (j === i ? !v : v)))
                  }
                  haptic="light"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 99,
                    backgroundColor: t ? pc.green : "transparent",
                    borderWidth: t ? 0 : 2,
                    borderColor: pc.lineStrong,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {t ? <Ionicons name="checkmark" size={18} color={pc.onGreen} /> : null}
                </Pressy>
                <View style={{ flex: 1, gap: 1 }}>
                  <AppText weight="bold" size={14.5} color={pc.text}>
                    {str("collect.unit_check", { n: i + 1 })}
                  </AppText>
                  {over ? (
                    <AppText size={11} color={pc.muted}>
                      {str("collect.counts_as", { units: unitRules.oversized_multiplier })}
                    </AppText>
                  ) : null}
                </View>
                <Pressy
                  accessibilityRole="button"
                  onPress={() =>
                    setOversized((prev) => prev.map((v, j) => (j === i ? !v : v)))
                  }
                  haptic="light"
                  style={{
                    borderRadius: radii.pill,
                    borderWidth: 1.5,
                    borderColor: over ? pc.green : pc.lineStrong,
                    backgroundColor: over ? pc.glowSoft : "transparent",
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                  }}
                >
                  <AppText weight="bold" size={11.5} color={over ? pc.money : pc.muted}>
                    {str("collect.chip_oversized")}
                  </AppText>
                </Pressy>
              </View>
            );
          })}
        </View>

        {/* live recount when chips changed */}
        {adjustment ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 4,
            }}
          >
            <AppText size={12.5} color={pc.muted}>
              {str("submit.units_label")}
            </AppText>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <AppText size={12} color={pc.faint}>
                {str("collect.counts_as", { units: countedUnits })}
              </AppText>
              <MonoText weight="heavy" size={20} color={pc.money}>
                {countedUnits}
              </MonoText>
            </View>
          </View>
        ) : null}

        {/* leak decline */}
        <PCard dashed style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 99,
              backgroundColor: pc.chip,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="camera-outline" size={19} color={pc.muted} />
          </View>
          <Pressy
            accessibilityRole="button"
            onPress={() => void openLeakCamera()}
            style={{ flex: 1, minHeight: PICKER_TAP - 12, justifyContent: "center" }}
          >
            <AppText weight="bold" size={14} color={pc.text}>
              {str("collect.leak_cta")}
            </AppText>
            <AppText size={11.5} color={pc.muted} style={{ marginTop: 2 }}>
              {str("collect.leak_note")}
            </AppText>
          </Pressy>
        </PCard>

        <View style={{ gap: spacing.xs }}>
          <PButton
            label={str("collect.done_cta")}
            onPress={() => void done()}
            loading={busy}
            disabled={!claim || tickedCount < requested}
            haptic="medium"
          />
          <AppText size={11.5} color={pc.faint} center>
            {str("collect.done_note")}
          </AppText>
        </View>
      </View>

      {/* leak photo capture */}
      <Modal visible={cameraOpen} animationType="slide" onRequestClose={() => setCameraOpen(false)}>
        <View style={{ flex: 1, backgroundColor: pc.bg }}>
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-around",
              padding: spacing.lg,
              backgroundColor: pc.bg,
            }}
          >
            <Pressy
              accessibilityRole="button"
              onPress={() => setCameraOpen(false)}
              style={{
                width: PICKER_TAP,
                height: PICKER_TAP,
                borderRadius: PICKER_TAP / 2,
                borderWidth: 1.5,
                borderColor: pc.lineStrong,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close" size={26} color={pc.text} />
            </Pressy>
            <Pressy
              accessibilityRole="button"
              onPress={() => void captureLeak()}
              disabled={capturing}
              haptic="medium"
              style={{
                width: PICKER_TAP + 16,
                height: PICKER_TAP + 16,
                borderRadius: (PICKER_TAP + 16) / 2,
                backgroundColor: capturing ? pc.chip : pc.danger,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 4,
                borderColor: pc.text,
              }}
            >
              <Ionicons name="camera" size={30} color={pc.ink} />
            </Pressy>
            <View style={{ width: PICKER_TAP, height: PICKER_TAP }} />
          </View>
        </View>
      </Modal>
    </PScreen>
  );
}
