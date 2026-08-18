import React from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "./theme";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** Minimal bottom sheet on top of everything (used for payment/upgrade). */
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
            backgroundColor: "rgba(22,22,22,0.35)",
          }}
        />
        <View
          style={{
            backgroundColor: colors.bg,
            borderTopStartRadius: 24,
            borderTopEndRadius: 24,
            padding: spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
            gap: spacing.md,
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 44,
              height: 5,
              borderRadius: 3,
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
