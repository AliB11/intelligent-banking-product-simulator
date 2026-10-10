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

export type PointsProductMode = "simple" | "tiered_murabaha";

/**
 * TieredMurabahaTier — یک پله (حالت) از محصول امتیازی چندپله‌ای مرابحه‌ای
 * مشابه «نگین فراپویا» و مدل ALM
 */
export interface TieredMurabahaTier {
  id?: string;
  /** نام پله (حالت اول، دوم، ...) */
  name: string;
  /** دوره انتظار/ماندگاری سپرده (ماه) */
  waitingMonths: number;
  /** دوره بازپرداخت تسهیلات (ماه) */
  repaymentMonths: number;
  /** ضریب تسهیلات به میانگین سپرده (درصد، مثلاً ۲۵ یعنی ۲۵٪) */
  loanToAvgDepositPct: number;
  /** نرخ سود مرابحه این پله (درصد سالانه) */
  rate: number;
  /** حداقل میانگین سپرده لازم (میلیون تومان) */
  minAvgDeposit: number;
  /** سهم پیش‌بینی‌شده از مشتریانی که این پله را انتخاب می‌کنند (درصد، مجموع ~۱۰۰) */
  expectedTakeUpShare: number;
}

export interface MenuBenefitOption {
  /** تعداد ماه انتظار لازم برای باز شدن این آپشن */
  extraWaitMonths: number;
  /** عنوان فارسی مزیت */
  label: string;
  /** نوع مزیت: افزایش مبلغ، افزایش اقساط، کاهش سود */
  type: "amount_boost" | "tenor_boost" | "rate_cut";
  /** مقدار اعمال‌شده (در واحد مربوط) */
  value: number;
  /** آیا در سقف خود قرار دارد؟ */
  atCap?: boolean;
}

export interface NeginCustomerOption {
  /** شناسه ترکیب */
  comboId: string;
  /** مبلغ وام (میلیون تومان) */
  loanAmount: number;
  /** دوره بازپرداخت (ماه) */
  tenor: number;
  /** نرخ سود سالانه (%) */
  rate: number;
  /** ضریب α (%) */
  alpha: number;
  /** دوره انتظار لازم (ماه) */
  waitingMonths: number;
  /** قسط ماهانه (میلیون تومان) */
  monthlyInstallment: number;
  /** کل بازپرداخت */
  totalRepayment: number;
  /** هزینه فرصت سپرده‌گذاری (میلیون تومان، با نرخ فرصت) */
  opportunityCost: number;
  /** کل هزینه مؤثر برای مشتری (کل بازپرداخت + هزینه فرصت - سود سپرده) */
  effectiveCustomerCost: number;
  /** بازده مؤثر سالانه بانک (IRR) با احتساب ارزش منابع ارزان دوره انتظار و زیان مورد انتظار */
  bankEffectiveYield: number;
  /** امتیاز مطلوبیت مشتری (۰ تا ۱۰۰) */
  customerUtility: number;
  /** آیا این ترکیب روی مرز پارتو است؟ */
  paretoOptimal: boolean;
}

