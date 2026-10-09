import { clamp, lognormal, mulberry32, normal, sigmoid, type Rng } from "./math";

export type Employment = "gov" | "private" | "self" | "retired" | "student" | "unemployed";
export type Region = "tehran" | "metro" | "city" | "rural";

export interface Customer {
  id: number;
  name?: string;
  age: number;
  employment: Employment;
  region: Region;
  married: boolean;
  income: number; // million toman / month
  existingDebt: number; // million toman / month (current installments)
  latent: number; // hidden true risk factor (N(0,1))
  scoreTrue: number; // "true" creditworthiness on 0..900 scale
  scoreNoise: number; // bureau measurement noise
  thinFile: boolean; // no / short credit history
  hasProperty: boolean;
  propertyValue: number; // million toman
  guarantorProb: number;
  hasCheque: boolean;
  sharesValue: number;
  goldValue: number;
  balance: number; // average deposit balance (million toman)
  monthlySpend: number; // card spend (million toman / month)
  digital: number; // 0..1 digital affinity
  needFactor: number;
  priceSens: number; // 0..1
  patience: number; // months willing to wait to accumulate points
  u: number[]; // pre-drawn uniforms (common random numbers)
}

const EMP_DIST: [Employment, number][] = [
  ["gov", 0.16],
  ["private", 0.3],
  ["self", 0.24],
  ["retired", 0.12],
  ["student", 0.08],
  ["unemployed", 0.1],
];
const REGION_DIST: [Region, number][] = [
  ["tehran", 0.22],
  ["metro", 0.28],
  ["city", 0.35],
  ["rural", 0.15],
];
const INCOME_MEDIAN: Record<Employment, number> = { gov: 28, private: 24, self: 30, retired: 18, student: 6, unemployed: 5 };
const REGION_INC: Record<Region, number> = { tehran: 1.3, metro: 1.05, city: 0.9, rural: 0.72 };
export const GUARANTOR_PROB: Record<Employment, number> = {
  gov: 0.72,
  private: 0.6,
  self: 0.5,
  retired: 0.58,
  student: 0.3,
  unemployed: 0.18,
};

function pick<T>(rng: Rng, dist: [T, number][]): T {
  let u = rng();
  for (const [v, p] of dist) {
    if (u < p) return v;
    u -= p;
  }
  return dist[dist.length - 1][0];
}

export function scoreFromLatent(latent: number, income: number, age: number): number {
  return clamp(650 - 82 * latent + 18 * Math.log(Math.max(1, income) / 25) + Math.min(Math.max(age - 22, 0), 20) * 1.2, 250, 900);
}

const cache = new Map<string, Customer[]>();

