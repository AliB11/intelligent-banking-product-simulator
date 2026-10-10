import { CHANNELS, COLLATERALS, CONTRACTS, FAMILIES, KINDS, PURPOSES, REPAYMENTS, SEGMENTS } from "./catalog";
import { mulberry32 } from "./math";
import type { Channel, DeepPartial, Kind, ProductConfig, Segment, TieredMurabahaTier } from "./types";

/** Hard limits for a tier menu (bounded to keep ALM/simulation cost predictable). */
export const MAX_TIERS = 12;

/** Whitelist and bound one tier of a tiered points product. Returns null for non-object input. */
export function sanitizeTier(raw: unknown, index: number): TieredMurabahaTier | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number, lo: number, hi: number, int = false) => {
    const n = typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
    return int ? Math.round(n) : n;
  };
  const tier: TieredMurabahaTier = {
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 60) : `حالت ${index + 1}`,
    waitingMonths: num(r.waitingMonths, 2, 0, 60, true),
    repaymentMonths: num(r.repaymentMonths, 16, 1, 360, true),
    loanToAvgDepositPct: num(r.loanToAvgDepositPct, 25, 0, 1000),
    rate: num(r.rate, 23, 0, 100),
    minAvgDeposit: num(r.minAvgDeposit, 0, 0, 1e6),
    expectedTakeUpShare: num(r.expectedTakeUpShare, 0, 0, 100),
  };
  if (typeof r.id === "string" && /^[\w-]{1,24}$/.test(r.id)) tier.id = r.id;
  return tier;
}

export function defaultConfig(): ProductConfig {
  return {
    name: "محصول جدید",
    code: "NEW-001",
    tagline: "",
    emoji: "🏦",
    color: "#6366f1",
    family: "credit",
    kind: "installment",
    contract: "murabaha",
    purpose: "goods",
    segment: "mass",
    channel: "omni",
    description: "",
    credit: {
      rate: 23,
      upfrontFee: 1,
      annualFee: 0,
      insurance: 0,
      compensatingDeposit: 0,
      minAmount: 20,
      maxAmount: 300,
      tenor: 24,
      grace: 0,
      repayment: "annuity",
      stepUp: 0,
      balloon: 0,
      downPayment: 0,
      merchantFee: 0,
      interestFreeDays: 0,
      revolvingShare: 50,
      utilization: 50,
      prepayDiscount: 90,
      latePenaltySpread: 6,
    },
    risk: {
      minScore: 560,
      maxDti: 40,
      collateral: "e_promissory",
      coverage: 120,
      guarantors: 1,
      maxAge: 70,
      altData: false,
      behavioral: false,
      collectionsIntensity: 50,
    },
    funding: {
      costOfFunds: 17,
      opexPerAccount: 45,
      acquisitionCost: 350,
      riskWeight: 100,
      targetCar: 10,
      targetRoe: 30,
      taxRate: 25,
      reserveRatio: 10,
    },
    points: {
      coefficient: 2,
      minHoldingDays: 30,
      depositRate: 0,
      loanFee: 4,
      maxLoan: 500,
      transferable: false,
      expiryMonths: 0,
      usageRate: 70,
      mode: "simple",
      tiers: [],
      individualLoanCap: 400,
      minOpeningDeposit: 0.1,
      alphaStepPerWaitMonth: 25,
      tenorStepPerWaitMonth: 8,
      rateCutPerWaitMonth: 2,
      maxAmountBoostMonths: 7,
      maxTenorBoostMonths: 6,
      maxRateCutMonths: 9,
      allowCombinedBenefits: true,
    },
    loyalty: {
      pointsPer100k: 10,
      pointValue: 60,
      breakage: 25,
      expiryMonths: 24,
      tiers: false,
      partnerShare: 20,
      spendUplift: 10,
      balanceUplift: 6,
      churnReduction: 15,
      gamification: false,
    },
    prepayment: {
      enabled: false,
      baseRate: 5,
      sensitivityToRateGap: 2,
      maxRate: 30,
    },
    gamification: {
      enabled: false,
      pointsPerExtraWaitMonth: 50,
      lotteryChancePerMonth: 0.5,
      topTierFeeDiscount: 50,
    },
    antiNegin: {
      enabled: false,
      fastLoanRate: 23,
      fastLoanAlphaPct: 25,
      fastLoanTenor: 12,
    },
  };
}

export function mergeConfig(base: ProductConfig, patch: DeepPartial<ProductConfig> | undefined | null): ProductConfig {
  const out = JSON.parse(JSON.stringify(base)) as ProductConfig;
  if (!patch) return out;
  const rec = (t: Record<string, unknown>, p: Record<string, unknown>) => {
    for (const key of Object.keys(p)) {
      if (!Object.hasOwn(t, key) || ["__proto__", "constructor", "prototype"].includes(key)) continue;
      const v = p[key];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (typeof t[key] !== "object" || t[key] === null) t[key] = {};
        rec(t[key] as Record<string, unknown>, v as Record<string, unknown>);
      } else if (v !== undefined && v !== null) {
        t[key] = v;
      }
    }
  };
  rec(out as unknown as Record<string, unknown>, patch as unknown as Record<string, unknown>);
  return out;
}