export interface PointsConfig {
  coefficient: number; // k in L = k × B × H / N (مدل ساده)
  minHoldingDays: number;
  depositRate: number; // % paid on points account
  loanFee: number; // % qard fee (max 4)
  maxLoan: number; // million toman
  transferable: boolean;
  expiryMonths: number; // 0 = never
  usageRate: number; // % of eligible depositors who use their points
  // === افزوده‌های جدید برای محصولات چندپله‌ای ===
  mode: PointsProductMode;
  tiers: TieredMurabahaTier[];
  /** سقف فردی تسهیلات (میلیون تومان) */
  individualLoanCap: number;
  /** حداقل افتتاح حساب (میلیون تومان) */
  minOpeningDeposit: number;
  /** گام افزایش ضریب α به ازای هر ماه انتظار (درصد) */
  alphaStepPerWaitMonth: number;
  /** گام افزایش دوره بازپرداخت به ازای هر ماه انتظار (ماه) */
  tenorStepPerWaitMonth: number;
  /** گام کاهش نرخ به ازای هر ماه انتظار (درصد) */
  rateCutPerWaitMonth: number;
  /** حداکثر افزایش مبلغ (تعداد ماه قابل تخصیص به افزایش مبلغ) */
  maxAmountBoostMonths: number;
  /** حداکثر افزایش اقساط (تعداد ماه قابل تخصیص به اقساط) */
  maxTenorBoostMonths: number;
  /** حداکثر کاهش نرخ (تعداد ماه قابل تخصیص به کاهش سود) */
  maxRateCutMonths: number;
  /** امکان انتخاب ترکیب (چند ماه به افزایش مبلغ، چند به اقساط، چند به کاهش سود) */
  allowCombinedBenefits: boolean;
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
  // === ماژول‌های خلاقانه جدید ===
  prepayment?: PrepaymentModel;
  gamification?: GamificationConfig;
  antiNegin?: AntiNeginConfig;
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
  /** null when no outstanding credit provides a meaningful denominator; not applicable to loyalty. */
  roa: number | null;
  /** null when modeled credit capital is zero; not applicable to loyalty. */
  raroc: number | null;
  /** RAROC excluding the deposit-franchise (FTP) benefit — pure credit economics (points products) */
  rarocCredit: number | null;
  /** RAROC after the HQLA-buffer cost and with liquidity capital in the denominator (points products) */
  rarocLiquidity: number | null;
  /** cost of holding the HQLA buffer over the horizon (billion toman) */
  liquidityCost: number;
  /** capital held against a stressed deposit run-off (billion toman) */
  liquidityCapital: number;
  economicCapital: number;
  regulatoryCapital: number;
  /** null when no outstanding credit provides a meaningful denominator; not applicable to loyalty. */
  nim: number | null;
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
  raroc: number | null;
  cumDefaultRate: number;
  probLoss: number;
  approvalRate: number;
  volume: number;
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
  baseline: { score: number; kpis: Kpis; feasible: boolean };
  best: { score: number; kpis: Kpis; config: ProductConfig; feasible: boolean };
  changes: { label: string; from: string; to: string }[];
  points: OptimizerPoint[];
  xLabel: string;
  yLabel: string;
}

// ===== انواع جدید برای تحلیل ALM / نقدینگی و محصول چندپله‌ای =====

export type AlmEventType = "deposit" | "reserve" | "release" | "pmt" | "fee" | "loan" | "withdrawal" | "profit" | "interbank" | "provision" | "writeoff";

export interface AlmFlowEvent {
  type: AlmEventType;
  tierId: string;
  tierName: string;
  tierIndex: number;
  amount: number;
  vintageMonth: number;
  vintageFrom?: number;
  vintageTo?: number;
  instFrom?: number;
  instTo?: number;
  instTotal?: number;
}

export interface AlmMonthRow {
  t: number;
  depositGross: number;
  reserveHeld: number;
  reserveRelease: number;
  depositNet: number;
  pmtInflow: number;
  principalIn: number;
  incomeIn: number;
  /** کارمزد تشکیل پرونده در زمان اعطا (میلیارد تومان) */
  feeInflow: number;
  inflow: number;
  loanOut: number;
  withdrawalOut: number;
  profitPaid: number;
  fundingCost: number;
  /** درآمد سرمایه‌گذاری مازاد نقد ماه قبل با نرخ FTP */
  surplusIncome: number;
  provisionCost: number;
  writeOff: number;
  outflow: number;
  ncf: number;
  cum: number;
  depositBalance: number;
  loanBook: number;
  cumMargin: number;
  events: AlmFlowEvent[];
}

export interface AlmTierResult {
  tier: TieredMurabahaTier;
  index: number;
  share: number;
  deposit: number;
  alphaEff: number;
  capBinding: boolean;
  repBalance: number;
  eligible: boolean;
  lends: boolean;
  effectiveRate: number;
  commitment: number;
  withdrawal: number;
  monthlyPmt: number;
  totalRepay: number;
  totalIncome: number;
  borrowers: number;
  /** تعداد سپرده‌گذاران این پله */
  customers?: number;
  /** نخستین ماه دریافت قسط (null اگر وام در افق اعطا نشود) */
  firstMaturity: number | null;
  lastMaturity: number | null;
  unitPay: number;
  customerOpportunityCost: number;
  customerEffectiveCost: number;
  /** هزینه تمام‌شده سالانه مشتری (IRR) با احتساب هزینه فرصت سپرده‌گذاری (%) */
  customerIrr: number;
  /** هزینه تمام‌شده مشتری منهای نرخ فرصت بازار (مثبت = محصول برای مشتری گران‌تر از بازار) */
  interestGap: number;
}

