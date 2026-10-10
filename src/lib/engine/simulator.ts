import { CBI, LIQUIDITY, CHANNELS, COLLATERALS, EMPLOYMENT_LABELS, SCENARIOS, SCORE_BANDS, rewardRate } from "./catalog";
import {
  aprFor,
  buildSchedule,
  clamp,
  irbRetailK,
  isTieredPoints,
  pointsLoanRate,
  pointsUpfrontFee,
  tierWeights,
  mean,
  mulberry32,
  normal,
  npv,
  quantile,
  sampleBass,
  seasoning,
  sigmoid,
  vasicekPd,
  zeros,
  type Schedule,
} from "./math";
import { generatePopulation, type Customer, type Employment } from "./population";
import type {
  Channel,
  Distribution,
  Kind,
  Kpis,
  MacroScenario,
  MonthPoint,
  PricingBreakdown,
  PricingRow,
  ProductConfig,
  Purpose,
  Repayment,
  ScenarioId,
  Segment,
  SegmentStat,
  SimParams,
  SimResult,
  TieredMurabahaTier,
} from "./types";

export const DEFAULT_PARAMS: SimParams = {
  customers: 4000,
  runs: 24,
  seed: 1405,
  scenario: "base",
  horizon: 36,
  marketRate: 26,
  scale: 250,
};

export const QUICK_PARAMS: SimParams = {
  customers: 1200,
  runs: 2,
  seed: 1405,
  scenario: "base",
  horizon: 36,
  marketRate: 26,
  scale: 830,
};

const NF = [0, 1, 2].map((d) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: d }));
const fa = (v: number, d = 0) => NF[Math.min(2, Math.max(0, d))].format(v);

export interface MarketCtx {
  marketRate: number;
  scenario: MacroScenario;
  inflation: number;
  apr: number;
}

export interface Driver {
  label: string;
  value: number;
}
export interface Check {
  ok: boolean;
  label: string;
  detail: string;
}

export interface UnderwriteResult {
  applyProb: number;
  eligible: boolean;
  checks: Check[];
  drivers: Driver[];
  score: number;
  need: number;
  amount: number;
  financed: number;
  limit: number;
  drawn: number;
  installment: number;
  dti: number;
  pd: number;
  lgd: number;
  tenor: number;
  rate: number;
  deposit: number;
  holdMonths: number;
  waitDays: number;
  reducedByDti: boolean;
  /** index of the chosen tier for tiered (Negin-style) points products, otherwise -1 */
  tierIndex: number;
}

/**
 * Tier chosen by a customer in a tiered points product. Selection follows the expected take-up shares,
 * down-weighting tiers whose waiting period exceeds the customer's patience (self-selection).
 */
export function chooseTier(tiers: TieredMurabahaTier[], u: number, patience: number): number {
  const base = tierWeights(tiers);
  const w = base.map((x, i) => x * (tiers[i].waitingMonths <= patience ? 1 : 0.35));
  const total = w.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return 0;
  let acc = 0;
  for (let i = 0; i < w.length; i++) {
    acc += w[i] / total;
    if (u < acc) return i;
  }
  return w.length - 1;
}

const EMP_PD: Record<Employment, number> = { gov: -0.45, private: 0, self: 0.25, retired: -0.35, student: 0.45, unemployed: 0.9 };
const KIND_PD: Record<Kind, number> = { installment: 0, bnpl: 0.1, credit_card: 0.15, credit_line: 0.05, points_loan: -0.55, loyalty: 0 };
const KIND_DEMAND: Record<Kind, number> = { installment: 0.2, bnpl: 0.3, credit_card: 0.24, credit_line: 0.16, points_loan: 0.18, loyalty: 0.45 };
const NEED_BASE: Record<Kind, number> = { installment: 7, bnpl: 1.6, credit_card: 3, credit_line: 12, points_loan: 3, loyalty: 0 };
const PURPOSE_NEED: Record<Purpose, number> = { goods: 1, service: 0.8, cash: 1, housing: 3.5, vehicle: 3, working_capital: 1.6, education: 0.8, medical: 0.7 };

export function segmentFit(seg: Segment, c: Customer): number {
  switch (seg) {
    case "salaried":
      return c.employment === "gov" || c.employment === "private" || c.employment === "retired" ? 1.35 : c.employment === "self" ? 0.6 : 0.35;
    case "youth":
      return c.age <= 30 ? 1.6 : c.age <= 35 ? 1.1 : 0.45;
    case "newlywed":
      return c.age >= 20 && c.age <= 35 ? 1.5 : 0.35;
    case "sme":
      return c.employment === "self" ? 2.2 : 0.25;
    case "freelancer":
      return c.employment === "self" ? 1.7 : c.employment === "private" ? 0.9 : 0.4;
    case "retiree":
      return c.employment === "retired" ? 2.4 : 0.3;
    case "affluent":
      return c.income >= 60 ? 2 : c.income >= 40 ? 1.2 : 0.4;
    default:
      return 1;
  }
}

export function channelFit(ch: Channel, digital: number): number {
  switch (ch) {
    case "digital":
      return 0.55 + 0.9 * digital;
    case "branch":
      return 1.15 - 0.45 * digital;
    case "embedded":
      return 0.5 + 1.0 * digital;
    default:
      return 0.9 + 0.25 * digital;
  }
}

/** Score as seen by the lender. Alternative data sharpens the signal, especially for thin-file customers. */
export function observedScore(c: Customer, altData: boolean): number {
  if (c.thinFile) {
    const shrink = altData ? 0.8 : 0.35;
    const sig = altData ? 38 : 70;
    return clamp(560 + shrink * (c.scoreTrue - 560) + sig * c.scoreNoise, 250, 900);
  }
  const sig = altData ? 28 : 48;
  return clamp(c.scoreTrue + sig * c.scoreNoise, 250, 900);
}

export function marketContext(cfg: ProductConfig, marketRate: number, scenarioId: ScenarioId = "base", inflation?: number): MarketCtx {
  const scenario = SCENARIOS[scenarioId] ?? SCENARIOS.base;
  return { marketRate, scenario, inflation: inflation ?? scenario.inflation, apr: aprFor(cfg) };
}

