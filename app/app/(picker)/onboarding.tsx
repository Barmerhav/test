import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { rpc } from "@/lib/supabase";
import type { TaxStatus } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { PButton, PCard, PChip, PField, PScreen } from "@/ui/PickerUI";
import { fireHaptic, Pressy } from "@/ui/Pressy";
import { pickerColors as pc, radii, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

type Step = "identity" | "tax" | "bank" | "training";

const STEPS: Step[] = ["identity", "tax", "bank", "training"];

const BIRTHDATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isAtLeast18(birthdate: string): boolean {
  if (!BIRTHDATE_RE.test(birthdate)) return false;
  const d = new Date(`${birthdate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  return d.getTime() <= cutoff.getTime();
}

function ProgressDots({ step }: { step: Step }) {
  const idx = STEPS.indexOf(step);
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 6,
        justifyContent: "center",
        marginBottom: spacing.lg,
      }}
    >
      {STEPS.map((s, i) => (
        <View
          key={s}
          style={{
            width: i === idx ? 22 : 7,
            height: 7,
            borderRadius: 99,
            backgroundColor: i <= idx ? pc.green : pc.chip,
          }}
        />
      ))}
    </View>
  );
}

/** Picker onboarding per artboards 09a/09b — under 3 minutes, promised. */
export default function PickerOnboarding() {
  const str = useStr();
  const router = useRouter();
  const rpcErrorToast = useRpcErrorToast();
  const { refresh } = useAppState();
  const { width } = useWindowDimensions();
  const unitRules = useConfig("unit_rules");

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

  const cardWidth = width - 18 * 2;

  const trainingRules: { key: string; icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; sub: string | null }[] = [
    {
      key: "rule1",
      icon: "bag-check-outline",
      title: str("training.rule1"),
      sub: str("training.rule1_sub"),
    },
    {
      key: "rule2",
      icon: "barbell-outline",
      title: str("training.rule2", { kg: unitRules.max_kg_per_unit }),
      sub: null,
    },
    { key: "rule3", icon: "water-outline", title: str("training.rule3"), sub: null },
    { key: "rule4", icon: "qr-code-outline", title: str("training.rule4"), sub: null },
  ];

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
      void fireHaptic("success");
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
      <PScreen>
        <ProgressDots step={step} />

        {step === "identity" ? (
          <View style={{ gap: spacing.lg }}>
            <AppText weight="heavy" size={21} color={pc.text} style={{ lineHeight: 30 }}>
              {str("picker.onb_title")}
            </AppText>
            {/* checklist header */}
            <View style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                <AppText weight="bold" size={13.5} color={pc.money}>
                  {str("picker.phone_verified")}
                </AppText>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                <Ionicons name="ellipse-outline" size={13} color={pc.muted} />
                <AppText weight="bold" size={13.5} color={pc.muted}>
                  {str("picker.id_step")}
                </AppText>
              </View>
            </View>
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
              <AppText size={13.5} color={pc.danger}>
                {str("picker.underage")}
              </AppText>
            ) : null}
            <PButton
              label={str("common.continue")}
              onPress={() => setStep("tax")}
              disabled={!identityOk}
              haptic="medium"
            />
          </View>
        ) : null}

        {step === "tax" ? (
          <View style={{ gap: spacing.lg }}>
            <View style={{ gap: 4 }}>
              <AppText weight="heavy" size={21} color={pc.text}>
                {str("picker.tax_status")}
              </AppText>
              <AppText size={13.5} color={pc.muted}>
                {str("picker.tax_sub")}
              </AppText>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {(["patur", "murshe", "none"] as TaxStatus[]).map((ts) => (
                <PChip
                  key={ts}
                  label={str(`picker.tax_${ts}`)}
                  selected={taxStatus === ts}
                  onPress={() => setTaxStatus(ts)}
                  style={{ flex: 1 }}
                  badge={ts === "none" ? str("picker.tax_none_hint") : undefined}
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

            {/* PoA — we issue the invoices */}
            <PCard style={{ gap: spacing.sm, padding: 18 }}>
              <AppText weight="heavy" size={15.5} color={pc.text}>
                {str("picker.poa_title")}
              </AppText>
              <AppText size={13} color={pc.muted} style={{ lineHeight: 19 }}>
                {str("picker.poa_body")}
              </AppText>
              <Pressy
                accessibilityRole="checkbox"
                accessibilityState={{ checked: poaChecked }}
                onPress={() => setPoaChecked((v) => !v)}
                haptic="light"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  minHeight: 44,
                }}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    borderWidth: poaChecked ? 0 : 2,
                    borderColor: pc.lineStrong,
                    backgroundColor: poaChecked ? pc.green : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {poaChecked ? (
                    <Ionicons name="checkmark" size={15} color={pc.onGreen} />
                  ) : null}
                </View>
                <AppText weight="bold" size={13} color={pc.text} style={{ flex: 1 }}>
                  {str("picker.poa_consent")}
                </AppText>
              </Pressy>
            </PCard>

            <PButton
              label={str("picker.to_bank_cta")}
              onPress={() => setStep("bank")}
              disabled={!taxOk}
              haptic="medium"
            />
          </View>
        ) : null}

        {step === "bank" ? (
          <View style={{ gap: spacing.lg }}>
            <AppText weight="heavy" size={21} color={pc.text}>
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
              haptic="medium"
            />
          </View>
        ) : null}

        {step === "training" ? (
          <View style={{ gap: spacing.lg }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <AppText weight="heavy" size={21} color={pc.text}>
                {str("training.title")}
              </AppText>
              <MonoText weight="heavy" size={15} color={pc.money}>
                {`${page + 1}/${trainingRules.length}`}
              </MonoText>
            </View>
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const p = Math.min(
                  trainingRules.length - 1,
                  Math.max(0, Math.round(e.nativeEvent.contentOffset.x / cardWidth)),
                );
                setPage(p);
                setMaxPageSeen((prev) => Math.max(prev, p));
              }}
              style={{ marginStart: -18, marginEnd: -18 }}
              contentContainerStyle={{ paddingHorizontal: 18 }}
            >
              {trainingRules.map((rule) => (
                <View
                  key={rule.key}
                  style={{
                    width: cardWidth,
                    minHeight: 280,
                    borderRadius: radii.cardBig,
                    backgroundColor: pc.surface,
                    borderWidth: 1,
                    borderColor: pc.line,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing.md,
                    padding: spacing.lg,
                  }}
                >
                  <View
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: 99,
                      backgroundColor: pc.chip,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={rule.icon} size={46} color={pc.money} />
                  </View>
                  <AppText weight="heavy" size={21} color={pc.text} center>
                    {rule.title}
                  </AppText>
                  {rule.sub ? (
                    <AppText size={13.5} color={pc.muted} center style={{ lineHeight: 20 }}>
                      {rule.sub}
                    </AppText>
                  ) : null}
                </View>
              ))}
            </ScrollView>
            {/* dots + swipe hint */}
            <View style={{ alignItems: "center", gap: spacing.xs }}>
              <View style={{ flexDirection: "row", gap: spacing.xs }}>
                {trainingRules.map((rule, i) => (
                  <View
                    key={rule.key}
                    style={{
                      width: i === page ? 22 : 8,
                      height: 8,
                      borderRadius: 99,
                      backgroundColor: i === page ? pc.green : pc.chip,
                    }}
                  />
                ))}
              </View>
              {maxPageSeen < trainingRules.length - 1 ? (
                <AppText size={11.5} color={pc.faint}>
                  {str("training.swipe_hint")}
                </AppText>
              ) : null}
            </View>
            <PButton
              label={str("training.start_cta")}
              onPress={() => void submit()}
              loading={saving}
              disabled={maxPageSeen < trainingRules.length - 1}
              haptic="medium"
            />
          </View>
        ) : null}
      </PScreen>
    </KeyboardAvoidingView>
  );
}
