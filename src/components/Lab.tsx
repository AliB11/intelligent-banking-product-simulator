"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AlmLab from "@/components/AlmLab";
import { BarsChart, ComboChart, DnaRadar, Funnel, ParetoChart, Tornado, Waterfall } from "@/components/charts";
import { Badge, Btn, Card, COMP_LEVEL, Gauge, LEVEL, Meter, Num, Select, Spinner, Stat, Tabs } from "@/components/ui";
import { CHANNELS, COLLATERALS, CONTRACTS, FAMILIES, KINDS, SCENARIOS } from "@/lib/engine/catalog";
import { executiveSummary } from "@/lib/engine/advisor";
import { mergeConfig } from "@/lib/engine/templates";
import type { DeepPartial, FullAlmResult, FullResult, Objective, OptimizerResult, ProductConfig, ScenarioId, StressRow, TornadoItem } from "@/lib/engine/types";
import { axisMoney, count, faDate, fmt, money, mt, pct } from "@/lib/format";
import { DEFAULT_UI_PARAMS, type UiParams } from "@/lib/params";

interface HistItem {
  id: number;
  type: string;
  scenario: string;
  summary: Record<string, unknown>;
  createdAt: string;
}

type TabKey = "results" | "advisor" | "pricing" | "stress" | "sensitivity" | "optimizer" | "alm" | "compliance" | "history";

const OBJECTIVES: { value: Objective; label: string }[] = [
  { value: "balanced", label: "⚖️ متوازن (حداکثر امتیاز سلامت)" },
  { value: "profit", label: "💰 حداکثر سود خالص" },
  { value: "raroc", label: "📐 حداکثر بازده تعدیل‌شده با ریسک" },
  { value: "inclusion", label: "🤝 حداکثر شمول مالی با سود نامنفی" },
];

const TYPE_LABEL: Record<string, string> = {
  monte_carlo: "مونت‌کارلو",
  stress: "تست استرس",
  sensitivity: "حساسیت",
  optimize: "بهینه‌سازی",
  alm: "ALM",
};

const ALM_SCEN_LABEL: Record<string, string> = { stress: "استرس نقدینگی (ALM)", fast_growth: "رشد سریع (ALM)" };

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? "خطای سرور");
  return j;
}

