"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ComboChart, DnaRadar } from "@/components/charts";
import { Badge, Btn, Card, COMP_LEVEL, Gauge, LEVEL, Num, Select, Spinner, Stat, Tabs, TextField, Toggle } from "@/components/ui";
import { analyzeResult } from "@/lib/engine/advisor";
import { CBI, CHANNELS, COLLATERALS, CONTRACTS, FAMILIES, KINDS, PURPOSES, REPAYMENTS, SEGMENTS, rewardRate, scoreGrade } from "@/lib/engine/catalog";
import { pointsLoanLimit } from "@/lib/engine/math";
import { QUICK_PARAMS, repaymentPreview, simulatePortfolio } from "@/lib/engine/simulator";
import { mergeConfig, suggestName } from "@/lib/engine/templates";
import type { Channel, Collateral, Contract, Family, FullResult, Kind, ProductConfig, Purpose, Repayment, Segment } from "@/lib/engine/types";
import { fmt, money, mt, pct } from "@/lib/format";

type Section = "credit" | "risk" | "funding" | "points" | "loyalty";
type TabKey = "identity" | "pricing" | "structure" | "risk" | "funding" | "points" | "loyalty";

export default function Studio({ initial, productId }: { initial: ProductConfig; productId?: number }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ProductConfig>(initial);
  const [tab, setTab] = useState<TabKey>("identity");
  const [preview, setPreview] = useState<FullResult | null>(null);
  const [computing, setComputing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameSeed, setNameSeed] = useState(7);
  const [calcBalance, setCalcBalance] = useState(100);
  const [calcDays, setCalcDays] = useState(180);

  useEffect(() => {
    setComputing(true);
    const t = setTimeout(() => {
      try {
        setPreview(analyzeResult(cfg, simulatePortfolio(cfg, QUICK_PARAMS)));
      } finally {
        setComputing(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [cfg]);

  const setTop = <K extends keyof ProductConfig>(k: K, v: ProductConfig[K]) => setCfg((c) => ({ ...c, [k]: v }) as ProductConfig);
  const setS = <S extends Section, K extends keyof ProductConfig[S]>(s: S, k: K, v: ProductConfig[S][K]) =>
    setCfg((c) => ({ ...c, [s]: { ...c[s], [k]: v } }) as ProductConfig);

  const changeFamily = (f: Family) =>
    setCfg((c) => {
      let kind: Kind = c.kind;
      if (f === "points") kind = c.kind === "loyalty" ? "loyalty" : "points_loan";
      else if (c.kind === "points_loan" || c.kind === "loyalty") kind = f === "hybrid" ? "credit_card" : "installment";
      const contract: Contract = kind === "points_loan" ? "qard" : kind === "credit_card" ? "murabaha" : c.contract;
      return { ...c, family: f, kind, contract };
    });
  const changeKind = (k: Kind) =>
    setCfg((c) => ({
      ...c,
      kind: k,
      family: KINDS[k].family.includes(c.family) ? c.family : KINDS[k].family[0],
      contract: k === "points_loan" ? "qard" : k === "credit_card" ? "murabaha" : c.contract,
      credit: k === "credit_card" ? { ...c.credit, tenor: Math.min(36, Math.max(12, c.credit.tenor)) } : c.credit,
    }));

  const isPoints = cfg.kind === "points_loan";
  const isLoyalty = cfg.kind === "loyalty";
  const isRev = cfg.kind === "credit_card" || cfg.kind === "credit_line";
  const hasLoyalty = isLoyalty || cfg.family === "hybrid";
  const cap = cfg.contract === "qard" ? CBI.qardFeeCap : CBI.loanRateCap;

  const tabs = useMemo(() => {
    const t: { key: TabKey; label: string; icon: string }[] = [{ key: "identity", label: "هویت و بازار", icon: "🪪" }];
    if (!isLoyalty) {
      t.push({ key: "pricing", label: "قیمت‌گذاری", icon: "💰" });
      t.push({ key: "structure", label: "ساختار", icon: "🧱" });
      t.push({ key: "risk", label: "ریسک و تضمین", icon: "🛡️" });
    }
    if (isPoints) t.push({ key: "points", label: "موتور امتیاز", icon: "⭐" });
    if (hasLoyalty) t.push({ key: "loyalty", label: "وفاداری و پاداش", icon: "🎁" });
    t.push({ key: "funding", label: "تأمین مالی و سرمایه", icon: "🏛️" });
    return t;
  }, [isLoyalty, isPoints, hasLoyalty]);
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "identity";

  const repAmount = Math.round(Math.min(cfg.credit.maxAmount, Math.max(cfg.credit.minAmount, (cfg.credit.minAmount + cfg.credit.maxAmount) / 3)));
  const schedule = useMemo(() => (isLoyalty || isRev ? null : repaymentPreview(cfg, repAmount)), [cfg, repAmount, isLoyalty, isRev]);
  const scheduleData = useMemo(
    () => (schedule ? schedule.pay.map((_, i) => ({ m: i + 1, اصل: schedule.prin[i], سود: schedule.int[i], مانده: schedule.bal[i] })) : []),
    [schedule],
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(productId ? `/api/products/${productId}` : "/api/products", {
        method: productId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: cfg }),
      });
      const j = (await res.json()) as { id?: number; error?: string };
      if (!res.ok || !j.id) throw new Error(j.error ?? "خطا در ذخیره");
      router.push(`/products/${j.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const kp = preview?.sim.kpis;
  const enumOpts = <T extends string>(rec: Record<T, { label: string }>) => (Object.keys(rec) as T[]).map((k) => ({ value: k, label: rec[k].label }));

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* ------------- configuration ------------- */}
      <div className="space-y-4 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black text-slate-900">🧪 کارگاه طراحی محصول</h1>
            <p className="text-sm text-slate-500">هر تغییر، بلافاصله با یک شبیه‌سازی کوچک مونت‌کارلو ارزیابی می‌شود.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/studio" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:text-indigo-700">
              الگوها
            </Link>
            <Btn onClick={save} disabled={saving}>
              {saving ? <Spinner /> : "💾"} ذخیره و ورود به آزمایشگاه
            </Btn>
          </div>
        </div>
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        <Tabs tabs={tabs} value={activeTab} onChange={setTab} />

        {activeTab === "identity" && (
          <Card title="هویت، بازار هدف و عقد" icon="🪪">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="نام محصول" value={cfg.name} onChange={(v) => setTop("name", v)} />
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <TextField label="کد محصول" value={cfg.code} onChange={(v) => setTop("code", v)} ltr />
                </div>
                <Btn
                  variant="ghost"
                  onClick={() => {
                    const s = suggestName(cfg.kind, nameSeed);
                    setNameSeed((x) => x + 1);
                    setCfg((c) => ({ ...c, name: s.name, tagline: s.tagline, emoji: s.emoji }));
                  }}
                >
                  ✨ نام خلاقانه
                </Btn>
              </div>
              <TextField label="شعار تبلیغاتی" value={cfg.tagline} onChange={(v) => setTop("tagline", v)} />
              <div className="grid grid-cols-2 gap-2">
                <TextField label="نماد (ایموجی)" value={cfg.emoji} onChange={(v) => setTop("emoji", v.slice(0, 4))} />
                <label className="block">
                  <div className="mb-1 text-xs font-medium text-slate-700">رنگ برند</div>
                  <input type="color" value={cfg.color} onChange={(e) => setTop("color", e.target.value)} className="h-9 w-full cursor-pointer rounded-lg border border-slate-200" />
                </label>
              </div>
              <Select<Family>
                label="خانواده محصول"
                value={cfg.family}
                onChange={changeFamily}
                options={(Object.keys(FAMILIES) as Family[]).map((f) => ({ value: f, label: `${FAMILIES[f].emoji} ${FAMILIES[f].label} — ${FAMILIES[f].desc}` }))}
              />
              <Select<Kind>
                label="نوع محصول"
                value={cfg.kind}
                onChange={changeKind}
                options={(Object.keys(KINDS) as Kind[]).filter((k) => KINDS[k].family.includes(cfg.family)).map((k) => ({ value: k, label: `${KINDS[k].emoji} ${KINDS[k].label}` }))}
              />
              <Select<Contract>
                label="عقد اسلامی"
                value={cfg.contract}
                onChange={(v) => setTop("contract", v)}
                options={(Object.keys(CONTRACTS) as Contract[]).map((c) => ({ value: c, label: `${CONTRACTS[c].label} (${CONTRACTS[c].type})` }))}
                hint={CONTRACTS[cfg.contract].note}
              />
              <Select<Purpose> label="موضوع / کاربرد" value={cfg.purpose} onChange={(v) => setTop("purpose", v)} options={(Object.keys(PURPOSES) as Purpose[]).map((p) => ({ value: p, label: PURPOSES[p] }))} />
              <Select<Segment> label="بخش هدف" value={cfg.segment} onChange={(v) => setTop("segment", v)} options={(Object.keys(SEGMENTS) as Segment[]).map((s) => ({ value: s, label: `${SEGMENTS[s].label} — ${SEGMENTS[s].desc}` }))} />
              <Select<Channel> label="کانال عرضه" value={cfg.channel} onChange={(v) => setTop("channel", v)} options={enumOpts(CHANNELS)} />
              <div className="sm:col-span-2">
                <TextField label="توضیحات محصول" value={cfg.description} onChange={(v) => setTop("description", v)} multiline />
              </div>
            </div>
          </Card>
        )}

        {activeTab === "pricing" && (
          <Card title="قیمت‌گذاری و کارمزدها" icon="💰" subtitle="نرخ مؤثر (APR) شامل کارمزدها، بیمه و سپرده جبرانی محاسبه می‌شود.">
            <div className="grid gap-4 sm:grid-cols-2">
              {isPoints ? (
                <Num label="کارمزد وام امتیازی" value={cfg.points.loanFee} onChange={(v) => setS("points", "loanFee", v)} min={0} max={8} step={0.5} unit="٪" warn={cfg.points.loanFee > 4} hint="سقف کارمزد قرض‌الحسنه: ۴٪" />
              ) : (
                <Num
                  label={cfg.contract === "qard" ? "کارمزد قرض‌الحسنه" : "نرخ سود اسمی سالانه"}
                  value={cfg.credit.rate}
                  onChange={(v) => setS("credit", "rate", v)}
                  min={0}
                  max={40}
                  step={0.5}
                  unit="٪"
                  warn={cfg.credit.rate > cap}
                  hint={cfg.contract === "qard" ? "سقف کارمزد: ۴٪" : "سقف مصوب شورای پول و اعتبار: ۲۳٪"}
                />
              )}
              <Num label="کارمزد تشکیل پرونده (یکجا)" value={cfg.credit.upfrontFee} onChange={(v) => setS("credit", "upfrontFee", v)} min={0} max={6} step={0.25} unit="٪" />
              {isRev && <Num label={cfg.kind === "credit_card" ? "آبونمان سالانه" : "کارمزد تعهد سالانه"} value={cfg.credit.annualFee} onChange={(v) => setS("credit", "annualFee", v)} min={0} max={5} step={0.25} unit="٪ سقف" />}
              <Num label="حق بیمه سالانه (هزینه مشتری)" value={cfg.credit.insurance} onChange={(v) => setS("credit", "insurance", v)} min={0} max={5} step={0.1} unit="٪" />
              {(cfg.kind === "bnpl" || cfg.kind === "credit_card") && (
                <Num label="کارمزد پذیرنده (MDR)" value={cfg.credit.merchantFee} onChange={(v) => setS("credit", "merchantFee", v)} min={0} max={10} step={0.25} unit="٪" hint="سهم فروشگاه از هر خرید اعتباری" />
              )}
              <Num label="سپرده جبرانی / مسدودی اجباری" value={cfg.credit.compensatingDeposit} onChange={(v) => setS("credit", "compensatingDeposit", v)} min={0} max={30} step={1} unit="٪" warn={cfg.credit.compensatingDeposit > 0} hint="ممنوع طبق بخشنامه‌های بانک مرکزی" />
              <Num label="وجه التزام تأخیر (مازاد بر نرخ)" value={cfg.credit.latePenaltySpread} onChange={(v) => setS("credit", "latePenaltySpread", v)} min={0} max={12} step={0.5} unit="٪" warn={cfg.credit.latePenaltySpread > 6} hint="سقف قانونی: نرخ قرارداد + ۶٪" />
              <Num label="تخفیف سود در پرداخت زودهنگام" value={cfg.credit.prepayDiscount} onChange={(v) => setS("credit", "prepayDiscount", v)} min={0} max={100} step={5} unit="٪" warn={cfg.kind === "credit_card" && cfg.credit.prepayDiscount < 90} hint={cfg.kind === "credit_card" ? "کارت مرابحه: حداقل ۹۰٪" : undefined} />
            </div>
          </Card>
        )}

        {activeTab === "structure" && (
          <Card title="ساختار مبلغ، دوره و بازپرداخت" icon="🧱">
            <div className="grid gap-4 sm:grid-cols-2">
              <Num label="حداقل مبلغ" value={cfg.credit.minAmount} onChange={(v) => setS("credit", "minAmount", v)} min={1} max={2000} step={1} unit="م.ت" />
              <Num label={isRev ? "سقف اعتبار" : "حداکثر مبلغ"} value={cfg.credit.maxAmount} onChange={(v) => setS("credit", "maxAmount", v)} min={5} max={5000} step={5} unit="م.ت" hint="سقف وام خرد و کارت: ۴۰۰ م.ت | قرض‌الحسنه: ۵۰۰ م.ت" />
              <Num label={isRev ? "دوره تقسیط / تمدید" : "دوره بازپرداخت"} value={cfg.credit.tenor} onChange={(v) => setS("credit", "tenor", v)} min={1} max={180} step={1} unit="ماه" />
              {!isRev && !isPoints && <Num label="دوره تنفس (فقط سود)" value={cfg.credit.grace} onChange={(v) => setS("credit", "grace", v)} min={0} max={24} step={1} unit="ماه" />}
              {!isRev && !isPoints && (
                <Select<Repayment> label="روش بازپرداخت" value={cfg.credit.repayment} onChange={(v) => setS("credit", "repayment", v)} options={(Object.keys(REPAYMENTS) as Repayment[]).map((r) => ({ value: r, label: `${REPAYMENTS[r].label} — ${REPAYMENTS[r].desc}` }))} />
              )}
              {cfg.credit.repayment === "step_up" && !isPoints && <Num label="رشد سالانه قسط" value={cfg.credit.stepUp} onChange={(v) => setS("credit", "stepUp", v)} min={0} max={60} step={1} unit="٪" hint="هم‌گام با رشد اسمی درآمد در تورم بالا" />}
              {cfg.credit.repayment === "balloon" && !isPoints && <Num label="مبلغ بالونی سررسید" value={cfg.credit.balloon} onChange={(v) => setS("credit", "balloon", v)} min={0} max={80} step={5} unit="٪ اصل" />}
              {!isRev && !isPoints && <Num label="پیش‌پرداخت مشتری" value={cfg.credit.downPayment} onChange={(v) => setS("credit", "downPayment", v)} min={0} max={60} step={1} unit="٪" />}
              {cfg.kind === "credit_card" && (
                <>
                  <Num label="دوره تنفس بدون سود" value={cfg.credit.interestFreeDays} onChange={(v) => setS("credit", "interestFreeDays", v)} min={0} max={60} step={1} unit="روز" />
                  <Num label="سهم مشتریان گردان (Revolver)" value={cfg.credit.revolvingShare} onChange={(v) => setS("credit", "revolvingShare", v)} min={0} max={100} step={1} unit="٪" />
                </>
              )}
              {isRev && <Num label="میانگین استفاده از سقف" value={cfg.credit.utilization} onChange={(v) => setS("credit", "utilization", v)} min={5} max={100} step={1} unit="٪" />}
            </div>
          </Card>
        )}

        {activeTab === "risk" && (
          <Card title="سیاست اعتباری، تضامین و وصول" icon="🛡️">
            <div className="grid gap-4 sm:grid-cols-2">
              <Num label="حد نصاب امتیاز اعتباری (۰ تا ۹۰۰)" value={cfg.risk.minScore} onChange={(v) => setS("risk", "minScore", v)} min={250} max={850} step={10} hint={`حداقل رتبه پذیرفته‌شده: ${scoreGrade(cfg.risk.minScore)}`} />
              <Num label="سقف نسبت اقساط به درآمد (DTI)" value={cfg.risk.maxDti} onChange={(v) => setS("risk", "maxDti", v)} min={10} max={80} step={1} unit="٪" warn={cfg.risk.maxDti > 50} />
              <Select<Collateral> label="نوع تضمین" value={cfg.risk.collateral} onChange={(v) => setS("risk", "collateral", v)} options={enumOpts(COLLATERALS)} hint={COLLATERALS[cfg.risk.collateral].note} />
              {["property", "deposit_lien", "gold", "shares", "asset"].includes(cfg.risk.collateral) && (
                <Num label="نسبت پوشش وثیقه" value={cfg.risk.coverage} onChange={(v) => setS("risk", "coverage", v)} min={50} max={250} step={5} unit="٪" />
              )}
              {cfg.risk.collateral === "guarantor" && <Num label="تعداد ضامن" value={cfg.risk.guarantors} onChange={(v) => setS("risk", "guarantors", v)} min={1} max={3} step={1} />}
              <Num label="حداکثر سن در پایان قرارداد" value={cfg.risk.maxAge} onChange={(v) => setS("risk", "maxAge", v)} min={50} max={90} step={1} unit="سال" />
              <Num label="شدت وصول مطالبات" value={cfg.risk.collectionsIntensity} onChange={(v) => setS("risk", "collectionsIntensity", v)} min={0} max={100} step={5} hint="LGD کمتر، هزینه وصول بیشتر" />
              <Toggle label="اعتبارسنجی با داده‌های جایگزین (هوش مصنوعی)" checked={cfg.risk.altData} onChange={(v) => setS("risk", "altData", v)} hint="گردش حساب، قبوض و تراکنش‌ها؛ بهبود تمایز ریسک فاقدین سابقه" />
              <Toggle label="پایش رفتاری و هشدار زودهنگام" checked={cfg.risk.behavioral} onChange={(v) => setS("risk", "behavioral", v)} hint="کاهش PD و LGD با مداخله پیش از نکول" />
            </div>
          </Card>
        )}

        {activeTab === "points" && (
          <Card title="موتور امتیاز پول–زمان" icon="⭐" subtitle="L = k × B × H / N — وام قابل دریافت بر اساس میانگین موجودی (B)، ماه‌های نگهداری (H) و دوره بازپرداخت (N)">
            <div className="grid gap-4 sm:grid-cols-2">
              <Num label="ضریب تبدیل امتیاز (k)" value={cfg.points.coefficient} onChange={(v) => setS("points", "coefficient", v)} min={0.5} max={5} step={0.1} hint="رسالت ≈ ۲ | نیک‌وام ملت ≈ ۳.۲" warn={cfg.points.coefficient > 3.5} />
              <Num label="حداقل دوره معدل‌گیری" value={cfg.points.minHoldingDays} onChange={(v) => setS("points", "minHoldingDays", v)} min={0} max={365} step={5} unit="روز" />
              <Num label="سقف وام امتیازی" value={cfg.points.maxLoan} onChange={(v) => setS("points", "maxLoan", v)} min={10} max={2000} step={10} unit="م.ت" />
              <Num label="نرخ استفاده از امتیاز (رفتاری)" value={cfg.points.usageRate} onChange={(v) => setS("points", "usageRate", v)} min={5} max={100} step={1} unit="٪" hint="بقیه امتیازها سوخت یا ذخیره می‌شوند" />
              <Num label="جایزه/سود حساب امتیازی" value={cfg.points.depositRate} onChange={(v) => setS("points", "depositRate", v)} min={0} max={10} step={0.5} unit="٪" warn={cfg.points.depositRate > 0} />
              <Num label="انقضای امتیاز (۰ = ندارد)" value={cfg.points.expiryMonths} onChange={(v) => setS("points", "expiryMonths", v)} min={0} max={60} step={1} unit="ماه" />
              <Toggle label="قابلیت انتقال امتیاز" checked={cfg.points.transferable} onChange={(v) => setS("points", "transferable", v)} hint="انتقال به بستگان درجه یک یا کارکنان" />
            </div>
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <div className="mb-2 text-sm font-bold text-amber-800">🧮 ماشین‌حساب امتیاز</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Num label="میانگین موجودی" value={calcBalance} onChange={setCalcBalance} min={1} max={2000} step={1} unit="م.ت" />
                <Num label="مدت نگهداری" value={calcDays} onChange={setCalcDays} min={1} max={720} step={1} unit="روز" />
              </div>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                <Stat label={`وام ${fmt(cfg.credit.tenor)} ماهه قابل دریافت`} value={mt(Math.min(cfg.points.maxLoan, pointsLoanLimit(calcBalance, calcDays / 30, cfg.credit.tenor, cfg.points.coefficient)))} tone="brand" />
                <Stat label="ارزش هر ۱ م.ت در روز" value={`${fmt((cfg.points.coefficient / 360) * 1e6)} تومان`} sub="امتیاز وام ۱۲ ماهه" />
                <Stat label="معادل وام ۱۲ ماهه" value={mt(pointsLoanLimit(calcBalance, calcDays / 30, 12, cfg.points.coefficient))} />
              </div>
            </div>
          </Card>
        )}

        {activeTab === "loyalty" && (
          <Card title="باشگاه وفاداری و اقتصاد پاداش" icon="🎁" subtitle={`نرخ بازگشت به مشتری: ${pct(rewardRate(cfg.loyalty.pointsPer100k, cfg.loyalty.pointValue), 2)} از مبلغ خرید`}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Num label="امتیاز به ازای هر ۱۰۰ هزار تومان خرید/قسط" value={cfg.loyalty.pointsPer100k} onChange={(v) => setS("loyalty", "pointsPer100k", v)} min={0} max={50} step={1} />
              <Num label="ارزش هر امتیاز در بازخرید" value={cfg.loyalty.pointValue} onChange={(v) => setS("loyalty", "pointValue", v)} min={0} max={500} step={5} unit="تومان" />
              <Num label="نرخ سوخت امتیاز (Breakage)" value={cfg.loyalty.breakage} onChange={(v) => setS("loyalty", "breakage", v)} min={0} max={80} step={1} unit="٪" warn={cfg.loyalty.breakage > 40} />
              <Num label="انقضای امتیاز (۰ = ندارد)" value={cfg.loyalty.expiryMonths} onChange={(v) => setS("loyalty", "expiryMonths", v)} min={0} max={60} step={1} unit="ماه" />
              <Num label="سهم شرکای تجاری از هزینه پاداش" value={cfg.loyalty.partnerShare} onChange={(v) => setS("loyalty", "partnerShare", v)} min={0} max={90} step={5} unit="٪" />
              <Num label="افزایش گردش خرید اعضا" value={cfg.loyalty.spendUplift} onChange={(v) => setS("loyalty", "spendUplift", v)} min={0} max={60} step={1} unit="٪" />
              <Num label="افزایش موجودی سپرده اعضا" value={cfg.loyalty.balanceUplift} onChange={(v) => setS("loyalty", "balanceUplift", v)} min={0} max={50} step={1} unit="٪" />
              <Num label="کاهش نسبی ریزش مشتری" value={cfg.loyalty.churnReduction} onChange={(v) => setS("loyalty", "churnReduction", v)} min={0} max={80} step={1} unit="٪" />
              <Toggle label="سطوح عضویت (نقره‌ای/طلایی/الماس)" checked={cfg.loyalty.tiers} onChange={(v) => setS("loyalty", "tiers", v)} />
              <Toggle label="گیمیفیکیشن و مأموریت‌های ماهانه" checked={cfg.loyalty.gamification} onChange={(v) => setS("loyalty", "gamification", v)} />
            </div>
          </Card>
        )}

        {activeTab === "funding" && (
          <Card title="تأمین مالی، هزینه و سرمایه" icon="🏛️" subtitle="سپرده یک‌ساله ۲۰.۵٪ | سه‌ساله ۲۲.۵٪ | کوتاه‌مدت ۵٪ | بین‌بانکی ۲۴٪ | سپرده قانونی ۱۰ تا ۱۵٪">
            <div className="grid gap-4 sm:grid-cols-2">
              <Num label="بهای تمام‌شده وجوه (FTP)" value={cfg.funding.costOfFunds} onChange={(v) => setS("funding", "costOfFunds", v)} min={0} max={40} step={0.5} unit="٪" />
              <Num label="هزینه عملیاتی هر حساب در ماه" value={cfg.funding.opexPerAccount} onChange={(v) => setS("funding", "opexPerAccount", v)} min={0} max={500} step={5} unit="هزار تومان" />
              <Num label="هزینه جذب هر مشتری (CAC)" value={cfg.funding.acquisitionCost} onChange={(v) => setS("funding", "acquisitionCost", v)} min={0} max={5000} step={10} unit="هزار تومان" />
              <Num label="ضریب ریسک دارایی (RWA)" value={cfg.funding.riskWeight} onChange={(v) => setS("funding", "riskWeight", v)} min={0} max={150} step={5} unit="٪" />
              <Num label="نسبت کفایت سرمایه هدف" value={cfg.funding.targetCar} onChange={(v) => setS("funding", "targetCar", v)} min={0} max={20} step={0.5} unit="٪" warn={cfg.funding.targetCar < 8} hint="حداقل قانونی: ۸٪" />
              <Num label="نرخ بازده هدف سرمایه (Hurdle)" value={cfg.funding.targetRoe} onChange={(v) => setS("funding", "targetRoe", v)} min={0} max={80} step={1} unit="٪" />
              <Num label="نرخ مالیات" value={cfg.funding.taxRate} onChange={(v) => setS("funding", "taxRate", v)} min={0} max={40} step={1} unit="٪" />
              <Num label="نرخ سپرده قانونی" value={cfg.funding.reserveRatio} onChange={(v) => setS("funding", "reserveRatio", v)} min={0} max={30} step={0.5} unit="٪" />
            </div>
          </Card>
        )}
      </div>

      {/* ------------- live preview ------------- */}
      <div className="space-y-4 lg:col-span-5">
        <div className="lg:sticky lg:top-20 space-y-4">
          <div className="relative overflow-hidden rounded-3xl p-5 text-white shadow-xl" style={{ background: `linear-gradient(135deg, ${cfg.color}, #0f172a 85%)` }}>
            <div className="hero-grid absolute inset-0 opacity-40" />
            <div className="relative">
              <div className="flex items-start justify-between">
                <span className="floaty text-4xl">{cfg.emoji}</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">{FAMILIES[cfg.family].label} • {KINDS[cfg.kind].label}</span>
              </div>
              <div className="mt-3 text-xl font-black">{cfg.name}</div>
              <div className="text-sm text-white/80">{cfg.tagline || "شعار محصول را بنویسید"}</div>
              <div className="mt-4 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-white/15 px-2 py-0.5">{CONTRACTS[cfg.contract].label}</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5">{CHANNELS[cfg.channel].label}</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5">{SEGMENTS[cfg.segment].label}</span>
                {!isLoyalty && <span className="rounded-full bg-white/15 px-2 py-0.5">{COLLATERALS[cfg.risk.collateral].label}</span>}
              </div>
              <div className="mt-4 ltr text-left font-mono text-sm tracking-widest text-white/70">{cfg.code}</div>
            </div>
          </div>

          <Card
            title="پیش‌نمایش زنده"
            icon="⚡"
            subtitle={`بازار ${fmt(1)} میلیون نفری • سناریوی پایه ۱۴۰۵ • ${fmt(QUICK_PARAMS.customers)} مشتری مصنوعی`}
            actions={computing ? <span className="text-xs text-indigo-600">در حال محاسبه…</span> : <Badge tone="emerald">به‌روز</Badge>}
          >
            {preview && kp ? (
              <div className={computing ? "opacity-60 transition" : "transition"}>
                <div className="grid grid-cols-[150px_1fr] items-center gap-3">
                  <Gauge value={preview.health.score} label={`${preview.health.grade} • ${preview.health.label}`} size={150} />
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="سود خالص" value={money(kp.netProfit)} tone={kp.netProfit >= 0 ? "good" : "bad"} />
                    {isLoyalty ? (
                      <Stat label="بازده باشگاه" value={pct(kp.loyaltyRoi, 0)} tone={kp.loyaltyRoi >= 0 ? "good" : "bad"} />
                    ) : (
                      <Stat label="RAROC" value={pct(kp.raroc, 0)} tone={kp.raroc >= cfg.funding.targetRoe ? "good" : "warn"} />
                    )}
                    <Stat label={isLoyalty ? "اعضا" : "نرخ تأیید"} value={isLoyalty ? fmt(kp.booked) : pct(kp.approvalRate, 0)} />
                    <Stat label={isLoyalty ? "نرخ پاداش" : "NPL"} value={isLoyalty ? pct(rewardRate(cfg.loyalty.pointsPer100k, cfg.loyalty.pointValue), 2) : pct(kp.nplEnd)} tone={!isLoyalty && kp.nplEnd > 8 ? "bad" : "neutral"} />
                  </div>
                </div>
                {!isLoyalty && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Stat label="نرخ مؤثر مشتری" value={pct(kp.apr)} />
                    <Stat label="نرخ سربه‌سر" value={pct(preview.sim.pricing.breakEven)} tone={preview.sim.pricing.breakEven > preview.sim.pricing.productRate ? "bad" : "good"} />
                    <Stat label="انطباق" value={`${fmt(preview.compliance.score)}/۱۰۰`} tone={preview.compliance.fails ? "bad" : "good"} />
                  </div>
                )}
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-slate-400">در حال اجرای شبیه‌سازی…</div>
            )}
          </Card>

          {preview && (
            <Card title="DNA محصول" icon="🧬" subtitle="هشت بعد کلیدی طراحی">
              <DnaRadar axes={preview.dna.map((d) => d.axis)} series={[{ name: cfg.name, color: cfg.color, values: preview.dna.map((d) => d.value) }]} height={250} />
            </Card>
          )}

          {preview && preview.insights.length > 0 && (
            <Card title="پیشنهادهای دستیار هوشمند" icon="🤖">
              <div className="space-y-2">
                {preview.insights.slice(0, 4).map((ins) => (
                  <div key={ins.id} className={`rounded-xl border p-2.5 ${LEVEL[ins.level].cls}`}>
                    <div className={`text-xs font-bold ${LEVEL[ins.level].text}`}>
                      {LEVEL[ins.level].icon} {ins.title}
                    </div>
                    <div className="mt-1 text-[11px] leading-5 text-slate-600">{ins.body}</div>
                    {ins.action && (
                      <button type="button" onClick={() => setCfg((c) => mergeConfig(c, ins.action?.patch))} className="mt-1.5 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-indigo-700 shadow-sm hover:bg-indigo-50">
                        ⚡ {ins.action.label}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {preview && (
            <Card title="انطباق مقرراتی و شرعی" icon="⚖️">
              <ul className="space-y-1.5">
                {[...preview.compliance.items]
                  .sort((a, b) => ["fail", "warn", "info", "pass"].indexOf(a.level) - ["fail", "warn", "info", "pass"].indexOf(b.level))
                  .slice(0, 7)
                  .map((it) => (
                    <li key={it.id} className="text-xs leading-5">
                      <span className={`font-bold ${COMP_LEVEL[it.level].cls}`}>
                        {COMP_LEVEL[it.level].icon} {it.title}:
                      </span>{" "}
                      <span className="text-slate-600">{it.detail}</span>
                    </li>
                  ))}
              </ul>
            </Card>
          )}

          {schedule && (
            <Card title={`جدول اقساط نمونه — ${mt(repAmount)}`} icon="📅" subtitle={`قسط: ${mt(schedule.installment, 2)} • جمع پرداختی: ${mt(schedule.total, 1)} • ${REPAYMENTS[isPoints ? "annuity" : cfg.credit.repayment].label}`}>
              <ComboChart
                data={scheduleData}
                xKey="m"
                height={190}
                yFmt={(v) => fmt(v, 1)}
                series={[
                  { key: "اصل", label: "اصل", color: "#6366f1", type: "bar", stack: "p" },
                  { key: "سود", label: "سود/کارمزد", color: "#f59e0b", type: "bar", stack: "p" },
                  { key: "مانده", label: "مانده", color: "#0f172a", type: "line", axis: "right" },
                ]}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
