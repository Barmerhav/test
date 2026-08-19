import React from "react";
import { View } from "react-native";
import { useStr } from "@/state/AppState";
import { AppText } from "./Text";
import { colors, pickerColors } from "./theme";

/** The Lemata wordmark: app name + green period. */
export function Brand({ size = 21, dark }: { size?: number; dark?: boolean }) {
  const str = useStr();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline" }}>
      <AppText weight="black" size={size} color={dark ? pickerColors.text : colors.ink}>
        {str("app_name")}
      </AppText>
      <AppText weight="black" size={size} color={dark ? pickerColors.green : colors.green}>
        .
      </AppText>
    </View>
  );
}
