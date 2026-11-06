import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useFilters } from "../context/FilterContext";
import { api, getStoredUser } from "../api/client";
import { visibleGroups } from "../utils/permissions";
import { rangeText } from "../utils/dateRange";
import Icon from "./Icons";
import { t } from "../i18n";

const DATE_OPTIONS = [
  { id: "today", get label() { return t("اليوم"); } },
  { id: "this_week", get label() { return t("هذا الأسبوع"); } },
  { id: "this_month", get label() { return t("هذا الشهر"); } },
  { id: "last_month", get label() { return t("الشهر الماضي"); } },
  { id: "last_3_months", get label() { return t("آخر 3 شهور"); } },
  { id: "last_6_months", get label() { return t("آخر 6 شهور"); } },
  { id: "this_year", get label() { return t("هذا العام"); } },
  { id: "last_year", get label() { return t("العام الماضي"); } },
  { id: "custom", get label() { return t("نطاق مخصص"); } },
];

const STATUS_OPTIONS = [
  { id: "all", get label() { return t("كل الحالات"); } },
  { id: "Active", get label() { return t("العملاء النشطين"); } },
  { id: "Suspended", get label() { return t("متوقفين مؤقتًا"); } },
  { id: "Stopped", get label() { return t("متوقفين"); } },
  { id: "Expired", get label() { return t("منتهية عقودهم"); } },
];

// Arabic-friendly matching: ignore diacritics and unify alef/ya/ta-marbuta forms.
function norm(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");

// Closes a popover when clicking outside it or pressing Escape.
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open, setOpen, ref]);
}