export function generatePopulation(n: number, seed: number): Customer[] {
  const key = `${n}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = mulberry32(seed * 31 + 7);
  const out: Customer[] = [];
  for (let i = 0; i < n; i++) {
    const employment = pick(rng, EMP_DIST);
    const region = pick(rng, REGION_DIST);
    let age: number;
    if (employment === "student") age = 18 + Math.floor(rng() * 9);
    else if (employment === "retired") age = 55 + Math.floor(rng() * 21);
    else age = 22 + Math.floor(Math.pow(rng(), 1.15) * 40);
    const sigma = employment === "self" ? 0.8 : 0.55;
    const ageBoost = 1 + clamp((age - 25) * 0.012, -0.1, 0.35);
    const income = clamp(lognormal(rng, INCOME_MEDIAN[employment] * REGION_INC[region] * ageBoost, sigma), 2, 600);
    const existingDebt = rng() < 0.45 ? income * (0.05 + rng() * 0.3) : 0;
    const thinP =
      0.1 + (employment === "student" ? 0.5 : 0) + (employment === "unemployed" ? 0.25 : 0) + (age < 25 ? 0.2 : 0);
    const thinFile = rng() < clamp(thinP, 0, 0.9);
    const latent = normal(rng) + (age < 25 ? 0.15 : 0);
    const scoreTrue = scoreFromLatent(latent, income, age);
    const scoreNoise = normal(rng);
    const propP = sigmoid(-2.0 + 0.05 * (age - 30) + 0.9 * Math.log(income / 25) - (region === "tehran" ? 0.4 : 0));
    const hasProperty = rng() < propP;
    const propertyValue = hasProperty
      ? lognormal(rng, region === "tehran" ? 9000 : region === "metro" ? 5000 : 2500, 0.5)
      : 0;
    const chequeP = employment === "student" || employment === "unemployed" ? 0.3 : 0.75;
    const hasCheque = rng() < chequeP && scoreTrue > 470;
    const sharesValue = rng() < 0.6 ? lognormal(rng, 45, 0.7) : 0;
    const goldValue = rng() < 0.32 ? lognormal(rng, 90, 0.8) : 0;
    const balance = rng() < 0.12 ? rng() * 2 : lognormal(rng, income * 1.5 * (age > 40 ? 1.4 : 1), 1.0);
    const monthlySpend = income * (0.35 + rng() * 0.45);
    const digital = clamp(
      sigmoid(2.0 - 0.075 * (age - 25) + (region === "tehran" || region === "metro" ? 0.5 : -0.3) + normal(rng) * 0.6),
      0.02,
      0.99,
    );
    const needFactor = lognormal(rng, 1, 0.5);
    const priceSens = clamp(0.25 + 0.6 * Math.pow(rng(), 0.8) + (income < 15 ? 0.15 : 0), 0.1, 1);
    const patience = 2 + rng() * 10;
    const married = age > 26 ? rng() < 0.68 : rng() < 0.2;
    const u = [rng(), rng(), rng(), rng(), rng(), rng(), rng(), rng()];
    out.push({
      id: i,
      age,
      employment,
      region,
      married,
      income,
      existingDebt,
      latent,
      scoreTrue,
      scoreNoise,
      thinFile,
      hasProperty,
      propertyValue,
      guarantorProb: GUARANTOR_PROB[employment],
      hasCheque,
      sharesValue,
      goldValue,
      balance,
      monthlySpend,
      digital,
      needFactor,
      priceSens,
      patience,
      u,
    });
  }
  if (cache.size > 12) cache.clear();
  cache.set(key, out);
  return out;
}

// ---------- Personas (customer journey simulator) ----------
export interface PersonaInput {
  name: string;
  avatar: string;
  story: string;
  age: number;
  employment: Employment;
  region: Region;
  income: number;
  existingDebt: number;
  score: number;
  thinFile: boolean;
  balance: number;
  monthlySpend: number;
  hasProperty: boolean;
  hasCheque: boolean;
  hasGuarantor: boolean;
  digital: number;
  need: number;
}

export const PERSONAS: PersonaInput[] = [
  { name: "سارا", avatar: "👩‍💻", story: "۲۸ ساله، برنامه‌نویس شرکت خصوصی در تهران، دیجیتال‌محور", age: 28, employment: "private", region: "tehran", income: 38, existingDebt: 0, score: 690, thinFile: false, balance: 90, monthlySpend: 18, hasProperty: false, hasCheque: true, hasGuarantor: true, digital: 0.95, need: 150 },
  { name: "رضا", avatar: "👨‍🏫", story: "۴۱ ساله، معلم رسمی در اصفهان، صاحب خانه", age: 41, employment: "gov", region: "metro", income: 30, existingDebt: 6, score: 645, thinFile: false, balance: 60, monthlySpend: 14, hasProperty: true, hasCheque: true, hasGuarantor: true, digital: 0.6, need: 250 },
  { name: "مریم", avatar: "👩‍🎓", story: "۲۳ ساله، دانشجوی کارشناسی ارشد، بدون سابقه اعتباری", age: 23, employment: "student", region: "city", income: 8, existingDebt: 0, score: 545, thinFile: true, balance: 12, monthlySpend: 5, hasProperty: false, hasCheque: false, hasGuarantor: false, digital: 0.92, need: 40 },
  { name: "حسین", avatar: "🧑‍🔧", story: "۳۶ ساله، صاحب کارگاه تولیدی کوچک در مشهد", age: 36, employment: "self", region: "metro", income: 75, existingDebt: 18, score: 600, thinFile: false, balance: 220, monthlySpend: 30, hasProperty: true, hasCheque: true, hasGuarantor: false, digital: 0.55, need: 900 },
  { name: "پروین", avatar: "👵", story: "۶۳ ساله، بازنشسته آموزش‌وپرورش با سپرده قابل‌توجه", age: 63, employment: "retired", region: "city", income: 19, existingDebt: 0, score: 720, thinFile: false, balance: 350, monthlySpend: 8, hasProperty: true, hasCheque: true, hasGuarantor: true, digital: 0.2, need: 120 },
  { name: "علی", avatar: "🧑‍🌾", story: "۳۰ ساله، کشاورز و فریلنسر در روستا با درآمد نامنظم", age: 30, employment: "self", region: "rural", income: 14, existingDebt: 3, score: 505, thinFile: false, balance: 20, monthlySpend: 6, hasProperty: false, hasCheque: false, hasGuarantor: true, digital: 0.4, need: 80 },
];

export function personaToCustomer(p: PersonaInput): Customer {
  // invert score model to recover the latent risk factor
  const base = 650 + 18 * Math.log(Math.max(1, p.income) / 25) + Math.min(Math.max(p.age - 22, 0), 20) * 1.2;
  const latent = clamp((base - p.score) / 82, -3, 3);
  return {
    id: -1,
    name: p.name,
    age: p.age,
    employment: p.employment,
    region: p.region,
    married: p.age > 26,
    income: Math.max(1, p.income),
    existingDebt: Math.max(0, p.existingDebt),
    latent,
    scoreTrue: p.score,
    scoreNoise: 0,
    thinFile: p.thinFile,
    hasProperty: p.hasProperty,
    propertyValue: p.hasProperty ? 4000 : 0,
    guarantorProb: p.hasGuarantor ? 1 : 0,
    hasCheque: p.hasCheque,
    sharesValue: 45,
    goldValue: 0,
    balance: Math.max(0, p.balance),
    monthlySpend: Math.max(0, p.monthlySpend),
    digital: clamp(p.digital, 0, 1),
    needFactor: 1,
    priceSens: 0.6,
    patience: 8,
    u: [0.01, 0.5, p.hasGuarantor ? 0 : 1, 0.4, 0.3, 0.5, 0.5, 0.5],
  };
}
