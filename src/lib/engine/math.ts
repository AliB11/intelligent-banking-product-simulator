import type { ProductConfig, Repayment, TieredMurabahaTier } from "./types";

// ---------- Random ----------
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function lognormal(rng: Rng, median: number, sigma: number): number {
  return median * Math.exp(sigma * normal(rng));
}

// ---------- Basic helpers ----------
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
export const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);
export const mean = (a: number[]): number => (a.length ? sum(a) / a.length : 0);
export const zeros = (n: number): number[] => new Array(n).fill(0);

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ---------- Normal distribution ----------
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ---------- Credit risk models ----------
/** Basel II/III IRB capital requirement K for retail exposures (fraction of EAD). */
export function irbRetailK(pd: number, lgd: number, type: "other" | "qrre" | "mortgage" = "other"): number {
  const PD = clamp(pd, 0.0003, 0.9999);
  let R: number;
  if (type === "qrre") R = 0.04;
  else if (type === "mortgage") R = 0.15;
  else {
    const f = (1 - Math.exp(-35 * PD)) / (1 - Math.exp(-35));
    R = 0.03 * f + 0.16 * (1 - f);
  }
  const k = lgd * normCdf((normInv(PD) + Math.sqrt(R) * normInv(0.999)) / Math.sqrt(1 - R)) - PD * lgd;
  return Math.max(0, k);
}

/** Vasicek single-factor conditional PD given systematic factor z (z>0 = bad state). */
export function vasicekPd(pd: number, z: number, rho: number): number {
  return normCdf((normInv(clamp(pd, 1e-5, 0.9999)) + Math.sqrt(rho) * z) / Math.sqrt(1 - rho));
}

/** Seasoning curve — default intensity by month-on-book (peaks around months 6–15). */
const SEASON_CACHE: number[] = [];
export function seasoning(mob: number): number {
  if (mob < 512) {
    const hit = SEASON_CACHE[mob];
    if (hit !== undefined) return hit;
  }
  const v = 0.45 + 1.1 * (1 - Math.exp(-mob / 4)) * Math.exp(-mob / 40);
  if (mob < 512) SEASON_CACHE[mob] = v;
  return v;
}

// ---------- Bass diffusion (adoption timing) ----------
export function bassCdf(t: number, p: number, q: number): number {
  const e = Math.exp(-(p + q) * t);
  return (1 - e) / (1 + (q / p) * e);
}

export function sampleBass(u: number, p: number, q: number, T: number): number {
  const U = u * bassCdf(T, p, q);
  const E = (1 - U) / (1 + (U * q) / p);
  return Math.min(T - 1e-9, Math.max(0, -Math.log(E) / (p + q)));
}

// ---------- Amortization ----------
export interface Schedule {
  pay: number[];
  int: number[];
  prin: number[];
  bal: number[];
  months: number;
  installment: number;
  total: number;
}

export function buildSchedule(
  P: number,
  annualRate: number,
  tenor: number,
  grace: number,
  method: Repayment,
  stepUp = 0,
  balloonPct = 0,
): Schedule {
  const r = Math.max(0, annualRate) / 1200;
  const n = Math.max(1, Math.round(tenor));
  const g = Math.max(0, Math.round(grace));
  const pay: number[] = [];
  const int: number[] = [];
  const prin: number[] = [];
  const bal: number[] = [];
  let b = P;
  for (let i = 0; i < g; i++) {
    const it = b * r;
    pay.push(it);
    int.push(it);
    prin.push(0);
    bal.push(b);
  }
  let installment = 0;
  const push = (it: number, pr: number) => {
    b -= pr;
    pay.push(it + pr);
    int.push(it);
    prin.push(pr);
    bal.push(Math.max(0, b));
  };
  if (method === "equal_principal") {
    const pp = P / n;
    for (let i = 0; i < n; i++) {
      const it = b * r;
      const pr = i === n - 1 ? b : Math.min(pp, b);
      if (i === 0) installment = it + pr;
      push(it, pr);
    }
  } else if (method === "bullet") {
    installment = P * r + (n === 1 ? P : 0);
    for (let i = 0; i < n; i++) push(b * r, i === n - 1 ? b : 0);
  } else if (method === "seasonal") {
    // Equal quarterly payments, with a final short period at contractual maturity.
    const dates = Array.from({ length: Math.ceil(n / 3) }, (_, i) => Math.min(n, (i + 1) * 3));
    const A = P / dates.reduce((pv, m) => pv + Math.pow(1 + r, -m), 0);
    installment = A / Math.min(3, n);
    let accrued = 0;
    for (let m = 1; m <= n; m++) {
      const it = b * r;
      accrued += it;
      b += it;
      const payment = dates.includes(m) ? (m === n ? b : Math.min(A, b)) : 0;
      b -= payment;
      pay.push(payment);
      int.push(payment ? accrued : 0);
      prin.push(payment ? payment - accrued : 0);
      if (payment) accrued = 0;
      bal.push(Math.max(0, b));
    }
  } else if (method === "step_up") {
    const s = Math.max(0, stepUp) / 100;
    let pv = 0;
    for (let i = 0; i < n; i++) pv += Math.pow(1 + s, Math.floor(i / 12)) / Math.pow(1 + r, i + 1);
    const base = P / pv;
    installment = base;
    for (let i = 0; i < n; i++) {
      const amt = base * Math.pow(1 + s, Math.floor(i / 12));
      const it = b * r;
      push(it, i === n - 1 ? b : amt - it);
    }
  } else if (method === "balloon") {
    const B = (P * clamp(balloonPct, 0, 90)) / 100;
    const A = r === 0 ? (P - B) / n : ((P - B / Math.pow(1 + r, n)) * r) / (1 - Math.pow(1 + r, -n));
    installment = A;
    for (let i = 0; i < n; i++) {
      const it = b * r;
      push(it, i === n - 1 ? b : A - it);
    }
  } else {
    const A = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n));
    installment = A;
    for (let i = 0; i < n; i++) {
      const it = b * r;
      push(it, i === n - 1 ? b : A - it);
    }
  }
  return { pay, int, prin, bal, months: pay.length, installment, total: sum(pay) };
}

