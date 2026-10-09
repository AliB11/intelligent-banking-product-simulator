"use client";

import { useEffect, useMemo, useState } from "react";
import { BarsChart, ComboChart } from "@/components/charts";
import { Badge, Card, Num, Select, Stat, Toggle } from "@/components/ui";
import { EMPLOYMENT_LABELS, KINDS, REGION_LABELS, rewardRate, scoreGrade } from "@/lib/engine/catalog";
import { aprFor, pointsLoanLimit } from "@/lib/engine/math";
import { PERSONAS, personaToCustomer, type Employment, type PersonaInput, type Region } from "@/lib/engine/population";
import { marketContext, observedScore, repaymentPreview, underwrite } from "@/lib/engine/simulator";
import { TEMPLATES, templateConfig } from "@/lib/engine/templates";
import type { ProductConfig } from "@/lib/engine/types";
import { fmt, mt, pct } from "@/lib/format";

interface Item {
  id: number;
  name: string;
  config: ProductConfig;
}

export default function PersonaPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [choice, setChoice] = useState<string>("tpl:murabaha_card");
  const [persona, setPersona] = useState<PersonaInput>(PERSONAS[0]);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((j: { items?: Item[] }) => {
        const list = j.items ?? [];
        setItems(list);
        const q = new URLSearchParams(window.location.search).get("product");
        if (q && list.some((i) => String(i.id) === q)) setChoice(`id:${q}`);
        else if (list.length) setChoice(`id:${list[0].id}`);
      })
      .catch(() => undefined);
  }, []);

  const cfg: ProductConfig | null = useMemo(() => {
    if (choice.startsWith("id:")) return items.find((i) => `id:${i.id}` === choice)?.config ?? null;
    return templateConfig(choice.slice(4));
  }, [choice, items]);

  const set = <K extends keyof PersonaInput>(k: K, v: PersonaInput[K]) => setPersona((p) => ({ ...p, [k]: v }));

  const analysis = useMemo(() => {
    if (!cfg) return null;
    const c = personaToCustomer(persona);
    const ctx = marketContext(cfg, 26, "base");
    const uw = underwrite(cfg, c, ctx, cfg.kind === "loyalty" ? undefined : persona.need);
    const sched = cfg.kind !== "loyalty" && cfg.kind !== "credit_card" && cfg.kind !== "credit_line" && uw.amount > 0 ? repaymentPreview(cfg, uw.amount) : null;
    return { c, uw, sched, apr: aprFor(cfg), bureau: observedScore(c, false), alt: observedScore(c, true) };
  }, [cfg, persona]);

  const productOptions = [
    ...items.map((i) => ({ value: `id:${i.id}`, label: `${i.config.emoji} ${i.name} (محصول ذخیره‌شده)` })),
    ...TEMPLATES.map((t) => ({ value: `tpl:${t.key}`, label: `${t.patch.emoji} ${t.title} (الگو)` })),
  ];

  const uw = analysis?.uw;
  const isPoints = cfg?.kind === "points_loan";
  const isLoyalty = cfg?.kind === "loyalty";
  const isRev = cfg?.kind === "credit_card" || cfg?.kind === "credit_line";

  const pointsTimeline = useMemo(() => {
    if (!cfg || !uw || !isPoints) return [];
    const days = Math.max(30, Math.round(uw.holdMonths * 30) + 60);
    const pts: { m: number; loan: number; need: number }[] = [];
    for (let d = 0; d <= days; d += Math.max(1, Math.round(days / 40))) {
      pts.push({ m: d, loan: Math.min(cfg.points.maxLoan, pointsLoanLimit(uw.deposit, d / 30, cfg.credit.tenor, cfg.points.coefficient)), need: Math.min(persona.need, cfg.points.maxLoan) });
    }
    return pts;
  }, [cfg, uw, isPoints, persona.need]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black">🧭 شبیه‌ساز سفر مشتری</h1>
        <p className="text-sm text-slate-500">یک مشتری را انتخاب یا بسازید و ببینید محصول با او چگونه رفتار می‌کند — همراه با توضیح‌پذیری کامل تصمیم اعتباری.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {PERSONAS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => setPersona(p)}
            className={`rounded-2xl border p-3 text-right transition ${persona.name === p.name ? "border-indigo-400 bg-indigo-50 shadow" : "border-slate-200 bg-white hover:border-indigo-200"}`}
          >
            <div className="text-3xl">{p.avatar}</div>
            <div className="mt-1 font-bold">{p.name}</div>
            <div className="text-[11px] leading-5 text-slate-500">{p.story}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-4">
          <Card title="محصول" icon="🏦">
            <Select<string> label="انتخاب محصول" value={choice} onChange={setChoice} options={productOptions} />
          </Card>
          <Card title={`پرونده ${persona.name}`} icon={persona.avatar}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Select<Employment> label="اشتغال" value={persona.employment} onChange={(v) => set("employment", v)} options={Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => ({ value: value as Employment, label }))} />
                <Select<Region> label="محل سکونت" value={persona.region} onChange={(v) => set("region", v)} options={Object.entries(REGION_LABELS).map(([value, label]) => ({ value: value as Region, label }))} />
              </div>
              <Num label="سن" value={persona.age} onChange={(v) => set("age", v)} min={18} max={80} unit="سال" />
              <Num label="درآمد ماهانه" value={persona.income} onChange={(v) => set("income", v)} min={2} max={300} unit="م.ت" />
              <Num label="اقساط فعلی ماهانه" value={persona.existingDebt} onChange={(v) => set("existingDebt", v)} min={0} max={150} step={0.5} unit="م.ت" />
              <Num label="امتیاز اعتباری (ICS)" value={persona.score} onChange={(v) => set("score", v)} min={250} max={900} step={5} hint={`رتبه ${scoreGrade(persona.score)}`} />
              <Num label="میانگین موجودی حساب" value={persona.balance} onChange={(v) => set("balance", v)} min={0} max={3000} step={5} unit="م.ت" />
              <Num label="خرید کارتی ماهانه" value={persona.monthlySpend} onChange={(v) => set("monthlySpend", v)} min={0} max={200} unit="م.ت" />
              <Num label="مبلغ مورد نیاز" value={persona.need} onChange={(v) => set("need", v)} min={1} max={3000} step={5} unit="م.ت" />
              <Toggle label="بدون سابقه اعتباری (Thin-file)" checked={persona.thinFile} onChange={(v) => set("thinFile", v)} />
              <Toggle label="ملک قابل ترهین دارد" checked={persona.hasProperty} onChange={(v) => set("hasProperty", v)} />
              <Toggle label="دسته‌چک صیادی دارد" checked={persona.hasCheque} onChange={(v) => set("hasCheque", v)} />
              <Toggle label="ضامن معتبر دارد" checked={persona.hasGuarantor} onChange={(v) => set("hasGuarantor", v)} />
            </div>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-8">
          {!cfg || !analysis || !uw ? (
            <Card>
              <div className="py-12 text-center text-slate-500">محصولی انتخاب کنید.</div>
            </Card>
          ) : (
            <>
              <div className={`rounded-3xl p-5 text-white shadow-lg ${uw.eligible ? "bg-gradient-to-l from-emerald-600 to-teal-700" : "bg-gradient-to-l from-rose-600 to-orange-600"}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm opacity-80">{cfg.emoji} {cfg.name} • {KINDS[cfg.kind].label}</div>
                    <div className="mt-1 text-2xl font-black">{uw.eligible ? (isLoyalty ? "🎉 عضویت فعال شد" : "✅ درخواست تأیید شد") : "❌ درخواست رد شد"}</div>
                    <div className="mt-1 text-sm opacity-90">
                      احتمال تمایل {persona.name} به این محصول: {pct(uw.applyProb * 100, 0)}
                    </div>
                  </div>
                  {!isLoyalty && uw.eligible && (
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-xl bg-white/15 p-2">
                        <div className="text-[11px] opacity-80">{isRev ? "سقف اعتبار" : "مبلغ قابل پرداخت"}</div>
                        <div className="font-black">{mt(isRev ? uw.limit : uw.amount)}</div>
                      </div>
                      <div className="rounded-xl bg-white/15 p-2">
                        <div className="text-[11px] opacity-80">{isRev ? "حداقل پرداخت ماهانه" : "قسط ماهانه"}</div>
                        <div className="font-black">{mt(uw.installment, 2)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {!isLoyalty && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="امتیاز در نگاه بانک" value={fmt(uw.score)} sub={`بیورو: ${fmt(analysis.bureau)} • داده جایگزین: ${fmt(analysis.alt)}`} />
                  <Stat label="احتمال نکول سالانه (PD)" value={pct(uw.pd * 100)} tone={uw.pd > 0.1 ? "bad" : uw.pd > 0.05 ? "warn" : "good"} />
                  <Stat label="نسبت اقساط به درآمد" value={pct(uw.dti)} tone={uw.dti > cfg.risk.maxDti ? "bad" : "neutral"} />
                  <Stat label="نرخ مؤثر سالانه" value={pct(analysis.apr)} />
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <Card title="چک‌لیست تصمیم اعتباری" icon="📋">
                  <ul className="space-y-2">
                    {uw.checks.map((ch) => (
                      <li key={ch.label} className={`rounded-xl border p-2.5 text-sm ${ch.ok ? "border-emerald-100 bg-emerald-50/60" : "border-rose-100 bg-rose-50/60"}`}>
                        <div className={`font-bold ${ch.ok ? "text-emerald-700" : "text-rose-700"}`}>{ch.ok ? "✅" : "❌"} {ch.label}</div>
                        <div className="text-xs leading-5 text-slate-600">{ch.detail}</div>
                      </li>
                    ))}
                  </ul>
                </Card>
                {!isLoyalty && (
                  <Card title="چرا این PD؟ (توضیح‌پذیری)" icon="🔍" subtitle="سهم هر عامل در لوجیت احتمال نکول؛ مثبت = افزایش ریسک">
                    <BarsChart
                      vertical
                      height={300}
                      data={uw.drivers.map((d) => ({ label: d.label, value: Math.round(d.value * 100) / 100 }))}
                      xKey="label"
                      yFmt={(v) => fmt(v, 2)}
                      series={[{ key: "value", label: "سهم در لوجیت", color: "#6366f1" }]}
                      colorBy={(r) => (Number(r.value) > 0 ? "#f43f5e" : "#10b981")}
                    />
                  </Card>
                )}
                {isLoyalty && (
                  <Card title="پاداش سالانه پیش‌بینی‌شده" icon="🎁">
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="نرخ بازگشت پاداش" value={pct(rewardRate(cfg.loyalty.pointsPer100k, cfg.loyalty.pointValue), 2)} />
                      <Stat label="امتیاز سالانه" value={fmt(persona.monthlySpend * 12 * 10 * cfg.loyalty.pointsPer100k)} />
                      <Stat label="ارزش پاداش سالانه" value={mt((persona.monthlySpend * 12 * rewardRate(cfg.loyalty.pointsPer100k, cfg.loyalty.pointValue)) / 100, 2)} tone="good" />
                      <Stat label="سطح عضویت" value={cfg.loyalty.tiers ? (persona.monthlySpend > 25 ? "💎 الماس" : persona.monthlySpend > 12 ? "🥇 طلایی" : "🥈 نقره‌ای") : "عضو"} />
                    </div>
                  </Card>
                )}
              </div>

              {isPoints && uw.deposit > 0 && (
                <Card title="مسیر انباشت امتیاز پول–زمان" icon="⏳" subtitle={`سپرده ${mt(uw.deposit)} • انتظار ${fmt(uw.waitDays)} روز تا وام ${mt(uw.amount)}`}>
                  <ComboChart
                    data={pointsTimeline}
                    xKey="m"
                    xLabel="روز"
                    yFmt={(v) => fmt(v)}
                    series={[
                      { key: "loan", label: "وام قابل دریافت (م.ت)", color: "#eab308" },
                      { key: "need", label: "مبلغ مورد نیاز", color: "#0f172a", type: "line", dashed: true },
                    ]}
                  />
                </Card>
              )}

              {analysis.sched && uw.eligible && (
                <Card title="جدول اقساط شخصی‌سازی‌شده" icon="📅" subtitle={`جمع پرداختی: ${mt(analysis.sched.total, 1)} • ${fmt(analysis.sched.months)} قسط`}>
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b text-slate-500">
                          <th className="p-1.5">ماه</th>
                          <th className="p-1.5">قسط</th>
                          <th className="p-1.5">اصل</th>
                          <th className="p-1.5">سود/کارمزد</th>
                          <th className="p-1.5">مانده</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.sched.pay.map((p, i) => (
                          <tr key={i} className="border-b border-slate-50 text-center">
                            <td className="p-1.5">{fmt(i + 1)}</td>
                            <td className="p-1.5 font-semibold">{fmt(p, 2)}</td>
                            <td className="p-1.5">{fmt(analysis.sched?.prin[i] ?? 0, 2)}</td>
                            <td className="p-1.5">{fmt(analysis.sched?.int[i] ?? 0, 2)}</td>
                            <td className="p-1.5">{fmt(analysis.sched?.bal[i] ?? 0, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">ارقام به میلیون تومان</div>
                </Card>
              )}
              <div className="flex flex-wrap gap-2">
                <Badge tone="indigo">LGD: {pct(uw.lgd * 100, 0)}</Badge>
                <Badge tone="sky">زیان مورد انتظار سالانه: {mt(uw.pd * uw.lgd * (isRev ? uw.drawn : uw.financed), 2)}</Badge>
                {uw.reducedByDti && <Badge tone="amber">مبلغ به سقف توان بازپرداخت کاهش یافت</Badge>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
