import React from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "./theme";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** Bottom sheet: white, 28px top radius, grabber, scrim per the artboards. */
export function Sheet({ visible, onClose, children }: SheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          onPress={onClose}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            start: 0,
            end: 0,
            backgroundColor: colors.scrim,
          }}
        />
        <View
          style={{
            backgroundColor: colors.card,
            borderTopStartRadius: 28,
            borderTopEndRadius: 28,
            paddingHorizontal: 22,
            paddingTop: 14,
            paddingBottom: insets.bottom + spacing.lg,
            gap: spacing.md,
            shadowColor: colors.ink,
            shadowOpacity: 0.22,
            shadowRadius: 40,
            shadowOffset: { width: 0, height: -18 },
            elevation: 12,
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 40,
              height: 5,
              borderRadius: 99,
              backgroundColor: colors.line,
              marginBottom: spacing.xs,
            }}
          />
          {children}
        </View>
      </View>
    </Modal>
  );
}
