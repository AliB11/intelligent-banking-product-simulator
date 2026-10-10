"use client";

import { useState } from "react";
import { customerAllInCost, pmtFor } from "@/lib/engine/alm";
import { NumericInput } from "@/components/ui";
import { CBI } from "@/lib/engine/catalog";
import { effectiveApr, tierWeights } from "@/lib/engine/math";
import { MAX_TIERS } from "@/lib/engine/templates";
import type { TieredMurabahaTier } from "@/lib/engine/types";
import { fmt } from "@/lib/format";

type NumKey = "waitingMonths" | "repaymentMonths" | "loanToAvgDepositPct" | "rate" | "minAvgDeposit" | "expectedTakeUpShare";

const COLS: { key: NumKey; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: "waitingMonths", label: "انتظار", unit: "ماه", min: 0, max: 60, step: 1 },
  { key: "loanToAvgDepositPct", label: "ضریب α", unit: "٪ معدل", min: 0, max: 1000, step: 5 },
  { key: "rate", label: "نرخ سود", unit: "٪", min: 0, max: 40, step: 0.5 },
  { key: "repaymentMonths", label: "بازپرداخت", unit: "ماه", min: 1, max: 360, step: 1 },
  { key: "minAvgDeposit", label: "حداقل معدل", unit: "م.ت", min: 0, max: 10000, step: 1 },
  { key: "expectedTakeUpShare", label: "سهم انتخاب", unit: "٪", min: 0, max: 100, step: 1 },
];

/**
 * Editable menu of a tiered (Negin-style) points product. Each row is one "wait longer → better terms" tier.
 * The derived columns show the customer price (APR) and the loan per 100M toman average balance.
 */
