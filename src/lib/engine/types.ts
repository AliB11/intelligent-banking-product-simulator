// ===== Core domain types for the Simorgh banking product simulator =====

export type Family = "credit" | "points" | "hybrid";
export type Kind = "installment" | "credit_card" | "bnpl" | "credit_line" | "points_loan" | "loyalty";
export type Contract =
  | "qard"
  | "murabaha"
  | "installment_sale"
  | "ijara"
  | "joaleh"
  | "musharaka"
  | "mudaraba"
  | "salaf"
  | "istisna";
export type Repayment = "annuity" | "equal_principal" | "step_up" | "balloon" | "bullet" | "seasonal";
export type Collateral =
  | "scoring"
  | "e_promissory"
  | "cheque"
  | "guarantor"
  | "salary"
  | "deposit_lien"
  | "property"
  | "shares"
  | "asset"
  | "gold";
export type Segment = "mass" | "salaried" | "youth" | "newlywed" | "sme" | "freelancer" | "retiree" | "affluent";
export type Channel = "digital" | "branch" | "omni" | "embedded";
export type Purpose =
  | "goods"
  | "service"
  | "cash"
  | "housing"
  | "vehicle"
  | "working_capital"
  | "education"
  | "medical";
export type ScenarioId =
  | "base"
  | "stagflation"
  | "recession"
  | "boom"
  | "fx_shock"
  | "liquidity_crunch"
  | "disinflation";
export type Objective = "profit" | "raroc" | "inclusion" | "balanced";

export interface CreditConfig {
  rate: number; // annual nominal % (for qard = fee %)
  upfrontFee: number; // % of principal (file / origination fee)
  annualFee: number; // % of limit per year (cards & lines)
  insurance: number; // % of principal per year (customer cost)
  compensatingDeposit: number; // % blocked deposit (prohibited)
  minAmount: number; // million toman
  maxAmount: number; // million toman
  tenor: number; // months
  grace: number; // months (interest-only)
  repayment: Repayment;
  stepUp: number; // % yearly installment growth (step_up)
  balloon: number; // % of principal paid at maturity (balloon)
  downPayment: number; // % paid by customer upfront
  merchantFee: number; // % merchant discount rate
  interestFreeDays: number; // card / BNPL free period
  revolvingShare: number; // % of card users who revolve
  utilization: number; // % average utilization of limit
  prepayDiscount: number; // % discount on embedded profit for early repayment
  latePenaltySpread: number; // % above contract rate (max 6)
}

export interface RiskConfig {
  minScore: number; // 0..900 (ICS24 scale)
  maxDti: number; // % of income
  collateral: Collateral;
  coverage: number; // collateral coverage %
  guarantors: number;
  maxAge: number; // max age at maturity
  altData: boolean; // alternative-data / AI scoring
  behavioral: boolean; // behavioral early-warning
  collectionsIntensity: number; // 0..100
}

export interface FundingConfig {
  costOfFunds: number; // % annual (FTP)
  opexPerAccount: number; // thousand toman per account-month
  acquisitionCost: number; // thousand toman per new account
  riskWeight: number; // % (regulatory)
  targetCar: number; // % capital adequacy
  targetRoe: number; // % hurdle rate on capital
  taxRate: number; // %
  reserveRatio: number; // % legal reserve on deposits
}

export interface PointsConfig {
  coefficient: number; // k in L = k × B × H / N
  minHoldingDays: number;
  depositRate: number; // % paid on points account
  loanFee: number; // % qard fee (max 4)
  maxLoan: number; // million toman
  transferable: boolean;
  expiryMonths: number; // 0 = never
  usageRate: number; // % of eligible depositors who use their points
}

export interface LoyaltyConfig {
  pointsPer100k: number; // points per 100,000 toman spend
  pointValue: number; // toman per point at redemption
  breakage: number; // % never redeemed
  expiryMonths: number; // 0 = never
  tiers: boolean;
  partnerShare: number; // % of reward cost paid by partners
  spendUplift: number; // % spend uplift
  balanceUplift: number; // % deposit-balance uplift
  churnReduction: number; // % relative churn reduction
  gamification: boolean;
}

