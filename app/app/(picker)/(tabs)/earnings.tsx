import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { formatILS, netDisplayShekels, shekelsToAgorot } from "@pinui/shared";
import { formatDate, startOfMonth, startOfToday, startOfWeek } from "@/lib/dates";
import { supabase } from "@/lib/supabase";
import type { InvoiceRow, PayoutLineRow } from "@/lib/types";
import { useAppState, useConfig, useStr } from "@/state/AppState";
import { PCard, PChip, PScreen } from "@/ui/PickerUI";
import { PICKER_TAP, pickerColors as pc, spacing } from "@/ui/theme";
import { AppText, MonoText } from "@/ui/Text";
import { useRpcErrorToast } from "@/ui/Toast";

type Period = "today" | "week" | "month";

const PERIODS: { key: Period; strKey: string }[] = [
  { key: "today", strKey: "earnings.today" },
  { key: "week", strKey: "earnings.week" },
  { key: "month", strKey: "earnings.month" },
];

export default function EarningsScreen() {
  const str = useStr();
  const rpcErrorToast = useRpcErrorToast();
  const { myState } = useAppState();
  const payoutPerUnit = useConfig("picker_payout_per_unit_exvat");
  const netFactor = useConfig("net_display_factor");
  const maxStrikes = useConfig("strikes_to_suspend");

  const [period, setPeriod] = useState<Period>("today");
  const [lines, setLines] = useState<PayoutLineRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const load = async () => {
        const [lineRes, invRes] = await Promise.all([
          supabase
            .from("payout_lines")
            .select("id,units,amount_agorot,created_at,payout_id")
            .order("created_at", { ascending: false })
            .limit(200),
          supabase
            .from("invoices_selfbilled")
            .select("id,invoice_number,total_agorot,pdf_path")
            .order("issued_at", { ascending: false })
            .limit(50),
        ]);
        if (!alive) return;
        if (!lineRes.error && lineRes.data) setLines(lineRes.data as PayoutLineRow[]);
        if (!invRes.error && invRes.data) setInvoices(invRes.data as InvoiceRow[]);
      };
      void load();
      return () => {
        alive = false;
      };
    }, []),
  );

  const periodStart = useMemo(() => {
    if (period === "today") return startOfToday().getTime();
    if (period === "week") return startOfWeek().getTime();
    return startOfMonth().getTime();
  }, [period]);

  const periodTotal = useMemo(
    () =>
      lines
        .filter((l) => new Date(l.created_at).getTime() >= periodStart)
        .reduce((sum, l) => sum + l.amount_agorot, 0),
    [lines, periodStart],
  );

  const netPerUnit = netDisplayShekels(payoutPerUnit, netFactor);
  const strikes = myState?.picker?.strikes ?? 0;

  const openInvoice = async (invoice: InvoiceRow) => {
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
    <PScreen title={str("earnings.title")}>
      <View style={{ gap: spacing.lg }}>
        {/* period tabs + total */}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {PERIODS.map((p) => (
            <PChip
              key={p.key}
              label={str(p.strKey)}
              selected={period === p.key}
              onPress={() => setPeriod(p.key)}
              style={{ flex: 1 }}
            />
          ))}
        </View>
        <PCard style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl }}>
          <MonoText bold size={52} color={pc.amber} center>
            {formatILS(periodTotal)}
          </MonoText>
          <AppText size={13} color={pc.muted} center>
            {str("earnings.net_hint", {
              net: formatILS(shekelsToAgorot(netPerUnit)),
            })}
          </AppText>
          <AppText size={13} color={pc.muted} center>
            {str("earnings.payout_schedule")}
          </AppText>
        </PCard>

        {/* strikes */}
        <PCard
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <Ionicons
            name="warning-outline"
            size={20}
            color={strikes > 0 ? pc.danger : pc.muted}
          />
          <AppText size={14} color={strikes > 0 ? pc.danger : pc.muted}>
            {str("earnings.strikes", { count: strikes, max: maxStrikes })}
          </AppText>
        </PCard>

        {/* ledger */}
        <View style={{ gap: spacing.sm }}>
          {lines.map((line) => (
            <PCard key={line.id} padded style={{ paddingVertical: spacing.sm }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                }}
              >
                <Ionicons
                  name={line.payout_id ? "checkmark-circle" : "time-outline"}
                  size={18}
                  color={line.payout_id ? pc.success : pc.muted}
                />
                <MonoText size={13} color={pc.muted} style={{ flex: 1 }}>
                  {formatDate(line.created_at)}
                </MonoText>
                <MonoText size={14} color={pc.text}>
                  {line.units}
                </MonoText>
                <MonoText bold size={16} color={pc.amber}>
                  {formatILS(line.amount_agorot)}
                </MonoText>
              </View>
            </PCard>
          ))}
        </View>

        {/* invoices */}
        {invoices.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <AppText weight="bold" size={16} color={pc.text}>
              {str("earnings.invoices")}
            </AppText>
            {invoices.map((invoice) => (
              <Pressable
                key={invoice.id}
                accessibilityRole="button"
                onPress={() => void openInvoice(invoice)}
                disabled={!invoice.pdf_path}
              >
                <PCard
                  style={{
                    minHeight: PICKER_TAP,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                  }}
                >
                  <Ionicons name="document-text-outline" size={20} color={pc.muted} />
                  <MonoText size={14} color={pc.text} style={{ flex: 1 }}>
                    {invoice.invoice_number}
                  </MonoText>
                  <MonoText bold size={15} color={pc.text}>
                    {formatILS(invoice.total_agorot)}
                  </MonoText>
                  {invoice.pdf_path ? (
                    <Ionicons name="open-outline" size={18} color={pc.amber} />
                  ) : null}
                </PCard>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </PScreen>
  );
}
