import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { rpcErrorCode } from "@pinui/shared";
import { UpgradeSheet } from "@/components/UpgradeSheet";
import { defaultTtlKey, visibleTtlOptions } from "@/lib/ttl";
import { rpc } from "@/lib/supabase";
import type { RequestRow } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
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
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: TAP + 8,
        height: TAP + 8,
        borderRadius: (TAP + 8) / 2,
        backgroundColor: disabled ? colors.line : colors.ink,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={26} color={disabled ? colors.muted : colors.card} />
    </Pressable>
  );
}

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
  const [showUpgrade, setShowUpgrade] = useState(false);

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
    if (!selectedTtl) return;
    setSubmitting(true);
    try {
      const row = await rpc<RequestRow>("submit_request", {
        p_units: units,
        p_ttl_option: selectedTtl,
      });
      setActiveRequest(row);
      void refresh();
      router.back();
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

  return (
    <Screen title={str("submit.title")}>
      <View style={{ gap: spacing.xl }}>
        {/* unit stepper */}
        <View style={{ gap: spacing.sm }}>
          <AppText weight="medium" size={15}>
            {str("submit.units_label")}
          </AppText>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.xl,
              backgroundColor: colors.card,
              borderRadius: radii.card,
              borderWidth: 1,
              borderColor: colors.line,
              paddingVertical: spacing.lg,
            }}
          >
            <StepperButton
              icon="remove"
              onPress={() => setUnits((u) => Math.max(1, u - 1))}
              disabled={units <= 1}
            />
            <MonoText bold size={44} center style={{ minWidth: 72 }}>
              {units}
            </MonoText>
            <StepperButton
              icon="add"
              onPress={() => setUnits((u) => Math.min(maxUnits, u + 1))}
              disabled={units >= maxUnits}
            />
          </View>
          <AppText size={13} color={colors.muted} center>
            {str("submit.unit_hint")}
          </AppText>
        </View>

        {/* TTL chips (config-driven; past-cutoff options hidden) */}
        <View style={{ gap: spacing.sm }}>
          <AppText weight="medium" size={15}>
            {str("submit.deadline_label")}
          </AppText>
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
            {visible.map((opt) => (
              <Chip
                key={opt.key}
                label={str(`ttl.${opt.key}`)}
                selected={selectedTtl === opt.key}
                onPress={() => setTtlKey(opt.key)}
                style={{ flexGrow: 1 }}
              />
            ))}
          </View>
        </View>

        <Button
          label={str("submit.cta")}
          onPress={() => void submit()}
          disabled={!selectedTtl}
          loading={submitting}
        />
      </View>

      <UpgradeSheet
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        onUpgraded={() => {
          setShowUpgrade(false);
          // allowance just grew — retry the submit immediately
          void submit();
        }}
      />
    </Screen>
  );
}