export interface AlmKpis {
  totalDeposit: number;
  netDeposit: number;
  reserveHeld: number;
  totalCommitment: number;
  totalWithdrawal: number;
  leverage: number;
  minCum: number;
  minCumMonth: number;
  maxHole: number;
  tippingPoint: number | null;
  recoveryMonth: number | null;
  deficitMonths: number;
  endCum: number;
  totalPmtInHorizon: number;
  totalIncomeInHorizon: number;
  totalFeeIncome: number;
  pmtBeyondHorizon: number;
  interbankCost: number;
  /** جمع درآمد سرمایه‌گذاری مازاد نقد در افق (میلیارد تومان) */
  surplusIncome: number;
  borrowers: number;
  peakOutflow: number;
  peakOutflowMonth: number;
  totalProfitPaid: number;
  netInterestIncome: number;
  totalProvision: number;
  totalWriteOff: number;
  netMargin: number;
  marginOnNetDeposit: number;
  /** سنجه‌های مقرراتی آموزشی */
  minLcr: number;
  nsfrAt12: number;
  walAssets: number;
  walLiabilities: number;
  maturityGap: number;
}

export interface AlmResult {
  rows: AlmMonthRow[];
  tiers: AlmTierResult[];
  kpis: AlmKpis;
  /** تمام گزینه‌های مشتری (۲۵۰+ ترکیب) */
  customerOptions: NeginCustomerOption[];
  /** نقاط پارتو برای مثلث سه‌گانه */
  paretoFrontier: NeginCustomerOption[];
  durationMs: number;
}

export interface LiquidityStressCell {
  takeUpShock: number;
  approvalShock: number;
  maxHole: number;
  tippingPoint: number | null;
  netMargin: number;
  leverage: number;
}

export interface TornadoItem {
  key: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  low: number;
  high: number;
  base: number;
  /** دامنه نوسان = max(low, high, base) − min(low, high, base) */
  swing: number;
}

export interface AlmAnalysisResult {
  stressGrid: LiquidityStressCell[];
  tornado: TornadoItem[];
  monteCarlo: {
    runs: number;
    pTipping: number;
    pLoss: number;
    p5: number;
    p50: number;
    p95: number;
    p99: number;
    worstCaseMaxHole: number;
    /** نمونه‌های مرتب‌شده حداکثر حفره (برای هیستوگرام) */
    samples?: number[];
  };
  optimalTierDesign?: {
    tiers: TieredMurabahaTier[];
    objective: number;
    kpis: AlmKpis;
    constraintViolations: string[];
  };
  scenariosA?: AlmResult;
  scenariosB?: AlmResult;
  scenariosC?: AlmResult;
}

export interface GameTierResult {
  waitMonths: number;
  pointsEarned: number;
  benefitUnlocked: string;
  tierName: string;
  lotteryChancePct: number;
}

export interface PrepaymentModel {
  /** آیا ماژول پیش‌پرداخت فعال است؟ */
  enabled: boolean;
  /** نرخ پایه پیش‌پرداخت سالانه (%) در حالت نرخ برابر بازار */
  baseRate: number;
  /** حساسیت به اختلاف نرخ (به ازای هر درصد اختلاف نرخ قرارداد با بازار، چند درصد نرخ پیش‌پرداخت افزایش می‌یابد) */
  sensitivityToRateGap: number;
  /** حداکثر نرخ پیش‌پرداخت (%) */
  maxRate: number;
}

export interface GamificationConfig {
  enabled: boolean;
  /** امتیاز جایزه به ازای هر ماه انتظار اضافی */
  pointsPerExtraWaitMonth: number;
  /** نرخ شانس قرعه‌کشی به ازای هر ماه انتظار (%) */
  lotteryChancePerMonth: number;
  /** تخفیف کارمزد برای مشتریان سطح بالا (درصد) */
  topTierFeeDiscount: number;
}

export interface AntiNeginConfig {
  /** فعال‌سازی تسهیلات فوری (بدون انتظار) برای پوشش کسری */
  enabled: boolean;
  /** نرخ سود تسهیلات فوری (%) */
  fastLoanRate: number;
  /** ضریب تسهیلات فوری (%) */
  fastLoanAlphaPct: number;
  /** اقساط تسهیلات فوری (ماه) */
  fastLoanTenor: number;
}

export interface FullAlmResult {
  alm: AlmResult;
  analysis: AlmAnalysisResult;
  prepayment?: {
    avgPrepaymentRate: number;
    lostInterestIncome: number;
    acceleratedCashflow: number;
  };
  gamification?: {
    totalPointsIssued: number;
    expectedLotteryPayouts: number;
    tierUpgradeRate: number;
    estimatedRetentionUpliftPct: number;
  };
  antiNegin?: {
    fastLoanVolume: number;
    fastLoanIncome: number;
    holeCoverageByFastLoans: number;
    /** مانده نقد خالص جریان ضدنگین در ماه کف نقدینگی طرح پایه (میلیارد تومان؛ منفی = مصرف نقدینگی) */
    cashAtTrough?: number;
  };
  gamificationJourney?: GameTierResult[];
}
