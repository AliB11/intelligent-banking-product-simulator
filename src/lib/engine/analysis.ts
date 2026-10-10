import { CHANNELS, COLLATERALS, SCENARIOS } from "./catalog";
import { checkCompliance, computeHealth } from "./advisor";
import { clamp, mulberry32, type Rng } from "./math";
import { simulatePortfolio } from "./simulator";
import { mergeConfig } from "./templates";
import type {
  Channel,
  Collateral,
  Kpis,
  Objective,
  OptimizerPoint,
  OptimizerResult,
  ProductConfig,
  ScenarioId,
  SimParams,
  SimResult,
  StressRow,
  TornadoItem,
} from "./types";

const NF = [0, 1, 2].map((d) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: d }));
const fa = (v: number, d = 1) => NF[Math.min(2, Math.max(0, d))].format(v);
const clone = (c: ProductConfig) => mergeConfig(c, {});

/** Preserve the represented market when reducing the synthetic sample. */
export function resampleParams(base: SimParams, cap: number): SimParams {
  const customers = Math.min(base.customers, cap);
  return { ...base, customers, scale: base.scale * base.customers / customers };
}

// ======================= Stress testing =======================
export function runStress(cfg: ProductConfig, base: SimParams): StressRow[] {
  const ids = Object.keys(SCENARIOS) as ScenarioId[];
  return ids.map((id) => {
    const s = SCENARIOS[id];
    const sim = simulatePortfolio(cfg, {
      ...resampleParams(base, 3000),
      scenario: id,
      inflation: undefined,
      runs: Math.min(base.runs, 12),
    });
    return {
      id,
      label: s.label,
      color: s.color,
      inflation: s.inflation,
      netProfit: sim.kpis.netProfit,
      realProfit: sim.kpis.realProfit,
      nplEnd: sim.kpis.nplEnd,
      raroc: sim.kpis.raroc,
      cumDefaultRate: sim.kpis.cumDefaultRate,
      probLoss: sim.profitDist.probLoss,
      approvalRate: sim.kpis.approvalRate,
      volume: sim.kpis.volume,
    };
  });
}

// ======================= Sensitivity (tornado) =======================
interface SensVar {
  key: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  apply: (c: ProductConfig, p: SimParams, d: -1 | 1) => [ProductConfig, SimParams];
}

