"use client";

import type { ReactNode } from "react";
import { fmt } from "@/lib/format";

export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            {title && (
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                {icon && <span>{icon}</span>}
                {title}
              </h3>
            )}
            {subtitle && <p className="mt-0.5 text-xs leading-5 text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  good: "text-emerald-600",
  bad: "text-rose-600",
  warn: "text-amber-600",
  neutral: "text-slate-800",
  brand: "text-indigo-600",
};
export type Tone = keyof typeof TONES;

export function Stat({ label, value, sub, tone = "neutral", icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-gradient-to-b from-white to-slate-50 p-3">
      <div className="flex items-center justify-between gap-1 text-[11px] text-slate-500">
        <span>{label}</span>
        {icon && <span>{icon}</span>}
      </div>
      <div className={`mt-1 text-lg font-extrabold leading-7 ${TONES[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-4 text-slate-400">{sub}</div>}
    </div>
  );
}

const BADGES = {
  slate: "bg-slate-100 text-slate-700",
  indigo: "bg-indigo-50 text-indigo-700",
  emerald: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-700",
  amber: "bg-amber-50 text-amber-700",
  sky: "bg-sky-50 text-sky-700",
  fuchsia: "bg-fuchsia-50 text-fuchsia-700",
};
export function Badge({ tone = "slate", children }: { tone?: keyof typeof BADGES; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGES[tone]}`}>{children}</span>;
}

export function Num({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  hint,
  warn,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: ReactNode;
  warn?: boolean;
}) {
  const safe = Number.isFinite(value) ? value : 0;
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            value={safe}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(Number(e.target.value))}
            className={`ltr w-20 rounded-md border px-1.5 py-0.5 text-left text-xs ${warn ? "border-rose-300 bg-rose-50" : "border-slate-200"}`}
          />
          {unit && <span className="text-[11px] text-slate-400">{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, safe))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      {hint && <div className={`mt-0.5 text-[11px] leading-4 ${warn ? "text-rose-600" : "text-slate-400"}`}>{hint}</div>}
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hint?: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-slate-700">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <div className="mt-0.5 text-[11px] leading-4 text-slate-400">{hint}</div>}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  ltr,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  ltr?: boolean;
}) {
  const cls = `w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none ${ltr ? "ltr text-left" : ""}`;
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-slate-700">{label}</div>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={cls} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      )}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right transition hover:border-indigo-300"
    >
      <span>
        <span className="block text-xs font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-[11px] leading-4 text-slate-400">{hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-indigo-500" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "right-4" : "right-0.5"}`} />
      </span>
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; icon?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="scrollbar-thin flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          aria-pressed={value === t.key}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            value === t.key ? "bg-white text-indigo-700 shadow" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {t.icon && <span className="ml-1">{t.icon}</span>}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "primary",
  disabled,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "success" | "dark";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const v = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-600/20",
    ghost: "border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700",
    danger: "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    dark: "bg-slate-900 text-white hover:bg-slate-800",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    >
      {children}
    </button>
  );
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
}

export function Gauge({ value, label, sub, size = 160 }: { value: number; label?: string; sub?: string; size?: number }) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const c = Math.PI * 52;
  const color = v >= 75 ? "#10b981" : v >= 55 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 70" width={size} height={size * 0.6}>
        <path d="M8 62 A52 52 0 0 1 112 62" fill="none" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M8 62 A52 52 0 0 1 112 62"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
        />
        <text x="60" y="56" textAnchor="middle" fontSize="22" fontWeight="800" fill="#0f172a">
          {fmt(v)}
        </text>
      </svg>
      {label && <div className="-mt-1 text-sm font-extrabold" style={{ color }}>{label}</div>}
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Meter({ value, max = 100, color = "#6366f1" }: { value: number; max?: number; color?: string }) {
  const w = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

export const LEVEL = {
  critical: { icon: "⛔", cls: "border-rose-200 bg-rose-50/70", text: "text-rose-700", label: "بحرانی" },
  warning: { icon: "⚠️", cls: "border-amber-200 bg-amber-50/70", text: "text-amber-700", label: "هشدار" },
  opportunity: { icon: "💡", cls: "border-sky-200 bg-sky-50/70", text: "text-sky-700", label: "فرصت" },
  positive: { icon: "🌟", cls: "border-emerald-200 bg-emerald-50/70", text: "text-emerald-700", label: "نقطه قوت" },
} as const;

export const COMP_LEVEL = {
  pass: { icon: "✅", cls: "text-emerald-700" },
  warn: { icon: "⚠️", cls: "text-amber-700" },
  fail: { icon: "❌", cls: "text-rose-700" },
  info: { icon: "ℹ️", cls: "text-sky-700" },
} as const;
