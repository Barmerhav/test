import React, { useState } from "react";
import { Share, View } from "react-native";
import { BuildingMeterCard } from "@/components/BuildingMeterCard";
import { rpc } from "@/lib/supabase";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { colors, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast, useToast } from "@/ui/Toast";

/** Invite tab: the referral moment as a first-class destination — big mono
 * code, share CTA, building-meter tie-in (artboards 05c + 07). */
export default function InviteScreen() {
  const str = useStr();
  const { myState } = useAppState();
  const referral = useConfig("referral");
  const { show } = useToast();
  const rpcError = useRpcErrorToast();

  const code = myState?.user?.referral_code ?? "";

  // referee side: enter a neighbor's code (server enforces eligibility —
  // only before the first settled payment, once ever)
  const [friendCode, setFriendCode] = useState("");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const applyCode = async () => {
    setApplying(true);
    try {
      await rpc("apply_referral_code", { p_code: friendCode.trim() });
      setApplied(true);
      show(str("invite.applied"), "success");
    } catch (err) {
      rpcError(err);
    } finally {
      setApplying(false);
    }
  };

  const share = async () => {
    try {
      await Share.share({
        message: `${str("settings.referral_share", {
          units: referral.reward_units_each_side,
        })} ${code}`,
      });
    } catch {
      // share sheet dismissed
    }
  };

  return (
    <Screen title={str("invite.tab")}>
      <View style={{ gap: spacing.lg }}>
        <Card big mint style={{ gap: spacing.md, alignItems: "center", padding: 22 }}>
          <AppText weight="heavy" size={17} color={colors.inkDeep} center>
            {str("request.referral_moment", {
              units: referral.reward_units_each_side,
            })}
          </AppText>
          <View
            style={{
              alignSelf: "stretch",
              borderWidth: 1.5,
              borderStyle: "dashed",
              borderColor: colors.mintDashed,
              borderRadius: 12,
              paddingVertical: 16,
              backgroundColor: colors.mintField,
            }}
          >
            <MonoText weight="heavy" size={26} center style={{ letterSpacing: 3 }}>
              {code}
            </MonoText>
          </View>
          <AppText size={12.5} color={colors.text2} center>
            {str("settings.referral_share", { units: referral.reward_units_each_side })}
          </AppText>
          <Button
            label={str("settings.share_cta")}
            onPress={() => void share()}
            style={{ alignSelf: "stretch" }}
            haptic="medium"
          />
        </Card>

        {referral.enabled && !applied ? (
          <Card style={{ gap: spacing.sm }}>
            <AppText weight="bold" size={14.5}>
              {str("invite.have_code")}
            </AppText>
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" }}>
              <Field
                value={friendCode}
                onChangeText={(t) => setFriendCode(t.toUpperCase())}
                placeholder={str("invite.code_placeholder")}
                mono
                maxLength={12}
                style={{ flex: 1 }}
              />
              <Button
                label={str("invite.apply_cta")}
                onPress={() => void applyCode()}
                disabled={applying || friendCode.trim().length < 4}
                compact
              />
            </View>
          </Card>
        ) : null}

        <BuildingMeterCard />
      </View>
    </Screen>
  );
}