export function runSensitivity(cfg: ProductConfig, base: SimParams): TornadoItem[] {
  const fast: SimParams = { ...resampleParams(base, 2500), runs: Math.min(base.runs, 6) };
  const baseProfit = simulatePortfolio(cfg, fast).kpis.netProfit;
  const k = cfg.kind;
  const vars: SensVar[] = [];
  if (k !== "loyalty") {
    vars.push({
      key: "rate",
      label: k === "points_loan" ? "کارمزد وام امتیازی" : "نرخ سود",
      lowLabel: k === "points_loan" ? "−۱.۵ واحد" : "−۳ واحد",
      highLabel: k === "points_loan" ? "+۱.۵ واحد" : "+۳ واحد",
      apply: (c, p, d) => {
        const x = clone(c);
        if (k === "points_loan") x.points.loanFee = clamp(x.points.loanFee + d * 1.5, 0, 8);
        else x.credit.rate = clamp(x.credit.rate + d * 3, 0, 40);
        return [x, p];
      },
    });
    vars.push({
      key: "minScore", label: "حد نصاب امتیاز اعتباری", lowLabel: "−۴۰", highLabel: "+۴۰",
      apply: (c, p, d) => { const x = clone(c); x.risk.minScore = clamp(x.risk.minScore + d * 40, 250, 850); return [x, p]; },
    });
    vars.push({
      key: "maxDti", label: "سقف نسبت بدهی به درآمد", lowLabel: "−۱۰", highLabel: "+۱۰",
      apply: (c, p, d) => { const x = clone(c); x.risk.maxDti = clamp(x.risk.maxDti + d * 10, 10, 80); return [x, p]; },
    });
    vars.push({
      key: "pd", label: "شوک نکول (PD)", lowLabel: "−۳۰٪", highLabel: "+۳۰٪",
      apply: (c, p, d) => [c, { ...p, pdShock: 1 + d * 0.3 }],
    });
  }
  vars.push({
    key: "cof", label: "هزینه تأمین وجوه", lowLabel: "−۳ واحد", highLabel: "+۳ واحد",
    apply: (c, p, d) => { const x = clone(c); x.funding.costOfFunds = clamp(x.funding.costOfFunds + d * 3, 0, 60); return [x, p]; },
  });
  vars.push({
    key: "opex", label: "هزینه عملیاتی هر حساب", lowLabel: "−۳۰٪", highLabel: "+۳۰٪",
    apply: (c, p, d) => { const x = clone(c); x.funding.opexPerAccount *= 1 + d * 0.3; x.funding.acquisitionCost *= 1 + d * 0.3; return [x, p]; },
  });
  vars.push({
    key: "market", label: "نرخ مؤثر رقبا (بازار)", lowLabel: "−۳ واحد", highLabel: "+۳ واحد",
    apply: (c, p, d) => [c, { ...p, marketRate: p.marketRate + d * 3 }],
  });
  vars.push({
    key: "inflation", label: "تورم", lowLabel: "−۱۵ واحد", highLabel: "+۱۵ واحد",
    apply: (c, p, d) => [c, { ...p, inflation: Math.max(0, (p.inflation ?? SCENARIOS[p.scenario].inflation) + d * 15) }],
  });
  if (k === "points_loan") {
    vars.push({
      key: "coef", label: "ضریب تبدیل امتیاز", lowLabel: "−۰.۵", highLabel: "+۰.۵",
      apply: (c, p, d) => { const x = clone(c); x.points.coefficient = clamp(x.points.coefficient + d * 0.5, 0.5, 6); return [x, p]; },
    });
    vars.push({
      key: "usage", label: "نرخ استفاده از امتیاز", lowLabel: "−۱۵ واحد", highLabel: "+۱۵ واحد",
      apply: (c, p, d) => { const x = clone(c); x.points.usageRate = clamp(x.points.usageRate + d * 15, 5, 100); return [x, p]; },
    });
  }
  if (k === "loyalty" || cfg.family === "hybrid") {
    vars.push({
      key: "pointValue", label: "ارزش هر امتیاز", lowLabel: "−۳۰٪", highLabel: "+۳۰٪",
      apply: (c, p, d) => { const x = clone(c); x.loyalty.pointValue *= 1 + d * 0.3; return [x, p]; },
    });
    vars.push({
      key: "breakage", label: "نرخ سوخت امتیاز", lowLabel: "−۱۰ واحد", highLabel: "+۱۰ واحد",
      apply: (c, p, d) => { const x = clone(c); x.loyalty.breakage = clamp(x.loyalty.breakage + d * 10, 0, 90); return [x, p]; },
    });
    vars.push({
      key: "uplift", label: "افزایش گردش خرید", lowLabel: "−۵ واحد", highLabel: "+۵ واحد",
      apply: (c, p, d) => { const x = clone(c); x.loyalty.spendUplift = clamp(x.loyalty.spendUplift + d * 5, 0, 80); return [x, p]; },
    });
  }
  const items: TornadoItem[] = vars.map((v) => {
    const [lc, lp] = v.apply(cfg, fast, -1);
    const [hc, hp] = v.apply(cfg, fast, 1);
    const low = simulatePortfolio(lc, lp).kpis.netProfit;
    const high = simulatePortfolio(hc, hp).kpis.netProfit;
    const swing = Math.max(low, high, baseProfit) - Math.min(low, high, baseProfit);
    return {
      key: v.key,
      label: v.label,
      lowLabel: v.lowLabel,
      highLabel: v.highLabel,
      low,
      high,
      base: baseProfit,
      swing,
    };
  });
  return items.sort((a, b) => b.swing - a.swing);
}

