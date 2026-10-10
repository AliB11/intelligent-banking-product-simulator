"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { axisMoney, count, fmt, money, pct } from "@/lib/format";

const tooltipStyle = { direction: "rtl" as const, fontFamily: "inherit", fontSize: 12, borderRadius: 12 };

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  type?: "area" | "line" | "bar";
  stack?: string;
  axis?: "left" | "right";
  dashed?: boolean;
}

export function ComboChart({
  data,
  xKey,
  series,
  height = 260,
  yFmt = axisMoney,
  y2Fmt,
  xLabel = "ماه",
  refY,
}: {
  data: object[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  yFmt?: (v: number) => string;
  y2Fmt?: (v: number) => string;
  xLabel?: string;
  refY?: number;
}) {
  const hasRight = series.some((s) => s.axis === "right");
  return (
    <div className="ltr" style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(Number(v))} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => yFmt(Number(v))} width={60} />
          {hasRight && (
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => (y2Fmt ?? yFmt)(Number(v))} width={46} />
          )}
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(l) => `${xLabel} ${fmt(Number(l))}`}
            formatter={(v, name) => [fmt(Number(v), 1), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12, direction: "rtl" }} />
          {refY !== undefined && <ReferenceLine yAxisId="left" y={refY} stroke="#94a3b8" />}
          {series.map((s) =>
            s.type === "bar" ? (
              <Bar key={s.key} yAxisId={s.axis ?? "left"} dataKey={s.key} name={s.label} fill={s.color} stackId={s.stack} />
            ) : s.type === "line" ? (
              <Line
                key={s.key}
                yAxisId={s.axis ?? "left"}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                strokeDasharray={s.dashed ? "5 4" : undefined}
              />
            ) : (
              <Area
                key={s.key}
                yAxisId={s.axis ?? "left"}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.16}
                strokeWidth={2}
                stackId={s.stack}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarsChart({
  data,
  xKey,
  series,
  height = 240,
  yFmt = (v: number) => fmt(v),
  vertical,
  colorBy,
  stacked,
}: {
  data: object[];
  xKey: string;
  series: { key: string; label: string; color: string }[];
  height?: number;
  yFmt?: (v: number) => string;
  vertical?: boolean;
  colorBy?: (row: Record<string, unknown>) => string;
  stacked?: boolean;
}) {
  return (
    <div className="ltr" style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={vertical ? "vertical" : "horizontal"} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          {vertical ? (
            <>
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => yFmt(Number(v))} />
              <YAxis type="category" dataKey={xKey} tick={{ fontSize: 11 }} width={120} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} interval={0} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => yFmt(Number(v))} width={60} />
            </>
          )}
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [yFmt(Number(v)), name]} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, direction: "rtl" }} />}
          <ReferenceLine {...(vertical ? { x: 0 } : { y: 0 })} stroke="#94a3b8" />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? "s" : undefined} radius={stacked ? 0 : 3}>
              {colorBy && data.map((row, i) => <Cell key={i} fill={colorBy(row as Record<string, unknown>)} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DnaRadar({ axes, series, height = 300 }: { axes: string[]; series: { name: string; color: string; values: number[] }[]; height?: number }) {
  const rows = axes.map((a, i) => {
    const r: Record<string, number | string> = { axis: a };
    series.forEach((s, j) => {
      r[`s${j}`] = Math.round(s.values[i] ?? 0);
    });
    return r;
  });
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={rows} outerRadius="70%">
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "#334155" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          {series.map((s, j) => (
            <Radar key={j} name={s.name} dataKey={`s${j}`} stroke={s.color} fill={s.color} fillOpacity={0.2} strokeWidth={2} />
          ))}
          <Tooltip contentStyle={tooltipStyle} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ParetoChart({
  points,
  xLabel,
  yLabel,
  height = 300,
}: {
  points: { x: number; y: number; feasible: boolean; front: boolean }[];
  xLabel: string;
  yLabel: string;
  height?: number;
}) {
  const infeasible = points.filter((p) => !p.feasible);
  const other = points.filter((p) => p.feasible && !p.front);
  const front = points.filter((p) => p.front).sort((a, b) => a.x - b.x);
  return (
    <div className="ltr" style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 12, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => fmt(Number(v))}
            label={{ value: xLabel, position: "insideBottom", offset: -10, fontSize: 11 }}
          />
          <YAxis type="number" dataKey="y" name={yLabel} tick={{ fontSize: 11 }} tickFormatter={(v) => axisMoney(Number(v))} width={60} />
          <ZAxis range={[36, 36]} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v), 1)} />
          <ReferenceLine y={0} stroke="#94a3b8" />
          <Scatter name="مغایر مقررات" data={infeasible} fill="#fca5a5" />
          <Scatter name="پیکربندی‌های آزموده" data={other} fill="#a5b4fc" />
          <Scatter name="مرز کارای پارتو" data={front} fill="#10b981" line={{ stroke: "#10b981", strokeWidth: 2 }} />
          <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Tornado({
  items,
}: {
  items: { key: string; label: string; lowLabel: string; highLabel: string; low: number; high: number; base: number }[];
}) {
  const maxDev = Math.max(1e-9, ...items.flatMap((i) => [Math.abs(i.low - i.base), Math.abs(i.high - i.base)]));
  const bar = (d: number, color: string, text: string) => {
    const w = (Math.abs(d) / maxDev) * 50;
    const style = d >= 0 ? { left: "50%", width: `${w}%` } : { left: `${50 - w}%`, width: `${w}%` };
    return (
      <div className="absolute top-1 flex h-5 items-center rounded" style={{ ...style, background: color }} title={text}>
        <span className="whitespace-nowrap px-1 text-[10px] font-bold text-white drop-shadow">{w > 12 ? text : ""}</span>
      </div>
    );
  };
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[11px] text-slate-500">
        <span>🟧 کاهش پارامتر</span>
        <span>🟦 افزایش پارامتر</span>
      </div>
      {items.map((it) => {
        const dl = it.low - it.base;
        const dh = it.high - it.base;
        return (
          <div key={it.key} className="grid grid-cols-[150px_1fr] items-center gap-2 text-xs">
            <div className="text-slate-700">
              <div className="font-semibold">{it.label}</div>
              <div className="text-[10px] text-slate-400">
                {it.lowLabel} / {it.highLabel}
              </div>
            </div>
            <div className="ltr relative h-7 rounded bg-slate-50">
              <div className="absolute inset-y-0 left-1/2 w-px bg-slate-400" />
              {bar(dl, "#f59e0b", `${dl >= 0 ? "+" : ""}${axisMoney(dl)}`)}
              {bar(dh, "#6366f1", `${dh >= 0 ? "+" : ""}${axisMoney(dh)}`)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Waterfall({ items, total }: { items: { label: string; value: number }[]; total: number }) {
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.value)), Math.abs(total));
  const rows = [...items.map((i) => ({ ...i, isTotal: false })), { label: "سود خالص پس از مالیات", value: total, isTotal: true }];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className={`grid grid-cols-[130px_1fr_110px] items-center gap-2 text-xs ${r.isTotal ? "border-t border-slate-200 pt-2 font-bold" : ""}`}>
          <span className="text-slate-700">{r.label}</span>
          <div className="h-4 rounded bg-slate-50">
            <div
              className="h-full rounded"
              style={{
                width: `${Math.max(1, (Math.abs(r.value) / max) * 100)}%`,
                background: r.isTotal ? (r.value >= 0 ? "#059669" : "#dc2626") : r.value >= 0 ? "#34d399" : "#fb7185",
              }}
            />
          </div>
          <span className={`text-left font-semibold ${r.value >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{money(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Funnel({ stages }: { stages: { stage: string; value: number }[] }) {
  const max = Math.max(1, stages[0]?.value ?? 1);
  const colors = ["#6366f1", "#7c3aed", "#a855f7", "#0ea5e9", "#14b8a6", "#ef4444"];
  return (
    <div className="space-y-2">
      {stages.map((s, i) => (
        <div key={s.stage}>
          <div className="mb-0.5 flex justify-between text-xs">
            <span className="text-slate-700">{s.stage}</span>
            <span className="font-bold text-slate-800">
              {count(s.value)}
              {i > 0 && stages[i - 1].value > 0 && (
                <span className="mr-1 font-normal text-slate-400">({pct((s.value / stages[i - 1].value) * 100, 0)})</span>
              )}
            </span>
          </div>
          <div className="mx-auto h-4 rounded-md" style={{ width: `${Math.max(3, (s.value / max) * 100)}%`, background: colors[i % colors.length] }} />
        </div>
      ))}
    </div>
  );
}

export interface OptionPoint {
  id: string;
  x: number;
  y: number;
  front: boolean;
  selected?: boolean;
}

/** Clickable scatter of a menu of customer options (x = customer utility, y = bank yield); Pareto front highlighted. */
export function OptionsScatter({
  points,
  xLabel,
  yLabel,
  onSelect,
  height = 320,
}: {
  points: OptionPoint[];
  xLabel: string;
  yLabel: string;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const other = points.filter((p) => !p.front && !p.selected);
  const front = points.filter((p) => p.front && !p.selected).sort((a, b) => a.x - b.x);
  const selected = points.filter((p) => p.selected);
  const click = (d: unknown) => {
    const id = (d as { payload?: { id?: string }; id?: string } | null)?.payload?.id ?? (d as { id?: string } | null)?.id;
    if (id && onSelect) onSelect(id);
  };
  return (
    <div className="ltr" style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 12, bottom: 24, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" dataKey="x" name={xLabel} domain={["auto", "auto"]} tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(Number(v))} label={{ value: xLabel, position: "insideBottom", offset: -12, fontSize: 11 }} />
          <YAxis type="number" dataKey="y" name={yLabel} domain={["auto", "auto"]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${fmt(Number(v))}٪`} width={52} />
          <ZAxis range={[40, 40]} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [fmt(Number(v), 1), name]} cursor={{ strokeDasharray: "3 3" }} />
          <Scatter name="گزینه‌های مغلوب" data={other} fill="#cbd5e1" onClick={click} style={{ cursor: "pointer" }} />
          <Scatter name="مرز پارتو" data={front} fill="#10b981" line={{ stroke: "#10b981", strokeWidth: 2 }} onClick={click} style={{ cursor: "pointer" }} />
          {selected.length > 0 && <Scatter name="انتخاب‌شده" data={selected} fill="#e11d48" shape="star" />}
          <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Heat-map grid (rows × columns) with a value-driven colour scale (green = low risk, red = high). */
export function HeatGrid({
  rows,
  cols,
  value,
  label,
  sub,
  rowTitle,
  colTitle,
}: {
  rows: number[];
  cols: number[];
  value: (r: number, c: number) => number;
  label: (r: number, c: number) => string;
  sub?: (r: number, c: number) => string;
  rowTitle: string;
  colTitle: string;
}) {
  const vals = rows.flatMap((r) => cols.map((c) => value(r, c)));
  const max = Math.max(1e-9, ...vals);
  const color = (v: number) => {
    const t = Math.min(1, Math.max(0, v / max));
    // emerald-100 → amber-300 → rose-500
    const stops: [number, number, number][] = [[209, 250, 229], [252, 211, 77], [244, 63, 94]];
    const seg = t < 0.5 ? 0 : 1;
    const k = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const a = stops[seg], b = stops[seg + 1];
    return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * k)).join(",")})`;
  };
  const sign = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="p-1 text-[10px] font-normal text-slate-400">{rowTitle} ↓ / {colTitle} ←</th>
            {cols.map((c) => (
              <th key={c} className="p-1 font-medium text-slate-600">{sign(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th className="p-1 font-medium text-slate-600">{sign(r)}</th>
              {cols.map((c) => (
                <td key={c} className="rounded-lg p-2 text-center tabular-nums" style={{ background: color(value(r, c)) }}>
                  <div className={`font-bold ${r === 0 && c === 0 ? "underline" : ""}`}>{label(r, c)}</div>
                  {sub && <div className="text-[10px] text-slate-700">{sub(r, c)}</div>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
