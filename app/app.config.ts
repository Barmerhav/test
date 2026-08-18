import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * App shell config. The two EXPO_PUBLIC_* env vars flow into `extra` so the
 * supabase client (src/lib/supabase.ts) can read them via expo-constants.
 * Defaults point at the local Supabase stack (`supabase start`).
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Pinui+",
  slug: "pinui-app",
  version: "0.1.0",
  scheme: "pinui",
  orientation: "portrait",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  ios: {
    supportsTablet: false,
    bundleIdentifier: "app.pinui.resident",
  },
  android: {
    package: "app.pinui.resident",
  },
  plugins: [
    "expo-router",
    "expo-font",
    ["expo-splash-screen", { backgroundColor: "#F8F6F1" }],
  ],
  extra: {
    supportsRTL: true,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "public-anon-key-placeholder",
  },
});
