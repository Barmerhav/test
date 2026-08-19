import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { TrustCard } from "@/components/TrustCard";
import { rpc } from "@/lib/supabase";
import { useAppState, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { fireHaptic, Pressy } from "@/ui/Pressy";
import { Screen } from "@/ui/Screen";
import { colors, radii, spacing, TAP } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

type Step = "address" | "entry_code";

/** Numeric stepper row (design 01b: floor/apartment with − / + controls). */
function StepperRow({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
}) {
  const StepBtn = ({ icon, onPress }: { icon: "add" | "remove"; onPress: () => void }) => (
    <Pressy
      accessibilityRole="button"
      onPress={onPress}
      haptic="light"
      style={{
        width: 40,
        height: 40,
        borderRadius: 99,
        backgroundColor: colors.surface,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name={icon} size={20} color={colors.ink} />
    </Pressy>
  );
  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: colors.card,
        borderWidth: 1.5,
        borderColor: colors.line,
        borderRadius: radii.field,
        paddingHorizontal: 8,
        paddingVertical: 6,
        gap: 4,
      }}
    >
      <StepBtn icon="remove" onPress={() => onChange(Math.max(min, value - 1))} />
      <View style={{ alignItems: "center" }}>
        <AppText size={11} color={colors.muted}>
          {label}
        </AppText>
        <MonoText weight="heavy" size={18}>
          {value}
        </MonoText>
      </View>
      <StepBtn icon="add" onPress={() => onChange(value + 1)} />
    </View>
  );
}

/** Onboarding 2/3 + 3/3 per artboards 01b–01c: address, then the trust moment. */
export default function AddressScreen() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh } = useAppState();

  const [step, setStep] = useState<Step>("address");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [floor, setFloor] = useState(1);
  const [apartment, setApartment] = useState(1);
  const [doorNote, setDoorNote] = useState("");
  const [entryCode, setEntryCode] = useState("");
  const [saving, setSaving] = useState(false);

  const addressComplete =
    city.trim().length > 0 && street.trim().length > 0 && houseNumber.trim().length > 0;

  const submit = async (withCode: boolean) => {
    setSaving(true);
    try {
      await rpc<string>("onboard_residency", {
        p_city: city.trim(),
        p_street: street.trim(),
        p_house_number: houseNumber.trim(),
        p_floor: floor,
        p_apartment: String(apartment),
        p_entry_code: withCode && entryCode.trim().length > 0 ? entryCode.trim() : null,
        p_door_note: doorNote.trim().length > 0 ? doorNote.trim() : null,
      });
      void fireHaptic("success");
      await refresh();
      router.replace("/(onboarding)/plan");
    } catch (err) {
      rpcErrorToast(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {step === "address" ? (
        <Screen title={str("onboarding.address_title")} subtitle={str("onboarding.address_sub")}>
          <View style={{ gap: spacing.md }}>
            <Field label={str("onboarding.street")} value={street} onChangeText={setStreet} />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <Field
                label={str("onboarding.house_number")}
                value={houseNumber}
                onChangeText={setHouseNumber}
                mono
                style={{ flex: 1 }}
              />
              <Field
                label={str("onboarding.city")}
                value={city}
                onChangeText={setCity}
                style={{ flex: 2 }}
              />
            </View>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <StepperRow
                label={str("onboarding.floor")}
                value={floor}
                onChange={setFloor}
                min={0}
              />
              <StepperRow
                label={str("onboarding.apartment")}
                value={apartment}
                onChange={setApartment}
                min={1}
              />
            </View>
            <Field
              label={str("onboarding.door_note")}
              value={doorNote}
              onChangeText={setDoorNote}
            />
            <Button
              label={str("common.continue")}
              onPress={() => setStep("entry_code")}
              disabled={!addressComplete}
              haptic="medium"
            />
          </View>
        </Screen>
      ) : (
        <Screen
          title={str("onboarding.entry_code_title")}
          subtitle={str("onboarding.entry_code_sub")}
        >
          <View style={{ gap: spacing.lg }}>
            <Field
              value={entryCode}
              onChangeText={setEntryCode}
              keyboardType="number-pad"
              mono
              autoFocus
            />
            <TrustCard />
            <Button
              label={str("onboarding.save_cta")}
              onPress={() => void submit(true)}
              loading={saving}
              big
              haptic="medium"
            />
            <Pressy
              accessibilityRole="button"
              onPress={() => void submit(false)}
              disabled={saving}
              style={{ minHeight: TAP, alignItems: "center", justifyContent: "center" }}
            >
              <AppText weight="semibold" size={13.5} color={colors.muted}>
                {str("onboarding.no_code")}
              </AppText>
            </Pressy>
          </View>
        </Screen>
      )}
    </KeyboardAvoidingView>
  );
}
