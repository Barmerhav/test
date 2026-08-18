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
  success: colors.success,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("info");
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (msg: string, k: Kind = "info") => {
      setMessage(msg);
      setKind(k);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }).start(
          () => setMessage(null),
        );
      }, 3500);
    },
    [opacity],
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
              start: spacing.md,
              end: spacing.md,
              opacity,
              backgroundColor: colors.card,
              borderRadius: radii.chip,
              borderWidth: 1,
              borderColor: colors.line,
              borderStartWidth: 4,
              borderStartColor: kindColor[kind],
              padding: spacing.md,
              ...shadow,
            }}
          >
            <AppText weight="medium" size={15}>
              {message}
            </AppText>
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