export default function Lab({
  productId,
  config,
  initial,
  history: initialHistory,
  almLatest = null,
}: {
  productId: number;
  config: ProductConfig;
  initial: FullResult | null;
  history: HistItem[];
  almLatest?: { id: number; createdAt: string; summary: Record<string, unknown>; result: FullAlmResult } | null;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ProductConfig>(config);
  const [params, setParams] = useState<UiParams>(() => initial ? {
    ...DEFAULT_UI_PARAMS,
    ...initial.sim.params,
    marketSize: initial.sim.params.customers * initial.sim.params.scale,
    inflation: initial.sim.params.inflation ?? null,
  } : DEFAULT_UI_PARAMS);
  const [result, setResult] = useState<FullResult | null>(initial);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("results");
  const [stress, setStress] = useState<StressRow[] | null>(null);
  const [sens, setSens] = useState<TornadoItem[] | null>(null);
  const [opt, setOpt] = useState<OptimizerResult | null>(null);
  const [objective, setObjective] = useState<Objective>("balanced");
  const [history, setHistory] = useState<HistItem[]>(initialHistory);
  const started = useRef(false);

  const isPoints = cfg.kind === "points_loan";
  const isLoyalty = cfg.kind === "loyalty";
  const setP = <K extends keyof UiParams>(k: K, v: UiParams[K]) => setParams((p) => ({ ...p, [k]: v }));

  const runSim = async () => {
    setLoading("sim");
    setError(null);
    try {
      const j = await post<FullResult & { simulationId: number | null }>("/api/simulate", { productId, params });
      setResult(j);
      setHistory((h) => [
        {
          id: j.simulationId ?? Date.now(),
          type: "monte_carlo",
          scenario: params.scenario,
          summary: { netProfit: j.sim.kpis.netProfit, raroc: j.sim.kpis.raroc, nplEnd: j.sim.kpis.nplEnd, health: j.health.score, grade: j.health.grade },
          createdAt: new Date().toISOString(),
        },
        ...h,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    if (!initial && !started.current) {
      started.current = true;
      void runSim();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveConfig = async (next: ProductConfig) => {
    const r = await fetch(`/api/products/${productId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: next }) });
    if (!r.ok) throw new Error("ذخیره پیکربندی ناموفق بود");
    setCfg(next);
  };

  const applyPatch = async (patch: DeepPartial<ProductConfig>) => {
    setLoading("apply");
    setError(null);
    try {
      await saveConfig(mergeConfig(cfg, patch));
      setStress(null);
      setSens(null);
      setOpt(null);
      await runSim();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(null);
    }
  };

  const runAnalysis = async (mode: "stress" | "sensitivity" | "optimize") => {
    setLoading(mode);
    setError(null);
    try {
      if (mode === "stress") setStress((await post<{ rows: StressRow[] }>("/api/analyze", { productId, mode, params })).rows);
      else if (mode === "sensitivity") setSens((await post<{ items: TornadoItem[] }>("/api/analyze", { productId, mode, params })).items);
      else setOpt(await post<OptimizerResult>("/api/analyze", { productId, mode, objective, params }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  };

  const applyOptimized = async () => {
    if (!opt) return;
    setLoading("apply");
    try {
      await saveConfig(opt.best.config);
      setOpt(null);
      setTab("results");
      await runSim();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(null);
    }
  };

  const remove = async () => {
    if (!confirm("این محصول و همه شبیه‌سازی‌های آن حذف شود؟")) return;
    setLoading("delete");
    setError(null);
    try {
      const response = await fetch(`/api/products/${productId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("حذف محصول انجام نشد؛ دوباره تلاش کنید.");
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ارتباط با سرور");
    } finally { setLoading(null); }
  };

  const exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ product: cfg, kpis: result?.sim.kpis ?? null, health: result?.health ?? null, compliance: result?.compliance ?? null, insights: result?.insights ?? [] }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cfg.code || "product"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const sim = result?.sim;
  const kp = sim?.kpis;
  const stale = sim && (params.customers !== sim.params.customers || params.runs !== sim.params.runs ||
    params.scenario !== sim.params.scenario || params.horizon !== sim.params.horizon ||
    params.marketRate !== sim.params.marketRate || params.seed !== sim.params.seed ||
    Math.abs(params.marketSize - sim.params.customers * sim.params.scale) > 0.01 ||
    (params.inflation ?? null) !== (sim.params.inflation ?? null));
  const series = sim
    ? sim.series.map((s) => ({
        m: s.m,
        revenue: s.interest + s.fees + s.benefit + s.incremental,
        cost: -(s.funding + s.opex + s.losses + s.reward),
        profit: s.profit,
        cum: s.cumProfit,
        real: s.realCumProfit,
        out: s.outstanding,
        npl: s.npl,
        dep: s.deposits,
        liab: s.liability,
        reward: s.reward,
        inc: s.incremental,
      }))
    : [];

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="relative overflow-hidden rounded-3xl p-5 text-white shadow-xl" style={{ background: `linear-gradient(120deg, ${cfg.color}, #0f172a 75%)` }}>
        <div className="hero-grid absolute inset-0 opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="floaty grid h-16 w-16 place-items-center rounded-2xl bg-white/15 text-4xl">{cfg.emoji}</span>
            <div>
              <div className="text-2xl font-black">{cfg.name}</div>
              <div className="text-sm text-white/80">{cfg.tagline}</div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-white/15 px-2 py-0.5">{FAMILIES[cfg.family].emoji} {FAMILIES[cfg.family].label}</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5">{KINDS[cfg.kind].label}</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5">{CONTRACTS[cfg.contract].label}</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5">{CHANNELS[cfg.channel].label}</span>
                {!isLoyalty && <span className="rounded-full bg-white/15 px-2 py-0.5">{COLLATERALS[cfg.risk.collateral].label}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {result && <Gauge value={result.health.score} label={`${result.health.grade} • ${result.health.label}`} size={130} />}
            <div className="flex flex-col gap-2">
              <Link href={`/studio/${productId}`} className="rounded-xl bg-white/15 px-3 py-2 text-center text-sm font-semibold hover:bg-white/25">✏️ ویرایش در کارگاه</Link>
              <Link href={`/persona?product=${productId}`} className="rounded-xl bg-white/15 px-3 py-2 text-center text-sm font-semibold hover:bg-white/25">🧭 سفر مشتری</Link>
              <button type="button" onClick={() => window.print()} className="rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/25">🖨️ شناسنامه / PDF</button>
              <button type="button" onClick={exportJson} className="rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/25">⬇️ خروجی JSON</button>
              <button type="button" onClick={remove} disabled={!!loading} className="rounded-xl bg-rose-500/30 px-3 py-2 text-sm font-semibold hover:bg-rose-500/50">🗑️ حذف</button>
            </div>
          </div>
        </div>
      </div>

      {/* controls */}
      <Card title="پارامترهای شبیه‌سازی مونت‌کارلو" icon="🎛️" subtitle="جمعیت مصنوعی با توزیع درآمد، اشتغال، رتبه اعتباری و رفتار مشتری ایرانی؛ هر اجرا با یک شوک سیستماتیک (واسیچک) متفاوت">
        <div className="grid items-end gap-4 md:grid-cols-3 lg:grid-cols-7">
          <Select<ScenarioId> label="سناریوی کلان" value={params.scenario} onChange={(v) => setP("scenario", v)} options={(Object.keys(SCENARIOS) as ScenarioId[]).map((s) => ({ value: s, label: `${SCENARIOS[s].label} (تورم ${fmt(SCENARIOS[s].inflation)}٪)` }))} />
          <Num label="مشتریان مصنوعی" value={params.customers} onChange={(v) => setP("customers", v)} min={1000} max={10000} step={500} />
          <Num label="تعداد اجرا" value={params.runs} onChange={(v) => setP("runs", v)} min={4} max={60} step={1} />
          <Num label="افق (ماه)" value={params.horizon} onChange={(v) => setP("horizon", v)} min={12} max={60} step={6} />
          <Num label="نرخ مؤثر رقبا" value={params.marketRate} onChange={(v) => setP("marketRate", v)} min={15} max={40} step={0.5} unit="٪" />
          <Select<string>
            label="اندازه بازار هدف"
            value={String(params.marketSize)}
            onChange={(v) => setP("marketSize", Number(v))}
            options={[250000, 500000, 1000000, 3000000, 10000000].map((n) => ({ value: String(n), label: `${count(n)} نفر` }))}
          />
          <Btn onClick={runSim} disabled={!!loading} className="h-10">
            {loading === "sim" || loading === "apply" ? <Spinner /> : "▶"} اجرای شبیه‌سازی
          </Btn>
        </div>
        <div className="mt-2 text-[11px] text-slate-500">{SCENARIOS[params.scenario].description}</div>
        {error && <div role="alert" className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</div>}
      </Card>

      {stale && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <span>پارامترها تغییر کرده‌اند؛ نمودارهای فعلی هنوز مربوط به اجرای قبلی هستند.</span>
        <Btn onClick={runSim} disabled={!!loading} variant="ghost">به‌روزرسانی نتایج</Btn>
      </div>}
      {loading && <p role="status" aria-live="polite" className="text-sm text-indigo-700">در حال پردازش… لطفاً تا تکمیل عملیات صبر کنید.</p>}

      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "results", label: "داشبورد نتایج", icon: "📊" },
          { key: "advisor", label: "دستیار هوشمند", icon: "🤖" },
          { key: "pricing", label: "قیمت‌گذاری ریسک‌محور", icon: "🏷️" },
          { key: "stress", label: "تست استرس", icon: "🌪️" },
          { key: "sensitivity", label: "تحلیل حساسیت", icon: "🌡️" },
          { key: "optimizer", label: "بهینه‌ساز هوشمند", icon: "🧠" },
          ...(isPoints ? [{ key: "alm" as TabKey, label: "آزمایشگاه ALM", icon: "🌊" }] : []),
          { key: "compliance", label: "انطباق", icon: "⚖️" },
          { key: "history", label: "تاریخچه", icon: "🕘" },
        ]}
      />

      {!result && (
        <Card>
          <div className="py-16 text-center text-slate-500">{loading ? "⏳ در حال اجرای شبیه‌سازی مونت‌کارلو…" : "برای مشاهده نتایج، شبیه‌سازی را اجرا کنید."}</div>
        </Card>
      )}

      {result && sim && kp && tab === "results" && (
        <div className="space-y-4">
          <Card title="خلاصه مدیریتی هوشمند" icon="🧾" className="border-indigo-200 bg-indigo-50/50">
            <div className="space-y-1.5 text-sm leading-7 text-slate-700">
              {executiveSummary(cfg, result).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <Stat label="سود خالص (پس از مالیات)" value={money(kp.netProfit)} tone={kp.netProfit >= 0 ? "good" : "bad"} icon="💰" />
            <Stat label="سود واقعی (تعدیل تورم)" value={money(kp.realProfit)} tone={kp.realProfit >= 0 ? "good" : "bad"} sub={`تورم ${fmt(kp.inflation)}٪`} icon="📉" />
            {isLoyalty ? (
              <Stat label="بازده باشگاه (ROI)" value={pct(kp.loyaltyRoi, 0)} tone={kp.loyaltyRoi >= 0 ? "good" : "bad"} icon="🎯" />
            ) : (
              <Stat label="RAROC سالانه" value={pct(kp.raroc, 1)} tone={kp.raroc >= cfg.funding.targetRoe ? "good" : kp.raroc >= 0 ? "warn" : "bad"} sub={`هدف ${fmt(cfg.funding.targetRoe)}٪`} icon="📐" />
            )}
            {isLoyalty ? (
              <Stat label="اعضای جذب‌شده" value={count(kp.booked)} icon="👥" />
            ) : (
              <Stat label="حجم اعطا" value={money(kp.volume)} sub={`${count(kp.booked)} قرارداد`} icon="🏦" />
            )}
            {!isLoyalty && <Stat label="NPL (پایدار)" value={pct(kp.nplEnd)} tone={kp.nplEnd > 8 ? "bad" : kp.nplEnd > 5 ? "warn" : "good"} icon="🚨" />}
            {!isLoyalty && <Stat label="نرخ تأیید" value={pct(kp.approvalRate, 0)} sub={`${count(kp.applicants)} متقاضی`} icon="✅" />}
            {!isLoyalty && <Stat label="نرخ مؤثر مشتری (APR)" value={pct(kp.apr)} icon="🏷️" />}
            {!isLoyalty && <Stat label="ROA سالانه" value={pct(kp.roa)} tone={kp.roa >= 0 ? "good" : "bad"} icon="📈" />}
            {!isLoyalty && <Stat label="حاشیه سود خالص (NIM)" value={pct(kp.nim)} icon="➗" />}
            {!isLoyalty && <Stat label="PD / LGD متوسط" value={`${pct(kp.avgPd)} / ${pct(kp.avgLgd, 0)}`} icon="🎲" />}
            {!isLoyalty && <Stat label="نکول تجمعی" value={pct(kp.cumDefaultRate)} icon="⚠️" />}
            {!isLoyalty && <Stat label="بازده واقعی دارایی" value={pct(kp.realYield)} tone={kp.realYield >= 0 ? "good" : "bad"} icon="🔥" />}
            <Stat label="شمول مالی" value={pct(kp.inclusion, 0)} sub="کم‌درآمد یا فاقد سابقه" icon="🤝" />
            {!isLoyalty && <Stat label="شکاف عدالت اعتباری" value={`${fmt(kp.fairnessGap, 0)} واحد`} sub="تأیید پردرآمد − کم‌درآمد" icon="⚖️" />}
            {!isLoyalty && <Stat label="بار اقساط خانوار" value={pct(kp.customerBurden)} sub="میانگین DTI" icon="🏠" />}
            {!isLoyalty && <Stat label="سرمایه اقتصادی (IRB)" value={money(kp.economicCapital)} sub={`سرمایه قانونی ${money(kp.regulatoryCapital)}`} icon="🏛️" />}
            {!isLoyalty && <Stat label="ارزش فعلی خالص" value={money(kp.npv)} tone={kp.npv >= 0 ? "good" : "bad"} icon="⏳" />}
            {!isLoyalty && <Stat label="میانگین مبلغ/قسط" value={mt(kp.avgTicket)} sub={`قسط ${mt(kp.avgInstallment, 1)}`} icon="🧾" />}
            {isPoints && (
              <>
                <Stat label="میانگین سپرده امتیازی" value={money(kp.depositsAvg)} icon="🐷" />
                <Stat label="ارزش منابع ارزان" value={money(kp.fundingBenefit)} tone="good" icon="💎" />
                <Stat label="RAROC فقط اعتباری" value={pct(kp.rarocCredit, 0)} tone={kp.rarocCredit >= 0 ? "neutral" : "bad"} sub="بدون ارزش منابع ارزان" icon="🧮" />
                <Stat label="RAROC تعدیل‌شده نقدینگی" value={pct(kp.rarocLiquidity, 0)} tone={kp.rarocLiquidity >= cfg.funding.targetRoe ? "good" : "warn"} sub={`بافر ${money(kp.liquidityCost)} • سرمایه ${money(kp.liquidityCapital)}`} icon="💧" />
                <Stat label="تراز پول–زمان (عمر)" value={fmt(kp.moneyTimeRatio, 2)} tone={kp.moneyTimeRatio >= 1 ? "good" : "bad"} sub="سپرده‌ماه ÷ وام‌ماه" icon="⏱️" />
                <Stat label="انتظار برای امتیاز" value={`${fmt(kp.avgWaitDays)} روز`} icon="⌛" />
              </>
            )}
            {(isLoyalty || cfg.family === "hybrid") && (
              <>
                <Stat label="امتیاز صادرشده" value={count(kp.pointsIssued)} icon="⭐" />
                <Stat label="هزینه پاداش" value={money(kp.rewardCost)} tone="bad" icon="🎁" />
                {isLoyalty && <Stat label="درآمد افزایشی" value={money(kp.incrementalRevenue)} tone="good" icon="📈" />}
                {isLoyalty && <Stat label="تعهد امتیاز (پایان)" value={money(kp.pointsLiabilityEnd)} icon="📒" />}
              </>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="صورت سود و زیان ماهانه" icon="📊" subtitle="میلیارد تومان — میانگین اجراهای مونت‌کارلو">
              <ComboChart
                data={series}
                xKey="m"
                refY={0}
                series={[
                  { key: "revenue", label: "درآمد", color: "#10b981", type: "bar", stack: "x" },
                  { key: "cost", label: "هزینه", color: "#f43f5e", type: "bar", stack: "x" },
                  { key: "profit", label: "سود ماهانه", color: "#0f172a", type: "line" },
                ]}
              />
            </Card>
            <Card title="سود تجمعی: اسمی در برابر واقعی" icon="🔥" subtitle={`اثر تورم ${fmt(kp.inflation)}٪ بر ارزش واقعی سود`}>
              <ComboChart
                data={series}
                xKey="m"
                refY={0}
                series={[
                  { key: "cum", label: "تجمعی اسمی", color: "#6366f1" },
                  { key: "real", label: "تجمعی واقعی", color: "#f59e0b" },
                ]}
              />
            </Card>
            {!isLoyalty && (
              <Card title="مانده سبد و نسبت مطالبات غیرجاری" icon="🏦">
                <ComboChart
                  data={series}
                  xKey="m"
                  y2Fmt={(v) => `${fmt(v, 0)}٪`}
                  series={[
                    { key: "out", label: "مانده سبد", color: cfg.color },
                    ...(isPoints ? [{ key: "dep", label: "سپرده امتیازی", color: "#eab308" }] : []),
                    { key: "npl", label: "NPL٪", color: "#ef4444", type: "line" as const, axis: "right" as const },
                  ]}
                />
              </Card>
            )}
            {isLoyalty && (
              <Card title="اقتصاد پاداش و تعهد امتیاز" icon="🎁">
                <ComboChart
                  data={series}
                  xKey="m"
                  series={[
                    { key: "inc", label: "درآمد افزایشی", color: "#10b981", type: "line" },
                    { key: "reward", label: "هزینه پاداش", color: "#f43f5e", type: "line" },
                    { key: "liab", label: "تعهد امتیاز", color: "#a855f7" },
                  ]}
                />
              </Card>
            )}
            <Card
              title="توزیع سود خالص در اجراهای مونت‌کارلو"
              icon="🎲"
              subtitle={`P5: ${money(sim.profitDist.p5)} • میانه: ${money(sim.profitDist.p50)} • P95: ${money(sim.profitDist.p95)} • احتمال زیان: ${pct(sim.profitDist.probLoss, 0)} • VaR۹۵: ${money(sim.profitDist.var95)}`}
            >
              <BarsChart data={sim.profitDist.bins} xKey="label" series={[{ key: "count", label: "تعداد اجرا", color: "#6366f1" }]} colorBy={(r) => (Number(r.x) < 0 ? "#f43f5e" : "#10b981")} height={230} />
            </Card>
            <Card title="قیف جذب مشتری" icon="🔻">
              <Funnel stages={sim.funnel} />
            </Card>
            <Card title="آبشار سود و زیان (کل افق)" icon="🌊">
              <Waterfall items={sim.waterfall} total={kp.netProfit} />
            </Card>
            {!isLoyalty && (
              <Card title="توزیع رتبه اعتباری: متقاضی، تأییدشده، نکول" icon="🎯">
                <BarsChart
                  data={sim.scoreBands}
                  xKey="band"
                  yFmt={(v) => count(v)}
                  series={[
                    { key: "applied", label: "متقاضی", color: "#cbd5e1" },
                    { key: "approved", label: "تأییدشده", color: "#6366f1" },
                    { key: "defaulted", label: "نکول", color: "#ef4444" },
                  ]}
                />
              </Card>
            )}
            {!isLoyalty && (
              <Card title="منحنی نکول تجمعی (Vintage)" icon="📈" subtitle="درصد قراردادهای نکول‌شده بر حسب ماه از اعطا">
                <ComboChart data={sim.vintage} xKey="m" yFmt={(v) => `${fmt(v, 1)}٪`} xLabel="ماه از اعطا" series={[{ key: "cum", label: "نکول تجمعی٪", color: "#ef4444" }]} />
              </Card>
            )}
          </div>

          {!isLoyalty && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="عملکرد به تفکیک اشتغال" icon="👔">
                <SegTable rows={sim.segments} />
              </Card>
              <Card title="عدالت اعتباری: دهک‌های درآمدی" icon="⚖️">
                <SegTable rows={sim.quintiles} />
              </Card>
            </div>
          )}
          <div className="text-left text-[11px] text-slate-400">
            ⏱️ {fmt(sim.durationMs)} میلی‌ثانیه • {fmt(sim.params.customers)} مشتری × {fmt(sim.params.runs)} اجرا × {fmt(sim.params.horizon)} ماه
          </div>
        </div>
      )}

      {result && tab === "advisor" && (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-4">
            <Card title="امتیاز سلامت محصول" icon="❤️">
              <Gauge value={result.health.score} label={`${result.health.grade} • ${result.health.label}`} size={200} />
              <div className="mt-3 space-y-2">
                {result.health.parts.map((p) => (
                  <div key={p.key}>
                    <div className="flex justify-between text-xs">
                      <span>{p.label} <span className="text-slate-400">(وزن {fmt(p.weight * 100)}٪)</span></span>
                      <span className="font-bold">{fmt(p.value)}</span>
                    </div>
                    <Meter value={p.value} color={p.value >= 70 ? "#10b981" : p.value >= 50 ? "#f59e0b" : "#ef4444"} />
                  </div>
                ))}
              </div>
            </Card>
            <Card title="DNA محصول" icon="🧬">
              <DnaRadar axes={result.dna.map((d) => d.axis)} series={[{ name: cfg.name, color: cfg.color, values: result.dna.map((d) => d.value) }]} height={260} />
            </Card>
          </div>
          <div className="lg:col-span-8">
            <Card title="توصیه‌های دستیار هوشمند" icon="🤖" subtitle="سیستم خبره مبتنی بر قواعد بانک مرکزی، اقتصاد اعتبار و نتایج شبیه‌سازی؛ با یک کلیک اعمال و دوباره شبیه‌سازی کنید.">
              {result.insights.length === 0 && <div className="py-8 text-center text-sm text-slate-500">موردی برای بهبود یافت نشد. 🎉</div>}
              <div className="space-y-3">
                {result.insights.map((ins) => (
                  <div key={ins.id} className={`rounded-2xl border p-4 ${LEVEL[ins.level].cls}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className={`font-bold ${LEVEL[ins.level].text}`}>
                        {LEVEL[ins.level].icon} {ins.title}
                      </div>
                      <Badge tone={ins.level === "critical" ? "rose" : ins.level === "warning" ? "amber" : ins.level === "opportunity" ? "sky" : "emerald"}>{LEVEL[ins.level].label}</Badge>
                    </div>
                    <p className="mt-1.5 text-sm leading-7 text-slate-700">{ins.body}</p>
                    {ins.action && (
                      <Btn variant="ghost" className="mt-2" disabled={!!loading} onClick={() => ins.action && applyPatch(ins.action.patch)}>
                        {loading === "apply" ? <Spinner /> : "⚡"} {ins.action.label} و شبیه‌سازی مجدد
                      </Btn>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {result && sim && tab === "pricing" && (
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-5" title="ساختار نرخ مبتنی بر ریسک" icon="🏷️" subtitle="نرخ لازم = هزینه وجوه + زیان مورد انتظار + هزینه عملیاتی + هزینه پاداش − کارمزدها − ارزش منابع ارزان + هزینه سرمایه">
            {isLoyalty ? (
              <div className="py-8 text-center text-sm text-slate-500">برای باشگاه وفاداری، قیمت‌گذاری نرخ کاربرد ندارد.</div>
            ) : (
              <div className="space-y-2 text-sm">
                {[
                  ["هزینه تأمین وجوه", sim.pricing.cof, 1],
                  ["زیان مورد انتظار (EL)", sim.pricing.el, 1],
                  ["هزینه عملیاتی", sim.pricing.opex, 1],
                  ["هزینه پاداش", sim.pricing.reward, 1],
                  ["کارمزدها و وجه التزام", sim.pricing.fees, -1],
                  ["ارزش منابع ارزان", sim.pricing.benefit, -1],
                ].map(([label, v, sign]) => (
                  <div key={String(label)} className="flex items-center justify-between border-b border-dashed border-slate-100 pb-1">
                    <span className="text-slate-600">{Number(sign) > 0 ? "➕" : "➖"} {label}</span>
                    <span className="font-semibold">{pct(Number(v), 2)}</span>
                  </div>
                ))}
                <div className="flex justify-between rounded-lg bg-slate-100 p-2 font-bold"><span>= نرخ سربه‌سر</span><span>{pct(sim.pricing.breakEven, 2)}</span></div>
                <div className="flex justify-between px-2"><span className="text-slate-600">➕ هزینه سرمایه ({fmt(cfg.funding.targetRoe)}٪ × سرمایه)</span><span className="font-semibold">{pct(sim.pricing.capital, 2)}</span></div>
                <div className="flex justify-between rounded-lg bg-indigo-50 p-2 font-bold text-indigo-800"><span>= نرخ مبتنی بر ریسک</span><span>{pct(sim.pricing.riskBased, 2)}</span></div>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Stat label="نرخ فعلی محصول" value={pct(sim.pricing.productRate)} tone={sim.pricing.productRate >= sim.pricing.riskBased ? "good" : "bad"} />
                  <Stat label="سقف قانونی" value={pct(sim.pricing.cap)} tone={sim.pricing.riskBased > sim.pricing.cap ? "bad" : "neutral"} />
                </div>
                {sim.pricing.riskBased > sim.pricing.cap && (
                  <div className="rounded-lg bg-rose-50 p-2 text-xs leading-6 text-rose-700">
                    نرخ لازم از سقف دستوری بالاتر است ← «جیره‌بندی اعتبار»: بانک باید ریسک (PD/LGD) یا هزینه را کاهش دهد، نه قیمت را افزایش.
                  </div>
                )}
              </div>
            )}
          </Card>
          <Card className="lg:col-span-7" title="جدول قیمت‌گذاری به تفکیک رتبه اعتباری" icon="📋" subtitle="کدام رتبه‌ها با نرخ فعلی و سقف ۲۳٪ سودآورند؟">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="p-2 text-right">رتبه</th>
                    <th className="p-2">سهم سبد</th>
                    <th className="p-2">PD</th>
                    <th className="p-2">LGD</th>
                    <th className="p-2">EL</th>
                    <th className="p-2">هزینه سرمایه</th>
                    <th className="p-2">نرخ لازم</th>
                    <th className="p-2">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.pricingGrid.map((r) => (
                    <tr key={r.band} className="border-b border-slate-50 text-center">
                      <td className="p-2 text-right font-semibold">{r.band}</td>
                      <td className="p-2">{pct(r.share, 0)}</td>
                      <td className="p-2">{pct(r.pd)}</td>
                      <td className="p-2">{pct(r.lgd, 0)}</td>
                      <td className="p-2">{pct(r.el, 2)}</td>
                      <td className="p-2">{pct(r.capital, 2)}</td>
                      <td className="p-2 font-bold">{pct(r.required, 1)}</td>
                      <td className="p-2">
                        {r.status === "ok" ? <Badge tone="emerald">سودآور</Badge> : r.status === "above_rate" ? <Badge tone="amber">نیازمند نرخ بالاتر</Badge> : <Badge tone="rose">بالاتر از سقف</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sim.pricingGrid.length === 0 && <div className="py-6 text-center text-slate-400">داده‌ای برای نمایش نیست.</div>}
            </div>
          </Card>
        </div>
      )}

      {tab === "stress" && (
        <Card
          title="تست استرس کلان اقتصادی (۷ سناریو)"
          icon="🌪️"
          subtitle="هر سناریو با تورم، نکول، LGD، تقاضا و هزینه وجوه متفاوت شبیه‌سازی می‌شود."
          actions={<Btn onClick={() => runAnalysis("stress")} disabled={!!loading}>{loading === "stress" ? <Spinner /> : "🌪️"} اجرای تست استرس</Btn>}
        >
          {!stress ? (
            <div className="py-10 text-center text-sm text-slate-500">برای اجرای تست استرس دکمه بالا را بزنید.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <BarsChart data={stress} xKey="label" yFmt={axisMoney} series={[{ key: "netProfit", label: "سود خالص (میلیارد تومان)", color: "#6366f1" }]} colorBy={(r) => String(r.color)} />
                <BarsChart data={stress} xKey="label" yFmt={(v) => `${fmt(v, 1)}٪`} series={[{ key: "nplEnd", label: "NPL٪", color: "#ef4444" }]} colorBy={(r) => String(r.color)} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="p-2 text-right">سناریو</th>
                      <th className="p-2">تورم</th>
                      <th className="p-2">سود خالص</th>
                      <th className="p-2">سود واقعی</th>
                      <th className="p-2">NPL</th>
                      <th className="p-2">نکول تجمعی</th>
                      <th className="p-2">RAROC</th>
                      <th className="p-2">احتمال زیان</th>
                      <th className="p-2">نرخ تأیید</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stress.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 text-center">
                        <td className="p-2 text-right font-semibold"><span className="ml-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.label}</td>
                        <td className="p-2">{pct(r.inflation, 0)}</td>
                        <td className={`p-2 font-bold ${r.netProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{money(r.netProfit)}</td>
                        <td className={`p-2 ${r.realProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{money(r.realProfit)}</td>
                        <td className="p-2">{pct(r.nplEnd)}</td>
                        <td className="p-2">{pct(r.cumDefaultRate)}</td>
                        <td className="p-2">{pct(r.raroc, 0)}</td>
                        <td className="p-2">{pct(r.probLoss, 0)}</td>
                        <td className="p-2">{pct(r.approvalRate, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === "sensitivity" && (
        <Card
          title="نمودار گردبادی حساسیت سود خالص"
          icon="🌡️"
          subtitle="اثر تغییر هر پارامتر کلیدی (با ثابت ماندن بقیه) بر سود خالص — مرتب‌شده بر اساس شدت اثر"
          actions={<Btn onClick={() => runAnalysis("sensitivity")} disabled={!!loading}>{loading === "sensitivity" ? <Spinner /> : "🌡️"} اجرای تحلیل حساسیت</Btn>}
        >
          {!sens ? (
            <div className="py-10 text-center text-sm text-slate-500">برای اجرای تحلیل حساسیت دکمه بالا را بزنید.</div>
          ) : (
            <>
              <div className="mb-3 text-xs text-slate-500">سود پایه: <b>{money(sens[0]?.base ?? 0)}</b></div>
              <Tornado items={sens} />
            </>
          )}
        </Card>
      )}

      {tab === "optimizer" && (
        <div className="space-y-4">
          <Card title="بهینه‌ساز هوشمند محصول" icon="🧠" subtitle="جستجوی تصادفی + جستجوی محلی نخبه‌گرا در فضای پارامترها با قید انطباق مقرراتی؛ مرز پارتو بین دسترسی و سود را کشف می‌کند.">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64">
                <Select<Objective> label="هدف بهینه‌سازی" value={objective} onChange={setObjective} options={OBJECTIVES} />
              </div>
              <Btn onClick={() => runAnalysis("optimize")} disabled={!!loading}>
                {loading === "optimize" ? <Spinner /> : "🧠"} اجرای بهینه‌ساز
              </Btn>
            </div>
          </Card>
          {opt && (
            <div className="grid gap-4 lg:grid-cols-12">
              <Card className="lg:col-span-5" title="پیکربندی پیشنهادی" icon="🏆" subtitle={`${fmt(opt.evaluations)} پیکربندی ارزیابی شد`}>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="سود خالص: فعلی ← بهینه" value={<span className="text-base">{money(opt.baseline.kpis.netProfit)} ← {money(opt.best.kpis.netProfit)}</span>} tone={opt.best.kpis.netProfit >= opt.baseline.kpis.netProfit ? "good" : "warn"} />
                  <Stat label={isLoyalty ? "ROI" : "RAROC"} value={<span className="text-base">{pct(isLoyalty ? opt.baseline.kpis.loyaltyRoi : opt.baseline.kpis.raroc, 0)} ← {pct(isLoyalty ? opt.best.kpis.loyaltyRoi : opt.best.kpis.raroc, 0)}</span>} />
                  <Stat label="نرخ تأیید" value={<span className="text-base">{pct(opt.baseline.kpis.approvalRate, 0)} ← {pct(opt.best.kpis.approvalRate, 0)}</span>} />
                  <Stat label="NPL" value={<span className="text-base">{pct(opt.baseline.kpis.nplEnd)} ← {pct(opt.best.kpis.nplEnd)}</span>} />
                </div>
                <div className="mt-3">
                  <div className="mb-1 text-xs font-bold text-slate-700">تغییرات پیشنهادی:</div>
                  {opt.changes.length === 0 ? (
                    <div className="text-xs text-slate-500">پیکربندی فعلی در همسایگی بهینه است.</div>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {opt.changes.map((c) => (
                        <li key={c.label} className="flex justify-between rounded-lg bg-slate-50 px-2 py-1">
                          <span>{c.label}</span>
                          <span><span className="text-slate-400 line-through">{c.from}</span> ← <b className="text-indigo-700">{c.to}</b></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {opt.changes.length > 0 && (
                  <Btn variant="success" className="mt-3 w-full" onClick={applyOptimized} disabled={!!loading}>
                    {loading === "apply" ? <Spinner /> : "✅"} اعمال پیکربندی بهینه و شبیه‌سازی مجدد
                  </Btn>
                )}
              </Card>
              <Card className="lg:col-span-7" title="فضای جستجو و مرز کارای پارتو" icon="🗺️" subtitle="هر نقطه یک طراحی آزموده‌شده است؛ نقاط سبز هیچ طراحی دیگری بر آن‌ها غلبه نمی‌کند.">
                <ParetoChart points={opt.points} xLabel={opt.xLabel} yLabel={opt.yLabel} />
              </Card>
            </div>
          )}
        </div>
      )}

      {result && tab === "compliance" && (
        <Card title={`گزارش انطباق — امتیاز ${fmt(result.compliance.score)} از ۱۰۰`} icon="⚖️" subtitle={`${fmt(result.compliance.fails)} مغایرت • ${fmt(result.compliance.warns)} هشدار — مبتنی بر مصوبات شورای پول و اعتبار، قانون عملیات بانکی بدون ربا و بخشنامه‌های بانک مرکزی`}>
          <div className="grid gap-2 md:grid-cols-2">
            {result.compliance.items.map((it) => (
              <div key={it.id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                <div className={`text-sm font-bold ${COMP_LEVEL[it.level].cls}`}>{COMP_LEVEL[it.level].icon} {it.title}</div>
                <div className="mt-1 text-xs leading-6 text-slate-600">{it.detail}</div>
                <div className="mt-1 text-[11px] text-slate-400">📜 {it.ref}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "alm" && isPoints && (
        <AlmLab
          productId={productId}
          cfg={cfg}
          history={history}
          busy={!!loading}
          latest={almLatest}
          onSaved={(item) => setHistory((h) => [item, ...h])}
          onApplyTiers={(tiers) => applyPatch({ points: { tiers } })}
        />
      )}

      {tab === "history" && (
        <Card title="تاریخچه تحلیل‌ها" icon="🕘">
          {history.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">هنوز تحلیلی ثبت نشده است.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="p-2 text-right">زمان</th>
                    <th className="p-2">نوع</th>
                    <th className="p-2">سناریو</th>
                    <th className="p-2">سود خالص</th>
                    <th className="p-2">RAROC</th>
                    <th className="p-2">NPL</th>
                    <th className="p-2">سلامت</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const s = h.summary as Record<string, number | string | undefined>;
                    return (
                      <tr key={`${h.type}-${h.id}`} className="border-b border-slate-50 text-center">
                        <td className="p-2 text-right">{faDate(h.createdAt)}</td>
                        <td className="p-2"><Badge tone="indigo">{TYPE_LABEL[h.type] ?? h.type}</Badge></td>
                        <td className="p-2">{h.type === "alm" ? ALM_SCEN_LABEL[h.scenario] ?? "پایه (ALM)" : SCENARIOS[h.scenario as ScenarioId]?.label ?? "همه سناریوها"}</td>
                        <td className="p-2">{typeof s.netProfit === "number" ? money(s.netProfit) : typeof s.bestProfit === "number" ? money(s.bestProfit) : typeof s.netMargin === "number" ? `${money(s.netMargin)} (حاشیه)` : "—"}</td>
                        <td className="p-2">{typeof s.raroc === "number" ? pct(s.raroc, 0) : "—"}</td>
                        <td className="p-2">{typeof s.nplEnd === "number" ? pct(s.nplEnd) : "—"}</td>
                        <td className="p-2">{typeof s.health === "number" ? `${fmt(s.health)} (${s.grade ?? ""})` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function SegTable({ rows }: { rows: { key: string; label: string; applicants: number; approved: number; approvalRate: number; avgPd: number; volume: number }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-slate-500">
            <th className="p-2 text-right">گروه</th>
            <th className="p-2">متقاضی</th>
            <th className="p-2">تأیید</th>
            <th className="p-2">نرخ تأیید</th>
            <th className="p-2">PD</th>
            <th className="p-2">حجم</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-slate-50 text-center">
              <td className="p-2 text-right font-semibold">{r.label}</td>
              <td className="p-2">{count(r.applicants)}</td>
              <td className="p-2">{count(r.approved)}</td>
              <td className="p-2">
                <div className="flex items-center gap-1">
                  <Meter value={r.approvalRate} color="#6366f1" />
                  <span className="w-10">{pct(r.approvalRate, 0)}</span>
                </div>
              </td>
              <td className="p-2">{pct(r.avgPd)}</td>
              <td className="p-2">{money(r.volume)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
