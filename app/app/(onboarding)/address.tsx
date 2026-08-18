import { useRouter } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { TrustCard } from "@/components/TrustCard";
import { rpc } from "@/lib/supabase";
import { useAppState, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { spacing } from "@/ui/theme";
import { useRpcErrorToast } from "@/ui/Toast";

type Step = "address" | "entry_code";

export default function AddressScreen() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh } = useAppState();

  const [step, setStep] = useState<Step>("address");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [floor, setFloor] = useState("");
  const [apartment, setApartment] = useState("");
  const [doorNote, setDoorNote] = useState("");
  const [entryCode, setEntryCode] = useState("");
  const [saving, setSaving] = useState(false);

  const addressComplete =
    city.trim().length > 0 &&
    street.trim().length > 0 &&
    houseNumber.trim().length > 0 &&
    /^-?\d+$/.test(floor.trim()) &&
    apartment.trim().length > 0;

  const submit = async () => {
    setSaving(true);
    try {
      await rpc<string>("onboard_residency", {
        p_city: city.trim(),
        p_street: street.trim(),
        p_house_number: houseNumber.trim(),
        p_floor: Number.parseInt(floor.trim(), 10),
        p_apartment: apartment.trim(),
        p_entry_code: entryCode.trim().length > 0 ? entryCode.trim() : null,
        p_door_note: doorNote.trim().length > 0 ? doorNote.trim() : null,
      });
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
        <Screen title={str("onboarding.address_title")}>
          <View style={{ gap: spacing.md }}>
            <Field label={str("onboarding.city")} value={city} onChangeText={setCity} />
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
                label={str("onboarding.floor")}
                value={floor}
                onChangeText={setFloor}
                keyboardType="number-pad"
                mono
                style={{ flex: 1 }}
              />
              <Field
                label={str("onboarding.apartment")}
                value={apartment}
                onChangeText={setApartment}
                mono
                style={{ flex: 1 }}
              />
            </View>
            <Field
              label={str("onboarding.door_note")}
              value={doorNote}
              onChangeText={setDoorNote}
            />
            <Button
              // NOTE: 'common.continue' is not seeded yet — shows '!key' until
              // the strings workstream adds it.
              label={str("common.continue")}
              onPress={() => setStep("entry_code")}
              disabled={!addressComplete}
            />
          </View>
        </Screen>
      ) : (
        <Screen title={str("onboarding.entry_code_title")}>
          <View style={{ gap: spacing.lg }}>
            <TrustCard />
            <Field
              label={str("onboarding.entry_code_title")}
              value={entryCode}
              onChangeText={setEntryCode}
              keyboardType="number-pad"
              mono
            />
            <Button
              label={str("common.continue")}
              onPress={() => void submit()}
              loading={saving}
            />
          </View>
        </Screen>
      )}
    </KeyboardAvoidingView>
  );
}
