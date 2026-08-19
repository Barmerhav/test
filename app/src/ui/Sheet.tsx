import React from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "./theme";
import { ModalToastHost } from "./Toast";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** Bottom sheet: white, 28px top radius, grabber, scrim per the artboards.
 * Keyboard-aware (card forms) and hosts its own toast layer above the modal. */
export function Sheet({ visible, onClose, children }: SheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: "flex-end" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
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
      </KeyboardAvoidingView>
      <ModalToastHost />
    </Modal>
  );
}
