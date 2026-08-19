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
  /** hide the caption + credits badge (compact usage-header variant) */
  compact?: boolean;
}

/** Allowance ring per artboard 03: deep-green arc on a soft track, big mono
 * "remaining/included" center, caption home.allowance_left. */
export function AllowanceRing({
  included,
  used,
  credits,
  size = 172,
  strokeWidth = 13,
  compact,
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
            stroke={colors.ringTrack}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx={center}
            cy={center}
            r={r}
            stroke={colors.greenDeep}
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
            gap: 2,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <MonoText weight="heavy" size={size * 0.23}>
              {remaining}
            </MonoText>
            <MonoText weight="heavy" size={size * 0.128} color={colors.faint}>
              {`/${included}`}
            </MonoText>
          </View>
          {!compact ? (
            <AppText
              weight="semibold"
              size={12.5}
              color={colors.text2}
              center
              style={{ maxWidth: size * 0.8 }}
            >
              {str("home.allowance_left")}
            </AppText>
          ) : null}
        </View>
      </View>
      {!compact && credits > 0 ? (
        <View
          style={{
            marginTop: spacing.xs,
            backgroundColor: colors.mint,
            borderRadius: radii.pill,
            paddingHorizontal: spacing.sm,
            paddingVertical: 4,
          }}
        >
          {/* LTR isolation so the leading '+' never bidi-flips to '3+' */}
          <AppText
            weight="bold"
            size={12.5}
            color={colors.greenDeep}
            style={{ writingDirection: "ltr" }}
          >
            {str("home.credits_left", { units: credits })}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}
