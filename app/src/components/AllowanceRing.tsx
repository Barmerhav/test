import React from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useStr } from "@/state/AppState";
import { colors, radii, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";

export interface AllowanceRingProps {
  included: number;
  used: number;
  credits: number;
  size?: number;
  strokeWidth?: number;
}

/** Remaining-allowance ring: fill proportion = remaining/included, big mono
 * remaining in the middle, small '+N' credits badge when credits exist. */
export function AllowanceRing({
  included,
  used,
  credits,
  size = 160,
  strokeWidth = 14,
}: AllowanceRingProps) {
  const str = useStr();
  const remaining = Math.max(0, included - used);
  const fraction = included > 0 ? Math.min(1, remaining / included) : 0;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;

  return (
    <View style={{ width: size, alignItems: "center" }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle
            cx={center}
            cy={center}
            r={r}
            stroke={colors.line}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx={center}
            cy={center}
            r={r}
            stroke={colors.success}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - fraction)}
            transform={`rotate(-90 ${center} ${center})`}
          />
        </Svg>
        <View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            start: 0,
            end: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MonoText bold size={size * 0.28} center>
            {remaining}
          </MonoText>
        </View>
      </View>
      <AppText weight="medium" size={14} color={colors.muted} center style={{ marginTop: spacing.xs }}>
        {str("home.allowance_left", { units: remaining })}
      </AppText>
      {credits > 0 ? (
        <View
          style={{
            marginTop: spacing.xs,
            backgroundColor: colors.card,
            borderColor: colors.success,
            borderWidth: 1,
            borderRadius: radii.chip,
            paddingHorizontal: spacing.sm,
            paddingVertical: 4,
          }}
        >
          <AppText weight="medium" size={13} color={colors.success}>
            {str("home.credits_left", { units: credits })}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}