export function underwrite(cfg: ProductConfig, c: Customer, ctx: MarketCtx, needOverride?: number): UnderwriteResult {
  const cr = cfg.credit;
  const rk = cfg.risk;
  const pt = cfg.points;
  const ly = cfg.loyalty;
  const k = cfg.kind;
  const col = COLLATERALS[rk.collateral] ?? COLLATERALS.scoring;
  const isRev = k === "credit_card" || k === "credit_line";
  const isPoints = k === "points_loan";
  const isLoyalty = k === "loyalty";
  const hybrid = cfg.family === "hybrid";
  const tierIndex = isTieredPoints(cfg) ? chooseTier(pt.tiers, c.u[5] ?? 0.5, c.patience) : -1;
  const tier = tierIndex >= 0 ? pt.tiers[tierIndex] : null;
  const rate = tier ? tier.rate : isPoints ? pointsLoanRate(cfg) : cr.rate;
  const tenor = Math.max(1, Math.round(tier ? tier.repaymentMonths : cr.tenor));
  const grace = isPoints ? 0 : cr.grace;
  const downPct = isPoints ? 0 : cr.downPayment;
  const score = observedScore(c, rk.altData);
  const checks: Check[] = [];
  const drivers: Driver[] = [];

  // ----- demand side -----
  const maxAmt = isPoints ? Math.min(cr.maxAmount, pt.maxLoan, tier ? pt.individualLoanCap : Infinity) : cr.maxAmount;
  let need = needOverride ?? (isLoyalty ? 0 : c.income * NEED_BASE[k] * PURPOSE_NEED[cfg.purpose] * c.needFactor);
  if (needOverride === undefined && cfg.purpose === "working_capital" && c.employment !== "self") need *= 0.5;
  const seg = segmentFit(cfg.segment, c);
  const chan = channelFit(cfg.channel, c.digital);
  const price = isLoyalty ? 1 : clamp(Math.exp(-c.priceSens * 0.07 * (ctx.apr - ctx.marketRate)), 0.15, 3);
  const amountFit = isLoyalty || need <= maxAmt ? 1 : 0.55 + 0.45 * (maxAmt / Math.max(1, need));
  const rr = rewardRate(ly.pointsPer100k, ly.pointValue);
  const loyaltyAttract =
    clamp(0.55 + 0.45 * Math.min(2.5, rr / 0.5), 0.5, 1.8) *
    (ly.tiers ? 1.08 : 1) *
    (ly.gamification ? 1.12 : 1) *
    (ly.expiryMonths > 0 && ly.expiryMonths < 12 ? 0.9 : 1);

  let deposit = 0;
  let holdMonths = 0;
  let waitDays = 0;
  let patienceF = 1;
  let pointsCap = Infinity;
  if (isPoints) {
    const avail = Math.max(0, (c.balance * 0.8 + c.income * 1.5) * ctx.scenario.depositShift);
    const desired = clamp(need, cr.minAmount, maxAmt);
    if (tier) {
      // tiered murabaha: loan = α × average balance after the tier's waiting period
      const alpha = Math.max(0.01, tier.loanToAvgDepositPct / 100);
      deposit = Math.min(avail, desired / alpha);
      holdMonths = Math.max(1, tier.waitingMonths);
      pointsCap = deposit >= tier.minAvgDeposit ? alpha * deposit : 0;
    } else {
      const minHold = Math.max(1, pt.minHoldingDays / 30);
      // rational depositor: parks only what is needed to earn the desired loan within ~3 months
      const required = (desired * tenor) / (Math.max(0.1, pt.coefficient) * Math.max(minHold, 3));
      deposit = Math.min(avail, required);
      holdMonths = deposit > 0.5 ? (desired * tenor) / (Math.max(0.1, pt.coefficient) * deposit) : 99;
      holdMonths = clamp(holdMonths, minHold, 12);
      pointsCap = (pt.coefficient * deposit * holdMonths) / tenor;
    }
    waitDays = Math.round(holdMonths * 30);
    patienceF = holdMonths > c.patience ? 0.3 : 1;
  }
  const holdDays = tier ? tier.waitingMonths * 30 : pt.minHoldingDays;
  const pointsAttract = isPoints
    ? (tier ? 1.1 : Math.pow(Math.max(0.2, pt.coefficient) / 2, 0.6)) *
      (pt.transferable ? 1.15 : 1) *
      (pt.expiryMonths > 0 ? 0.9 : 1) *
      clamp(1 - 0.0015 * (holdDays - 30), 0.6, 1.1) *
      (c.balance >= 5 ? 1 : 0.15) *
      (1 + 0.01 * pt.depositRate) *
      patienceF
    : 1;

  const friction = isLoyalty
    ? 1
    : col.friction * (rk.collateral === "guarantor" ? Math.pow(0.8, Math.max(0, rk.guarantors - 1)) : 1);
  const structural = isLoyalty
    ? 1
    : clamp(
        (1 - 0.015 * cr.compensatingDeposit) *
          (1 + 0.02 * Math.min(grace, 12)) *
          (1 + 0.004 * clamp(tenor - 12, -12, 48)) *
          (1 - 0.006 * downPct) *
          (1 - 0.03 * cr.upfrontFee) *
          (k === "credit_card" ? 1 + 0.004 * cr.interestFreeDays : 1),
        0.2,
        2,
      );
  const kindAttract = isLoyalty ? loyaltyAttract : isPoints ? pointsAttract : hybrid ? 1.1 * clamp(loyaltyAttract, 0.8, 1.4) : 1;
  const applyProb = clamp(
    KIND_DEMAND[k] * seg * chan * price * friction * amountFit * structural * kindAttract * ctx.scenario.demandMultiplier,
    0,
    0.92,
  );

  if (isLoyalty) {
    checks.push({ ok: true, label: "عضویت در باشگاه", detail: "عضویت برای همه دارندگان حساب و کارت آزاد است" });
    return {
      applyProb, eligible: true, checks, drivers, score, need, amount: 0, financed: 0, limit: 0, drawn: 0, installment: 0,
      dti: (c.existingDebt / Math.max(0.5, c.income)) * 100, pd: 0, lgd: 0, tenor, rate, deposit, holdMonths, waitDays, reducedByDti: false, tierIndex,
    };
  }

  let eligible = true;
  const fail = (label: string, detail: string) => {
    eligible = false;
    checks.push({ ok: false, label, detail });
  };
  const pass = (label: string, detail: string) => checks.push({ ok: true, label, detail });

  // 1) credit score
  if (score >= rk.minScore) pass("امتیاز اعتباری", `امتیاز ${fa(score)} ≥ حد نصاب ${fa(rk.minScore)}`);
  else fail("امتیاز اعتباری", `امتیاز ${fa(score)} کمتر از حد نصاب ${fa(rk.minScore)} است`);

  // 2) age at maturity
  const ageEnd = c.age + (tenor + grace + (isPoints ? holdMonths : 0)) / 12;
  if (ageEnd <= rk.maxAge) pass("سن در پایان قرارداد", `${fa(ageEnd, 1)} سال (سقف ${fa(rk.maxAge)})`);
  else fail("سن در پایان قرارداد", `${fa(ageEnd, 1)} سال؛ بیش از سقف ${fa(rk.maxAge)} سال`);

  // 3) collateral availability
  let collOk = true;
  let collNote = `${col.label} — ${col.note}`;
  switch (rk.collateral) {
    case "guarantor":
      collOk = c.u[2] < Math.pow(c.guarantorProb, Math.max(1, rk.guarantors));
      collNote = collOk ? `${fa(rk.guarantors)} ضامن معتبر معرفی شد` : "یافتن ضامن معتبر ممکن نشد";
      break;
    case "salary":
      collOk = c.employment === "gov" || c.employment === "private" || c.employment === "retired";
      collNote = collOk ? "گواهی کسر از حقوق صادر شد" : "فقط حقوق‌بگیران و بازنشستگان مشمول کسر از حقوق هستند";
      break;
    case "cheque":
      collOk = c.hasCheque;
      collNote = collOk ? "چک صیادی در سامانه ثبت شد" : "دسته‌چک صیادی یا سابقه چک سالم ندارد";
      break;
    case "property":
      collOk = c.hasProperty;
      collNote = collOk ? "ملک قابل ترهین ارزیابی شد" : "ملک قابل ترهین ندارد";
      break;
    case "shares":
      collOk = c.sharesValue > 0;
      collNote = collOk ? `سهام به ارزش ${fa(c.sharesValue)} میلیون توثیق شد` : "سهام قابل توثیق ندارد";
      break;
    case "gold":
      collOk = c.goldValue > 0;
      collNote = collOk ? `طلا/گواهی سکه به ارزش ${fa(c.goldValue)} میلیون` : "طلا یا گواهی سکه ندارد";
      break;
    case "deposit_lien":
      collOk = c.balance >= (cr.minAmount * rk.coverage) / 100;
      collNote = collOk ? "سپرده کافی برای مسدودی دارد" : "موجودی کافی برای مسدودی ندارد";
      break;
    default:
      break;
  }
  if (collOk) pass("وثیقه و تضامین", collNote);
  else fail("وثیقه و تضامین", collNote);

  // 4) amount & affordability
  let amount = clamp(need, cr.minAmount, maxAmt);
  if (isPoints) amount = Math.min(amount, pointsCap);
  const cov = Math.max(0.5, rk.coverage / 100);
  if (rk.collateral === "deposit_lien") amount = Math.min(amount, c.balance / cov);
  if (rk.collateral === "shares") amount = Math.min(amount, c.sharesValue / cov);
  if (rk.collateral === "gold") amount = Math.min(amount, c.goldValue / cov);
  if (rk.collateral === "property" && c.hasProperty) amount = Math.min(amount, c.propertyValue / cov);

  let limit = 0;
  let drawn = 0;
  let financed = 0;
  let inst = 0;
  const compute = () => {
    if (isRev) {
      limit = amount;
      drawn = (limit * cr.utilization) / 100;
      financed = drawn;
      inst = drawn * (rate / 1200 + 1 / tenor);
    } else {
      financed = amount * (1 - downPct / 100);
      inst = buildSchedule(financed, rate, tenor, grace, isPoints ? "annuity" : cr.repayment, cr.stepUp, cr.balloon).installment;
    }
  };
  compute();
  let dti = ((inst + c.existingDebt) / Math.max(0.5, c.income)) * 100;
  let reducedByDti = false;
  if (dti > rk.maxDti) {
    const room = (rk.maxDti / 100) * c.income - c.existingDebt;
    if (room <= 0 || inst <= 0) {
      fail("توان بازپرداخت (DTI)", `اقساط فعلی ${fa(c.existingDebt, 1)} میلیون، سقف ${fa(rk.maxDti)}٪ درآمد را پر کرده است`);
    } else {
      amount *= room / inst;
      compute();
      dti = ((inst + c.existingDebt) / Math.max(0.5, c.income)) * 100;
      reducedByDti = true;
    }
  }
  if (eligible) {
    if (amount + 1e-6 < cr.minAmount) {
      fail("حداقل مبلغ", `مبلغ قابل پرداخت ${fa(amount, 1)} کمتر از حداقل ${fa(cr.minAmount)} میلیون تومان است`);
    } else {
      pass(
        "توان بازپرداخت (DTI)",
        `نسبت اقساط به درآمد ${fa(dti, 1)}٪${reducedByDti ? " — مبلغ تا سقف توان بازپرداخت کاهش یافت" : ""}`,
      );
    }
  }

  // ----- explainable PD (logit contributions) -----
  const add = (label: string, v: number) => {
    if (Math.abs(v) > 0.004) drivers.push({ label, value: v });
    return v;
  };
  let z = -2.75;
  z += add("ریسک رفتاری پنهان مشتری", c.latent);
  z += add("نسبت بدهی به درآمد", 2.0 * (dti / 100 - 0.35));
  z += add("وضعیت اشتغال", EMP_PD[c.employment]);
  z += add("نوع وثیقه و تضمین", col.pdEffect);
  z += add("نوع محصول", KIND_PD[k]);
  z += add("انتخاب نامطلوب (قیمت بالاتر از بازار)", 0.07 * Math.max(0, ctx.apr - ctx.marketRate));
  z += add("سن", c.age < 25 ? 0.25 : c.age > 62 ? 0.1 : 0);
  z += add("طول دوره بازپرداخت", 0.004 * (tenor - 24));
  if (rk.behavioral) z += add("پایش رفتاری و هشدار زودهنگام", -0.15);
  if (hybrid) z += add("پاداش خوش‌حسابی (لایه امتیاز)", -0.12);
  if (tier) z += add("خودانتخابی مشتری صبور (انتظار طولانی‌تر)", -0.03 * Math.max(0, tier.waitingMonths - 2));
  z += add("شرایط کلان اقتصادی", Math.log(ctx.scenario.pdMultiplier));
  const pd = clamp(sigmoid(z), 0.002, 0.6);

  let lgd = col.lgd;
  if (rk.collateral === "property" || rk.collateral === "deposit_lien" || rk.collateral === "gold" || rk.collateral === "shares") {
    lgd *= clamp(1.2 / cov, 0.5, 2);
  }
  lgd *= 1 - (0.15 * rk.collectionsIntensity) / 100;
  if (rk.behavioral) lgd *= 0.92;
  lgd = clamp(lgd + ctx.scenario.lgdShift, 0.02, 0.95);

  return {
    applyProb, eligible, checks, drivers, score, need, amount, financed, limit, drawn, installment: inst, dti, pd, lgd,
    tenor, rate, deposit, holdMonths, waitDays, reducedByDti, tierIndex,
  };
}

