import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { countUnits } from "@pinui/shared";
import { base64ToArrayBuffer } from "@/lib/base64";
import { rpc, supabase } from "@/lib/supabase";
import type { ClaimRow, CollectAdjustment, StopRequestRow } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { PButton, PCard, PChip, PScreen } from "@/ui/PickerUI";
import { PICKER_TAP, pickerColors as pc, radii, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast, useToast } from "@/ui/Toast";

function Stepper({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.sm,
      }}
    >
      <AppText size={14} color={pc.text} style={{ flexShrink: 1 }}>
        {label}
      </AppText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange(Math.max(min, value - 1))}
          style={{
            width: PICKER_TAP - 8,
            height: PICKER_TAP - 8,
            borderRadius: (PICKER_TAP - 8) / 2,
            backgroundColor: pc.surface,
            borderWidth: 1,
            borderColor: pc.line,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="remove" size={22} color={pc.text} />
        </Pressable>
        <MonoText bold size={22} color={pc.text} center style={{ minWidth: 36 }}>
          {value}
        </MonoText>
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange(value + 1)}
          style={{
            width: PICKER_TAP - 8,
            height: PICKER_TAP - 8,
            borderRadius: (PICKER_TAP - 8) / 2,
            backgroundColor: pc.surface,
            borderWidth: 1,
            borderColor: pc.line,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="add" size={22} color={pc.text} />
        </Pressable>
      </View>
    </View>
  );
}

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
  const [ticked, setTicked] = useState<boolean[]>([]);
  const [adjusting, setAdjusting] = useState(false);
  const [largeBags, setLargeBags] = useState(0);
  const [smallBags, setSmallBags] = useState(0);
  const [oversizedBags, setOversizedBags] = useState(0);
  const [overweight, setOverweight] = useState(false);
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
    if (c) {
      const rRes = await supabase
        .from("requests")
        .select("id,units_requested,notes,residency_id,building_id,status")
        .eq("id", c.request_id)
        .limit(1);
      const r = ((rRes.data ?? []) as StopRequestRow[])[0] ?? null;
      setRequest(r);
      if (r) {
        setTicked(Array.from({ length: r.units_requested }, () => false));
        setLargeBags(r.units_requested);
      }
    }
  }, [claimId]);

  useEffect(() => {
    void load();
  }, [load]);

  const adjustment: CollectAdjustment | null = adjusting
    ? {
        large_bags: largeBags,
        small_bags: smallBags,
        oversized_bags: oversizedBags,
        small_group_overweight: overweight,
      }
    : null;

  const adjustedUnits = adjustment
    ? countUnits(unitRules, {
        largeBags: adjustment.large_bags,
        smallBags: adjustment.small_bags,
        oversizedBags: adjustment.oversized_bags,
        smallGroupOverweight: adjustment.small_group_overweight,
      })
    : (request?.units_requested ?? 0);

  const done = async () => {
    if (!claim) return;
    setBusy(true);
    try {
      await rpc("mark_collected", {
        p_claim_id: claim.id,
        p_adjustment: adjustment,
      });
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
    <PScreen title={str("collect.title")}>
      <View style={{ gap: spacing.lg }}>
        {/* per-unit checklist */}
        <PCard style={{ gap: spacing.sm }}>
          {ticked.map((t, i) => (
            <Pressable
              key={i}
              accessibilityRole="checkbox"
              onPress={() =>
                setTicked((prev) => prev.map((v, j) => (j === i ? !v : v)))
              }
              style={{
                minHeight: PICKER_TAP,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
              }}
            >
              <Ionicons
                name={t ? "checkmark-circle" : "ellipse-outline"}
                size={28}
                color={t ? pc.success : pc.muted}
              />
              <AppText size={15} color={pc.text}>
                {str("collect.unit_check", { n: i + 1 })}
              </AppText>
            </Pressable>
          ))}
        </PCard>

        {/* unit-counting chips / adjustment */}
        <PCard style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
            <PChip
              label={str("collect.chip_small")}
              selected={adjusting && smallBags > 0}
              onPress={() => {
                setAdjusting(true);
                setSmallBags((v) => (v > 0 ? 0 : unitRules.max_small_bags_per_unit));
              }}
              style={{ flexGrow: 1 }}
            />
            <PChip
              label={str("collect.chip_oversized")}
              selected={adjusting && oversizedBags > 0}
              onPress={() => {
                setAdjusting(true);
                setOversizedBags((v) => (v > 0 ? 0 : 1));
              }}
              style={{ flexGrow: 1 }}
            />
          </View>
          {adjusting ? (
            <View style={{ gap: spacing.md }}>
              <Stepper label={str("collect.chip_large")} value={largeBags} onChange={setLargeBags} />
              <Stepper label={str("collect.chip_small")} value={smallBags} onChange={setSmallBags} />
              <Stepper
                label={str("collect.chip_oversized")}
                value={oversizedBags}
                onChange={setOversizedBags}
              />
              <PChip
                label={str("collect.chip_overweight")}
                selected={overweight}
                onPress={() => setOverweight((v) => !v)}
              />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <AppText size={14} color={pc.muted}>
                  {str("submit.units_label")}
                </AppText>
                <MonoText bold size={24} color={pc.amber}>
                  {adjustedUnits}
                </MonoText>
              </View>
            </View>
          ) : null}
        </PCard>

        <PButton
          label={str("collect.done_cta")}
          onPress={() => void done()}
          loading={busy}
          disabled={!claim || adjustedUnits < 1}
        />

        {/* leak decline */}
        <PCard style={{ gap: spacing.sm }}>
          <PButton
            label={str("collect.leak_cta")}
            kind="danger"
            onPress={() => void openLeakCamera()}
          />
          <AppText size={12} color={pc.muted} center>
            {str("collect.leak_note")}
          </AppText>
        </PCard>
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
            <Pressable
              accessibilityRole="button"
              onPress={() => setCameraOpen(false)}
              style={{
                width: PICKER_TAP,
                height: PICKER_TAP,
                borderRadius: PICKER_TAP / 2,
                borderWidth: 1,
                borderColor: pc.line,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close" size={26} color={pc.text} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void captureLeak()}
              disabled={capturing}
              style={{
                width: PICKER_TAP + 16,
                height: PICKER_TAP + 16,
                borderRadius: (PICKER_TAP + 16) / 2,
                backgroundColor: capturing ? pc.line : pc.danger,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 4,
                borderColor: pc.paper,
              }}
            >
              <Ionicons name="camera" size={30} color={pc.ink} />
            </Pressable>
            <View style={{ width: PICKER_TAP, height: PICKER_TAP, borderRadius: radii.chip }} />
          </View>
        </View>
      </Modal>
    </PScreen>
  );
}
