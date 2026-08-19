/**
 * Global app state: session, hydrated my-state, config + strings stores
 * (live-patched via Realtime), plans, and the active-request live card.
 *
 * PRIME DIRECTIVE: no hardcoded business values/strings — everything renders
 * through useConfig()/useStr() backed by the `config` and `strings` tables.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@supabase/supabase-js";
import * as Notifications from "expo-notifications";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState as RNAppState, Platform } from "react-native";
import {
  configEntries,
  getConfig,
  type ConfigKey,
  type ConfigStore,
  type ConfigValues,
} from "@pinui/shared";
import { rpc, supabase } from "@/lib/supabase";
import type {
  Locale,
  MyPicker,
  MyState,
  MyStateUser,
  PlanRow,
  RequestRow,
} from "@/lib/types";

/** Terminal statuses the resident should still SEE on the home card until
 * dismissed (celebration / credit banner / leak notice). */
const STICKY_TERMINAL = ["paid", "expired", "declined_leak"] as const;

/** AsyncStorage key remembering the last dismissed terminal request, so the
 * celebration/banner card doesn't resurrect from last_request on relaunch. */
const DISMISSED_KEY = "pinui.dismissed_request_id";

function isStickyTerminal(status: string): boolean {
  return (STICKY_TERMINAL as readonly string[]).includes(status);
}

type StrParams = Record<string, string | number>;
export type StrFn = (key: string, params?: StrParams) => string;

interface AppStateValue {
  bootstrapped: boolean;
  session: Session | null;
  myState: MyState | null;
  myStateLoaded: boolean;
  /** the last get_my_state attempt failed (boot error state + retry) */
  myStateError: boolean;
  plans: PlanRow[];
  configStore: ConfigStore;
  strings: ReadonlyMap<string, string>;
  locale: Locale;
  activeRequest: RequestRow | null;
  str: StrFn;
  refresh: () => Promise<MyState | null>;
  refreshPlans: () => Promise<void>;
  setActiveRequest: (row: RequestRow | null) => void;
  dismissRequest: () => void;
  patchUser: (user: MyStateUser) => void;
  patchPicker: (patch: Partial<MyPicker>) => void;
  signOut: () => Promise<void>;
}

const AppStateContext = createContext<AppStateValue | null>(null);

