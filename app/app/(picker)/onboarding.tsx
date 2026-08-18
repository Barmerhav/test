import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { rpc } from "@/lib/supabase";
import type { TaxStatus } from "@/lib/types";
import { useAppState, useStr } from "@/state/AppState";
import { PButton, PCard, PChip, PField, PScreen } from "@/ui/PickerUI";
import { pickerColors as pc, radii, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

type Step = "identity" | "tax" | "bank" | "training";

const BIRTHDATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isAtLeast18(birthdate: string): boolean {
  if (!BIRTHDATE_RE.test(birthdate)) return false;
  const d = new Date(`${birthdate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  return d.getTime() <= cutoff.getTime();
}

const TRAINING_RULES = [
  { key: "training.rule1", icon: "bag-check-outline" },
  { key: "training.rule2", icon: "barbell-outline" },
  { key: "training.rule3", icon: "water-outline" },
  { key: "training.rule4", icon: "qr-code-outline" },
] as const;

export default function PickerOnboarding() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh } = useAppState();
  const { width } = useWindowDimensions();

  const [step, setStep] = useState<Step>("identity");
  const [idNumber, setIdNumber] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [taxStatus, setTaxStatus] = useState<TaxStatus | null>(null);
  const [vatId, setVatId] = useState("");
  const [poaChecked, setPoaChecked] = useState(false);
  const [bank, setBank] = useState("");
  const [branch, setBranch] = useState("");
  const [account, setAccount] = useState("");
  const [page, setPage] = useState(0);
  const [maxPageSeen, setMaxPageSeen] = useState(0);
  const [saving, setSaving] = useState(false);
  const pagerRef = useRef<ScrollView | null>(null);

  const cardWidth = width - spacing.lg * 2;

  const identityOk = idNumber.trim().length >= 5 && isAtLeast18(birthdate.trim());
  const taxOk =
    taxStatus !== null &&
    poaChecked &&
    (taxStatus !== "murshe" || vatId.trim().length > 0);
  const bankOk =
    bank.trim().length > 0 && branch.trim().length > 0 && account.trim().length > 0;

  const submit = async () => {
    if (!taxStatus) return;
    setSaving(true);
    try {
      await rpc("register_picker", {
        p_birthdate: birthdate.trim(),
        p_id_number: idNumber.trim(),
        p_tax_status: taxStatus,
        p_poa_consent: poaChecked,
        p_bank_details: {
          bank: bank.trim(),
          branch: branch.trim(),
          account: account.trim(),
        },
        p_vat_id: taxStatus === "murshe" ? vatId.trim() : null,
      });
      await refresh();
      router.replace("/(picker)/pending");
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
      <PScreen title={str("picker.onb_title")}>
        {step === "identity" ? (
          <View style={{ gap: spacing.lg }}>
            <PField
              label={str("picker.id_number")}
              value={idNumber}
              onChangeText={setIdNumber}
              keyboardType="number-pad"
              mono
              maxLength={9}
            />
            <PField
              label={str("picker.birthdate")}
              value={birthdate}
              onChangeText={setBirthdate}
              keyboardType="numbers-and-punctuation"
              mono
              placeholder="YYYY-MM-DD"
              maxLength={10}
            />
            {birthdate.trim().length === 10 && !isAtLeast18(birthdate.trim()) ? (
              <AppText size={14} color={pc.danger}>
                {str("picker.underage")}
              </AppText>
            ) : null}
            <PButton
              label={str("common.continue")}
              onPress={() => setStep("tax")}
              disabled={!identityOk}
            />
          </View>
        ) : null}

        {step === "tax" ? (
          <View style={{ gap: spacing.lg }}>
            <AppText weight="medium" size={15} color={pc.text}>
              {str("picker.tax_status")}
            </AppText>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {(["patur", "murshe", "none"] as TaxStatus[]).map((ts) => (
                <PChip
                  key={ts}
                  label={str(`picker.tax_${ts}`)}
                  selected={taxStatus === ts}
                  onPress={() => setTaxStatus(ts)}
                  style={{ flex: 1 }}
                />
              ))}
            </View>
            {taxStatus === "murshe" ? (
              <PField
                label={str("picker.vat_id")}
                value={vatId}
                onChangeText={setVatId}
                keyboardType="number-pad"
                mono
              />
            ) : null}

            {/* PoA consent — must check to continue */}
            <Pressable accessibilityRole="checkbox" onPress={() => setPoaChecked((v) => !v)}>
              <PCard paper style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Ionicons
                    name={poaChecked ? "checkbox" : "square-outline"}
                    size={26}
                    color={poaChecked ? pc.success : pc.ink}
                  />
                  <AppText weight="bold" size={16} color={pc.ink} style={{ flex: 1 }}>
                    {str("picker.poa_title")}
                  </AppText>
                </View>
                <AppText size={14} color={pc.ink} style={{ lineHeight: 21 }}>
                  {str("picker.poa_body")}
                </AppText>
              </PCard>
            </Pressable>

            <PButton
              label={str("common.continue")}
              onPress={() => setStep("bank")}
              disabled={!taxOk}
            />
          </View>
        ) : null}

        {step === "bank" ? (
          <View style={{ gap: spacing.lg }}>
            <AppText weight="medium" size={15} color={pc.text}>
              {str("picker.bank_details")}
            </AppText>
            <PField
              label={str("picker.bank")}
              value={bank}
              onChangeText={setBank}
              keyboardType="number-pad"
              mono
            />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <PField
                label={str("picker.branch")}
                value={branch}
                onChangeText={setBranch}
                keyboardType="number-pad"
                mono
                style={{ flex: 1 }}
              />
              <PField
                label={str("picker.account")}
                value={account}
                onChangeText={setAccount}
                keyboardType="number-pad"
                mono
                style={{ flex: 2 }}
              />
            </View>
            <PButton
              label={str("common.continue")}
              onPress={() => setStep("training")}
              disabled={!bankOk}
            />
          </View>
        ) : null}

        {step === "training" ? (
          <View style={{ gap: spacing.lg }}>
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const p = Math.min(
                  TRAINING_RULES.length - 1,
                  Math.max(0, Math.round(e.nativeEvent.contentOffset.x / cardWidth)),
                );
                setPage(p);
                setMaxPageSeen((prev) => Math.max(prev, p));
              }}
              style={{ marginStart: -spacing.lg, marginEnd: -spacing.lg }}
              contentContainerStyle={{ paddingHorizontal: spacing.lg }}
            >
              {TRAINING_RULES.map((rule) => (
                <PCard
                  key={rule.key}
                  paper
                  style={{
                    width: cardWidth,
                    minHeight: 260,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing.lg,
                  }}
                >
                  <Ionicons name={rule.icon} size={72} color={pc.ink} />
                  <AppText weight="bold" size={20} color={pc.ink} center>
                    {str(rule.key)}
                  </AppText>
                </PCard>
              ))}
            </ScrollView>
            {/* page dots */}
            <View style={{ flexDirection: "row", justifyContent: "center", gap: spacing.xs }}>
              {TRAINING_RULES.map((rule, i) => (
                <View
                  key={rule.key}
                  style={{
                    width: i === page ? 22 : 8,
                    height: 8,
                    borderRadius: radii.chip,
                    backgroundColor: i === page ? pc.amber : pc.line,
                  }}
                />
              ))}
            </View>
            <PButton
              label={str("common.continue")}
              onPress={() => void submit()}
              loading={saving}
              disabled={maxPageSeen < TRAINING_RULES.length - 1}
            />
          </View>
        ) : null}
      </PScreen>
    </KeyboardAvoidingView>
  );
}
