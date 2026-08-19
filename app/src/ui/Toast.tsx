import { Ionicons } from "@expo/vector-icons";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Animated, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { rpcErrorCode, stringsKeyForError } from "@pinui/shared";
import { useStr } from "@/state/AppState";
import { colors, radii, shadow, spacing } from "./theme";
import { AppText } from "./Text";

type Kind = "info" | "error" | "success";

interface ToastPayload {
  message: string;
  kind: Kind;
  seq: number;
}

interface ToastValue {
  show: (message: string, kind?: Kind) => void;
  /** internal — read by ToastViewport instances */
  toast: ToastPayload | null;
}

const ToastContext = createContext<ToastValue | null>(null);

const kindColor: Record<Kind, string> = {
  info: colors.ink,
  error: colors.danger,
  success: colors.greenDeep,
};

const kindIcon: Record<Kind, "information-circle" | "alert-circle" | "checkmark-circle"> = {
  info: "information-circle",
  error: "alert-circle",
  success: "checkmark-circle",
};

/** The pill itself. One lives at the root (inside FullWindowOverlay on iOS so
 * it floats above native modals); RN <Modal>s on Android host their own. */
export function ToastViewport() {
  const insets = useSafeAreaInsets();
  const ctx = useContext(ToastContext);
  const toast = ctx?.toast ?? null;
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(-12)).current;

  useEffect(() => {
    if (!toast) {
      opacity.setValue(0);
      translate.setValue(-12);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.spring(translate, { toValue: 0, useNativeDriver: true, speed: 30 }),
    ]).start();
  }, [toast, opacity, translate]);

  if (!toast) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: insets.top + spacing.sm,
        start: spacing.lg,
        end: spacing.lg,
        opacity,
        transform: [{ translateY: translate }],
        alignItems: "center",
        zIndex: 999,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          backgroundColor: colors.card,
          borderRadius: radii.pill,
          borderWidth: 1,
          borderColor: colors.lineSoft,
          paddingVertical: 10,
          paddingHorizontal: spacing.md,
          maxWidth: "100%",
          ...shadow,
          shadowOpacity: 0.12,
        }}
      >
        <Ionicons name={kindIcon[toast.kind]} size={18} color={kindColor[toast.kind]} />
        <AppText weight="bold" size={13.5} style={{ flexShrink: 1 }}>
          {toast.message}
        </AppText>
      </View>
    </Animated.View>
  );
}

/** Render inside RN <Modal>s so toasts stay visible above them (Android
 * modals are separate windows; on iOS the root FullWindowOverlay covers). */
export function ModalToastHost() {
  if (Platform.OS !== "android") return null;
  return <ToastViewport />;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const seqRef = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: Kind = "info") => {
    seqRef.current += 1;
    setToast({ message, kind, seq: seqRef.current });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const value = useMemo(() => ({ show, toast }), [show, toast]);

  return (
    <ToastContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {Platform.OS === "ios" ? (
          <FullWindowOverlay>
            <ToastViewport />
          </FullWindowOverlay>
        ) : (
          <ToastViewport />
        )}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): { show: ToastValue["show"] } {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return { show: ctx.show };
}

/** Central RPC error → strings-table toast. */
export function useRpcErrorToast(): (err: unknown) => void {
  const { show } = useToast();
  const str = useStr();
  return useCallback(
    (err: unknown) => {
      show(str(stringsKeyForError(rpcErrorCode(err))), "error");
    },
    [show, str],
  );
}
