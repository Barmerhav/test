import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Linking, RefreshControl, ScrollView, View } from "react-native";
import { formatILS, netDisplayShekels, shekelsToAgorot } from "@pinui/shared";
import {
  formatMonthName,
  formatWeekdayDate,
  startOfMonth,
  startOfToday,
  startOfWeek,
} from "@/lib/dates";
import { supabase } from "@/lib/supabase";
import type { InvoiceRow, PayoutLineRow } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { PCard, PSegmented } from "@/ui/PickerUI";
import { Pressy } from "@/ui/Pressy";
import { SkeletonList } from "@/ui/Skeleton";
import { PICKER_TAP, pickerColors as pc, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Period = "today" | "week" | "month";

interface InvoiceRowFull extends InvoiceRow {
  issued_at: string;
}

interface BankDetails {
  bank?: string;
  branch?: string;
  account?: string;
}

interface DayGroup {
  key: string;
  date: Date;
  stops: number;
  units: number;
  total: number;
}

/** Earnings per artboard 14: big mono total, stats line, payout method,
 * day-grouped ledger, invoice archive. */
export default function EarningsScreen() {
  const str = useStr();
  const insets = useSafeAreaInsets();
  const rpcErrorToast = useRpcErrorToast();
  const { session, myState, locale } = useAppState();
  const payoutPerUnit = useConfig("picker_payout_per_unit_exvat");
  const netFactor = useConfig("net_display_factor");
  const maxStrikes = useConfig("strikes_to_suspend");

  const [period, setPeriod] = useState<Period>("today");
  const [lines, setLines] = useState<PayoutLineRow[] | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRowFull[]>([]);
  const [bank, setBank] = useState<BankDetails | null>(null);
  const [nextPayout, setNextPayout] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const uid = session?.user.id ?? null;

  const load = useCallback(async () => {
    const [lineRes, invRes, pickerRes, payoutRes] = await Promise.all([
      supabase
        .from("payout_lines")
        .select("id,units,amount_agorot,created_at,payout_id")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("invoices_selfbilled")
        .select("id,invoice_number,total_agorot,pdf_path,issued_at")
        .order("issued_at", { ascending: false })
        .limit(50),
      uid
        ? supabase.from("pickers").select("bank_details").eq("user_id", uid).limit(1)
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("payouts")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (!lineRes.error && lineRes.data) setLines(lineRes.data as PayoutLineRow[]);
    if (!invRes.error && invRes.data) setInvoices(invRes.data as InvoiceRowFull[]);
    const pickerRow = (pickerRes.data as { bank_details: BankDetails | null }[] | null)?.[0];
    if (pickerRow?.bank_details) setBank(pickerRow.bank_details);
    // next weekly transfer ≈ last payout run + 7 days (weekly cadence)
    const lastPayout = (payoutRes.data as { created_at: string }[] | null)?.[0];
    if (lastPayout) {
      const next = new Date(lastPayout.created_at);
      next.setDate(next.getDate() + 7);
      setNextPayout(next.toISOString());
    }
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const periodStart = useMemo(() => {
    if (period === "today") return startOfToday().getTime();
    if (period === "week") return startOfWeek().getTime();
    return startOfMonth().getTime();
  }, [period]);

  const periodLines = useMemo(
    () => (lines ?? []).filter((l) => new Date(l.created_at).getTime() >= periodStart),
    [lines, periodStart],
  );

  const periodTotal = periodLines.reduce((sum, l) => sum + l.amount_agorot, 0);
  const periodUnits = periodLines.reduce((sum, l) => sum + l.units, 0);
  const periodStops = periodLines.length;
  const avgPerStop = periodStops > 0 ? Math.round(periodTotal / periodStops) : 0;

  /** Ledger grouped by calendar day. */
  const dayGroups: DayGroup[] = useMemo(() => {
    const map = new Map<string, DayGroup>();
    for (const line of lines ?? []) {
      const d = new Date(line.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const existing = map.get(key);
      if (existing) {
        existing.stops += 1;
        existing.units += line.units;
        existing.total += line.amount_agorot;
      } else {
        map.set(key, {
          key,
          date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
          stops: 1,
          units: line.units,
          total: line.amount_agorot,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [lines]);

  const netPerUnit = netDisplayShekels(payoutPerUnit, netFactor);
  const strikes = myState?.picker?.strikes ?? 0;

  const openInvoice = async (invoice: InvoiceRowFull) => {
    if (!invoice.pdf_path) return;
    try {
      const { data, error } = await supabase.storage
        .from("invoices")
        .createSignedUrl(invoice.pdf_path, 300);
      if (error) throw error;
      if (data?.signedUrl) await Linking.openURL(data.signedUrl);
    } catch (err) {
      rpcErrorToast(err);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: pc.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.md,
        paddingBottom: insets.bottom + spacing.xl,
        paddingStart: 18,
        paddingEnd: 18,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={pc.green}
        />
      }
    >
      <AppText weight="black" size={24} color={pc.text} style={{ marginBottom: spacing.md }}>
        {str("earnings.title")}
      </AppText>

      <PSegmented
        options={[
          { key: "today", label: str("earnings.today") },
          { key: "week", label: str("earnings.week") },
          { key: "month", label: str("earnings.month") },
        ]}
        value={period}
        onChange={(k) => setPeriod(k as Period)}
        style={{ marginBottom: spacing.md }}
      />

      {lines === null ? (
        <SkeletonList rows={3} height={110} dark />
      ) : (
        <View style={{ gap: spacing.md }}>
          {/* big total + stats */}
          <PCard style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm }}>
            <MonoText weight="heavy" size={50} color={pc.money} center>
              {formatILS(periodTotal)}
            </MonoText>
            <AppText size={12.5} color={pc.muted} center>
              {str("earnings.stats_line", {
                stops: periodStops,
                units: periodUnits,
                avg: formatILS(avgPerStop),
              })}
            </AppText>
            <AppText size={12} color={pc.faint} center>
              {str("earnings.net_hint", {
                net: formatILS(shekelsToAgorot(netPerUnit)),
              })}
            </AppText>
          </PCard>

          {/* payout method + schedule */}
          <PCard style={{ gap: spacing.xs }}>
            {nextPayout ? (
              <AppText weight="bold" size={13.5} color={pc.text}>
                {str("earnings.payout_schedule", {
                  day: formatWeekdayDate(nextPayout, locale),
                })}
              </AppText>
            ) : null}
            {bank?.account ? (
              <AppText size={12.5} color={pc.muted}>
                {str("earnings.payout_method", {
                  bank: bank.bank ?? "—",
                  last4: bank.account.slice(-4),
                })}
              </AppText>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Ionicons
                name="warning-outline"
                size={15}
                color={strikes > 0 ? pc.danger : pc.faint}
              />
              <AppText size={12} color={strikes > 0 ? pc.danger : pc.faint}>
                {str("earnings.strikes", { count: strikes, max: maxStrikes })}
              </AppText>
            </View>
          </PCard>

          {/* ledger grouped by day */}
          {dayGroups.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              {dayGroups.map((group) => (
                <PCard
                  key={group.key}
                  padded
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    paddingVertical: 13,
                  }}
                >
                  <AppText size={12.5} color={pc.muted} style={{ flex: 1 }} numberOfLines={1}>
                    {str("earnings.ledger_day", {
                      day: formatWeekdayDate(group.date.toISOString(), locale),
                      stops: group.stops,
                    })}
                  </AppText>
                  <MonoText weight="bold" size={13} color={pc.faint}>
                    {group.units}
                  </MonoText>
                  <MonoText weight="heavy" size={16} color={pc.money}>
                    {`+${formatILS(group.total, { isolate: false })}`}
                  </MonoText>
                </PCard>
              ))}
            </View>
          ) : (
            <View style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm }}>
              <AppText size={40}>💸</AppText>
              <AppText size={13.5} color={pc.muted} center>
                {str("feed.empty")}
              </AppText>
            </View>
          )}

          {/* invoice archive */}
          {invoices.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <AppText weight="heavy" size={15.5} color={pc.text}>
                {str("earnings.invoices")}
              </AppText>
              {invoices.map((invoice) => (
                <Pressy
                  key={invoice.id}
                  accessibilityRole="button"
                  onPress={() => void openInvoice(invoice)}
                  disabled={!invoice.pdf_path}
                  haptic="light"
                  style={{
                    minHeight: PICKER_TAP,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    backgroundColor: pc.surface,
                    borderWidth: 1,
                    borderColor: pc.line,
                    borderRadius: 14,
                    paddingHorizontal: 14,
                  }}
                >
                  <Ionicons name="document-text-outline" size={19} color={pc.muted} />
                  <AppText size={12.5} color={pc.text} style={{ flex: 1 }} numberOfLines={1}>
                    {str("earnings.invoice_line", {
                      number: invoice.invoice_number,
                      month: formatMonthName(locale, new Date(invoice.issued_at)),
                    })}
                  </AppText>
                  <MonoText weight="bold" size={14} color={pc.text}>
                    {formatILS(invoice.total_agorot)}
                  </MonoText>
                  {invoice.pdf_path ? (
                    <Ionicons name="open-outline" size={16} color={pc.money} />
                  ) : null}
                </Pressy>
              ))}
            </View>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}