export default function TierTable({
  tiers,
  upfrontFee,
  insurance,
  contract,
  depositRate,
  loanCap = Infinity,
  minLoan = 0,
  minDeposit = 0,
  onChange,
}: {
  tiers: TieredMurabahaTier[];
  upfrontFee: number;
  insurance: number;
  contract: "qard" | "murabaha";
  depositRate: number;
  loanCap?: number;
  minLoan?: number;
  minDeposit?: number;
  onChange: (tiers: TieredMurabahaTier[]) => void;
}) {
  const [oppRate, setOppRate] = useState(23);
  /** all-in annual cost for a customer with a 100M toman average balance (IRR incl. the opportunity cost of waiting) */
  const loanFor = (t: TieredMurabahaTier) => {
    const loan = Math.min(t.loanToAvgDepositPct, loanCap);
    return 100 >= Math.max(minDeposit, t.minAvgDeposit) && loan >= minLoan ? loan : 0;
  };
  const allIn = (t: TieredMurabahaTier) => {
    const loan = loanFor(t); // α% of 100M = α million
    const n = Math.max(1, Math.round(t.repaymentMonths));
    if (loan <= 0) return null;
    return customerAllInCost(loan, 100, t.waitingMonths, pmtFor(contract, loan, t.rate, n), n, oppRate, depositRate, upfrontFee, insurance).cost;
  };
  const weights = tierWeights(tiers);
  const shareSum = tiers.reduce((s, t) => s + t.expectedTakeUpShare, 0);
  const set = (i: number, key: NumKey, value: number) => {
    const v = key === "waitingMonths" || key === "repaymentMonths" ? Math.round(value) : value;
    onChange(tiers.map((t, j) => (j === i ? { ...t, [key]: v } : t)));
  };
  const add = () => {
    const last = tiers[tiers.length - 1];
    const next: TieredMurabahaTier = last
      ? { ...last, id: undefined, name: `حالت ${tiers.length + 1}`, waitingMonths: last.waitingMonths + 1, expectedTakeUpShare: 0 }
      : { name: "حالت ۱", waitingMonths: 2, repaymentMonths: 16, loanToAvgDepositPct: 25, rate: 23, minAvgDeposit: 0, expectedTakeUpShare: 100 };
    onChange([...tiers, next]);
  };
  const remove = (i: number) => onChange(tiers.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-2 text-right">پله</th>
              {COLS.map((c) => (
                <th key={c.key} className="p-2 text-right font-medium">
                  {c.label} <span className="text-[10px] text-slate-400">({c.unit})</span>
                </th>
              ))}
              <th className="p-2 text-right">APR</th>
              <th className="p-2 text-right" title="IRR سالانه با احتساب هزینه فرصت انتظار (معدل ۱۰۰ م.ت)">هزینه تمام‌شده</th>
              <th className="p-2 text-right" title="وام به ازای ۱۰۰ میلیون تومان معدل">وام/۱۰۰ م.ت</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {tiers.map((t, i) => {
              const loan = loanFor(t);
              const apr = loan > 0 ? effectiveApr(loan, t.rate, Math.max(1, Math.round(t.repaymentMonths)), 0, "annuity", 0, 0, upfrontFee, insurance, 0) : null;
              return (
                <tr key={t.id ? `id:${t.id}` : `index:${i}`} className="border-t border-slate-100">
                  <td className="p-1.5">
                    <input
                      aria-label="نام پله"
                      className="w-28 rounded border border-slate-200 px-1.5 py-1"
                      value={t.name}
                      maxLength={60}
                      onChange={(e) => onChange(tiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                  </td>
                  {COLS.map((c) => (
                    <td key={c.key} className="p-1.5">
                      <NumericInput
                        aria-label={`${c.label} ${t.name}`}
                        className={`w-20 rounded border px-1.5 py-1 tabular-nums ${c.key === "rate" && t.rate > CBI.loanRateCap ? "border-rose-400 bg-rose-50" : "border-slate-200"}`}
                        value={t[c.key]}
                        min={c.min}
                        max={c.max}
                        step={c.step}
                        onChange={(v) => set(i, c.key, v)}
                      />
                    </td>
                  ))}
                  <td className="p-1.5 tabular-nums text-slate-700">{apr === null ? "—" : `${fmt(apr, 1)}٪`}</td>
                  {(() => {
                    const c = allIn(t);
                    return (
                      <td className={`p-1.5 font-bold tabular-nums ${c === null ? "text-slate-400" : c > oppRate ? "text-rose-600" : "text-emerald-600"}`} title={c !== null && c > oppRate ? "برای مشتری گران‌تر از نرخ فرصت" : "برای مشتری ارزان‌تر از نرخ فرصت"}>
                        {c === null ? "—" : c >= 999 ? "> ۹۹۹٪" : `${fmt(c, 1)}٪`}
                      </td>
                    );
                  })()}
                  <td className="p-1.5 tabular-nums text-slate-700">{fmt(loanFor(t), 0)} م.ت</td>
                  <td className="p-1.5 text-left">
                    <button type="button" className="rounded px-1.5 py-0.5 text-rose-600 hover:bg-rose-50 disabled:opacity-30" onClick={() => remove(i)} disabled={tiers.length <= 1} aria-label={`حذف ${t.name}`}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          جمع سهم انتخاب: <b className={Math.abs(shareSum - 100) > 1 ? "text-amber-700" : "text-slate-700"}>{fmt(shareSum, 0)}٪</b>
          {Math.abs(shareSum - 100) > 1 && " — در شبیه‌سازی به ۱۰۰٪ نرمال می‌شود"} • میانگین وزنی نرخ:{" "}
          <b className="text-slate-700">{fmt(tiers.reduce((s, t, i) => s + weights[i] * t.rate, 0), 1)}٪</b>
        </span>
        <label className="flex items-center gap-1">
          نرخ فرصت مشتری
          <NumericInput aria-label="نرخ فرصت مشتری" className="w-16 rounded border border-slate-200 px-1.5 py-0.5 tabular-nums" value={oppRate} min={0} max={60} step={0.5} onChange={setOppRate} />٪
        </label>
        <button type="button" onClick={add} disabled={tiers.length >= MAX_TIERS} className="rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          + افزودن پله
        </button>
      </div>
    </div>
  );
}
