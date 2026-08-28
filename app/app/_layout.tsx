import {
  Heebo_400Regular,
  Heebo_500Medium,
  Heebo_600SemiBold,
  Heebo_700Bold,
  Heebo_800ExtraBold,
  Heebo_900Black,
} from "@expo-google-fonts/heebo";
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
  JetBrainsMono_800ExtraBold,
} from "@expo-google-fonts/jetbrains-mono";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import React, { useEffect } from "react";
import { I18nManager } from "react-native";
import { routeForState } from "@/lib/routing";
import { AppStateProvider, useAppState } from "@/state/AppState";
import { colors } from "@/ui/theme";
import { ToastProvider } from "@/ui/Toast";

// Hebrew-first, fully RTL — force before the first render.
I18nManager.allowRTL(true);
if (!I18nManager.isRTL) {
  I18nManager.forceRTL(true);
}

/** forceRTL only persists a native preference for the NEXT start, so the very
 * first launch on an LTR-locale device would run mirrored. Reload once
 * (guarded by a storage flag so it can never loop; skipped in dev where the
 * dev-menu reload covers it). */
const RTL_RELOAD_KEY = "pinui.rtl_reloaded_once";
async function ensureRtlApplied(): Promise<void> {
  if (I18nManager.isRTL || __DEV__) return;
  try {
    const already = await AsyncStorage.getItem(RTL_RELOAD_KEY);
    if (already) return;
    await AsyncStorage.setItem(RTL_RELOAD_KEY, "1");
    await Updates.reloadAsync();
  } catch {
    // reload unavailable (e.g. updates disabled) — the app stays usable and
    // picks up RTL on the next natural restart
  }
}

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { bootstrapped, session, myState, myStateLoaded } = useAppState();
  const segments = useSegments();
  const router = useRouter();

  const ready = fontsLoaded && bootstrapped && (!session || myStateLoaded);

  useEffect(() => {
    void ensureRtlApplied();
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const group: string | undefined = segments[0];
    if (!session) {
      if (group !== "(auth)") router.replace("/(auth)/phone");
      return;
    }
    // Post-login the auth screens drive their own forward navigation
    // (otp → mode → onward), so never bounce the user out of them.
    if (group === "(auth)") return;
    if (!myState?.user) return;
    const dest = routeForState(myState);
    if (group !== dest.group) router.replace(dest.href);
  }, [ready, session, myState, segments, router]);

  return (
    <>
      <StatusBar style="dark" backgroundColor={colors.bg} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Heebo_400Regular,
    Heebo_500Medium,
    Heebo_600SemiBold,
    Heebo_700Bold,
    Heebo_800ExtraBold,
    Heebo_900Black,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    JetBrainsMono_800ExtraBold,
  });

  return (
    <AppStateProvider>
      <ToastProvider>
        <RootNavigator fontsLoaded={fontsLoaded} />
      </ToastProvider>
    </AppStateProvider>
  );
}