/** Whitelist structure and bound computational inputs; regulatory violations remain visible to the advisor. */
export function normalizeConfig(input: unknown): ProductConfig {
  const defaults = defaultConfig();
  const enums: Record<string, object> = { family: FAMILIES, kind: KINDS, contract: CONTRACTS, purpose: PURPOSES, segment: SEGMENTS, channel: CHANNELS, repayment: REPAYMENTS, collateral: COLLATERALS };
  const limits: Record<string, [number, number]> = {
    tenor: [1, 360], grace: [0, 60], minAmount: [1, 1e6], maxAmount: [1, 1e6], maxLoan: [1, 1e6],
    minScore: [0, 900], maxAge: [18, 100], guarantors: [0, 10], coverage: [0, 1000],
    coefficient: [0.01, 20], minHoldingDays: [0, 3650], expiryMonths: [0, 120],
    opexPerAccount: [0, 1e6], acquisitionCost: [0, 1e6], pointsPer100k: [0, 10000], pointValue: [0, 1e6],
    riskWeight: [0, 1000], targetRoe: [0, 200], interestFreeDays: [0, 365],
    compensatingDeposit: [0, 90], downPayment: [0, 90],
    // prices, fees and behavioural shares are percentages: physically bounded, regulatory caps stay visible to the advisor
    rate: [0, 100], upfrontFee: [0, 100], annualFee: [0, 100], insurance: [0, 100], merchantFee: [0, 100],
    revolvingShare: [0, 100], utilization: [0, 100], prepayDiscount: [0, 100], latePenaltySpread: [0, 100],
    maxDti: [0, 100], collectionsIntensity: [0, 100], stepUp: [0, 100], balloon: [0, 90],
    costOfFunds: [0, 200], targetCar: [0, 100], taxRate: [0, 90], reserveRatio: [0, 100],
    depositRate: [0, 100], loanFee: [0, 100], usageRate: [0, 100], individualLoanCap: [1, 1e6], minOpeningDeposit: [0, 1e6],
    alphaStepPerWaitMonth: [0, 200], tenorStepPerWaitMonth: [0, 60], rateCutPerWaitMonth: [0, 50],
    maxAmountBoostMonths: [0, 24], maxTenorBoostMonths: [0, 24], maxRateCutMonths: [0, 24],
    breakage: [0, 100], partnerShare: [0, 100], spendUplift: [0, 500], balanceUplift: [0, 500], churnReduction: [0, 100],
    baseRate: [0, 100], sensitivityToRateGap: [0, 20], maxRate: [0, 100],
    pointsPerExtraWaitMonth: [0, 1e5], lotteryChancePerMonth: [0, 100], topTierFeeDiscount: [0, 100],
    fastLoanRate: [0, 100], fastLoanAlphaPct: [0, 1000], fastLoanTenor: [1, 360],
  };
  const integers = new Set([
    "tenor", "grace", "minScore", "maxAge", "guarantors", "minHoldingDays", "expiryMonths", "interestFreeDays",
    "maxAmountBoostMonths", "maxTenorBoostMonths", "maxRateCutMonths", "fastLoanTenor",
  ]);
  const clean = (base: any, raw: unknown): any => {
    // the only array in the schema is points.tiers: every element is whitelisted and bounded
    if (Array.isArray(base)) {
      if (!Array.isArray(raw)) return base;
      return raw.slice(0, MAX_TIERS).map(sanitizeTier).filter((t): t is TieredMurabahaTier => t !== null);
    }
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return Object.fromEntries(Object.entries(base).map(([key, fallback]) => {
      const v = Object.hasOwn(source, key) ? source[key] : undefined;
      if (typeof fallback === "object" && fallback !== null) return [key, clean(fallback, v)];
      if (typeof fallback === "number") {
        const [lo, hi] = limits[key] ?? [-1e9, 1e9];
        const n = typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback as number;
        return [key, integers.has(key) ? Math.round(n) : n];
      }
      if (typeof fallback === "boolean") return [key, typeof v === "boolean" ? v : fallback];
      if (typeof v !== "string") return [key, fallback];
      if (enums[key]) return [key, Object.hasOwn(enums[key], v) ? v : fallback];
      if (key === "color") return [key, /^#[0-9a-f]{6}$/i.test(v) ? v : fallback];
      const max = key === "description" ? 4000 : key === "code" ? 40 : key === "emoji" ? 16 : 200;
      return [key, v.trim().slice(0, max) || fallback];
    }));
  };
  const cfg = clean(defaults as unknown as Record<string, unknown>, input) as unknown as ProductConfig;
  cfg.credit.minAmount = Math.min(cfg.credit.minAmount, cfg.credit.maxAmount);
  if (!KINDS[cfg.kind].family.includes(cfg.family)) cfg.family = KINDS[cfg.kind].family[0];
  return cfg;
}

export interface Template {
  key: string;
  title: string;
  group: "credit" | "points" | "hybrid";
  inspiration: string;
  patch: DeepPartial<ProductConfig>;
}

export const TEMPLATES: Template[] = [
  {
    key: "murabaha_card",
    title: "کارت اعتباری مرابحه",
    group: "credit",
    inspiration: "بخشنامه کارت اعتباری مرابحه بانک مرکزی (اقساط ۱۲ تا ۳۶ ماه، تخفیف ۹۰٪)",
    patch: {
      name: "کارت اعتباری «همراه»", code: "CC-HAMRAH", tagline: "امروز بخر، آرام بپرداز", emoji: "💳", color: "#6366f1",
      family: "credit", kind: "credit_card", contract: "murabaha", purpose: "goods", segment: "mass", channel: "digital",
      description: "کارت اعتباری مرابحه با دوره تنفس بدون سود، تقسیط ۱۲ ماهه و تخفیف ۹۰٪ سود مستتر در بازپرداخت زودهنگام.",
      credit: { rate: 23, upfrontFee: 0, annualFee: 1, minAmount: 20, maxAmount: 200, tenor: 12, interestFreeDays: 30, revolvingShare: 55, utilization: 55, merchantFee: 1.5, prepayDiscount: 90 },
      risk: { minScore: 580, maxDti: 40, collateral: "e_promissory", altData: true, behavioral: true },
    },
  },
  {
    key: "bnpl",
    title: "اعتبار خرید (BNPL)",
    group: "credit",
    inspiration: "مدل لندو، دیجی‌پی و بامیلوپی با سفته الکترونیک",
    patch: {
      name: "اعتبار خرید «آسان‌پی»", code: "BNPL-ASAN", tagline: "خرید بی‌دغدغه، قسط بی‌استرس", emoji: "🛍️", color: "#ec4899",
      family: "credit", kind: "bnpl", contract: "murabaha", purpose: "goods", segment: "youth", channel: "embedded",
      description: "اعتبار خرید تعبیه‌شده در فروشگاه‌های آنلاین با پیش‌پرداخت ۱۵٪، اقساط ۶ ماهه و کارمزد پذیرنده.",
      credit: { rate: 23, upfrontFee: 2, minAmount: 5, maxAmount: 60, tenor: 6, downPayment: 15, merchantFee: 5 },
      risk: { minScore: 540, maxDti: 45, collateral: "e_promissory", altData: true },
      funding: { opexPerAccount: 25, acquisitionCost: 150 },
    },
  },
  {
    key: "micro_instant",
    title: "وام خرد آنی بدون ضامن",
    group: "credit",
    inspiration: "دستورالعمل تسهیلات خرد و مدل نئوبانک‌ها (بلو، ویپاد، بانکینو)",
    patch: {
      name: "وام آنی «پرواز»", code: "MICRO-PARVAZ", tagline: "اعتبار در چند دقیقه، بدون ضامن", emoji: "⚡", color: "#0ea5e9",
      family: "credit", kind: "installment", contract: "murabaha", purpose: "goods", segment: "mass", channel: "digital",
      description: "اعتبار خرید کالا تمام‌دیجیتال مبتنی بر اعتبارسنجی و داده‌های جایگزین، بدون ضامن و چک.",
      credit: { rate: 23, upfrontFee: 1.5, minAmount: 10, maxAmount: 200, tenor: 12 },
      risk: { minScore: 600, maxDti: 35, collateral: "scoring", altData: true, behavioral: true, collectionsIntensity: 70 },
      funding: { opexPerAccount: 20, acquisitionCost: 200 },
    },
  },
  {
    key: "marriage_qard",
    title: "قرض‌الحسنه ازدواج",
    group: "credit",
    inspiration: "تسهیلات تکلیفی قانون جوانی جمعیت",
    patch: {
      name: "قرض‌الحسنه ازدواج «پیوند»", code: "QH-PEYVAND", tagline: "آغاز زندگی، بی‌دغدغه", emoji: "💍", color: "#f43f5e",
      family: "credit", kind: "installment", contract: "qard", purpose: "cash", segment: "newlywed", channel: "branch",
      description: "تسهیلات تکلیفی قرض‌الحسنه با کارمزد ۴٪ و بازپرداخت ۱۰ ساله؛ مأموریت اجتماعی با تأمین از منابع قرض‌الحسنه.",
      credit: { rate: 4, upfrontFee: 0, minAmount: 100, maxAmount: 300, tenor: 120, latePenaltySpread: 4 },
      risk: { minScore: 450, maxDti: 50, collateral: "guarantor", guarantors: 1 },
      funding: { costOfFunds: 10 },
    },
  },
  {
    key: "car_ijara",
    title: "اجاره به شرط تملیک خودرو",
    group: "credit",
    inspiration: "لیزینگ و تسهیلات خودرو بانک‌ها",
    patch: {
      name: "اجاره به شرط تملیک «رهوار»", code: "IJ-RAHVAR", tagline: "کلید خودرو، امروز در دستان شما", emoji: "🚗", color: "#f59e0b",
      family: "credit", kind: "installment", contract: "ijara", purpose: "vehicle", segment: "salaried", channel: "omni",
      description: "تأمین مالی خودرو با پیش‌پرداخت ۳۰٪ و رهن خودرو؛ مالکیت در پایان قرارداد منتقل می‌شود.",
      credit: { rate: 23, upfrontFee: 1, insurance: 1.5, minAmount: 200, maxAmount: 1200, tenor: 48, downPayment: 30 },
      risk: { minScore: 580, maxDti: 40, collateral: "asset", coverage: 130 },
      funding: { riskWeight: 75 },
    },
  },
  {
    key: "housing_joaleh",
    title: "جعاله تعمیر مسکن",
    group: "credit",
    inspiration: "جعاله تعمیرات و بهسازی مسکن",
    patch: {
      name: "جعاله مسکن «نوسازی»", code: "JO-NOSAZI", tagline: "خانه‌ای نو، با اقساطی آسان", emoji: "🏠", color: "#10b981",
      family: "credit", kind: "installment", contract: "joaleh", purpose: "housing", segment: "mass", channel: "branch",
      description: "جعاله تعمیر و بهسازی مسکن با ۳ ماه دوره تنفس و وثیقه ملکی.",
      credit: { rate: 23, upfrontFee: 1, minAmount: 100, maxAmount: 500, tenor: 60, grace: 3 },
      risk: { minScore: 560, maxDti: 40, collateral: "property", coverage: 150 },
      funding: { riskWeight: 50 },
    },
  },
  {
    key: "sme_line",
    title: "خط اعتباری سرمایه در گردش",
    group: "credit",
    inspiration: "مشارکت مدنی سرمایه در گردش بنگاه‌های کوچک",
    patch: {
      name: "خط اعتباری «رونق»", code: "LINE-RONAGH", tagline: "نقدینگی همیشه در دسترس کسب‌وکار شما", emoji: "📈", color: "#8b5cf6",
      family: "credit", kind: "credit_line", contract: "musharaka", purpose: "working_capital", segment: "sme", channel: "omni",
      description: "خط اعتباری گردان یک‌ساله برای کسب‌وکارهای خرد با کارمزد تعهد ۱٪ و چک صیادی.",
      credit: { rate: 23, upfrontFee: 0.5, annualFee: 1, minAmount: 300, maxAmount: 3000, tenor: 12, utilization: 65, repayment: "bullet" },
      risk: { minScore: 580, maxDti: 55, collateral: "cheque", maxAge: 75 },
      funding: { opexPerAccount: 120, acquisitionCost: 1500 },
    },
  },
  {
    key: "salary_loan",
    title: "وام کسر از حقوق",
    group: "credit",
    inspiration: "طرح «کارگشا» بانک رفاه",
    patch: {
      name: "وام کسر از حقوق «کارگشا»", code: "SAL-KARGOSHA", tagline: "با حقوق خود، بی‌ضامن وام بگیرید", emoji: "🧾", color: "#14b8a6",
      family: "credit", kind: "installment", contract: "murabaha", purpose: "goods", segment: "salaried", channel: "digital",
      description: "اعتبار خرید کالا برای حقوق‌بگیران با تضمین کسر از حقوق تا سقف ۴۰۰ میلیون تومان.",
      credit: { rate: 23, upfrontFee: 1, minAmount: 20, maxAmount: 400, tenor: 36 },
      risk: { minScore: 500, maxDti: 40, collateral: "salary" },
    },
  },
  {
    key: "step_up",
    title: "وام پلکانی ضدتورم",
    group: "credit",
    inspiration: "نوآوری: هم‌راستاسازی قسط با رشد اسمی درآمد در تورم بالا",
    patch: {
      name: "وام پلکانی «پله»", code: "STEP-PELLEH", tagline: "قسط همگام با درآمد شما رشد می‌کند", emoji: "🪜", color: "#84cc16",
      family: "credit", kind: "installment", contract: "installment_sale", purpose: "goods", segment: "youth", channel: "digital",
      description: "فروش اقساطی با اقساط پلکانی ۲۵٪ سالانه؛ قسط اولیه سبک‌تر و حفظ ارزش واقعی دریافتی بانک.",
      credit: { rate: 23, upfrontFee: 1, minAmount: 30, maxAmount: 350, tenor: 36, repayment: "step_up", stepUp: 25 },
      risk: { minScore: 570, maxDti: 35, collateral: "e_promissory", altData: true, behavioral: true },
    },
  },
  {
    key: "gold_backed",
    title: "اعتبار طلامحور",
    group: "credit",
    inspiration: "توثیق گواهی سپرده سکه و طلای آب‌شده",
    patch: {
      name: "اعتبار طلامحور «زرین»", code: "GOLD-ZARRIN", tagline: "طلایت را نفروش، اعتبار بگیر", emoji: "🪙", color: "#ca8a04",
      family: "credit", kind: "installment", contract: "murabaha", purpose: "goods", segment: "mass", channel: "omni",
      description: "اعتبار خرید با توثیق طلا و گواهی سکه؛ LGD بسیار پایین در محیط تورمی.",
      credit: { rate: 23, upfrontFee: 1, minAmount: 20, maxAmount: 300, tenor: 12 },
      risk: { minScore: 480, maxDti: 45, collateral: "gold", coverage: 130 },
    },
  },
  {
    key: "resalat_points",
    title: "وام امتیازی پول–زمان",
    group: "points",
    inspiration: "روش امتیازی بانک قرض‌الحسنه رسالت: L × N = 2 × B × H",
    patch: {
      name: "وام امتیازی «همیاری»", code: "PTS-HAMYARI", tagline: "پولت می‌ماند، امتیازت می‌روید", emoji: "⭐", color: "#eab308",
      family: "points", kind: "points_loan", contract: "qard", purpose: "cash", segment: "mass", channel: "omni",
      description: "هر یک میلیون تومان در ۲۴ ساعت ≈ ۵٬۵۰۰ تومان امتیاز وام ۱۲ ماهه؛ بدون مسدودی، با کارمزد ۲٪.",
      credit: { rate: 0, upfrontFee: 0, minAmount: 10, maxAmount: 500, tenor: 24, latePenaltySpread: 4 },
      risk: { minScore: 460, maxDti: 45, collateral: "cheque" },
      points: { coefficient: 2, minHoldingDays: 30, depositRate: 0, loanFee: 2, maxLoan: 500, transferable: true, expiryMonths: 0, usageRate: 65 },
      funding: { costOfFunds: 18, opexPerAccount: 25, acquisitionCost: 120 },
    },
  },
  {
    key: "nikvam_points",
    title: "امتیاز پلکانی سخاوتمندانه",
    group: "points",
    inspiration: "طرح نیک‌وام بانک ملت (ضریب معادل ≈ ۳.۲)",
    patch: {
      name: "امتیاز پلکانی «نیک‌آوند»", code: "PTS-NIKAVAND", tagline: "هر روز سپرده، یک قدم تا وام", emoji: "🌟", color: "#f97316",
      family: "points", kind: "points_loan", contract: "qard", purpose: "cash", segment: "mass", channel: "digital",
      description: "ضریب تبدیل سخاوتمندانه ۳.۲، کارمزد ۴٪، امتیاز قابل انتقال و سقف یک میلیارد تومان.",
      credit: { rate: 0, minAmount: 20, maxAmount: 1000, tenor: 36, latePenaltySpread: 4 },
      risk: { minScore: 500, maxDti: 45, collateral: "e_promissory", altData: true },
      points: { coefficient: 3.2, minHoldingDays: 30, depositRate: 0, loanFee: 4, maxLoan: 1000, transferable: true, usageRate: 60 },
      funding: { costOfFunds: 18, opexPerAccount: 20, acquisitionCost: 100 },
    },
  },
  {
    key: "negin_farapuya",
    title: "نگین فراپویا (مرابحه چندپله‌ای بانک سپه)",
    group: "points",
    inspiration: "طرح «نگین فراپویا» بانک سپه؛ سپرده کوتاه‌مدت ماه‌شمار با منوی سه‌گانه و ۲۵۰+ ترکیب انتخابی",
    patch: {
      name: "نگین فراپویا", code: "PTS-NEGIN-FP", tagline: "انتظاری هوشمندانه، وامی با منوی ۲۵۰ حالته", emoji: "🔷", color: "#0369a1",
      family: "points", kind: "points_loan", contract: "murabaha", purpose: "cash", segment: "mass", channel: "omni",
      description:
        "سپرده کوتاه‌مدت ماه‌شمار ویژه با سود ۰.۰۱٪؛ دوره انتظار ۲ تا ۱۲ ماه، ضریب تسهیلات ۲۵٪ تا ۲۰۰٪ میانگین، نرخ سود ۵٪ تا ۲۳٪ و اقساط ۱۶/۲۴/۳۲/۴۰/۴۸/۵۶/۶۰ ماه. به ازای هر ماه انتظار اضافی مشتری یکی از سه گزینه افزایش مبلغ (+۲۵٪)، افزایش اقساط (+۸ماه) یا کاهش سود (-۲٪) را انتخاب می‌کند — حدود ۲۵۰ ترکیب. این الگو به موتور کامل ALM، تحلیل نقدینگی، گیمیفیکیشن سفر انتظار، ریسک پیش‌پرداخت و تسهیلات ضدنگین (فوری) تجهیز شده است.",
      credit: {
        rate: 18, // فقط مرجع حالت ساده؛ در حالت چندپله‌ای نرخ هر پله اعمال می‌شود (میانگین وزنی ≈ ۱۷.۸٪)
        upfrontFee: 1,
        annualFee: 0,
        insurance: 0,
        compensatingDeposit: 0,
        minAmount: 10,
        maxAmount: 400,
        tenor: 36,
        grace: 0,
        repayment: "annuity",
        stepUp: 0,
        balloon: 0,
        downPayment: 0,
        merchantFee: 0,
        interestFreeDays: 0,
        revolvingShare: 0,
        utilization: 0,
        prepayDiscount: 90,
        latePenaltySpread: 6,
      },
      risk: {
        minScore: 500,
        maxDti: 40,
        collateral: "e_promissory",
        coverage: 100,
        guarantors: 1,
        maxAge: 70,
        altData: true,
        behavioral: true,
        collectionsIntensity: 55,
      },
      points: {
        coefficient: 1.125,
        minHoldingDays: 60,
        depositRate: 0.01,
        loanFee: 0,
        maxLoan: 400,
        transferable: false,
        expiryMonths: 0,
        usageRate: 72,
        mode: "tiered_murabaha",
        individualLoanCap: 400,
        minOpeningDeposit: 0.1, // ۱۰۰ هزار تومان
        alphaStepPerWaitMonth: 25,
        tenorStepPerWaitMonth: 8,
        rateCutPerWaitMonth: 2,
        maxAmountBoostMonths: 7,
        maxTenorBoostMonths: 6,
        maxRateCutMonths: 9,
        allowCombinedBenefits: true,
        tiers: [
          { name: "حالت اول (پایه)", waitingMonths: 2, repaymentMonths: 16, loanToAvgDepositPct: 25, rate: 23, minAvgDeposit: 1, expectedTakeUpShare: 30 },
          { name: "حالت دوم", waitingMonths: 3, repaymentMonths: 24, loanToAvgDepositPct: 50, rate: 21, minAvgDeposit: 1, expectedTakeUpShare: 20 },
          { name: "حالت سوم", waitingMonths: 4, repaymentMonths: 32, loanToAvgDepositPct: 75, rate: 19, minAvgDeposit: 1, expectedTakeUpShare: 16 },
          { name: "حالت چهارم", waitingMonths: 6, repaymentMonths: 40, loanToAvgDepositPct: 100, rate: 15, minAvgDeposit: 1, expectedTakeUpShare: 13 },
          { name: "حالت پنجم", waitingMonths: 8, repaymentMonths: 48, loanToAvgDepositPct: 125, rate: 11, minAvgDeposit: 1, expectedTakeUpShare: 9 },
          { name: "حالت ششم", waitingMonths: 10, repaymentMonths: 56, loanToAvgDepositPct: 160, rate: 7, minAvgDeposit: 1, expectedTakeUpShare: 7 },
          { name: "حالت هفتم (وفادار)", waitingMonths: 12, repaymentMonths: 60, loanToAvgDepositPct: 200, rate: 5, minAvgDeposit: 1, expectedTakeUpShare: 5 },
        ],
      },
      funding: {
        // FTP = بهای فرصت وجوه برای بانک (نه نرخ سود سپرده ۰.۰۱٪)؛ ارزش منابع ارزان = FTP − نرخ سپرده
        costOfFunds: 20,
        opexPerAccount: 30,
        acquisitionCost: 90,
        riskWeight: 75,
        targetCar: 10,
        targetRoe: 32,
        taxRate: 25,
        reserveRatio: 10,
      },
      // ماژول ریسک پیش‌پرداخت زودهنگام
      prepayment: {
        enabled: true,
        baseRate: 8,                // در شرایط نرخ برابر، سالانه ۸٪ پیش‌پرداخت
        sensitivityToRateGap: 1.5,  // به ازای هر درصد اختلاف نرخ، ۱.۵ واحد درصد افزایش
        maxRate: 35,                // حداکثر ۳۵٪ در سال برای وام‌های ۵٪ در بازار ۲۳٪
      },
      // گیمیفیکیشن سفر انتظار
      gamification: {
        enabled: true,
        pointsPerExtraWaitMonth: 50,     // هر ماه انتظار ۵۰ امتیاز باشگاه
        lotteryChancePerMonth: 0.8,      // هر ماه ۰.۸٪ شانس قرعه‌کشی (سکه/کمک‌هزینه)
        topTierFeeDiscount: 100,         // تخفیف ۱۰۰٪ کارمزد برای پله هفتم (وفادار)
      },
      // ماژول ضدنگین (تسهیلات فوری برای پوشش حفره)
      antiNegin: {
        enabled: true,
        fastLoanRate: 23,           // نرخ سقف برای متقاضیان عجول
        fastLoanAlphaPct: 25,       // ضریب پایین برای تسهیلات فوری
        fastLoanTenor: 12,          // بازپرداخت کوتاه ۱۲ ماهه
      },
    },
  },
  {
    key: "loyalty_club",
    title: "باشگاه امتیاز و وفاداری",
    group: "points",
    inspiration: "باشگاه مشتریان بانک‌ها و برنامه‌های کش‌بک",
    patch: {
      name: "باشگاه امتیاز «ستاره»", code: "LOY-SETAREH", tagline: "هر خرید، یک ستاره", emoji: "🎁", color: "#d946ef",
      family: "points", kind: "loyalty", contract: "qard", purpose: "goods", segment: "mass", channel: "digital",
      description: "امتیاز بر اساس خرید کارتی، سطوح نقره‌ای/طلایی/الماس، مأموریت‌های گیمیفیکیشن و تأمین ۳۵٪ هزینه توسط شرکا.",
      credit: { merchantFee: 0.6 },
      loyalty: { pointsPer100k: 10, pointValue: 60, breakage: 25, expiryMonths: 18, tiers: true, partnerShare: 35, spendUplift: 12, balanceUplift: 8, churnReduction: 20, gamification: true },
      funding: { opexPerAccount: 15, acquisitionCost: 60 },
    },
  },
  {
    key: "hybrid_card",
    title: "کارت اعتباری امتیازی",
    group: "hybrid",
    inspiration: "ترکیب کارت مرابحه + باشگاه امتیاز + پاداش خوش‌حسابی",
    patch: {
      name: "کارت امتیازی «سیمرغ»", code: "HY-SIMORGH", tagline: "اعتبار هوشمند، پاداش خوش‌حسابی", emoji: "🦅", color: "#06b6d4",
      family: "hybrid", kind: "credit_card", contract: "murabaha", purpose: "goods", segment: "youth", channel: "digital",
      description: "کارت اعتباری مرابحه با امتیاز خرید و پاداش پرداخت به‌موقع؛ شرکای تجاری ۴۰٪ هزینه پاداش را تأمین می‌کنند.",
      credit: { rate: 23, annualFee: 1, minAmount: 20, maxAmount: 250, tenor: 12, interestFreeDays: 30, revolvingShare: 50, utilization: 55, merchantFee: 1.8, prepayDiscount: 90 },
      risk: { minScore: 570, maxDti: 40, collateral: "e_promissory", altData: true, behavioral: true },
      loyalty: { pointsPer100k: 8, pointValue: 50, breakage: 20, expiryMonths: 24, tiers: true, partnerShare: 40, spendUplift: 15, gamification: true },
    },
  },
  {
    key: "green_hybrid",
    title: "وام سبز امتیازی",
    group: "hybrid",
    inspiration: "نوآوری: تأمین مالی سبز با امتیاز خوش‌حسابی و مشارکت صندوق انرژی",
    patch: {
      name: "وام سبز «سبزینه»", code: "HY-SABZINEH", tagline: "انرژی پاک، قسط سبک‌تر، امتیاز بیشتر", emoji: "🌱", color: "#22c55e",
      family: "hybrid", kind: "installment", contract: "murabaha", purpose: "goods", segment: "mass", channel: "digital",
      description: "مرابحه خرید پنل خورشیدی و لوازم کم‌مصرف با ۲ ماه تنفس؛ امتیاز به ازای هر قسط به‌موقع، ۵۰٪ پاداش با صندوق سبز.",
      credit: { rate: 20, upfrontFee: 0.5, minAmount: 50, maxAmount: 400, tenor: 36, grace: 2 },
      risk: { minScore: 560, maxDti: 40, collateral: "e_promissory", altData: true },
      funding: { costOfFunds: 15 },
      loyalty: { pointsPer100k: 12, pointValue: 40, breakage: 15, partnerShare: 50, expiryMonths: 0, tiers: false, gamification: true },
    },
  },
];

export const SEED_TEMPLATE_KEYS = ["murabaha_card", "resalat_points", "bnpl", "loyalty_club", "hybrid_card"];

export function templateConfig(key: string): ProductConfig | null {
  const t = TEMPLATES.find((x) => x.key === key);
  return t ? mergeConfig(defaultConfig(), t.patch) : null;
}

// ---------- Creative product generator ----------
const NAMES = [
  "سیمرغ", "آسا", "پویا", "رهوار", "ستاره", "همراه", "نوید", "آوا", "تپش", "رویش", "مهرآسا", "بهار", "پرواز", "سپهر",
  "آرمان", "زرین", "همیار", "روشنا", "آذرخش", "کهکشان", "شکوفا", "دلگرم", "پارسا", "کوثر", "تیرگان", "هما", "آناهیتا",
  "مهتاب", "فردا", "یلدا", "نسیم", "آبشار", "ققنوس", "البرز", "ارغوان", "سروش",
];
const PREFIX: Record<Kind, string> = {
  installment: "وام",
  credit_card: "کارت اعتباری",
  bnpl: "اعتبار خرید",
  credit_line: "خط اعتباری",
  points_loan: "وام امتیازی",
  loyalty: "باشگاه",
};
const TAGLINES: Record<Kind, string[]> = {
  installment: ["رؤیایت را امروز بساز", "اقساطی به اندازه توان تو", "اعتبار منصفانه برای همه"],
  credit_card: ["امروز بخر، آرام بپرداز", "اعتباری به وسعت اعتماد", "کارتی که با تو رشد می‌کند"],
  bnpl: ["خرید بی‌دغدغه، قسط بی‌استرس", "همین حالا بخر، کم‌کم بپرداز", "سبد خریدت را سبک کن"],
  credit_line: ["نقدینگی همیشه در دسترس", "سوخت موتور کسب‌وکار تو", "اعتبار به سرعت بازار"],
  points_loan: ["پولت می‌ماند، امتیازت می‌روید", "هر روز سپرده، یک قدم تا وام", "امتیاز امروز، وام فردا"],
  loyalty: ["هر خرید، یک ستاره", "وفاداری‌ات بی‌پاداش نمی‌ماند", "امتیاز بگیر، دنیا را بخر"],
};
const COLORS = ["#6366f1", "#ec4899", "#0ea5e9", "#f43f5e", "#f59e0b", "#10b981", "#8b5cf6", "#14b8a6", "#84cc16", "#eab308", "#f97316", "#d946ef", "#06b6d4", "#22c55e"];
const EMOJI: Record<Kind, string[]> = {
  installment: ["🏦", "🚀", "🌈", "🔑"],
  credit_card: ["💳", "🦅", "💎"],
  bnpl: ["🛍️", "🧺", "🎀"],
  credit_line: ["📈", "⚙️", "🏭"],
  points_loan: ["⭐", "🌟", "🏆"],
  loyalty: ["🎁", "🎯", "🪄"],
};

export function suggestName(kind: Kind, seed: number): { name: string; tagline: string; emoji: string } {
  const rng = mulberry32(seed * 13 + 5);
  const nm = NAMES[Math.floor(rng() * NAMES.length)];
  const tl = TAGLINES[kind][Math.floor(rng() * TAGLINES[kind].length)];
  const em = EMOJI[kind][Math.floor(rng() * EMOJI[kind].length)];
  return { name: `${PREFIX[kind]} «${nm}»`, tagline: tl, emoji: em };
}

export function creativeProduct(seed: number): ProductConfig {
  const rng = mulberry32(seed * 7 + 3);
  const pick = <T,>(a: T[]): T => a[Math.floor(rng() * a.length)];
  const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  const tpl = pick(TEMPLATES);
  const cfg = mergeConfig(defaultConfig(), tpl.patch);
  const s = suggestName(cfg.kind, seed);
  cfg.name = s.name;
  cfg.tagline = s.tagline;
  cfg.emoji = s.emoji;
  cfg.code = `AI-${Math.floor(1000 + rng() * 8999)}`;
  cfg.color = pick(COLORS);
  const segs: Segment[] = ["mass", "salaried", "youth", "newlywed", "freelancer", "affluent", "retiree"];
  if (cfg.kind !== "credit_line") cfg.segment = pick(segs);
  const chans: Channel[] = cfg.kind === "bnpl" ? ["embedded", "digital"] : ["digital", "omni", "branch"];
  cfg.channel = pick(chans);
  if (cfg.kind === "points_loan") {
    cfg.points.coefficient = round(1.5 + rng() * 2);
    cfg.points.loanFee = round(rng() * 4);
    cfg.points.minHoldingDays = pick([30, 45, 60, 90]);
    cfg.points.transferable = rng() < 0.6;
  } else if (cfg.kind === "loyalty") {
    cfg.loyalty.pointsPer100k = Math.round(4 + rng() * 14);
    cfg.loyalty.pointValue = Math.round(20 + rng() * 80);
    cfg.loyalty.partnerShare = Math.round(rng() * 50);
    cfg.loyalty.tiers = rng() < 0.6;
    cfg.loyalty.gamification = rng() < 0.6;
  } else {
    cfg.credit.rate = cfg.contract === "qard" ? round(rng() * 4) : round(17 + rng() * 6);
    cfg.credit.upfrontFee = round(rng() * 2.5);
    cfg.risk.minScore = 480 + Math.round(rng() * 16) * 10;
    cfg.risk.maxDti = 30 + Math.round(rng() * 4) * 5;
    cfg.risk.altData = rng() < 0.65;
    cfg.risk.behavioral = rng() < 0.5;
  }
  cfg.description = `محصول تولیدشده توسط موتور ایده‌پرداز سیمرغ بر پایه الگوی «${tpl.title}» با جهش خلاقانه پارامترها.`;
  return cfg;
}