function stringsMapKey(locale: string, key: string): string {
  return `${locale}:${key}`;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [configStore, setConfigStore] = useState<ConfigStore>({});
  const [strings, setStrings] = useState<Map<string, string>>(new Map());
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [myState, setMyState] = useState<MyState | null>(null);
  const [myStateLoaded, setMyStateLoaded] = useState(false);
  const [myStateError, setMyStateError] = useState(false);
  const [activeRequest, setActiveRequestState] = useState<RequestRow | null>(null);

  // Last dismissed terminal request id (hydrated from storage once).
  const dismissedIdRef = useRef<string | null>(null);
  useEffect(() => {
    void AsyncStorage.getItem(DISMISSED_KEY)
      .then((v) => {
        dismissedIdRef.current = v;
      })
      .catch(() => undefined);
  }, []);

  // ── auth session ──────────────────────────────────────────────────────
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  // ── config + strings + plans hydration (anon-readable) ───────────────
  const refreshPlans = useCallback(async () => {
    const { data, error } = await supabase.from("plans").select("*");
    if (!error && data) setPlans(data as PlanRow[]);
  }, []);

  useEffect(() => {
    let alive = true;
    const hydrate = async () => {
      const [cfgRes, strRes, planRes] = await Promise.all([
        supabase.from("config").select("key,value"),
        supabase.from("strings").select("key,locale,value"),
        supabase.from("plans").select("*"),
      ]);
      if (!alive) return;
      if (!cfgRes.error && cfgRes.data) {
        const next: Record<string, unknown> = {};
        for (const row of cfgRes.data as { key: string; value: unknown }[]) {
          next[row.key] = row.value;
        }
        setConfigStore(next);
      }
      if (!strRes.error && strRes.data) {
        const next = new Map<string, string>();
        for (const row of strRes.data as {
          key: string;
          locale: string;
          value: string;
        }[]) {
          next.set(stringsMapKey(row.locale, row.key), row.value);
        }
        setStrings(next);
      }
      if (!planRes.error && planRes.data) setPlans(planRes.data as PlanRow[]);
      setHydrated(true);
    };
    void hydrate();
    return () => {
      alive = false;
    };
  }, []);

  // ── live config/strings patches ───────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("cfg-strings-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "config" },
        (payload) => {
          const isDelete = payload.eventType === "DELETE";
          const row = (isDelete ? payload.old : payload.new) as {
            key?: string;
            value?: unknown;
          };
          if (!row.key) return;
          const key = row.key;
          setConfigStore((prev) => {
            const next: Record<string, unknown> = { ...prev };
            if (isDelete) delete next[key];
            else next[key] = row.value;
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "strings" },
        (payload) => {
          const isDelete = payload.eventType === "DELETE";
          const row = (isDelete ? payload.old : payload.new) as {
            key?: string;
            locale?: string;
            value?: string;
          };
          if (!row.key || !row.locale) return;
          const mapKey = stringsMapKey(row.locale, row.key);
          setStrings((prev) => {
            const next = new Map(prev);
            if (isDelete) next.delete(mapKey);
            else next.set(mapKey, row.value ?? "");
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // ── my state ──────────────────────────────────────────────────────────
  const refresh = useCallback(async (): Promise<MyState | null> => {
    // Read the session straight from the auth client: right after verifyOtp
    // resolves, React state (and any render-assigned ref) hasn't flushed yet
    // under the concurrent root, but the client already holds the session.
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    if (!data.session) {
      setMyState(null);
      setActiveRequestState(null);
      setMyStateLoaded(true);
      return null;
    }
    try {
      const st = await rpc<MyState>("get_my_state");
      setMyState(st);
      setActiveRequestState((prev) => {
        if (st.active_request) return st.active_request;
        // No in-flight request: surface the latest terminal row (paid
        // celebration / expired credit / leak notice) until dismissed.
        const last = st.last_request;
        if (
          last &&
          isStickyTerminal(last.status) &&
          last.id !== dismissedIdRef.current
        ) {
          return last;
        }
        if (prev && isStickyTerminal(prev.status) && prev.id !== dismissedIdRef.current) {
          return prev;
        }
        return null;
      });
      setMyStateError(false);
      return st;
    } catch {
      setMyStateError(true);
      return null;
    } finally {
      setMyStateLoaded(true);
    }
  }, []);

  const uid = session?.user.id ?? null;

  // ── push token registration (best-effort; silent on simulator/denied) ─
  // Keyed per uid so a second account on the same device registers too.
  const pushRegisteredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!uid || pushRegisteredForRef.current === uid) return;
    const register = async () => {
      try {
        const perms = await Notifications.requestPermissionsAsync();
        if (!perms.granted) return;
        const token = await Notifications.getExpoPushTokenAsync();
        const platform =
          Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;
        await rpc("register_device", {
          p_expo_push_token: token.data,
          p_platform: platform,
        });
        pushRegisteredForRef.current = uid;
      } catch {
        // no push on this device/session — fine
      }
    };
    void register();
  }, [uid]);

  // Boot load with retry + backoff — a single transient failure must never
  // strand a signed-in user on a blank screen.
  useEffect(() => {
    setMyStateLoaded(false);
    if (!uid) {
      setMyState(null);
      setActiveRequestState(null);
      setMyStateLoaded(true);
      setMyStateError(false);
      return;
    }
    let alive = true;
    const boot = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const st = await refresh();
        if (st || !alive) return;
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    };
    void boot();
    return () => {
      alive = false;
    };
  }, [uid, refresh]);

  // Returning to the foreground resyncs state (also recovers a failed boot
  // once connectivity is back).
  useEffect(() => {
    if (!uid) return;
    const sub = RNAppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => sub.remove();
  }, [uid, refresh]);

  // ── live active-request updates ───────────────────────────────────────
  useEffect(() => {
    if (!uid) return;
    const channel = supabase
      .channel(`requests-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "requests",
          filter: `resident_id=eq.${uid}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const row = payload.new as RequestRow;
          setActiveRequestState((prev) => {
            if (row.status === "canceled" || row.status === "noshow") {
              return prev && prev.id === row.id ? null : prev;
            }
            if (prev && prev.id !== row.id) {
              // A different (newer) request supersedes the old card.
              return row;
            }
            return row;
          });
          // Terminal transitions change allowance/credits — resync.
          if (
            ["paid", "expired", "noshow", "canceled", "declined_leak"].includes(
              row.status,
            )
          ) {
            void refresh();
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [uid, refresh]);

  // ── strings accessor ──────────────────────────────────────────────────
  const locale: Locale = myState?.user?.locale === "en" ? "en" : "he";

  const str = useCallback<StrFn>(
    (key, params) => {
      const raw =
        strings.get(stringsMapKey(locale, key)) ??
        strings.get(stringsMapKey("he", key)) ??
        strings.get(stringsMapKey("en", key));
      if (raw === undefined) return `!${key}`;
      if (!params) return raw;
      return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name)
          ? String(params[name])
          : match,
      );
    },
    [strings, locale],
  );

  const setActiveRequest = useCallback((row: RequestRow | null) => {
    setActiveRequestState(row);
  }, []);

  const dismissRequest = useCallback(() => {
    setActiveRequestState((prev) => {
      if (prev) {
        dismissedIdRef.current = prev.id;
        void AsyncStorage.setItem(DISMISSED_KEY, prev.id).catch(() => undefined);
      }
      return null;
    });
  }, []);

  const patchUser = useCallback((user: MyStateUser) => {
    setMyState((prev) => (prev ? { ...prev, user } : prev));
  }, []);

  const patchPicker = useCallback((patch: Partial<MyPicker>) => {
    setMyState((prev) =>
      prev && prev.picker ? { ...prev, picker: { ...prev.picker, ...patch } } : prev,
    );
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setMyState(null);
    setActiveRequestState(null);
  }, []);

  const bootstrapped = sessionLoaded && hydrated;

  const value = useMemo<AppStateValue>(
    () => ({
      bootstrapped,
      session,
      myState,
      myStateLoaded,
      myStateError,
      plans,
      configStore,
      strings,
      locale,
      activeRequest,
      str,
      refresh,
      refreshPlans,
      setActiveRequest,
      dismissRequest,
      patchUser,
      patchPicker,
      signOut,
    }),
    [
      bootstrapped,
      session,
      myState,
      myStateLoaded,
      myStateError,
      plans,
      configStore,
      strings,
      locale,
      activeRequest,
      str,
      refresh,
      refreshPlans,
      setActiveRequest,
      dismissRequest,
      patchUser,
      patchPicker,
      signOut,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}

/** str(key, params?) with locale fallback he→en; returns '!key' when missing. */
export function useStr(): StrFn {
  return useAppState().str;
}

/** Typed config accessor; falls back to the shared seed default on bad rows
 * so a mid-flight config patch can never crash the UI. */
export function useConfig<K extends ConfigKey>(key: K): ConfigValues[K] {
  const { configStore } = useAppState();
  return useMemo(() => {
    try {
      return getConfig(configStore, key);
    } catch {
      return configEntries[key].default as ConfigValues[K];
    }
  }, [configStore, key]);
}