// ======================= Smart optimizer =======================
type Val = number | string | boolean;
interface OptVar {
  key: string;
  label: string;
  type: "num" | "choice" | "bool";
  min?: number;
  max?: number;
  step?: number;
  choices?: string[];
  get: (c: ProductConfig) => Val;
  set: (c: ProductConfig, v: Val) => void;
  fmt: (v: Val) => string;
}

const pctFmt = (v: Val) => `${fa(Number(v))}٪`;
const numFmt = (v: Val) => fa(Number(v));
const boolFmt = (v: Val) => (v ? "فعال" : "غیرفعال");

function varsFor(cfg: ProductConfig): OptVar[] {
  const k = cfg.kind;
  const v: OptVar[] = [];
  const isCredit = k !== "points_loan" && k !== "loyalty";
  if (isCredit) {
    const qard = cfg.contract === "qard";
    v.push({ key: "rate", label: qard ? "کارمزد" : "نرخ سود", type: "num", min: qard ? 0 : 14, max: qard ? 4 : 23, step: 0.5, get: (c) => c.credit.rate, set: (c, x) => { c.credit.rate = Number(x); }, fmt: pctFmt });
    v.push({ key: "upfrontFee", label: "کارمزد تشکیل پرونده", type: "num", min: 0, max: 3, step: 0.25, get: (c) => c.credit.upfrontFee, set: (c, x) => { c.credit.upfrontFee = Number(x); }, fmt: pctFmt });
    v.push({ key: "minScore", label: "حد نصاب امتیاز", type: "num", min: 420, max: 720, step: 10, get: (c) => c.risk.minScore, set: (c, x) => { c.risk.minScore = Number(x); }, fmt: numFmt });
    v.push({ key: "maxDti", label: "سقف DTI", type: "num", min: 25, max: 50, step: 5, get: (c) => c.risk.maxDti, set: (c, x) => { c.risk.maxDti = Number(x); }, fmt: pctFmt });
    const tenorRange: [number, number, number] =
      k === "credit_card" ? [12, 36, 6] : k === "bnpl" ? [3, 12, 1] : k === "credit_line" ? [6, 24, 3] : [6, Math.max(60, cfg.credit.tenor), 6];
    v.push({ key: "tenor", label: "دوره بازپرداخت (ماه)", type: "num", min: tenorRange[0], max: tenorRange[1], step: tenorRange[2], get: (c) => c.credit.tenor, set: (c, x) => { c.credit.tenor = Number(x); }, fmt: numFmt });
    if (!["asset", "property", "salary", "gold", "deposit_lien"].includes(cfg.risk.collateral)) {
      v.push({ key: "collateral", label: "تضمین", type: "choice", choices: ["scoring", "e_promissory", "cheque", "guarantor"], get: (c) => c.risk.collateral, set: (c, x) => { c.risk.collateral = x as Collateral; }, fmt: (x) => COLLATERALS[x as Collateral]?.label ?? String(x) });
    }
    v.push({ key: "altData", label: "اعتبارسنجی با داده جایگزین", type: "bool", get: (c) => c.risk.altData, set: (c, x) => { c.risk.altData = Boolean(x); }, fmt: boolFmt });
    v.push({ key: "behavioral", label: "پایش رفتاری", type: "bool", get: (c) => c.risk.behavioral, set: (c, x) => { c.risk.behavioral = Boolean(x); }, fmt: boolFmt });
    v.push({ key: "channel", label: "کانال", type: "choice", choices: k === "bnpl" ? ["embedded", "digital", "omni"] : ["digital", "omni", "branch"], get: (c) => c.channel, set: (c, x) => { c.channel = x as Channel; }, fmt: (x) => CHANNELS[x as Channel]?.label ?? String(x) });
  }
  if (k === "points_loan") {
    v.push({ key: "coef", label: "ضریب تبدیل امتیاز", type: "num", min: 1.2, max: 3.6, step: 0.1, get: (c) => c.points.coefficient, set: (c, x) => { c.points.coefficient = Math.round(Number(x) * 10) / 10; }, fmt: numFmt });
    v.push({ key: "loanFee", label: "کارمزد وام", type: "num", min: 0, max: 4, step: 0.5, get: (c) => c.points.loanFee, set: (c, x) => { c.points.loanFee = Number(x); }, fmt: pctFmt });
    v.push({ key: "minHold", label: "حداقل دوره نگهداری (روز)", type: "num", min: 30, max: 180, step: 15, get: (c) => c.points.minHoldingDays, set: (c, x) => { c.points.minHoldingDays = Number(x); }, fmt: numFmt });
    v.push({ key: "maxLoan", label: "سقف وام امتیازی", type: "num", min: 100, max: 500, step: 50, get: (c) => c.points.maxLoan, set: (c, x) => { c.points.maxLoan = Number(x); }, fmt: numFmt });
    v.push({ key: "ptenor", label: "دوره بازپرداخت (ماه)", type: "num", min: 12, max: 60, step: 6, get: (c) => c.credit.tenor, set: (c, x) => { c.credit.tenor = Number(x); }, fmt: numFmt });
    v.push({ key: "pminScore", label: "حد نصاب امتیاز", type: "num", min: 400, max: 650, step: 10, get: (c) => c.risk.minScore, set: (c, x) => { c.risk.minScore = Number(x); }, fmt: numFmt });
    v.push({ key: "transfer", label: "انتقال امتیاز", type: "bool", get: (c) => c.points.transferable, set: (c, x) => { c.points.transferable = Boolean(x); }, fmt: boolFmt });
  }
  if (k === "loyalty" || cfg.family === "hybrid") {
    v.push({ key: "ppk", label: "امتیاز به ازای هر ۱۰۰ هزار تومان", type: "num", min: 2, max: 20, step: 1, get: (c) => c.loyalty.pointsPer100k, set: (c, x) => { c.loyalty.pointsPer100k = Number(x); }, fmt: numFmt });
    v.push({ key: "pv", label: "ارزش هر امتیاز (تومان)", type: "num", min: 10, max: 150, step: 5, get: (c) => c.loyalty.pointValue, set: (c, x) => { c.loyalty.pointValue = Number(x); }, fmt: numFmt });
    v.push({ key: "partner", label: "سهم شرکای تجاری", type: "num", min: 0, max: 60, step: 5, get: (c) => c.loyalty.partnerShare, set: (c, x) => { c.loyalty.partnerShare = Number(x); }, fmt: pctFmt });
    v.push({ key: "tiers", label: "سطوح عضویت", type: "bool", get: (c) => c.loyalty.tiers, set: (c, x) => { c.loyalty.tiers = Boolean(x); }, fmt: boolFmt });
    v.push({ key: "gamify", label: "گیمیفیکیشن", type: "bool", get: (c) => c.loyalty.gamification, set: (c, x) => { c.loyalty.gamification = Boolean(x); }, fmt: boolFmt });
  }
  return v;
}

