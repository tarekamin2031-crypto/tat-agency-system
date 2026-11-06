import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, notifyError } from "../api/client";
import { useFilters } from "../context/FilterContext";
import { NAVY, NAVY_SOFT, GOLD, TEAL, RED, ORANGE, GREEN, inputStyle, btnStyle, darken, formatMoney, formatDateArabic, INK, tint } from "../theme";
import { Overlay, ModalShell, FieldLabel } from "../components/Modal";
import { EmptyBox, FilterPills, StatCard } from "../components/Bits";
import { t } from "../i18n";

const STATUS_META = {
  Paid: { get label() { return t("مدفوعة"); }, emoji: "🟢", color: GREEN },
  PartiallyPaid: { get label() { return t("مدفوعة جزئيًا"); }, emoji: "🟠", color: ORANGE },
  Overdue: { get label() { return t("متأخرة"); }, emoji: "🔴", color: RED },
  NotPaid: { get label() { return t("غير مدفوعة"); }, emoji: "🟡", color: GOLD },
};

// The invoice-payment views, embedded in the unified "التحصيل والمدفوعات"
// page (Collection.jsx). `section` is "invoices" (status table + totals) or
// "aging" (aged-receivables report). `onChanged` lets the host page refresh
// its own collection data after a payment is recorded here.
export default function PaymentPanels({ section, onChanged }) {
  const filters = useFilters();
  const [rows, setRows] = useState([]);
  const [aging, setAging] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [payTarget, setPayTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filters.toQueryString();
      const [data, agingData] = await Promise.all([api.paymentCenter(q), api.agingReport(q)]);
      setRows(data);
      setAging(agingData);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [filters.key]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.required_amount), 0);
    const collected = rows.reduce((s, r) => s + Number(r.paid_amount), 0);
    const remaining = rows.reduce((s, r) => s + Number(r.remaining_amount), 0);
    const overdueCount = rows.filter((r) => r.payment_status === "Overdue").length;
    return { total, collected, remaining, overdueCount };
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.payment_status !== statusFilter) return false;
      if (search.trim() && !(r.client_name || "").toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [rows, statusFilter, search]);

  const doRecordPayment = async (invoiceId, amount) => {
    try {
      await api.recordInvoicePayment(invoiceId, amount);
      setPayTarget(null);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <div>
      {section === "invoices" && (
        <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
        <StatCard label={t("إجمالي المطلوب")} value={formatMoney(stats.total, "EGP")} color={INK} />
        <StatCard label={t("إجمالي المحصّل")} value={formatMoney(stats.collected, "EGP")} color={GREEN} />
        <StatCard label={t("إجمالي المتبقي")} value={formatMoney(stats.remaining, "EGP")} color={GOLD} />
        <StatCard label={t("فواتير متأخرة")} value={stats.overdueCount} color={stats.overdueCount > 0 ? RED : GREEN} />
      </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("ابحث بالعميل...")} style={{ ...inputStyle, width: 200, marginBottom: 0 }} />
            <FilterPills
              options={[{ id: "all", get label() { return t("الكل"); } }, ...Object.entries(STATUS_META).map(([id, v]) => ({ id, label: v.label, color: v.color }))]}
              value={statusFilter}
              onChange={setStatusFilter}
            />
          </div>

          {loading ? <EmptyBox>{t("جارٍ التحميل…")}</EmptyBox> : filtered.length === 0 ? <EmptyBox>{t("لا توجد فواتير مطابقة")}</EmptyBox> : (
        <div className="tat-card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--ink-2)", fontSize: 12 }}>
                <Th>{t("العميل")}</Th><Th>{t("رقم الفاتورة (العقد)")}</Th><Th>{t("المطلوب")}</Th><Th>{t("المدفوع")}</Th><Th>{t("المتبقي")}</Th><Th>{t("الاستحقاق")}</Th><Th>{t("الحالة")}</Th><Th>{t("التأخير")}</Th><Th>{t("إجراء")}</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const meta = STATUS_META[r.payment_status];
                return (
                  <tr key={r.invoice_id} style={{ borderTop: "1px solid var(--border-soft)", fontSize: 13 }}>
                    <Td style={{ fontWeight: 600 }}>{r.client_name || t("بدون عميل")}</Td>
                    <Td>{r.contract_reference}</Td>
                    <Td>{formatMoney(r.required_amount, r.currency)}</Td>
                    <Td style={{ color: GREEN }}>{formatMoney(r.paid_amount, r.currency)}</Td>
                    <Td style={{ fontWeight: 700, color: r.remaining_amount > 0 ? RED : GREEN }}>{formatMoney(r.remaining_amount, r.currency)}</Td>
                    <Td>{formatDateArabic(r.due_date)}</Td>
                    <Td><span style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 14, background: tint(meta.color, 13), color: darken(meta.color) }}><span className="tat-dot" style={{ background: meta.color }} />{meta.label}</span></Td>
                    <Td style={{ color: r.days_overdue > 0 ? RED : "var(--ink-3)" }}>{r.days_overdue > 0 ? t("{days_overdue} يوم", { days_overdue: r.days_overdue }) : "—"}</Td>
                    <Td>
                      {r.payment_status !== "Paid" && (
                        <button onClick={() => setPayTarget(r)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)", color: TEAL, cursor: "pointer" }}>{t("تسجيل دفعة")}</button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}

      {section === "aging" && aging && (
        <div className="tat-card" style={{ overflow: "hidden" }}>
          <div style={{ background: "var(--surface-2)", color: "var(--ink-2)", padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>
            {t("إجمالي المتأخرات:")} {formatMoney(aging.totalOutstanding, "EGP")}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ fontSize: 12, color: "var(--ink-3)", borderBottom: "1px solid var(--border-soft)" }}>
                <Th>{t("الفئة العمرية")}</Th><Th>{t("إجمالي المتأخر")}</Th><Th>{t("عدد العملاء")}</Th><Th>{t("النسبة")}</Th>
              </tr>
            </thead>
            <tbody>
              {aging.buckets.map((b) => (
                <tr key={b.bucket} style={{ fontSize: 13, borderTop: "1px solid var(--border-soft)" }}>
                  <Td style={{ fontWeight: 600 }}>{b.label}</Td>
                  <Td style={{ color: b.totalOutstanding > 0 ? RED : "var(--ink-3)" }}>{formatMoney(b.totalOutstanding, "EGP")}</Td>
                  <Td>{b.clientCount}</Td>
                  <Td>{b.percentage.toFixed(1)}%</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payTarget && (
        <RecordPaymentModal target={payTarget} onClose={() => setPayTarget(null)} onSave={(amount) => doRecordPayment(payTarget.invoice_id, amount)} />
      )}
    </div>
  );
}

function Th({ children }) { return <th style={{ textAlign: "right", padding: "10px 12px", whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children, style }) { return <td style={{ padding: "10px 12px", whiteSpace: "nowrap", ...style }}>{children}</td>; }

function RecordPaymentModal({ target, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  return (
    <Overlay onClose={onClose}>
      <ModalShell onClose={onClose} title={t("تسجيل دفعة — {contract_reference}", { contract_reference: target.client_name || target.contract_reference })}>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 10 }}>{t("المتبقي حاليًا:")}{" "}<strong style={{ color: INK }}>{formatMoney(target.remaining_amount, target.currency)}</strong>
        </div>
        <FieldLabel>{t("المبلغ المدفوع الآن")}</FieldLabel>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} autoFocus />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={!amount} onClick={() => amount && onSave(amount)} style={{ ...btnStyle(GOLD), flex: 1, opacity: amount ? 1 : 0.5 }}>{t("حفظ")}</button>
        </div>
      </ModalShell>
    </Overlay>
  );
}