/* ------------------------------------------------------------ date range */
function DateRangePill({ f }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);
  const preset = DATE_OPTIONS.find((o) => o.id === f.dateRange) || DATE_OPTIONS[2];
  const isDefault = f.dateRange === f.defaults.dateRange;
  const text = f.dateRange === "all" ? t("كل الفترات") : rangeText(f.dateRange, f.customFrom, f.customTo);
  return (
    <div className="tat-pop-wrap" ref={ref}>
      <button type="button" className={`tat-daterange${isDefault ? "" : " on"}`} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="seg main"><Icon name="calendar" size={16} /><span className="tat-num">{text}</span></span>
        <span className="seg preset"><span>{f.dateRange === "all" ? t("الكل") : preset.label}</span><Icon name="chevron" size={14} /></span>
      </button>

      {open && (
        <div className="tat-pop tat-card" role="listbox">
          <div className="tat-pop-title">{t("الفترة الزمنية")}</div>
          {DATE_OPTIONS.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={f.dateRange === o.id} className={`tat-opt${f.dateRange === o.id ? " sel" : ""}`}
              onClick={() => { f.setDateRange(o.id); if (o.id !== "custom") setOpen(false); }}>
              <span>{o.label}</span>{f.dateRange === o.id && <Icon name="check" size={15} />}
            </button>
          ))}
          <button type="button" role="option" aria-selected={f.dateRange === "all"} className={`tat-opt${f.dateRange === "all" ? " sel" : ""}`} onClick={() => { f.setDateRange("all"); setOpen(false); }}>
            <span>{t("كل الفترات")}</span>{f.dateRange === "all" && <Icon name="check" size={15} />}
          </button>
          {f.dateRange === "custom" && (
            <div className="tat-pop-dates">
              <label><span className="tat-label">{t("من")}</span><input className="tat-ctl tat-date" type="date" value={f.customFrom} onChange={(e) => f.setCustomFrom(e.target.value)} /></label>
              <label><span className="tat-label">{t("إلى")}</span><input className="tat-ctl tat-date" type="date" value={f.customTo} onChange={(e) => f.setCustomTo(e.target.value)} /></label>
              <button type="button" className="tat-pop-apply" onClick={() => setOpen(false)}>{t("تطبيق")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- filters */
function FiltersButton({ f, clients, services }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);
  const changed = {
    clientStatus: f.clientStatus !== f.defaults.clientStatus,
    clientId: f.clientId !== "all",
    serviceId: f.serviceId !== "all",
  };
  const count = Object.values(changed).filter(Boolean).length;
  const resetAll = () => { f.setClientStatus(f.defaults.clientStatus); f.setClientId("all"); f.setServiceId("all"); };

  return (
    <div className="tat-pop-wrap" ref={ref}>
      <button type="button" className={`tat-filterbtn${count ? " on" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="sliders" size={16} /><span>{t("فلاتر")}</span>{count > 0 && <b>{count}</b>}
      </button>
      {open && (
        <div className="tat-pop tat-card tat-pop-filters">
          <div className="tat-pop-title">{t("تصفية النتائج")}</div>
          <label className="tat-pop-field"><span className="tat-label">{t("حالة العميل")}</span>
            <select className={`tat-ctl tat-select${changed.clientStatus ? " on" : ""}`} value={f.clientStatus} onChange={(e) => f.setClientStatus(e.target.value)}>
              {STATUS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="tat-pop-field"><span className="tat-label">{t("العميل")}</span>
            <select className={`tat-ctl tat-select${changed.clientId ? " on" : ""}`} value={f.clientId} onChange={(e) => f.setClientId(e.target.value)}>
              <option value="all">{t("كل العملاء")}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="tat-pop-field"><span className="tat-label">{t("الخدمة")}</span>
            <select className={`tat-ctl tat-select${changed.serviceId ? " on" : ""}`} value={f.serviceId} onChange={(e) => f.setServiceId(e.target.value)}>
              <option value="all">{t("كل الخدمات")}</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="tat-pop-foot">
            <button type="button" className="tat-pop-link" disabled={!count} onClick={resetAll}>{t("إعادة تعيين")}</button>
            <button type="button" className="tat-pop-apply" onClick={() => setOpen(false)}>{t("تم")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- search */
function SearchBox({ clients, f }) {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState(null); // loaded lazily on first focus
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);

  const ensureInvoices = async () => {
    if (invoices !== null) return;
    setInvoices([]);
    try { setInvoices(await api.listInvoices("date_range=all&client_status=all&client_id=all&service_id=all")); } catch { /* search just skips invoices */ }
  };

  const pages = useMemo(() => {
    const groups = visibleGroups(getStoredUser());
    return groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
  }, []);

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    const out = [];
    pages.filter((p) => norm(p.label).includes(q)).slice(0, 4)
      .forEach((p) => out.push({ kind: "page", key: `p${p.to}`, title: p.label, sub: p.group, icon: p.icon, run: () => navigate(p.to) }));
    clients.filter((c) => norm(c.name).includes(q) || norm(c.contact_name).includes(q)).slice(0, 5)
      .forEach((c) => out.push({
        kind: "client", key: `c${c.id}`, title: c.name, sub: c.industry || t("عميل"), icon: "users",
        run: () => { f.setClientStatus("all"); f.setClientId(String(c.id)); navigate("/clients"); },
      }));
    (invoices || []).filter((i) => norm(i.number).includes(q) || norm(i.client_name).includes(q) || norm(i.description).includes(q)).slice(0, 6)
      .forEach((i) => out.push({
        kind: "invoice", key: `i${i.id}`, title: t("{number} — {v1}", { number: i.number, v1: i.client_name || t("بدون عميل") }), sub: `${Number(i.amount).toLocaleString("en-US")} ${i.currency || ""}`, icon: "invoice",
        run: () => { f.setClientStatus("all"); f.setDateRange("all"); f.setClientId(i.client_id ? String(i.client_id) : "all"); navigate("/invoices"); },
      }));
    return out;
  }, [query, pages, clients, invoices, navigate, f]);

  useEffect(() => { setCursor(0); }, [query]);

  // "/" or Ctrl/⌘+K focuses the search; clicking outside closes it
  useEffect(() => {
    const typing = () => /input|textarea|select/i.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
    const onKey = (e) => {
      const isK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isK || (e.key === "/" && !typing())) { e.preventDefault(); inputRef.current?.focus(); }
    };
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, []);

  const choose = (r) => { r.run(); setQuery(""); setOpen(false); inputRef.current?.blur(); };

  const onInputKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && results[cursor]) { e.preventDefault(); choose(results[cursor]); }
    else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  };

  const KIND_LABEL = { page: t("الصفحات"), client: t("العملاء"), invoice: t("الفواتير") };
  let lastKind = null;

  return (
    <div className="tat-sbox" ref={boxRef}>
      <span className="tat-sbox-icon"><Icon name="search" size={18} /></span>
      <input
        ref={inputRef}
        className="tat-sbox-input"
        value={query}
        placeholder={t("ابحث عن عميل أو فاتورة أو صفحة…")}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); ensureInvoices(); }}
        onKeyDown={onInputKey}
        role="combobox"
        aria-expanded={open && !!query}
        aria-autocomplete="list"
      />
      {!query && <kbd className="tat-kbd" dir="ltr">{IS_MAC ? "⌘K" : "Ctrl K"}</kbd>}
      {query && <button className="tat-sbox-clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }} aria-label={t("مسح")}>×</button>}

      {open && query && (
        <div className="tat-search-panel tat-card" role="listbox">
          {results.length === 0 ? (
            <div className="tat-search-empty">{t("مفيش نتائج لـ «")}{query}»</div>
          ) : results.map((r, idx) => {
            const header = r.kind !== lastKind ? <div className="tat-search-group">{KIND_LABEL[r.kind]}</div> : null;
            lastKind = r.kind;
            return (
              <React.Fragment key={r.key}>
                {header}
                <div role="option" aria-selected={idx === cursor} className={`tat-search-item${idx === cursor ? " cur" : ""}`}
                  onMouseEnter={() => setCursor(idx)} onMouseDown={(e) => { e.preventDefault(); choose(r); }}>
                  <Icon name={r.icon} size={16} />
                  <span className="t">{r.title}</span>
                  <span className="s">{r.sub}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ bar */
export default function GlobalFilterBar() {
  const f = useFilters();
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);

  const loadOptions = useCallback(async () => {
    // options are non-critical (and a role may lack one of the two views) —
    // the bar still works without them
    const [c, s] = await Promise.allSettled([api.listClients(), api.listServices()]);
    if (c.status === "fulfilled") setClients(c.value);
    if (s.status === "fulfilled") setServices(s.value);
  }, []);
  useEffect(() => { loadOptions(); }, [loadOptions]);

  const activeCount =
    (f.dateRange !== f.defaults.dateRange ? 1 : 0) +
    (f.clientStatus !== f.defaults.clientStatus ? 1 : 0) +
    (f.clientId !== "all" ? 1 : 0) +
    (f.serviceId !== "all" ? 1 : 0);

  return (
    <div className="tat-topbar">
      <SearchBox clients={clients} f={f} />
      <div className="tat-topbar-right">
        <DateRangePill f={f} />
        <FiltersButton f={f} clients={clients} services={services} />
        {activeCount > 0 && (
          <button className="tat-bar-reset icon" onClick={f.reset} title={t("إعادة تعيين كل الفلاتر")} aria-label={t("إعادة تعيين كل الفلاتر")}>
            <Icon name="reset" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