function randomValue(v: OptVar, rng: Rng): Val {
  if (v.type === "bool") return rng() < 0.5;
  if (v.type === "choice") return (v.choices ?? [""])[Math.floor(rng() * (v.choices?.length ?? 1))];
  const steps = Math.round(((v.max ?? 1) - (v.min ?? 0)) / (v.step ?? 1));
  return (v.min ?? 0) + Math.floor(rng() * (steps + 1)) * (v.step ?? 1);
}

function neighborValue(v: OptVar, cur: Val, rng: Rng): Val {
  if (v.type === "bool") return !cur;
  if (v.type === "choice") {
    const others = (v.choices ?? []).filter((c) => c !== cur);
    return others.length ? others[Math.floor(rng() * others.length)] : cur;
  }
  const delta = (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 2)) * (v.step ?? 1);
  return clamp(Number(cur) + delta, v.min ?? -Infinity, v.max ?? Infinity);
}

interface Cand {
  cfg: ProductConfig;
  score: number;
  feasible: boolean;
  kpis: Kpis;
  x: number;
  y: number;
}

function evaluate(cfg: ProductConfig, params: SimParams, objective: Objective, result?: SimResult): Omit<Cand, "cfg"> {
  const sim = result ?? simulatePortfolio(cfg, params);
  const comp = checkCompliance(cfg);
  const kp = sim.kpis;
  let score: number;
  switch (objective) {
    case "profit":
      score = kp.netProfit;
      break;
    case "raroc":
      score = cfg.kind === "loyalty" ? kp.loyaltyRoi : kp.raroc;
      break;
    case "inclusion":
      score = kp.netProfit >= 0 ? ((kp.inclusion / 100) * kp.approved) / 1000 : -1e6 + kp.netProfit;
      break;
    default:
      score = computeHealth(cfg, sim, comp).score;
  }
  return { score, feasible: comp.fails === 0, kpis: kp, x: (cfg.kind === "loyalty" ? kp.booked : kp.approved) / 1000, y: kp.netProfit };
}

