import React from "react";
import { View } from "react-native";
import { colors } from "@/ui/theme";

/** Neutral landing — the root layout redirect immediately routes onward. */
export default function Index() {
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
