"use client";

import { useMemo, useState } from "react";
import { BarsChart, ComboChart, HeatGrid, OptionsScatter, Tornado } from "@/components/charts";
import { Badge, Btn, Card, Num, Select, Spinner, Stat } from "@/components/ui";
import { MAX_TIERS } from "@/lib/engine/templates";
import type { FullAlmResult, NeginCustomerOption, ProductConfig, TieredMurabahaTier } from "@/lib/engine/types";
import { count, faDate, fmt, money, mt, pct } from "@/lib/format";

export interface AlmHistItem {
  id: number;
  type: string;
  scenario: string;
  summary: Record<string, unknown>;
  createdAt: string;
}

type AlmScenario = "base" | "stress" | "fast_growth";
type Objective = "margin" | "liquidity" | "reach";

const SCEN_LABEL: Record<AlmScenario, string> = { base: "پایه", stress: "استرس نقدینگی", fast_growth: "رشد سریع" };
const OBJ_LABEL: Record<Objective, string> = { margin: "حداکثر حاشیه", liquidity: "حداقل حفره نقدینگی", reach: "حداکثر وام‌گیرنده" };

interface TierSnap { name: string; wait: number; alpha: number; rate: number; tenor: number; share: number }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * ALM lab of a points product: liquidity cash flows, tier economics with the customer's all-in cost,
 * stress heat-map, tornado, Monte Carlo, the customer-option Pareto frontier, the inverse tier designer
 * and a side-by-side comparison of stored design versions.
 */