export function runOptimizer(cfg: ProductConfig, base: SimParams, objective: Objective): OptimizerResult {
  const params: SimParams = { ...resampleParams(base, 1200), runs: Math.min(base.runs, 3) };
  const rng = mulberry32(base.seed * 3 + 11);
  const vars = varsFor(cfg);
  const evals: Cand[] = [];
  const evalCfg = (c: ProductConfig): Cand => {
    const cand: Cand = { cfg: c, ...evaluate(c, params, objective) };
    evals.push(cand);
    return cand;
  };
  const cmp = (a: Cand, b: Cand) => (a.feasible !== b.feasible ? (a.feasible ? -1 : 1) : b.score - a.score);

  const baseline = evalCfg(clone(cfg));
  const pool: Cand[] = [baseline];
  for (let i = 0; i < 32; i++) {
    const c = clone(cfg);
    for (const v of vars) if (rng() < 0.7) v.set(c, randomValue(v, rng));
    pool.push(evalCfg(c));
  }
  for (let round = 0; round < 3; round++) {
    pool.sort(cmp);
    const elites = pool.slice(0, 3);
    for (const e of elites) {
      for (let j = 0; j < 5; j++) {
        const c = clone(e.cfg);
        const nMut = 1 + Math.floor(rng() * 2);
        for (let t = 0; t < nMut && vars.length; t++) {
          const v = vars[Math.floor(rng() * vars.length)];
          v.set(c, neighborValue(v, v.get(c), rng));
        }
        pool.push(evalCfg(c));
      }
    }
  }
  pool.sort(cmp);
  const best = pool[0];
  const finalParams: SimParams = { ...resampleParams(base, 3000), runs: Math.min(base.runs, 10) };
  const bestFull = simulatePortfolio(best.cfg, finalParams);
  const baseFull = simulatePortfolio(cfg, finalParams);
  const changes = vars
    .filter((v) => String(v.get(cfg)) !== String(v.get(best.cfg)))
    .map((v) => ({ label: v.label, from: v.fmt(v.get(cfg)), to: v.fmt(v.get(best.cfg)) }));
  const points: OptimizerPoint[] = evals.map((e) => ({ x: e.x, y: e.y, score: e.score, feasible: e.feasible, front: false }));
  for (const p of points) {
    if (!p.feasible) continue;
    p.front = !points.some((q) => q !== p && q.feasible && q.x >= p.x && q.y >= p.y && (q.x > p.x || q.y > p.y));
  }
  return {
    objective,
    evaluations: evals.length,
    baseline: { score: evaluate(cfg, finalParams, objective, baseFull).score, kpis: baseFull.kpis },
    best: { score: evaluate(best.cfg, finalParams, objective, bestFull).score, kpis: bestFull.kpis, config: best.cfg },
    changes,
    points,
    xLabel: cfg.kind === "loyalty" ? "اعضای جذب‌شده (هزار نفر)" : "مشتریان تأییدشده (هزار نفر)",
    yLabel: "سود خالص (میلیارد تومان)",
  };
}
