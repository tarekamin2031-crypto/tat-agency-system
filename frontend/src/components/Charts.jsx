import React, { useEffect, useId, useRef, useState } from "react";
import { formatMoney } from "../theme";
import { t } from "../i18n";

// Dependency-free SVG charts styled with the TAT palette. Oldest period sits
// on the right (RTL reading order), matching the rest of the Arabic UI.

function compact(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(v));
}

function niceMax(max) {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * Grouped bar chart.
 * @param {{key:string,label:string}[]} data  categories (label shown on x axis)
 * @param {{key:string,label:string,color:string}[]} series  bars per category
 * @param {(row:object, series:object)=>number} getValue
 * @param {(value:number)=>string} [format]  tooltip number formatter
 */
export function GroupedBarChart({ data, series, getValue, format = (v) => formatMoney(v, "EGP"), height = 220 }) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const [wrapW, setWrapW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const PAD = { top: 12, right: 8, bottom: 28, left: 44 };
  // Slots grow to fill the container when there are few categories, and
  // fall back to a fixed minimum (with horizontal scroll) when there are many.
  const minSlot = Math.max(56, series.length * 16 + 18);
  const slot = Math.max(minSlot, data.length ? (wrapW - PAD.left - PAD.right) / data.length : minSlot);
  const width = PAD.left + PAD.right + slot * data.length;
  const innerH = height - PAD.top - PAD.bottom;
  const values = data.flatMap((row) => series.map((s) => getValue(row, s)));
  // Axis snaps to "nice" steps so 0 is always a labelled gridline and
  // negative values (e.g. a loss month) extend below the baseline.
  const step = niceMax(Math.max(1, ...values.map(Math.abs)) / 4);
  const max = Math.max(1, Math.ceil(Math.max(0, ...values) / step)) * step;
  const min = -Math.ceil(-Math.min(0, ...values) / step) * step;
  const span = max - min;
  const yOf = (v) => PAD.top + innerH * (1 - (v - min) / span);
  const zeroY = yOf(0);
  const barW = Math.min(series.length === 1 ? 34 : 24, (slot - 18) / series.length);
  const ticks = Array.from({ length: Math.round(span / step) + 1 }, (_, i) => min + i * step);
  const rows = [...data].reverse(); // oldest on the right

  return (
    <div ref={wrapRef} style={{ position: "relative", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", minWidth: "100%" }} role="img">
        <defs>
          {series.map((s2) => (
            <linearGradient key={s2.key} id={`gb-${uid}-${s2.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: s2.color }} stopOpacity="1" />
              <stop offset="100%" style={{ stopColor: s2.color }} stopOpacity="0.68" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => {
          const y = yOf(t);
          return (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke="var(--border-soft)" strokeDasharray="3 4" />
              <text x={PAD.left - 6} y={y + 3.5} textAnchor="end" direction="ltr" fontSize="10" fill="var(--ink-3)">{compact(t)}</text>
            </g>
          );
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" />
        {rows.map((row, i) => {
          const x0 = PAD.left + slot * i + (slot - barW * series.length - (series.length - 1) * 3) / 2;
          return (
            <g key={row.key} onMouseEnter={() => setHover(row.key)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(row.key)} onBlur={() => setHover(null)} tabIndex={0}>
              <rect x={PAD.left + slot * i + 4} y={PAD.top} width={slot - 8} height={innerH} rx="12" fill={hover === row.key ? "var(--surface-2)" : "transparent"} opacity="0.8" />
              {series.map((s, j) => {
                const v = getValue(row, s);
                const h = Math.abs(yOf(v) - zeroY);
                return <rect key={s.key} x={x0 + j * (barW + 4)} y={v >= 0 ? zeroY - h : zeroY} width={barW} height={Math.max(h, 0)} rx={Math.min(8, barW / 2, Math.max(h, 0) / 2)} fill={`url(#gb-${uid}-${s.key})`} opacity={v < 0 ? 0.85 : 1} />;
              })}
              <text x={PAD.left + slot * i + slot / 2} y={height - 9} textAnchor="middle" fontSize="11" fontWeight={hover === row.key ? 700 : 500} fill={hover === row.key ? "var(--ink)" : "var(--ink-3)"}>{row.label}</text>
            </g>
          );
        })}
      </svg>
      {hover && (() => {
        const row = data.find((r) => r.key === hover);
        return (
          <div className="tat-card" style={{ position: "absolute", top: 4, insetInlineStart: 52, padding: "8px 12px", fontSize: 12, pointerEvents: "none", boxShadow: "var(--shadow-lift)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{row.label}</div>
            {series.map((s) => (
              <div key={s.key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />
                {s.label}: <b>{format(getValue(row, s))}</b>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div style={{ display: "flex", gap: 14, marginBottom: 12, fontSize: 12, flexWrap: "wrap" }}>
      {items.map((i) => (
        <div key={i.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: i.color, display: "inline-block" }} />
          {i.label}
        </div>
      ))}
    </div>
  );
}

/**
 * Ranked horizontal bars (label, bar, value) — for "top N" style breakdowns.
 * items: [{ key, label, value, color? }]
 */
export function HorizontalBarChart({ items, color = "var(--tat-green)", format = (v) => formatMoney(v, "EGP") }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((i) => (
        <div key={i.key}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3, gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{i.label}</span>
            <span className="tat-num" style={{ fontWeight: 600, color: i.value < 0 ? "var(--red)" : undefined }}>{format(i.value)}</span>
          </div>
          <div style={{ height: 12, background: "var(--surface-2)", borderRadius: 9999, overflow: "hidden", boxShadow: "inset 0 1px 0 var(--highlight)" }}>
            <div style={{ height: "100%", width: `${(Math.abs(i.value) / max) * 100}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${i.value < 0 ? "var(--red)" : i.color || color} 55%, transparent), ${i.value < 0 ? "var(--red)" : i.color || color})`, borderRadius: 9999, transition: "width .35s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Tiny area sparkline for hero cards. values: number[] (oldest → newest). */
export function Sparkline({ values = [], color = "var(--green)", height = 56 }) {
  const w = 320;
  if (!values || values.length < 2) return <div style={{ height }} />;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const stepX = w / (values.length - 1);
  // newest point on the left to match the RTL charts (oldest on the right)
  const pts = values.map((v, i) => [w - i * stepX, height - 4 - ((v - min) / span) * (height - 8)]).reverse();
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} opacity="0.14" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ======================================================================
   Tactile chart set (stacked flow, highlight bars, half donut)
   ====================================================================== */

function useWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/**
 * Stacked rounded segments per period with soft "flow" ribbons between
 * neighbouring bars, a total above each bar and a hover tooltip.
 * data:   [{ key, label, parts: { [seriesKey]: number } }]  (oldest → newest)
 * series: [{ key, label, color }]  stacked bottom → top in this order
 */
export function StackedFlowChart({ data, series, height = 300, format = (v) => formatMoney(v, "EGP") }) {
  const wrapRef = useRef(null);
  const width = Math.max(useWidth(wrapRef), 280);
  const [hover, setHover] = useState(null);
  const PAD = { top: 34, right: 10, bottom: 30, left: 10 };
  const rows = [...data].reverse(); // oldest on the right (RTL)
  const n = rows.length || 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const slot = innerW / n;
  const barW = Math.min(76, slot * 0.52);
  const GAP = 4;
  const base = PAD.top + innerH;
  const totals = rows.map((r) => series.reduce((s, x) => s + Math.max(0, r.parts[x.key] || 0), 0));
  const maxT = Math.max(1, ...totals);

  const bars = rows.map((r, i) => {
    const x = PAD.left + slot * i + (slot - barW) / 2;
    let cum = 0;
    const segs = series.map((s) => {
      const v = Math.max(0, r.parts[s.key] || 0);
      const h = (v / maxT) * innerH;
      const seg = { key: s.key, color: s.color, v, top: base - cum - h, bottom: base - cum, h };
      cum += h;
      return seg;
    });
    return { x, segs, total: totals[i], row: r };
  });

  const ribbons = [];
  for (let i = 0; i < bars.length - 1; i++) {
    const a = bars[i], b = bars[i + 1];
    series.forEach((s, k) => {
      const A = a.segs[k], B = b.segs[k];
      if (A.h < 0.5 && B.h < 0.5) return;
      const x1 = a.x + barW, x2 = b.x, xm = (x1 + x2) / 2;
      ribbons.push({
        key: `${i}-${s.key}`, color: s.color, hot: hover === i || hover === i + 1,
        d: `M${x1},${A.top} C${xm},${A.top} ${xm},${B.top} ${x2},${B.top} L${x2},${B.bottom} C${xm},${B.bottom} ${xm},${A.bottom} ${x1},${A.bottom} Z`,
      });
    });
  }

  const tip = hover !== null ? bars[hover] : null;
  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", maxWidth: "100%" }} role="img">
        {ribbons.map((r) => <path key={r.key} d={r.d} fill={r.color} opacity={r.hot ? 0.2 : 0.09} style={{ transition: "opacity .15s" }} />)}
        {bars.map((b, i) => {
          const dim = hover !== null && hover !== i;
          return (
            <g key={b.row.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }} opacity={dim ? 0.45 : 1}>
              <rect x={b.x - 6} y={PAD.top} width={barW + 12} height={innerH + 8} fill="transparent" />
              {b.segs.map((s) => (s.h - GAP > 1 ? (
                <rect key={s.key} x={b.x} y={s.top + GAP / 2} width={barW} height={s.h - GAP} rx={Math.min(9, (s.h - GAP) / 2)} fill={s.color} />
              ) : null))}
              <text x={b.x + barW / 2} y={base - (b.total / maxT) * innerH - 12} textAnchor="middle" direction="ltr" fontSize="12.5" fontWeight="600" fill="var(--ink-2)">{compact(b.total)}</text>
              <text x={b.x + barW / 2} y={height - 8} textAnchor="middle" fontSize="12" fontWeight={hover === i ? 700 : 500} fill={hover === i ? "var(--ink)" : "var(--ink-3)"}>{b.row.label}</text>
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="tat-card" style={{ position: "absolute", top: 4, insetInlineStart: 12, padding: "9px 13px", fontSize: 12, pointerEvents: "none", boxShadow: "var(--shadow-lift)", minWidth: 170 }}>
          <div style={{ fontWeight: 700, marginBottom: 5 }}>{tip.row.label}</div>
          {[...series].reverse().map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 7, padding: "1.5px 0" }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} />
              <span style={{ flex: 1, color: "var(--ink-2)" }}>{s.label}</span>
              <b className="tat-num">{format(tip.row.parts[s.key] || 0)}</b>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, paddingTop: 5, borderTop: "1px solid var(--border-soft)" }}>
            <span style={{ color: "var(--ink-3)" }}>{t("الإجمالي")}</span><b className="tat-num">{format(tip.total)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Soft rounded bars; the hovered (or highest) one gets the gradient fill,
 * a value bubble above it and a bold label — like a "selected day" chart.
 * data: [{ key, label, value }] (oldest → newest)
 */
export function HighlightBarChart({ data, height = 230, format = (v) => String(v) }) {
  const [hover, setHover] = useState(null);
  const rows = [...data].reverse(); // oldest on the right (RTL)
  const max = Math.max(1, ...rows.map((r) => r.value));
  const peak = rows.reduce((bi, r, i) => (r.value > rows[bi].value ? i : bi), 0);
  const active = hover ?? peak;
  const barArea = height - 62;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height, overflowX: "auto", paddingTop: 4 }} onMouseLeave={() => setHover(null)}>
      {rows.map((r, i) => {
        const on = i === active;
        const h = Math.max(10, (r.value / max) * barArea);
        return (
          <div key={r.key} onMouseEnter={() => setHover(i)} style={{ flex: "1 0 46px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", cursor: "default" }}>
            <div className="tat-num" style={{ marginBottom: 8, minHeight: 26, fontSize: 12.5, fontWeight: 700, color: "var(--ink)", opacity: on ? 1 : 0, transition: "opacity .15s", whiteSpace: "nowrap" }}>{format(r.value)}</div>
            <div style={{
              width: "100%", maxWidth: 52, height: h, borderRadius: 12,
              background: on ? "linear-gradient(180deg, var(--green), color-mix(in srgb, var(--teal) 85%, var(--brand)))" : "var(--surface-2)",
              boxShadow: on ? "0 10px 22px -10px color-mix(in srgb, var(--green) 70%, transparent), inset 0 1px 0 rgba(255,255,255,.25)" : "inset 0 1px 0 var(--highlight)",
              transition: "background .18s ease, box-shadow .18s ease",
            }} />
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: on ? 700 : 500, color: on ? "var(--ink)" : "var(--ink-3)", whiteSpace: "nowrap" }}>{r.label}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Half donut with rounded, gapped segments and a centered total.
 * items: [{ key, label, value, color }]
 */
export function HalfDonut({ items, centerLabel, centerValue, height = 170 }) {
  const [hover, setHover] = useState(null);
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  const W = 300, cx = 150, cy = 150, r = 118, sw = 30;
  if (total <= 0) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 13 }}>{t("لا توجد بيانات")}</div>;
  const GAP = 0.035; // radians between segments
  let a0 = Math.PI; // sweep left → right across the top
  const arcs = items.filter((i) => i.value > 0).map((i) => {
    const sweep = (i.value / total) * Math.PI;
    const s = a0 + Math.min(GAP, sweep / 3) / 2;
    const e = a0 + sweep - Math.min(GAP, sweep / 3) / 2;
    a0 += sweep;
    const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x1, y1] = p(s), [x2, y2] = p(e);
    return { ...i, d: `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`, pct: (i.value / total) * 100 };
  });
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: "block", maxWidth: 360, margin: "0 auto" }} role="img">
        <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke="var(--surface-2)" strokeWidth={sw + 8} strokeLinecap="round" opacity="0.6" />
        {arcs.map((a, i) => (
          <path key={a.key} d={a.d} fill="none" stroke={a.color} strokeWidth={hover === i ? sw + 5 : sw} strokeLinecap="round"
            opacity={hover !== null && hover !== i ? 0.4 : 1} style={{ transition: "stroke-width .15s, opacity .15s", cursor: "default" }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <title>{`${a.label}: ${a.pct.toFixed(1)}%`}</title>
          </path>
        ))}
        <text x={cx} y={cy - 24} textAnchor="middle" fontSize="12" fill="var(--ink-3)">{hover !== null ? arcs[hover].label : centerLabel}</text>
        <text x={cx} y={cy + 2} textAnchor="middle" direction="ltr" fontSize="26" fontWeight="700" fill="var(--ink)">{hover !== null ? `${arcs[hover].pct.toFixed(0)}%` : centerValue}</text>
      </svg>
    </div>
  );
}