export default function AlmLab({
  productId,
  cfg,
  history,
  onSaved,
  onApplyTiers,
  busy,
  latest = null,
}: {
  productId: number;
  cfg: ProductConfig;
  history: AlmHistItem[];
  onSaved: (item: AlmHistItem) => void;
  onApplyTiers: (tiers: TieredMurabahaTier[]) => Promise<void>;
  busy: boolean;
  /** latest stored run for the current configuration (compact: no monthly events / option menu) */
  latest?: { id: number; createdAt: string; summary: Record<string, unknown>; result: FullAlmResult } | null;
}) {
  const [params, setParams] = useState(() => {
    const s = latest?.summary ?? {};
    return {
      marketShare: num(s.marketShare) ?? 5,
      horizon: num(s.horizon) ?? 60,
      scenario: (typeof s.scenario === "string" && s.scenario in SCEN_LABEL ? s.scenario : "base") as AlmScenario,
      seed: 1405,
      opportunityRate: num(s.opportunityRatePct) ?? 23,
    };
  });
  const [designer, setDesigner] = useState({ maxHolePct: 40, minMarginPct: 2, maxLeverage: 2.5, objective: "margin" as Objective });
  const [result, setResult] = useState<FullAlmResult | null>(latest?.result ?? null);
  const [resultCfg, setResultCfg] = useState<ProductConfig | null>(latest ? cfg : null);
  const [fromHistory, setFromHistory] = useState<string | null>(latest?.createdAt ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOpt, setSelectedOpt] = useState<string | null>(null);
  const [compare, setCompare] = useState<number[]>([]);
  const tiered = cfg.points.mode === "tiered_murabaha" && cfg.points.tiers.length > 0;
  const stale = result !== null && resultCfg !== cfg;

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/alm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, ...params, designer, save: true }),
      });
      const j = (await r.json()) as FullAlmResult & { simulationId?: number | null; error?: string };
      if (!r.ok) throw new Error(j.error ?? "خطای سرور");
      setResult(j);
      setResultCfg(cfg);
      setFromHistory(null);
      setSelectedOpt(null);
      if (j.simulationId) {
        const k = j.alm.kpis;
        onSaved({
          id: j.simulationId,
          type: "alm",
          scenario: params.scenario,
          createdAt: new Date().toISOString(),
          summary: {
            maxHole: k.maxHole, holePct: k.totalDeposit > 0 ? (k.maxHole / k.totalDeposit) * 100 : 0, tippingPoint: k.tippingPoint,
            recoveryMonth: k.recoveryMonth, netMargin: k.netMargin, marginOnNetDeposit: k.marginOnNetDeposit, leverage: k.leverage,
            minLcr: k.minLcr, nsfrAt12: k.nsfrAt12, totalDeposit: k.totalDeposit, borrowers: k.borrowers,
            pTipping: j.analysis.monteCarlo?.pTipping ?? null, p95Hole: j.analysis.monteCarlo?.p95 ?? null,
            marketShare: params.marketShare, horizon: params.horizon, scenario: params.scenario, opportunityRatePct: params.opportunityRate,
            tiers: j.alm.tiers.map((t) => ({ name: t.tier.name, wait: t.tier.waitingMonths, alpha: t.tier.loanToAvgDepositPct, rate: t.tier.rate, tenor: t.tier.repaymentMonths, share: t.tier.expectedTakeUpShare })),
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const k = result?.alm.kpis;
  const flow = useMemo(
    () => (result ? result.alm.rows.map((r) => ({ m: r.t, in: r.inflow, out: -r.outflow, cum: r.cum, dep: r.depositBalance, loan: r.loanBook, margin: r.cumMargin })) : []),
    [result],
  );
  const options = useMemo(() => result?.alm.customerOptions ?? [], [result]);
  const optById = useMemo(() => new Map(options.map((o) => [o.comboId, o])), [options]);
  const chosen: NeginCustomerOption | undefined = selectedOpt ? optById.get(selectedOpt) : undefined;
  const histogram = useMemo(() => {
    const s = result?.analysis.monteCarlo?.samples ?? [];
    if (s.length < 2) return [];
    const lo = s[0], hi = s[s.length - 1];
    const bins = 12;
    const w = (hi - lo) / bins || 1;
    const out = Array.from({ length: bins }, (_, i) => ({ bin: fmt(lo + w * (i + 0.5), 1), n: 0 }));
    for (const v of s) out[Math.min(bins - 1, Math.floor((v - lo) / w))].n++;
    return out;
  }, [result]);
  const almHistory = history.filter((h) => h.type === "alm");
  const compared = almHistory.filter((h) => compare.includes(h.id));
  const design = result?.analysis.optimalTierDesign;
  const grid = result?.analysis.stressGrid ?? [];
  const gridRows = [...new Set(grid.map((c) => c.takeUpShock))];
  const gridCols = [...new Set(grid.map((c) => c.approvalShock))];
  const cell = (r: number, c: number) => grid.find((x) => x.takeUpShock === r && x.approvalShock === c);

  const addOptionAsTier = async () => {
    if (!chosen || !tiered || cfg.points.tiers.length >= MAX_TIERS) return;
    const tier: TieredMurabahaTier = {
      name: `گزینه ${fmt(chosen.waitingMonths)} ماهه`,
      waitingMonths: chosen.waitingMonths,
      repaymentMonths: chosen.tenor,
      loanToAvgDepositPct: chosen.alpha,
      rate: chosen.rate,
      minAvgDeposit: cfg.points.tiers[0]?.minAvgDeposit ?? 0,
      expectedTakeUpShare: 5,
    };
    await onApplyTiers([...cfg.points.tiers, tier]);
  };

  return (
    <div className="space-y-4">
      <Card title="آزمایشگاه ALM — نقدینگی و ترازنامه محصول" icon="🌊" subtitle="جریان نقد ماهانه سپرده، اعطا، اقساط و برداشت؛ کسری با نرخ بین‌بانکی تأمین و مازاد با FTP سرمایه‌گذاری می‌شود (فقط در سود و زیان).">
        <div className="grid items-end gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Select<AlmScenario> label="سناریو" value={params.scenario} onChange={(v) => setParams((p) => ({ ...p, scenario: v }))} options={(Object.keys(SCEN_LABEL) as AlmScenario[]).map((s) => ({ value: s, label: SCEN_LABEL[s] }))} />
          <Num label="سهم از بازار ۵۰ همتی" value={params.marketShare} onChange={(v) => setParams((p) => ({ ...p, marketShare: v }))} min={0.1} max={50} step={0.5} unit="٪" />
          <Num label="افق" value={params.horizon} onChange={(v) => setParams((p) => ({ ...p, horizon: v }))} min={12} max={120} step={6} unit="ماه" />
          <Num label="نرخ فرصت مشتری" value={params.opportunityRate} onChange={(v) => setParams((p) => ({ ...p, opportunityRate: v }))} min={0} max={60} step={0.5} unit="٪" hint="سود سپرده جایگزین؛ مبنای هزینه تمام‌شده" />
          <Num label="بذر تصادفی" value={params.seed} onChange={(v) => setParams((p) => ({ ...p, seed: Math.max(1, Math.round(v)) }))} min={1} max={999999} step={1} />
          <Btn onClick={run} disabled={loading || busy} className="h-10">{loading ? <Spinner /> : "▶"} اجرا و ثبت در تاریخچه</Btn>
        </div>
        {error && <div role="alert" className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</div>}
        {fromHistory && !stale && <div role="status" className="mt-2 rounded-lg bg-sky-50 p-2 text-sm text-sky-900">نمایش آخرین اجرای ثبت‌شده ({faDate(fromHistory)}). منوی گزینه‌های مشتری در نسخه ذخیره‌شده نگه داشته نمی‌شود؛ برای دیدن مرز پارتو دوباره اجرا کنید.</div>}
        {stale && <div role="status" className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">پیکربندی محصول پس از این اجرا تغییر کرده است؛ برای نتایج تازه دوباره اجرا کنید.</div>}
      </Card>

      {!result && (
        <Card>
          <div className="py-12 text-center text-sm text-slate-500">{loading ? "⏳ در حال اجرای ALM، ۲۵ سناریوی استرس، ۳۰۰ اجرای مونت‌کارلو و طراح معکوس…" : "برای مشاهده جریان نقد و حفره نقدینگی، آزمایشگاه را اجرا کنید."}</div>
        </Card>
      )}

      {result && k && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <Stat label="کل سپرده جذب‌شده" value={money(k.totalDeposit)} sub={`${count(k.borrowers)} وام‌گیرنده`} icon="🐷" />
            <Stat label="حداکثر حفره نقدینگی" value={money(k.maxHole)} sub={k.totalDeposit > 0 ? `${pct((k.maxHole / k.totalDeposit) * 100)} سپرده` : undefined} tone={k.maxHole > 0 ? "bad" : "good"} icon="🕳️" />
            <Stat label="نقطه شکست / بازگشت" value={k.tippingPoint === null ? "ندارد" : `ماه ${fmt(k.tippingPoint)} ← ${k.recoveryMonth === null ? "—" : fmt(k.recoveryMonth)}`} sub={`${fmt(k.deficitMonths)} ماه کسری`} tone={k.tippingPoint === null ? "good" : "warn"} icon="⏱️" />
            <Stat label="حاشیه خالص در افق" value={money(k.netMargin)} sub={`${pct(k.marginOnNetDeposit)} سپرده خالص`} tone={k.netMargin >= 0 ? "good" : "bad"} icon="💰" />
            <Stat label="هزینه بین‌بانکی / درآمد مازاد" value={`${money(k.interbankCost)}`} sub={`مازاد: ${money(k.surplusIncome)}`} icon="🏦" />
            <Stat label="اهرم تعهدات" value={fmt(k.leverage, 2)} sub="(وام + برداشت) ÷ سپرده خالص" tone={k.leverage > 2.5 ? "bad" : "neutral"} icon="⚖️" />
            <Stat label="حداقل LCR (آموزشی)" value={pct(k.minLcr, 0)} tone={k.minLcr >= 100 ? "good" : "bad"} sub="بافر مستقل محصول" icon="💧" />
            <Stat label="NSFR ماه ۱۲" value={pct(k.nsfrAt12, 0)} tone={k.nsfrAt12 >= 100 ? "good" : "bad"} icon="🧱" />
            <Stat label="شکاف سررسید (WAL)" value={`${fmt(k.maturityGap, 1)} ماه`} sub={`دارایی ${fmt(k.walAssets, 1)} / بدهی ${fmt(k.walLiabilities, 1)}`} icon="📏" />
            <Stat label="ذخیره زیان اعتباری" value={money(k.totalProvision)} icon="🛡️" />
            <Stat label="اقساط فراتر از افق" value={money(k.pmtBeyondHorizon)} icon="➡️" />
            <Stat label="احتمال شکست (MC)" value={pct(result.analysis.monteCarlo?.pTipping ?? 0, 0)} sub={`P95 حفره: ${money(result.analysis.monteCarlo?.p95 ?? 0)}`} icon="🎲" />
          </div>

          <Card title="جریان نقد ماهانه و کسری انباشته" icon="📈" subtitle="ستون سبز = ورود (سپرده، اقساط، آزادسازی سپرده قانونی)، ستون قرمز = خروج؛ خط تیره = نقد انباشته — زیر صفر یعنی حفره نقدینگی.">
            <ComboChart
              data={flow}
              xKey="m"
              height={300}
              refY={0}
              series={[
                { key: "in", label: "ورود نقد", color: "#10b981", type: "bar" },
                { key: "out", label: "خروج نقد", color: "#f43f5e", type: "bar" },
                { key: "cum", label: "نقد انباشته", color: "#0f172a", type: "line" },
                { key: "dep", label: "مانده سپرده", color: "#6366f1", type: "line", dashed: true },
                { key: "loan", label: "مانده وام", color: "#f59e0b", type: "line", dashed: true },
                { key: "margin", label: "حاشیه انباشته", color: "#14b8a6", type: "line" },
              ]}
            />
          </Card>

          <Card title="اقتصاد پله‌ها و هزینه تمام‌شده مشتری" icon="🪜" subtitle={`هزینه تمام‌شده = IRR سالانه جریان [وام − هزینه فرصت انتظار، −اقساط] با نرخ فرصت ${fmt(params.opportunityRate, 1)}٪ — نرخ اسمی به‌تنهایی گمراه‌کننده است.`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="p-2 text-right">پله</th>
                    <th className="p-2">انتظار</th>
                    <th className="p-2">α مؤثر</th>
                    <th className="p-2">نرخ اسمی</th>
                    <th className="p-2">دوره</th>
                    <th className="p-2">سهم</th>
                    <th className="p-2">تعهد وام</th>
                    <th className="p-2">درآمد سود</th>
                    <th className="p-2">هزینه فرصت (۱۰۰ م.ت)</th>
                    <th className="p-2">هزینه تمام‌شده مشتری</th>
                    <th className="p-2">در برابر بازار</th>
                  </tr>
                </thead>
                <tbody>
                  {result.alm.tiers.map((t) => (
                    <tr key={t.index} className="border-b border-slate-50 text-center tabular-nums">
                      <td className="p-2 text-right font-semibold">{t.tier.name}{t.capBinding && <Badge tone="amber">سقف</Badge>}</td>
                      <td className="p-2">{fmt(t.tier.waitingMonths)} ماه</td>
                      <td className="p-2">{pct(t.alphaEff, 0)}</td>
                      <td className="p-2">{pct(t.effectiveRate, 1)}</td>
                      <td className="p-2">{fmt(t.tier.repaymentMonths)} ماه</td>
                      <td className="p-2">{pct(t.share, 0)}</td>
                      <td className="p-2">{money(t.commitment)}</td>
                      <td className="p-2">{money(t.totalIncome)}</td>
                      <td className="p-2">{mt(t.customerOpportunityCost, 1)}</td>
                      <td className={`p-2 font-bold ${t.interestGap > 0 ? "text-rose-600" : "text-emerald-600"}`}>{t.customerIrr >= 999 ? "> ۹۹۹٪" : pct(t.customerIrr, 1)}</td>
                      <td className="p-2">{t.interestGap > 0 ? <Badge tone="rose">{`${fmt(t.interestGap, 1)}+ گران‌تر`}</Badge> : <Badge tone="emerald">{`${fmt(-t.interestGap, 1)} ارزان‌تر`}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="نقشه حرارتی استرس نقدینگی" icon="🔥" subtitle="حداکثر حفره (میلیارد تومان) با شوک نرخ تقاضا (سطر) و نرخ تأیید (ستون)؛ زیرنویس = ماه شکست.">
              {grid.length > 0 && (
                <HeatGrid
                  rows={gridRows}
                  cols={gridCols}
                  rowTitle="تقاضا"
                  colTitle="تأیید"
                  value={(r, c) => cell(r, c)?.maxHole ?? 0}
                  label={(r, c) => fmt(cell(r, c)?.maxHole ?? 0, 1)}
                  sub={(r, c) => {
                    const x = cell(r, c);
                    return x?.tippingPoint === null || x === undefined ? "بدون کسری" : `ماه ${fmt(x.tippingPoint)}`;
                  }}
                />
              )}
            </Card>
            <Card title="حساسیت حفره نقدینگی" icon="🌪️" subtitle="اثر تغییر هر فرض بر حداکثر حفره (میلیارد تومان)">
              <Tornado items={result.analysis.tornado} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="توزیع مونت‌کارلوی حداکثر حفره" icon="🎲" subtitle={`${fmt(result.analysis.monteCarlo?.runs ?? 0)} اجرا با شوک هم‌زمان تقاضا، تأیید، خروج سپرده و نرخ بین‌بانکی`}>
              {histogram.length > 0 && <BarsChart data={histogram} xKey="bin" series={[{ key: "n", label: "تعداد اجرا", color: "#6366f1" }]} height={220} />}
              <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                {(["p5", "p50", "p95", "p99"] as const).map((q) => (
                  <div key={q} className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">{q.toUpperCase()}</div><div className="font-bold">{fmt(result.analysis.monteCarlo?.[q] ?? 0, 1)}</div></div>
                ))}
              </div>
              <div className="mt-2 text-xs text-slate-600">احتمال زیان حاشیه: {pct(result.analysis.monteCarlo?.pLoss ?? 0, 0)} • بدترین حفره: {money(result.analysis.monteCarlo?.worstCaseMaxHole ?? 0)}</div>
            </Card>
            <Card title="ماژول‌های مکمل" icon="🧩">
              <div className="space-y-3 text-xs leading-6">
                {result.prepayment && (
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="font-bold text-slate-700">⏩ پیش‌پرداخت</div>
                    نرخ سالانه وزنی {pct(result.prepayment.avgPrepaymentRate, 1)} • درآمد ازدست‌رفته {money(result.prepayment.lostInterestIncome)} • جریان نقد پیش‌افتاده {money(result.prepayment.acceleratedCashflow)}
                  </div>
                )}
                {result.antiNegin && (
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="font-bold text-slate-700">⚡ ضدنگین (وام فوری)</div>
                    حجم {money(result.antiNegin.fastLoanVolume)} • درآمد {money(result.antiNegin.fastLoanIncome)} • پوشش حفره <b>{pct(result.antiNegin.holeCoverageByFastLoans, 0)}</b>
                    {typeof result.antiNegin.cashAtTrough === "number" && <> • نقد در کف: {money(result.antiNegin.cashAtTrough)}</>}
                  </div>
                )}
                {result.gamification && (
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="font-bold text-slate-700">🎮 سفر انتظار</div>
                    امتیاز صادره {count(result.gamification.totalPointsIssued)} • جوایز قرعه‌کشی {money(result.gamification.expectedLotteryPayouts)} • ارتقای پله {pct(result.gamification.tierUpgradeRate, 0)} • کاهش ریزش {pct(result.gamification.estimatedRetentionUpliftPct, 1)}
                  </div>
                )}
                {!result.prepayment && !result.antiNegin && !result.gamification && <div className="text-slate-500">ماژول مکملی در پیکربندی فعال نیست.</div>}
              </div>
            </Card>
          </div>

          {options.length > 0 && (
            <Card title={`منوی ${fmt(options.length)} گزینه مشتری و مرز پارتو`} icon="🎯" subtitle="هر نقطه یک ترکیب «ماه‌های انتظار اضافه → مبلغ بیشتر / اقساط بلندتر / نرخ کمتر» برای معدل ۱۰۰ میلیون تومان است. روی نقطه کلیک کنید.">
              <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                <OptionsScatter
                  xLabel="مطلوبیت مشتری (۰ تا ۱۰۰)"
                  yLabel="بازده مؤثر بانک"
                  points={options.map((o) => ({ id: o.comboId, x: o.customerUtility, y: Math.min(o.bankEffectiveYield, 200), front: o.paretoOptimal, selected: o.comboId === selectedOpt }))}
                  onSelect={setSelectedOpt}
                />
                <div className="rounded-xl border border-slate-200 p-3 text-xs leading-6">
                  {chosen ? (
                    <>
                      <div className="mb-1 font-bold text-slate-800">گزینه انتخابی {chosen.paretoOptimal && <Badge tone="emerald">پارتو</Badge>}</div>
                      <div>انتظار: <b>{fmt(chosen.waitingMonths)} ماه</b></div>
                      <div>وام: <b>{mt(chosen.loanAmount, 1)}</b> (α {pct(chosen.alpha, 0)})</div>
                      <div>نرخ: <b>{pct(chosen.rate, 1)}</b> • دوره: <b>{fmt(chosen.tenor)} ماه</b></div>
                      <div>قسط: {mt(chosen.monthlyInstallment, 2)}</div>
                      <div>هزینه فرصت انتظار: {mt(chosen.opportunityCost, 1)}</div>
                      <div>هزینه کل مشتری: {mt(chosen.effectiveCustomerCost, 1)}</div>
                      <div>بازده مؤثر بانک: <b>{pct(chosen.bankEffectiveYield, 1)}</b></div>
                      {tiered ? (
                        <Btn className="mt-2 w-full" variant="ghost" disabled={busy || cfg.points.tiers.length >= MAX_TIERS} onClick={addOptionAsTier}>
                          ➕ افزودن به منوی پله‌ها (سهم اولیه ۵٪)
                        </Btn>
                      ) : (
                        <div className="mt-2 text-slate-500">افزودن به منو فقط برای محصولات چندپله‌ای فعال است.</div>
                      )}
                    </>
                  ) : (
                    <div className="text-slate-500">یک نقطه را انتخاب کنید تا جزئیات و امکان افزودن آن به منوی پله‌ها نمایش داده شود.</div>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Card title="طراح معکوس پله‌ها" icon="🧭" subtitle="هدف و قیود را تعیین کنید؛ سهم پله‌ها با «شیب انتظار» جابه‌جا و بهترین ترکیب امکان‌پذیر پیشنهاد می‌شود. تغییر قیود پس از اجرای دوباره اعمال می‌شود.">
            <div className="grid items-end gap-4 md:grid-cols-4">
              <Select<Objective> label="هدف" value={designer.objective} onChange={(v) => setDesigner((d) => ({ ...d, objective: v }))} options={(Object.keys(OBJ_LABEL) as Objective[]).map((o) => ({ value: o, label: OBJ_LABEL[o] }))} />
              <Num label="سقف حفره" value={designer.maxHolePct} onChange={(v) => setDesigner((d) => ({ ...d, maxHolePct: v }))} min={0} max={100} step={1} unit="٪ سپرده" />
              <Num label="حداقل حاشیه" value={designer.minMarginPct} onChange={(v) => setDesigner((d) => ({ ...d, minMarginPct: v }))} min={-20} max={100} step={0.5} unit="٪" />
              <Num label="سقف اهرم" value={designer.maxLeverage} onChange={(v) => setDesigner((d) => ({ ...d, maxLeverage: v }))} min={0.5} max={10} step={0.1} />
            </div>
            {!design ? (
              <div className="mt-3 text-sm text-slate-500">طراح معکوس به دست‌کم دو پله نیاز دارد.</div>
            ) : (
              <div className="mt-4 space-y-3">
                {design.constraintViolations.length > 0 ? (
                  <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">هیچ ترکیبی همه قیود را برآورده نکرد؛ نزدیک‌ترین طرح: {design.constraintViolations.join("؛ ")}</div>
                ) : (
                  <div className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900">طرح پیشنهادی همه قیود را برآورده می‌کند.</div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-slate-500"><th className="p-2 text-right">پله</th><th className="p-2">سهم فعلی</th><th className="p-2">سهم پیشنهادی</th><th className="p-2">تغییر</th></tr>
                    </thead>
                    <tbody>
                      {design.tiers.map((t, i) => {
                        const cur = cfg.points.tiers[i]?.expectedTakeUpShare ?? 0;
                        return (
                          <tr key={i} className="border-b border-slate-50 text-center tabular-nums">
                            <td className="p-2 text-right">{t.name}</td>
                            <td className="p-2">{pct(cur, 0)}</td>
                            <td className="p-2 font-bold">{pct(t.expectedTakeUpShare, 0)}</td>
                            <td className={`p-2 ${t.expectedTakeUpShare > cur ? "text-emerald-600" : t.expectedTakeUpShare < cur ? "text-rose-600" : ""}`}>{t.expectedTakeUpShare - cur > 0 ? "+" : ""}{fmt(t.expectedTakeUpShare - cur)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-slate-50 p-2">حفره: {money(k.maxHole)} ← <b>{money(design.kpis.maxHole)}</b></div>
                  <div className="rounded-lg bg-slate-50 p-2">حاشیه: {money(k.netMargin)} ← <b>{money(design.kpis.netMargin)}</b></div>
                  <div className="rounded-lg bg-slate-50 p-2">اهرم: {fmt(k.leverage, 2)} ← <b>{fmt(design.kpis.leverage, 2)}</b></div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">سهم پله‌ها فرض تقاضاست؛ اعمال آن یعنی بانک با بازاریابی و سقف ظرفیت پله‌ها این ترکیب را هدف می‌گیرد.</span>
                  {tiered && <Btn variant="ghost" disabled={busy} onClick={() => onApplyTiers(design.tiers.map((t, i) => ({ ...cfg.points.tiers[i], expectedTakeUpShare: t.expectedTakeUpShare })))}>✅ اعمال سهم‌های پیشنهادی</Btn>}
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      <Card title="مقایسه نسخه‌های طراحی" icon="🗂️" subtitle="هر اجرا با تصویر پله‌ها ثبت می‌شود؛ تا سه نسخه را برای مقایسه انتخاب کنید.">
        {almHistory.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">هنوز اجرای ALM ثبت نشده است.</div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="p-2" />
                    <th className="p-2 text-right">زمان</th>
                    <th className="p-2">سناریو</th>
                    <th className="p-2">پله‌ها</th>
                    <th className="p-2">حفره</th>
                    <th className="p-2">حاشیه</th>
                    <th className="p-2">اهرم</th>
                  </tr>
                </thead>
                <tbody>
                  {almHistory.map((h) => {
                    const s = h.summary;
                    const on = compare.includes(h.id);
                    return (
                      <tr key={h.id} className={`border-b border-slate-50 text-center ${on ? "bg-indigo-50/60" : ""}`}>
                        <td className="p-2">
                          <input
                            type="checkbox"
                            aria-label="انتخاب برای مقایسه"
                            checked={on}
                            disabled={!on && compare.length >= 3}
                            onChange={() => setCompare((c) => (on ? c.filter((x) => x !== h.id) : [...c, h.id]))}
                          />
                        </td>
                        <td className="p-2 text-right">{faDate(h.createdAt)}</td>
                        <td className="p-2">{SCEN_LABEL[h.scenario as AlmScenario] ?? h.scenario}</td>
                        <td className="p-2">{Array.isArray(s.tiers) ? fmt(s.tiers.length) : "—"}</td>
                        <td className="p-2">{money(num(s.maxHole))}</td>
                        <td className="p-2">{money(num(s.netMargin))}</td>
                        <td className="p-2">{fmt(num(s.leverage), 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {compared.length >= 2 && <VersionCompare items={compared} />}
          </div>
        )}
      </Card>
    </div>
  );
}

function VersionCompare({ items }: { items: AlmHistItem[] }) {
  const rows: { label: string; get: (s: Record<string, unknown>) => string; val?: (s: Record<string, unknown>) => number | null; better?: "low" | "high" }[] = [
    { label: "سناریو / سهم بازار / افق", get: (s) => `${SCEN_LABEL[s.scenario as AlmScenario] ?? "—"} • ${pct(num(s.marketShare), 1)} • ${fmt(num(s.horizon))} ماه` },
    { label: "کل سپرده", get: (s) => money(num(s.totalDeposit)) },
    { label: "حداکثر حفره", get: (s) => `${money(num(s.maxHole))} (${pct(num(s.holePct), 1)})`, val: (s) => num(s.holePct), better: "low" },
    { label: "ماه شکست → بازگشت", get: (s) => (s.tippingPoint === null ? "بدون کسری" : `${fmt(num(s.tippingPoint))} → ${fmt(num(s.recoveryMonth))}`) },
    { label: "حاشیه روی سپرده خالص", get: (s) => pct(num(s.marginOnNetDeposit), 1), val: (s) => num(s.marginOnNetDeposit), better: "high" },
    { label: "اهرم", get: (s) => fmt(num(s.leverage), 2), val: (s) => num(s.leverage), better: "low" },
    { label: "احتمال شکست (MC)", get: (s) => pct(num(s.pTipping), 0), val: (s) => num(s.pTipping), better: "low" },
    { label: "NSFR ماه ۱۲", get: (s) => pct(num(s.nsfrAt12), 0), val: (s) => num(s.nsfrAt12), better: "high" },
    { label: "وام‌گیرندگان", get: (s) => count(num(s.borrowers)), val: (s) => num(s.borrowers), better: "high" },
  ];
  const bestIdx = (r: (typeof rows)[number]) => {
    if (!r.val || !r.better) return -1;
    const vs = items.map((h) => r.val!(h.summary));
    let bi = -1;
    vs.forEach((v, i) => {
      if (v === null) return;
      if (bi < 0 || (r.better === "low" ? v < vs[bi]! : v > vs[bi]!)) bi = i;
    });
    return bi;
  };
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-slate-500">
              <th className="p-2 text-right">شاخص</th>
              {items.map((h) => <th key={h.id} className="p-2">{faDate(h.createdAt)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const b = bestIdx(r);
              return (
                <tr key={r.label} className="border-b border-slate-50 text-center">
                  <td className="p-2 text-right font-semibold">{r.label}</td>
                  {items.map((h, i) => <td key={h.id} className={`p-2 tabular-nums ${i === b ? "font-bold text-emerald-700" : ""}`}>{r.get(h.summary)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((h) => (
          <div key={h.id} className="rounded-xl border border-slate-200 p-2 text-[11px]">
            <div className="mb-1 font-bold text-slate-700">پله‌ها — {faDate(h.createdAt)}</div>
            <table className="w-full">
              <thead><tr className="text-slate-400"><th className="text-right">پله</th><th>انتظار</th><th>α</th><th>نرخ</th><th>سهم</th></tr></thead>
              <tbody>
                {(Array.isArray(h.summary.tiers) ? (h.summary.tiers as TierSnap[]) : []).map((t, i) => (
                  <tr key={i} className="text-center tabular-nums"><td className="text-right">{t.name}</td><td>{fmt(t.wait)}</td><td>{fmt(t.alpha)}</td><td>{fmt(t.rate, 1)}</td><td>{fmt(t.share)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
