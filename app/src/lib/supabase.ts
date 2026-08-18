import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

interface Extra {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

const extra: Extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const SUPABASE_URL = extra.supabaseUrl ?? "http://127.0.0.1:54321";
export const SUPABASE_ANON_KEY = extra.supabaseAnonKey ?? "public-anon-key-placeholder";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * All business RPCs live in the `api` schema. Throws the supabase error
 * (message contains a stable code — map with rpcErrorCode from @pinui/shared).
 */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.schema("api").rpc(fn, args ?? {});
  if (error) throw error;
  return data as T;
}
