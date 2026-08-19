import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { rpcErrorCode } from "@pinui/shared";
import { UpgradeSheet } from "@/components/UpgradeSheet";
import { defaultTtlKey, visibleTtlOptions } from "@/lib/ttl";
import { rpc } from "@/lib/supabase";
import type { RequestRow } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { fireHaptic, Pressy } from "@/ui/Pressy";
import { Screen } from "@/ui/Screen";
import { colors, radii, spacing, TAP } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

function StepperButton({
  icon,
  onPress,
  disabled,
}: {
  icon: "add" | "remove";
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressy
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      style={{
        width: TAP + 4,
        height: TAP + 4,
        borderRadius: (TAP + 4) / 2,
        backgroundColor: disabled ? colors.surface : colors.ink,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name={icon} size={24} color={disabled ? colors.faint : colors.card} />
    </Pressy>
  );
}

/** Submit sheet per artboard 04: title + subtitle, TTL chips (green ✓ fill),
 * bag stepper, hero CTA that flips into the success state. */
export default function SubmitSheet() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh, setActiveRequest } = useAppState();

  const unitRules = useConfig("unit_rules");
  const ttlConfig = useConfig("request_ttl_options");
  const timezone = useConfig("timezone");

  const maxUnits = unitRules.max_units_per_request;
  const [units, setUnits] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visible = useMemo(
    () => visibleTtlOptions(ttlConfig.options, timezone),
    [ttlConfig, timezone],
  );
  const [ttlKey, setTtlKey] = useState<string | null>(() =>
    defaultTtlKey(visibleTtlOptions(ttlConfig.options, timezone), ttlConfig.default),
  );
  const selectedTtl = visible.some((o) => o.key === ttlKey)
    ? ttlKey
    : defaultTtlKey(visible, ttlConfig.default);

  const submit = async () => {
    if (!selectedTtl || done) return;
    setSubmitting(true);
    try {
      const row = await rpc<RequestRow>("submit_request", {
        p_units: units,
        p_ttl_option: selectedTtl,
      });
      setActiveRequest(row);
      void refresh();
      void fireHaptic("success");
      setDone(true);
      closeTimer.current = setTimeout(() => router.back(), 1100);
    } catch (err) {
      if (rpcErrorCode(err) === "insufficient_allowance") {
        setShowUpgrade(true);
      } else {
        rpcErrorToast(err);
      }
    } finally {
      setSubmitting(false);
    }
  };

  React.useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <Screen>
      {/* grabber (modal sheet feel) */}
      <View
        style={{
          alignSelf: "center",
          width: 40,
          height: 5,
          borderRadius: 99,
          backgroundColor: colors.line,
          marginBottom: spacing.lg,
        }}
      />
      <View style={{ gap: spacing.xl }}>
        <View style={{ gap: 5 }}>
          <AppText weight="heavy" size={23}>
            {str("submit.title")}
          </AppText>
          <AppText size={14} color={colors.text2} style={{ lineHeight: 21 }}>
            {str("submit.subtitle")}
          </AppText>
        </View>

        {/* bag count stepper */}
        <View style={{ gap: spacing.sm }}>
          <AppText weight="bold" size={14.5}>
            {str("submit.units_label")}
          </AppText>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.xl,
              backgroundColor: colors.card,
              borderRadius: radii.cardBig,
              borderWidth: 1,
              borderColor: colors.lineSoft,
              paddingVertical: spacing.lg,
            }}
          >
            <StepperButton
              icon="remove"
              onPress={() => setUnits((u) => Math.max(1, u - 1))}
              disabled={units <= 1}
            />
            <MonoText weight="heavy" size={44} center style={{ minWidth: 72 }}>
              {units}
            </MonoText>
            <StepperButton
              icon="add"
              onPress={() => setUnits((u) => Math.min(maxUnits, u + 1))}
              disabled={units >= maxUnits}
            />
          </View>
          <AppText size={12.5} color={colors.muted} center>
            {str("submit.unit_hint")}
          </AppText>
        </View>

        {/* TTL chips (config-driven; past-cutoff hidden; green ✓ selected) */}
        <View style={{ gap: spacing.sm }}>
          <AppText weight="bold" size={14.5}>
            {str("submit.deadline_label")}
          </AppText>
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
            {visible.map((opt) => (
              <Chip
                key={opt.key}
                label={str(`ttl.${opt.key}`)}
                selected={selectedTtl === opt.key}
                onPress={() => setTtlKey(opt.key)}
                check
                style={{ flexGrow: 1 }}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Button
            label={done ? str("submit.success") : str("submit.cta")}
            kind={done ? "success" : "primary"}
            onPress={() => void submit()}
            disabled={!selectedTtl}
            loading={submitting}
            big
            haptic="medium"
          />
          <AppText size={11.5} color={colors.muted} center>
            {str("submit.cancel_hint")}
          </AppText>
        </View>
      </View>

      <UpgradeSheet
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        onUpgraded={() => {
          setShowUpgrade(false);
          // allowance just grew — retry immediately
          void submit();
        }}
      />
    </Screen>
  );
}
