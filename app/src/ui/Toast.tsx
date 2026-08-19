import { Ionicons } from "@expo/vector-icons";
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Animated, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { rpcErrorCode, stringsKeyForError } from "@pinui/shared";
import { useStr } from "@/state/AppState";
import { colors, radii, shadow, spacing } from "./theme";
import { AppText } from "./Text";

type Kind = "info" | "error" | "success";

interface ToastValue {
  show: (message: string, kind?: Kind) => void;
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

/** Top pill toast with icon; auto-dismisses after 3.5s. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("info");
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(-12)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (msg: string, k: Kind = "info") => {
      setMessage(msg);
      setKind(k);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.spring(translate, { toValue: 0, useNativeDriver: true, speed: 30 }),
      ]).start();
      hideTimer.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
          Animated.timing(translate, { toValue: -12, duration: 220, useNativeDriver: true }),
        ]).start(() => setMessage(null));
      }, 3500);
    },
    [opacity, translate],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {message !== null ? (
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
              <Ionicons name={kindIcon[kind]} size={18} color={kindColor[kind]} />
              <AppText weight="bold" size={13.5} style={{ flexShrink: 1 }}>
                {message}
              </AppText>
            </View>
          </Animated.View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
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