// ---------- IRR / APR / NPV ----------
export function irr(cfs: number[]): number {
  const f = (r: number) => {
    let v = 0;
    for (let t = 0; t < cfs.length; t++) v += cfs[t] / Math.pow(1 + r, t);
    return v;
  };
  let lo = -0.9;
  let hi = 1.5;
  let flo = f(lo);
  const fhi = f(hi);
  if (flo * fhi > 0) return 0;
  for (let i = 0; i < 90; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm * flo <= 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

export function npv(monthlyRate: number, cfs: number[]): number {
  let v = 0;
  for (let t = 0; t < cfs.length; t++) v += cfs[t] / Math.pow(1 + monthlyRate, t + 1);
  return v;
}

export function effectiveApr(
  P: number,
  rate: number,
  tenor: number,
  grace: number,
  method: Repayment,
  stepUp: number,
  balloon: number,
  upfrontFee: number,
  insurance: number,
  cdPct: number,
): number {
  const s = buildSchedule(P, rate, tenor, grace, method, stepUp, balloon);
  const cfs = [P * (1 - upfrontFee / 100) - (P * cdPct) / 100];
  for (let m = 0; m < s.months; m++) cfs.push(-(s.pay[m] + (P * insurance) / 1200));
  cfs[cfs.length - 1] += (P * cdPct) / 100;
  const r = irr(cfs);
  return (Math.pow(1 + r, 12) - 1) * 100;
}

/** True when a points product uses the multi-tier (Negin-style) murabaha menu. */
export function isTieredPoints(cfg: ProductConfig): boolean {
  return cfg.kind === "points_loan" && cfg.points.mode === "tiered_murabaha" && cfg.points.tiers.length > 0;
}

/**
 * Contract-aware price of a simple points loan: a qard loan charges the qard fee (≤ 4%),
 * an exchange contract (e.g. murabaha) charges the credit profit rate.
 */
export function pointsLoanRate(cfg: ProductConfig): number {
  return cfg.contract === "qard" ? cfg.points.loanFee : cfg.credit.rate;
}

/** Upfront fee applied to a points loan (qard loans are priced through the fee rate only). */
export function pointsUpfrontFee(cfg: ProductConfig): number {
  return cfg.contract === "qard" ? 0 : cfg.credit.upfrontFee;
}

/** Normalised selection weights of the tiers (falls back to equal weights). */
export function tierWeights(tiers: TieredMurabahaTier[]): number[] {
  const w = tiers.map((t) => Math.max(0, t.expectedTakeUpShare));
  const s = sum(w);
  return s > 0 ? w.map((x) => x / s) : tiers.map(() => 1 / Math.max(1, tiers.length));
}

/** Effective annual cost to the customer for a representative contract. */
export function aprFor(cfg: ProductConfig): number {
  const cr = cfg.credit;
  if (cfg.kind === "loyalty") return 0;
  if (cfg.kind === "points_loan") {
    const fee = pointsUpfrontFee(cfg);
    if (isTieredPoints(cfg)) {
      const w = tierWeights(cfg.points.tiers);
      return cfg.points.tiers.reduce(
        (s, t, i) => s + w[i] * effectiveApr(100, t.rate, Math.max(1, Math.round(t.repaymentMonths)), 0, "annuity", 0, 0, fee, cr.insurance, 0),
        0,
      );
    }
    return effectiveApr(100, pointsLoanRate(cfg), cr.tenor, 0, "annuity", 0, 0, fee, cr.insurance, 0);
  }
  if (cfg.kind === "credit_card" || cfg.kind === "credit_line") {
    const eff = (Math.pow(1 + cr.rate / 1200, 12) - 1) * 100;
    const util = Math.max(0.1, cr.utilization / 100);
    return eff + cr.annualFee / util + cr.upfrontFee / Math.max(1, cr.tenor / 12) + cr.insurance;
  }
  return effectiveApr(
    100,
    cr.rate,
    cr.tenor,
    cr.grace,
    cr.repayment,
    cr.stepUp,
    cr.balloon,
    cr.upfrontFee,
    cr.insurance,
    cr.compensatingDeposit,
  );
}

/** Points-based (money–time) loan limit: L = k × B × H / N */
export function pointsLoanLimit(balance: number, holdingMonths: number, tenor: number, k: number): number {
  return (k * balance * holdingMonths) / Math.max(1, tenor);
}

export function holdingNeeded(amount: number, tenor: number, balance: number, k: number): number {
  if (balance <= 0 || k <= 0) return Infinity;
  return (amount * tenor) / (k * balance);
}
