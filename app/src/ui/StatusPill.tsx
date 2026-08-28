/** ONE StatusPill component per the shared-components artboard — every state
 * of a request/claim as a rounded pill. Labels come from strings pill.*. */
import React from "react";
import { View } from "react-native";
import type { RequestStatus } from "@pinui/shared";
import { useStr } from "@/state/AppState";
import { AppText } from "./Text";
import { colors, pickerColors, radii } from "./theme";

export type PillKind =
  | "out"
  | "claimed"
  | "collected"
  | "credit"
  | "waiting_resident"
  | "open"
  | "mine"
  | "paid";

interface PillStyle {
  bg: string;
  fg: string;
  border?: string;
  dashed?: boolean;
}

/** Colors verified against the SHARED COMPONENTS artboard. */
const PILL: Record<PillKind, PillStyle> = {
  out: { bg: colors.pillOutBg, fg: colors.pillOutText },
  claimed: { bg: colors.mint, fg: colors.greenDeep },
  collected: { bg: colors.greenDeep, fg: colors.card },
  credit: { bg: colors.pillCreditBg, fg: colors.pillCreditText },
  waiting_resident: {
    bg: "transparent",
    fg: colors.pillWaitText,
    border: colors.pillWaitBorder,
    dashed: true,
  },
  open: { bg: pickerColors.surface, fg: pickerColors.money },
  mine: { bg: pickerColors.surface, fg: pickerColors.greenSoft },
  paid: { bg: pickerColors.greenSoft, fg: pickerColors.bg },
};

/** Dark-theme variant of the waiting pill (feed cards). */
const PILL_WAIT_DARK: PillStyle = {
  bg: "transparent",
  fg: pickerColors.money,
  border: pickerColors.green,
};

export function pillKindForStatus(status: RequestStatus): PillKind | null {
  switch (status) {
    case "submitted":
    case "open":
      return "out";
    case "claimed":
      return "claimed";
    case "resident_approval":
    case "put_out_prompt":
      return "waiting_resident";
    case "collected":
    case "verified":
      return "collected";
    case "paid":
      return "paid";
    case "expired":
    case "noshow":
      return "credit";
    default:
      return null;
  }
}

export function StatusPill({ kind, dark }: { kind: PillKind; dark?: boolean }) {
  const str = useStr();
  const s = dark && kind === "waiting_resident" ? PILL_WAIT_DARK : PILL[kind];
  const paidResident = kind === "paid" && !dark;
  const style: PillStyle = paidResident ? { bg: colors.greenDeep, fg: colors.card } : s;
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: style.bg,
        borderRadius: radii.pill,
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderWidth: style.border ? 1.5 : 0,
        borderColor: style.border,
        borderStyle: style.dashed ? "dashed" : "solid",
      }}
    >
      <AppText weight="bold" size={11.5} color={style.fg}>
        {str(`pill.${kind}`)}
      </AppText>
    </View>
  );
}