export interface ProductConfig {
  name: string;
  code: string;
  tagline: string;
  emoji: string;
  color: string;
  family: Family;
  kind: Kind;
  contract: Contract;
  purpose: Purpose;
  segment: Segment;
  channel: Channel;
  description: string;
  credit: CreditConfig;
  risk: RiskConfig;
  funding: FundingConfig;
  points: PointsConfig;
  loyalty: LoyaltyConfig;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface MacroScenario {
  id: ScenarioId;
  label: string;
  description: string;
  inflation: number;
  pdMultiplier: number;
  lgdShift: number;
  demandMultiplier: number;
  fundingShift: number;
  incomeGrowth: number;
  depositShift: number;
  spendShift: number;
  color: string;
}

export interface SimParams {
  customers: number;
  runs: number;
  seed: number;
  scenario: ScenarioId;
  horizon: number;
  marketRate: number;
  scale: number;
  inflation?: number;
  pdShock?: number;
}

export interface MonthPoint {
  m: number;
  outstanding: number;
  interest: number;
  fees: number;
  funding: number;
  opex: number;
  losses: number;
  benefit: number;
  reward: number;
  incremental: number;
  profit: number;
  cumProfit: number;
  realCumProfit: number;
  npl: number;
  active: number;
  deposits: number;
  liability: number;
}

export interface Kpis {
  market: number;
  applicants: number;
  approved: number;
  approvalRate: number;
  takeUpRate: number;
  booked: number;
  volume: number;
  avgTicket: number;
  avgInstallment: number;
  avgScoreApproved: number;
  avgPd: number;
  avgLgd: number;
  cumDefaultRate: number;
  nplEnd: number;
  lossRate: number;
  interestIncome: number;
  feeIncome: number;
  fundingCost: number;
  opex: number;
  creditLosses: number;
  preTaxProfit: number;
  netProfit: number;
  avgOutstanding: number;
  roa: number;
  raroc: number;
  economicCapital: number;
  regulatoryCapital: number;
  nim: number;
  apr: number;
  npv: number;
  realYield: number;
  realProfit: number;
  inclusion: number;
  fairnessGap: number;
  customerBurden: number;
  depositsAvg: number;
  fundingBenefit: number;
  sourceUseRatio: number;
  moneyTimeRatio: number;
  avgWaitDays: number;
  pointsIssued: number;
  rewardCost: number;
  incrementalRevenue: number;
  loyaltyRoi: number;
  pointsLiabilityEnd: number;
  inflation: number;
}

export interface Distribution {
  bins: { x: number; label: string; count: number }[];
  p5: number;
  p50: number;
  p95: number;
  mean: number;
  probLoss: number;
  var95: number;
}

export interface SegmentStat {
  key: string;
  label: string;
  applicants: number;
  approved: number;
  approvalRate: number;
  avgPd: number;
  volume: number;
}

export interface PricingBreakdown {
  cof: number;
  el: number;
  opex: number;
  fees: number;
  benefit: number;
  reward: number;
  capital: number;
  breakEven: number;
  riskBased: number;
  productRate: number;
  cap: number;
}

export interface PricingRow {
  band: string;
  pd: number;
  lgd: number;
  el: number;
  capital: number;
  required: number;
  status: "ok" | "above_rate" | "above_cap";
  share: number;
}

export interface SimResult {
  kpis: Kpis;
  series: MonthPoint[];
  profitDist: Distribution;
  scoreBands: { band: string; applied: number; approved: number; defaulted: number }[];
  segments: SegmentStat[];
  quintiles: SegmentStat[];
  vintage: { m: number; cum: number }[];
  funnel: { stage: string; value: number }[];
  waterfall: { label: string; value: number }[];
  pricing: PricingBreakdown;
  pricingGrid: PricingRow[];
  params: SimParams;
  durationMs: number;
}

export interface Insight {
  id: string;
  level: "critical" | "warning" | "opportunity" | "positive";
  title: string;
  body: string;
  impact?: string;
  action?: { label: string; patch: DeepPartial<ProductConfig> };
}

export interface ComplianceItem {
  id: string;
  level: "pass" | "warn" | "fail" | "info";
  title: string;
  detail: string;
  ref: string;
}

export interface ComplianceReport {
  score: number;
  fails: number;
  warns: number;
  items: ComplianceItem[];
}

export interface HealthPart {
  key: string;
  label: string;
  value: number;
  weight: number;
}

export interface Health {
  score: number;
  grade: string;
  label: string;
  parts: HealthPart[];
}

export interface DnaAxis {
  axis: string;
  value: number;
}

export interface FullResult {
  sim: SimResult;
  insights: Insight[];
  health: Health;
  compliance: ComplianceReport;
  dna: DnaAxis[];
}

export interface StressRow {
  id: ScenarioId;
  label: string;
  color: string;
  inflation: number;
  netProfit: number;
  realProfit: number;
  nplEnd: number;
  raroc: number;
  cumDefaultRate: number;
  probLoss: number;
  approvalRate: number;
  volume: number;
}

export interface TornadoItem {
  key: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  low: number;
  high: number;
  base: number;
}

export interface OptimizerPoint {
  x: number;
  y: number;
  score: number;
  feasible: boolean;
  front: boolean;
}

export interface OptimizerResult {
  objective: Objective;
  evaluations: number;
  baseline: { score: number; kpis: Kpis };
  best: { score: number; kpis: Kpis; config: ProductConfig };
  changes: { label: string; from: string; to: string }[];
  points: OptimizerPoint[];
  xLabel: string;
  yLabel: string;
}