interface Booking {
  c: Customer;
  uw: UnderwriteResult;
  start: number;
  takes: boolean;
  band: number;
  sch?: Schedule;
}

function bandIndex(score: number): number {
  for (let i = 0; i < SCORE_BANDS.length; i++) if (score < SCORE_BANDS[i].hi) return i;
  return SCORE_BANDS.length - 1;
}

function distribution(vals: number[]): Distribution {
  const s = [...vals].sort((a, b) => a - b);
  const mn = s[0] ?? 0;
  const mx = s[s.length - 1] ?? 0;
  const nb = Math.min(14, Math.max(4, Math.round(Math.sqrt(s.length) * 1.6)));
  const width = (mx - mn) / nb || 1;
  const bins = Array.from({ length: nb }, (_, i) => {
    const x = mn + width * (i + 0.5);
    return { x, label: fa(x, Math.abs(x) < 10 ? 1 : 0), count: 0 };
  });
  for (const v of s) bins[Math.min(nb - 1, Math.max(0, Math.floor((v - mn) / width)))].count++;
  const m = mean(s);
  const p5 = quantile(s, 0.05);
  return {
    bins,
    p5,
    p50: quantile(s, 0.5),
    p95: quantile(s, 0.95),
    mean: m,
    probLoss: s.length ? (s.filter((v) => v < 0).length / s.length) * 100 : 0,
    var95: Math.max(0, m - p5),
  };
}

const QUINTILE_LABELS = ["دهک ۱–۲ (کم‌درآمد)", "دهک ۳–۴", "دهک ۵–۶", "دهک ۷–۸", "دهک ۹–۱۰ (پردرآمد)"];

export function simulatePortfolio(cfg: ProductConfig, p: SimParams): SimResult {
  const t0 = Date.now();
  const H = clamp(Math.round(p.horizon), 6, 72);
  const N = clamp(Math.round(p.customers), 200, 20000);
  const R = clamp(Math.round(p.runs), 1, 200);
  const S = Math.max(1, p.scale);
  const toB = S / 1000; // million toman per synthetic customer → billion toman
  const ctx = marketContext(cfg, p.marketRate, p.scenario, p.inflation);
  if (p.pdShock && p.pdShock !== 1) ctx.scenario = { ...ctx.scenario, pdMultiplier: ctx.scenario.pdMultiplier * p.pdShock };
  const scen = ctx.scenario;
  const cr = cfg.credit;
  const rk = cfg.risk;
  const fnd = cfg.funding;
  const pt = cfg.points;
  const ly = cfg.loyalty;
  const k = cfg.kind;
  const isRev = k === "credit_card" || k === "credit_line";
  const isPoints = k === "points_loan";
  const isLoyalty = k === "loyalty";
  const hasLoyalty = isLoyalty || cfg.family === "hybrid";
  const pop = generatePopulation(N, p.seed);
  const ramp = Math.max(3, Math.round(H * 0.6));
  const tenor = Math.max(1, Math.round(cr.tenor));
  const nplWin = isRev ? 12 : clamp(tenor, 4, 12);
  const upfrontPct = isPoints ? pointsUpfrontFee(cfg) : cr.upfrontFee;
  let rateVol = 0;
  let rateW = 0;

  const nb = SCORE_BANDS.length;
  const bApplied = zeros(nb);
  const bApproved = zeros(nb);
  const bDefault = zeros(nb);
  const bPd = zeros(nb);
  const bLgd = zeros(nb);
  const empKeys: Employment[] = ["gov", "private", "self", "retired", "student", "unemployed"];
  const emp: Record<string, { a: number; ok: number; pd: number; vol: number }> = {};
  for (const e of empKeys) emp[e] = { a: 0, ok: 0, pd: 0, vol: 0 };
  const incSorted = pop.map((c) => c.income).sort((a, b) => a - b);
  const qs = [0.2, 0.4, 0.6, 0.8].map((x) => quantile(incSorted, x));
  const quint = (v: number) => (v <= qs[0] ? 0 : v <= qs[1] ? 1 : v <= qs[2] ? 2 : v <= qs[3] ? 3 : 4);
  const qst = [0, 1, 2, 3, 4].map(() => ({ a: 0, ok: 0, pd: 0, vol: 0 }));

  // ---------- 1. Demand & underwriting ----------
  const bookings: Booking[] = [];
  let applied = 0;
  let approved = 0;
  let pdS = 0;
  let lgdS = 0;
  let scoreS = 0;
  let dtiS = 0;
  let instS = 0;
  let ticketS = 0;
  let incl = 0;
  let waitS = 0;
  let ecS = 0;
  let depMT = 0;
  let loanMT = 0;
  for (const c of pop) {
    const uw = underwrite(cfg, c, ctx);
    if (c.u[0] >= uw.applyProb) continue;
    applied++;
    const bi = bandIndex(uw.score);
    bApplied[bi]++;
    emp[c.employment].a++;
    const qi = quint(c.income);
    qst[qi].a++;
    if (isPoints) waitS += uw.waitDays;
    const start = 1 + Math.floor(sampleBass(c.u[1], 0.025, 0.28, ramp));
    if (!uw.eligible) {
      if (isPoints) {
        depMT += uw.deposit * (uw.holdMonths + 3);
        bookings.push({ c, uw, start, takes: false, band: bi });
      }
      continue;
    }
    approved++;
    bApproved[bi]++;
    bPd[bi] += uw.pd;
    bLgd[bi] += uw.lgd;
    emp[c.employment].ok++;
    emp[c.employment].pd += uw.pd;
    emp[c.employment].vol += uw.financed;
    qst[qi].ok++;
    qst[qi].pd += uw.pd;
    qst[qi].vol += uw.financed;
    pdS += uw.pd;
    lgdS += uw.lgd;
    scoreS += uw.score;
    dtiS += uw.dti;
    instS += uw.installment;
    ticketS += isRev ? uw.limit : uw.amount;
    if (c.thinFile || qi <= 1) incl++;
    const takes = isPoints ? c.u[4] < pt.usageRate / 100 : true;
    if (isPoints) {
      // mirrors the balance behaviour of the cash-flow loop below (tiered: 15% kept after the loan, 40% leave after waiting)
      const tieredDep = uw.tierIndex >= 0;
      depMT += uw.deposit * uw.holdMonths + (takes ? (tieredDep ? 0.15 : 0.45) * uw.deposit * uw.tenor : uw.deposit * 12 * (tieredDep ? 0.6 : 1));
      if (takes) loanMT += (uw.financed * (uw.tenor + 1)) / 2;
    }
    if (takes && !isLoyalty) {
      rateVol += uw.rate * uw.financed;
      rateW += uw.financed;
    }
    let sch: Schedule | undefined;
    if (!isLoyalty && !isRev && takes) {
      sch = buildSchedule(uw.financed, uw.rate, uw.tenor, isPoints ? 0 : cr.grace, isPoints ? "annuity" : cr.repayment, cr.stepUp, cr.balloon);
      const exposure = uw.financed * 0.55;
      const type = cfg.purpose === "housing" && rk.collateral === "property" ? "mortgage" : "other";
      ecS += irbRetailK(uw.pd, uw.lgd, type) * exposure;
    } else if (isRev) {
      ecS += irbRetailK(uw.pd, uw.lgd, "qrre") * (uw.drawn + 0.3 * (uw.limit - uw.drawn));
    }
    bookings.push({ c, uw, start, takes, band: bi, sch });
  }

  // ---------- 2. Monte Carlo over time ----------
  const L = H + 1;
  const A = {
    out: zeros(L), int: zeros(L), fee: zeros(L), fund: zeros(L), opex: zeros(L), loss: zeros(L), npl: zeros(L),
    act: zeros(L), dep: zeros(L), ben: zeros(L), rew: zeros(L), inc: zeros(L), liab: zeros(L), profit: zeros(L),
    cum: zeros(L), real: zeros(L),
  };
  const vint = zeros(L);
  const runNet: number[] = [];
  const runReal: number[] = [];
  let bookedTot = 0;
  let volTot = 0;
  let defTot = 0;
  let ptsTot = 0;
  const cofBase = fnd.costOfFunds + scen.fundingShift;
  const ch = CHANNELS[cfg.channel] ?? CHANNELS.omni;
  const opexPer = (fnd.opexPerAccount / 1000) * ch.opex;
  const cac = (fnd.acquisitionCost / 1000) * ch.cac;
  const collCost = (0.02 * rk.collectionsIntensity) / 100;
  // points products: volume-weighted contract rate of the booked loans (tiers can differ)
  const prodRate = isPoints ? (rateW > 0 ? rateVol / rateW : isTieredPoints(cfg) ? aprFor(cfg) : pointsLoanRate(cfg)) : cr.rate;
  const cpr = clamp(0.1 - 0.002 * (ctx.inflation - prodRate), 0.01, 0.15) * (1 + cr.prepayDiscount / 200);
  const prepayM = cpr / 12;
  const uplift = (ly.spendUplift / 100) * (ly.tiers ? 1.25 : 1) * (ly.gamification ? 1.2 : 1);
  const ptsPerM = 10 * ly.pointsPer100k;
  const ppv = ly.pointValue / 1e6;
  const breakEff = clamp(ly.breakage + (ly.expiryMonths > 0 ? 60 / Math.max(3, ly.expiryMonths) : 0), 0, 90) / 100;
  const costShare = (1 - breakEff) * (1 - ly.partnerShare / 100) * (ly.tiers ? 1.12 : 1);
  const feeRate = Math.max(0.3, cr.merchantFee) / 100;
  const baseChurn = 0.015;
  const churnL = baseChurn * (1 - ly.churnReduction / 100);
  const custMargin = 0.12;

  for (let r = 0; r < R; r++) {
    const rng = mulberry32((p.seed + 17) * 7919 + r * 104729);
    const Z = R === 1 ? 0 : normal(rng);
    const cof = Math.max(0, cofBase + 0.8 * Z);
    const infl = Math.max(0, ctx.inflation + 6 * Z);
    const lgdShock = 0.03 * Z;
    const benefitRate = ((1 - fnd.reserveRatio / 100) * cof - pt.depositRate) / 1200;
    const gArr = Array.from({ length: L + 2 }, (_, m) => Math.pow(1 + infl / 100, m / 12));
    const g = (m: number) => gArr[m] ?? Math.pow(1 + infl / 100, m / 12);
    const out = zeros(L), int = zeros(L), fee = zeros(L), fund = zeros(L), opex = zeros(L), loss = zeros(L), npl = zeros(L);
    const act = zeros(L), dep = zeros(L), ben = zeros(L), rew = zeros(L), inc = zeros(L), liab = zeros(L);
    let booked = 0;
    let vol = 0;
    let defs = 0;
    let pts = 0;

    const accrue = (m: number, base: number) => {
      const issued = base * ptsPerM;
      pts += issued;
      rew[m] += issued * ppv * costShare;
    };
    const markDefault = (m: number, mob: number, ead: number, lgd: number, band: number) => {
      loss[m] += ead * lgd + ead * collCost;
      for (let j = m; j <= Math.min(H, m + nplWin - 1); j++) npl[j] += ead;
      vint[Math.min(mob, H)] += 1;
      defs++;
      bDefault[band] += 1;
    };
    const simLoan = (b: Booking, startM: number, sch: Schedule, rateA: number, hBase: number, lgd: number, extraFee: number, lateP: number) => {
      const principal = b.uw.financed;
      fee[startM] += (principal * upfrontPct) / 100 + extraFee;
      opex[startM] += cac;
      booked++;
      vol += principal;
      let prev = principal;
      for (let i = 0; i < sch.months; i++) {
        const m = startM + i;
        if (m > H) return { s: 0, end: H };
        const mob = i + 1;
        if (rng() < Math.min(0.5, hBase * seasoning(mob))) {
          markDefault(m, mob, prev, lgd, b.band);
          return { s: 3, end: m };
        }
        int[m] += sch.int[i];
        fund[m] += (prev * cof) / 1200;
        opex[m] += opexPer;
        act[m] += 1;
        out[m] += sch.bal[i];
        if (rng() < lateP) fee[m] += ((sch.pay[i] * (rateA + cr.latePenaltySpread)) / 100) * (45 / 365);
        if (hasLoyalty && !isLoyalty) accrue(m, sch.pay[i]);
        prev = sch.bal[i];
        if (i < sch.months - 1 && rng() < prepayM) return { s: 2, end: m };
      }
      return { s: 1, end: startM + sch.months - 1 };
    };

    for (const b of bookings) {
      const c = b.c;
      const pdc = vasicekPd(Math.max(0.0005, b.uw.pd), Z, 0.05);
      const hBase = 1 - Math.pow(1 - pdc, 1 / 12);
      const lgd = clamp(b.uw.lgd + lgdShock, 0.02, 0.95);
      const lateP = clamp(b.uw.pd * 1.2, 0.01, 0.3);

      if (isLoyalty) {
        opex[b.start] += cac * 0.4;
        booked++;
        let liability = 0;
        const spend0 = c.monthlySpend * scen.spendShift;
        for (let m = b.start; m <= H; m++) {
          if (rng() < churnL) break;
          const spend = spend0 * (1 + uplift) * g(m);
          const issued = spend * ptsPerM;
          pts += issued;
          rew[m] += issued * ppv * costShare;
          liability += issued * ppv * (1 - breakEff);
          liability -= liability * 0.22;
          liab[m] += liability;
          inc[m] +=
            spend * (uplift / (1 + uplift)) * feeRate +
            (c.balance * g(m) * (ly.balanceUplift / 100) * cof) / 1200 +
            custMargin * g(m) * (baseChurn - churnL) * (m - b.start + 1);
          opex[m] += opexPer * 0.25 + (ly.gamification ? 0.002 : 0);
          act[m] += 1;
        }
        continue;
      }

      if (isPoints) {
        const D = b.uw.deposit;
        const hold = Math.max(1, Math.ceil(b.uw.holdMonths));
        const loanOk = b.uw.eligible && b.takes && !!b.sch;
        const loanStart = b.start + hold;
        const rejected = !b.uw.eligible;
        opex[b.start] += cac * 0.6;
        // tiered (average-balance) schemes: the deposit is only a condition for the loan → same behaviour as the
        // ALM lab: 85% run-off after disbursement, 40% of the other savers leave when their wait ends
        const tieredMode = b.uw.tierIndex >= 0;
        const keepAfterLoan = tieredMode ? 0.15 : 0.45;
        const leavesAtEnd = tieredMode && !loanOk && rng() < 0.4;
        for (let m = b.start; m <= H; m++) {
          if (leavesAtEnd && m >= loanStart) break;
          if (m >= b.start + hold && rng() < (rejected ? 0.08 : 0.015)) break;
          const d = loanOk && m >= loanStart ? D * keepAfterLoan : rejected && m >= loanStart ? D * 0.5 : D;
          dep[m] += d;
          ben[m] += d * benefitRate;
          opex[m] += opexPer * 0.35;
        }
        if (loanOk && b.sch && loanStart <= H) simLoan(b, loanStart, b.sch, b.uw.rate, hBase, lgd, 0, lateP);
        continue;
      }

      if (isRev) {
        const limit = b.uw.limit;
        const drawn = b.uw.drawn;
        const revolver = k === "credit_line" || c.u[3] < cr.revolvingShare / 100;
        const spendBase =
          k === "credit_card" ? Math.min(limit * 0.8, c.monthlySpend * 0.45) * scen.spendShift * (hasLoyalty ? 1 + uplift : 1) : 0;
        fee[b.start] += (limit * cr.upfrontFee) / 100;
        opex[b.start] += cac;
        booked++;
        vol += limit;
        for (let m = b.start; m <= H; m++) {
          const mob = m - b.start + 1;
          if (rng() < 0.008) break;
          const spend = Math.min(limit, spendBase * g(mob));
          const bal = revolver ? drawn : spend * Math.max(0.3, cr.interestFreeDays / 30) * 0.5;
          if (rng() < Math.min(0.5, hBase * seasoning(mob) * (revolver ? 1 : 0.5))) {
            const ead = revolver ? drawn + 0.3 * (limit - drawn) : spend + 0.2 * Math.max(0, limit - spend);
            markDefault(m, mob, ead, lgd, b.band);
            break;
          }
          if (revolver) int[m] += (drawn * cr.rate) / 1200;
          fund[m] += (bal * cof) / 1200;
          out[m] += bal;
          act[m] += 1;
          opex[m] += opexPer;
          fee[m] += (spend * cr.merchantFee) / 100;
          if ((mob - 1) % 12 === 0) fee[m] += (limit * cr.annualFee) / 100;
          if (revolver && rng() < lateP) fee[m] += (((drawn / tenor) * (cr.rate + cr.latePenaltySpread)) / 100) * (45 / 365);
          if (hasLoyalty) accrue(m, spend);
        }
        continue;
      }

      // installment & BNPL (BNPL customers repeat purchases)
      if (!b.sch) continue;
      let startM = b.start;
      for (let guard = 0; guard < 8 && startM <= H; guard++) {
        const extra = k === "bnpl" ? (b.uw.amount * cr.merchantFee) / 100 : 0;
        const res = simLoan(b, startM, b.sch, cr.rate, hBase, lgd, extra, lateP);
        if (k !== "bnpl" || res.s === 3 || res.s === 0) break;
        if (rng() > 0.5) break;
        startM = res.end + 1 + Math.floor(rng() * 3);
      }
    }

    let cum = 0;
    let real = 0;
    for (let m = 1; m <= H; m++) {
      const pm = (int[m] + fee[m] + ben[m] + inc[m] - fund[m] - opex[m] - loss[m] - rew[m]) * toB;
      cum += pm;
      real += pm / g(m);
      A.out[m] += out[m] * toB;
      A.int[m] += int[m] * toB;
      A.fee[m] += fee[m] * toB;
      A.fund[m] += fund[m] * toB;
      A.opex[m] += opex[m] * toB;
      A.loss[m] += loss[m] * toB;
      A.npl[m] += npl[m] * toB;
      A.act[m] += act[m] * S;
      A.dep[m] += dep[m] * toB;
      A.ben[m] += ben[m] * toB;
      A.rew[m] += rew[m] * toB;
      A.inc[m] += inc[m] * toB;
      A.liab[m] += liab[m] * toB;
      A.profit[m] += pm;
      A.cum[m] += cum;
      A.real[m] += real;
    }
    const tax = (Math.max(0, cum) * fnd.taxRate) / 100;
    runNet.push(cum - tax);
    runReal.push(real - tax / g(H));
    bookedTot += booked;
    volTot += vol;
    defTot += defs;
    ptsTot += pts;
  }

  // ---------- 3. Aggregation ----------
  const series: MonthPoint[] = [];
  for (let m = 1; m <= H; m++) {
    const o = A.out[m] / R;
    const n = A.npl[m] / R;
    series.push({
      m,
      outstanding: o,
      interest: A.int[m] / R,
      fees: A.fee[m] / R,
      funding: A.fund[m] / R,
      opex: A.opex[m] / R,
      losses: A.loss[m] / R,
      benefit: A.ben[m] / R,
      reward: A.rew[m] / R,
      incremental: A.inc[m] / R,
      profit: A.profit[m] / R,
      cumProfit: A.cum[m] / R,
      realCumProfit: A.real[m] / R,
      npl: o + n > 0 ? (n / (o + n)) * 100 : 0,
      active: A.act[m] / R,
      deposits: A.dep[m] / R,
      liability: A.liab[m] / R,
    });
  }
  // NPL: steady-state measure (ignore run-off tail where outstanding vanishes)
  const peakOut = Math.max(1e-9, ...series.map((x) => x.outstanding));
  let lastValid = 0;
  for (const x of series) {
    if (x.outstanding >= 0.12 * peakOut) lastValid = x.npl;
    else x.npl = lastValid;
  }
  const validNpl = series.filter((x) => x.m >= 6 && x.outstanding >= 0.3 * peakOut).map((x) => x.npl);
  const nplSteady = validNpl.length ? mean(validNpl.slice(-12)) : series.length ? series[series.length - 1].npl : 0;
  const tot = (f: (x: MonthPoint) => number) => series.reduce((s, x) => s + f(x), 0);
  const interestIncome = tot((x) => x.interest);
  const feeIncome = tot((x) => x.fees);
  const fundingCost = tot((x) => x.funding);
  const opexT = tot((x) => x.opex);
  const lossesT = tot((x) => x.losses);
  const benefitT = tot((x) => x.benefit);
  const rewardT = tot((x) => x.reward);
  const incT = tot((x) => x.incremental);
  const preTax = interestIncome + feeIncome + benefitT + incT - fundingCost - opexT - lossesT - rewardT;
  const netProfit = mean(runNet);
  const avgOut = mean(series.map((x) => x.outstanding));
  const avgDep = mean(series.map((x) => x.deposits));
  const annual = 12 / H;
  const safeOut = Math.max(avgOut, 1e-6);
  const ec = ecS * toB;
  const rc = (((avgOut * fnd.riskWeight) / 100) * fnd.targetCar) / 100;
  const capital = Math.max(ec, rc, 1e-6);
  const volume = (volTot / R) * toB;
  const bookedAvg = bookedTot / R;
  const defAvg = defTot / R;
  const dist = distribution(runNet);
  const last = series[series.length - 1];

  // Liquidity adjustment (points products): HQLA buffer forgoes FTP; liquidity capital covers a stressed run-off
  const afterTax = 1 - fnd.taxRate / 100;
  const liqCost = isPoints ? ((avgDep * LIQUIDITY.bufferRunoff) / 100) * (cofBase / 100) * (H / 12) : 0;
  const liqCapital = isPoints ? ((avgDep * LIQUIDITY.stressRunoff) / 100) * (LIQUIDITY.stressSpread / 100) : 0;
  const pct = (v: number) => (isLoyalty || avgOut <= 1e-6 ? 0 : ((v * annual) / safeOut) * 100);
  // Hurdle is an after-tax ROE; pricing components are pre-tax → gross up by 1/(1 − tax).
  const grossRoe = fnd.targetRoe / Math.max(0.05, 1 - fnd.taxRate / 100);
  const pricing: PricingBreakdown = {
    cof: pct(fundingCost),
    el: pct(lossesT),
    opex: pct(opexT),
    fees: pct(feeIncome),
    benefit: pct(benefitT),
    reward: pct(rewardT),
    capital: isLoyalty || avgOut <= 1e-6 ? 0 : ((capital * grossRoe) / 100 / safeOut) * 100,
    breakEven: 0,
    riskBased: 0,
    productRate: prodRate,
    cap: cfg.contract === "qard" ? CBI.qardFeeCap : CBI.loanRateCap,
  };
  pricing.breakEven = pricing.cof + pricing.el + pricing.opex + pricing.reward - pricing.fees - pricing.benefit;
  pricing.riskBased = pricing.breakEven + pricing.capital;

  const pricingGrid: PricingRow[] = [];
  if (!isLoyalty && approved > 0 && avgOut > 1e-6) {
    for (let i = 0; i < nb; i++) {
      if (!bApproved[i]) continue;
      const bpd = bPd[i] / bApproved[i];
      const blgd = bLgd[i] / bApproved[i];
      const el = bpd * blgd * 100;
      const capCharge = irbRetailK(bpd, blgd, isRev ? "qrre" : "other") * grossRoe;
      const required = pricing.cof + el + pricing.opex - pricing.fees - pricing.benefit + pricing.reward + capCharge;
      pricingGrid.push({
        band: SCORE_BANDS[i].label,
        pd: bpd * 100,
        lgd: blgd * 100,
        el,
        capital: capCharge,
        required,
        status: required <= pricing.productRate ? "ok" : required <= pricing.cap ? "above_rate" : "above_cap",
        share: (bApproved[i] / approved) * 100,
      });
    }
  }

  const q0 = qst[0];
  const q4 = qst[4];
  const kpis: Kpis = {
    market: N * S,
    applicants: applied * S,
    approved: approved * S,
    approvalRate: applied ? (approved / applied) * 100 : 0,
    takeUpRate: (applied / N) * 100,
    booked: bookedAvg * S,
    volume,
    avgTicket: approved ? ticketS / approved : 0,
    avgInstallment: approved ? instS / approved : 0,
    avgScoreApproved: approved ? scoreS / approved : 0,
    avgPd: approved ? (pdS / approved) * 100 : 0,
    avgLgd: approved ? (lgdS / approved) * 100 : 0,
    cumDefaultRate: bookedAvg ? (defAvg / bookedAvg) * 100 : 0,
    nplEnd: isLoyalty ? 0 : nplSteady,
    lossRate: volume > 0 ? (lossesT / volume) * 100 : 0,
    interestIncome,
    feeIncome,
    fundingCost,
    opex: opexT,
    creditLosses: lossesT,
    preTaxProfit: preTax,
    netProfit,
    avgOutstanding: avgOut,
    roa: isLoyalty ? 0 : ((netProfit * annual) / safeOut) * 100,
    raroc: isLoyalty ? 0 : ((netProfit * annual) / capital) * 100,
    rarocCredit: isLoyalty ? 0 : (((netProfit - (isPoints ? benefitT * afterTax : 0)) * annual) / capital) * 100,
    rarocLiquidity: isLoyalty ? 0 : (((netProfit - liqCost * afterTax) * annual) / (capital + liqCapital)) * 100,
    liquidityCost: liqCost,
    liquidityCapital: liqCapital,
    economicCapital: ec,
    regulatoryCapital: rc,
    nim: isLoyalty ? 0 : (((interestIncome + feeIncome + benefitT - fundingCost) * annual) / safeOut) * 100,
    apr: ctx.apr,
    npv: npv(cofBase / 1200, series.map((x) => x.profit)),
    realYield: isLoyalty || avgOut <= 1e-6 ? 0 : ((1 + ((interestIncome + feeIncome - lossesT) * annual) / safeOut) / (1 + ctx.inflation / 100) - 1) * 100,
    realProfit: mean(runReal),
    inclusion: approved ? (incl / approved) * 100 : 0,
    fairnessGap: (q4.a ? (q4.ok / q4.a) * 100 : 0) - (q0.a ? (q0.ok / q0.a) * 100 : 0),
    customerBurden: approved ? dtiS / approved : 0,
    depositsAvg: avgDep,
    fundingBenefit: benefitT,
    sourceUseRatio: avgOut > 1e-6 ? avgDep / avgOut : 0,
    moneyTimeRatio: isPoints && loanMT > 0 ? depMT / loanMT : 0,
    avgWaitDays: applied ? waitS / applied : 0,
    pointsIssued: (ptsTot / R) * S,
    rewardCost: rewardT,
    incrementalRevenue: incT,
    loyaltyRoi: isLoyalty && rewardT + opexT > 0 ? ((incT + (isLoyalty ? 0 : feeIncome) - rewardT - opexT) / (rewardT + opexT)) * 100 : 0,
    pointsLiabilityEnd: last ? last.liability : 0,
    inflation: ctx.inflation,
  };

  const funnel = [
    { stage: "بازار هدف", value: N * S },
    { stage: isPoints ? "افتتاح حساب امتیازی" : isLoyalty ? "عضویت در باشگاه" : "متقاضی", value: applied * S },
    { stage: isLoyalty ? "عضو فعال" : "واجد شرایط", value: approved * S },
    { stage: isPoints ? "دریافت وام امتیازی" : isLoyalty ? "جذب در افق" : "قرارداد منعقدشده", value: bookedAvg * S },
    { stage: "فعال در پایان افق", value: last ? last.active : 0 },
  ];
  if (!isLoyalty) funnel.push({ stage: "نکول", value: defAvg * S });

  const waterfall: { label: string; value: number }[] = [];
  if (isLoyalty) waterfall.push({ label: "درآمد افزایشی وفاداری", value: incT });
  else waterfall.push({ label: isPoints ? "کارمزد وام امتیازی" : "درآمد سود", value: interestIncome });
  waterfall.push({ label: "کارمزد و وجه التزام", value: feeIncome });
  if (benefitT) waterfall.push({ label: "ارزش منابع ارزان", value: benefitT });
  if (!isLoyalty && incT) waterfall.push({ label: "درآمد افزایشی", value: incT });
  waterfall.push({ label: "هزینه وجوه", value: -fundingCost });
  waterfall.push({ label: "هزینه عملیاتی", value: -opexT });
  if (!isLoyalty) waterfall.push({ label: "زیان اعتباری", value: -lossesT });
  if (rewardT) waterfall.push({ label: "هزینه پاداش", value: -rewardT });
  waterfall.push({ label: "مالیات", value: -(preTax - netProfit) });

  const vintage: { m: number; cum: number }[] = [];
  let cv = 0;
  for (let m = 1; m <= H; m++) {
    cv += vint[m] / R;
    vintage.push({ m, cum: bookedAvg ? (cv / bookedAvg) * 100 : 0 });
  }

  const segments: SegmentStat[] = empKeys.map((e) => ({
    key: e,
    label: EMPLOYMENT_LABELS[e],
    applicants: emp[e].a * S,
    approved: emp[e].ok * S,
    approvalRate: emp[e].a ? (emp[e].ok / emp[e].a) * 100 : 0,
    avgPd: emp[e].ok ? (emp[e].pd / emp[e].ok) * 100 : 0,
    volume: emp[e].vol * toB,
  }));
  const quintiles: SegmentStat[] = qst.map((q, i) => ({
    key: `q${i + 1}`,
    label: QUINTILE_LABELS[i],
    applicants: q.a * S,
    approved: q.ok * S,
    approvalRate: q.a ? (q.ok / q.a) * 100 : 0,
    avgPd: q.ok ? (q.pd / q.ok) * 100 : 0,
    volume: q.vol * toB,
  }));

  const scoreBands = SCORE_BANDS.map((b, i) => ({
    band: b.label,
    applied: bApplied[i] * S,
    approved: bApproved[i] * S,
    defaulted: (bDefault[i] / R) * S,
  }));

  return {
    kpis,
    series,
    profitDist: dist,
    scoreBands,
    segments,
    quintiles,
    vintage,
    funnel,
    waterfall,
    pricing,
    pricingGrid,
    params: { ...p, horizon: H, customers: N, runs: R },
    durationMs: Date.now() - t0,
  };
}

export function repaymentPreview(cfg: ProductConfig, amount: number, tierIndex = -1) {
  const isPoints = cfg.kind === "points_loan";
  const tier = isTieredPoints(cfg) ? cfg.points.tiers[tierIndex >= 0 ? tierIndex : 0] : undefined;
  const rate = tier ? tier.rate : isPoints ? pointsLoanRate(cfg) : cfg.credit.rate;
  const tenor = tier ? tier.repaymentMonths : cfg.credit.tenor;
  const financed = amount * (1 - (isPoints ? 0 : cfg.credit.downPayment) / 100);
  const method: Repayment = isPoints ? "annuity" : cfg.credit.repayment;
  return buildSchedule(financed, rate, tenor, isPoints ? 0 : cfg.credit.grace, method, cfg.credit.stepUp, cfg.credit.balloon);
}
