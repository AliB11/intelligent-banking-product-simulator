// =========================================================================
//  موتور شبیه‌سازی ALM (دارایی-بدهی) برای محصولات امتیازی چندپله‌ای
//  پورت و بسط‌یافته از مخزن alm-simulation-engine-development برای سیمرغ
//
//  قراردادهای مدل (بازبینی ۱۴۰۵/۰۷/۱۹):
//  • همه مبالغ داخلی «میلیارد تومان»؛ نرخ‌ها «درصد سالانه»؛ زمان «ماه» (t = 0 … H).
//  • سپرده هر پله در ماه ۰ وارد می‌شود و سپرده قانونی همان لحظه نگه داشته می‌شود.
//  • در پایان انتظار (t = T_dep) وام اعطا و بخشی از سپرده برداشت می‌شود؛ سپرده قانونی
//    به نسبت برداشت آزاد می‌شود. نخستین قسط در ماه T_dep + 1 دریافت می‌شود.
//  • نکول به‌صورت انتظار ریاضی (PD × LGD) از جریان نقد وصولی کسر و هم‌زمان ذخیره
//    مطالبات در سود و زیان شناسایی می‌شود.
//  • هزینه بین‌بانکی روی کسری انباشته ماه قبل محاسبه و در همان ماه از NCF کسر می‌شود؛
//    بنابراین همیشه cum_t = Σ ncf.
// =========================================================================
import { COLLATERALS } from "./catalog";
import { clamp, irr, mulberry32, normal, quantile, sum } from "./math";
import type {
  AlmFlowEvent,
  AlmKpis,
  AlmMonthRow,
  AlmResult,
  AlmTierResult,
  FullAlmResult,
  GameTierResult,
  Kpis,
  LiquidityStressCell,
  NeginCustomerOption,
  PrepaymentModel,
  ProductConfig,
  TieredMurabahaTier,
  TornadoItem,
} from "./types";

/** سقف عددی برای نسبت‌هایی که مخرجشان صفر می‌شود (JSON مقدار Infinity را پشتیبانی نمی‌کند). */
export const RATIO_CAP = 999;

// --------------- فرمول‌های اقساط ---------------

/** قسط ماهانه قرض‌الحسنه با کارمزد ساده سالانه */
export function pmtQard(principal: number, feePct: number, months: number): number {
  const fee = principal * (feePct / 100) * (months / 12);
  return months > 0 ? (principal + fee) / months : principal;
}

/** قسط ماهانه مرابحه (اقساط مساوی = فرمول استاندارد وام) */
export function pmtMurabaha(principal: number, annualRatePct: number, months: number): number {
  if (annualRatePct <= 0 || months <= 0) return months > 0 ? principal / months : principal;
  const rm = annualRatePct / 1200;
  const f = Math.pow(1 + rm, months);
  return (principal * rm * f) / (f - 1);
}

export function pmtFor(contract: "qard" | "murabaha", principal: number, rate: number, months: number): number {
  return contract === "qard" ? pmtQard(principal, rate, months) : pmtMurabaha(principal, rate, months);
}

/** جدول تفکیک قسط به اصل و سود (یا کارمزد) برای اصل واحد/دلخواه. */
export function splitSchedule(contract: "qard" | "murabaha", principal: number, rate: number, months: number) {
  const n = Math.max(1, Math.round(months));
  const pmt = pmtFor(contract, principal, rate, n);
  const prin: number[] = [];
  const inc: number[] = [];
  const bal: number[] = [];
  let b = principal;
  for (let k = 0; k < n; k++) {
    let interest: number;
    let p: number;
    if (contract === "qard") {
      interest = (principal * (rate / 100) * (n / 12)) / n;
      p = principal / n;
    } else {
      interest = b * (rate / 1200);
      p = k === n - 1 ? b : pmt - interest;
    }
    b = Math.max(0, b - p);
    prin.push(p);
    inc.push(interest);
    bal.push(b);
  }
  return { pmt, prin, inc, bal, n };
}

/** نرخ مؤثر سالانه (درصد) از نرخ ماهانه IRR. */
const annualize = (monthly: number) => (Math.pow(1 + monthly, 12) - 1) * 100;

/**
 * هزینه تمام‌شده مشتری (all-in) شامل هزینه فرصت سپرده‌گذاری.
 * ارزش آتی هزینه فرصت تا ماه اعطا از مبلغ وام کسر می‌شود و IRR جریان
 * [L − OC, −PMT × n] سالانه می‌شود. اگر هزینه فرصت از کل وام بیشتر باشد، RATIO_CAP برمی‌گردد.
 */
export function customerAllInCost(
  loan: number,
  deposit: number,
  waitMonths: number,
  pmt: number,
  months: number,
  opportunityRatePct: number,
  depositRatePct: number,
): { cost: number; opportunityCost: number } {
  const oc = deposit * (Math.pow(1 + opportunityRatePct / 1200, waitMonths) - Math.pow(1 + depositRatePct / 1200, waitMonths));
  const net = loan - oc;
  if (loan <= 0 || pmt <= 0) return { cost: 0, opportunityCost: oc };
  if (net <= 0) return { cost: RATIO_CAP, opportunityCost: oc };
  const cfs = [net, ...Array.from({ length: months }, () => -pmt)];
  const r = irr(cfs);
  return { cost: Math.min(RATIO_CAP, annualize(r)), opportunityCost: oc };
}

/**
 * بازده مؤثر بانک روی وام با احتساب ارزش منابع ارزان دوره انتظار:
 * سپرده (پس از سپرده قانونی) با نرخ FTP به کار گرفته می‌شود و سود سپرده پرداخت می‌شود.
 */
export function bankEffectiveYield(
  loan: number,
  deposit: number,
  waitMonths: number,
  pmt: number,
  months: number,
  costOfFundsPct: number,
  depositRatePct: number,
  reserveRatioPct: number,
): number {
  if (loan <= 0 || pmt <= 0) return 0;
  const benefit =
    deposit * (1 - reserveRatioPct / 100) * (Math.pow(1 + costOfFundsPct / 1200, waitMonths) - 1) -
    deposit * (Math.pow(1 + depositRatePct / 1200, waitMonths) - 1);
  const net = loan - benefit;
  if (net <= 0) return RATIO_CAP;
  const r = irr([-net, ...Array.from({ length: months }, () => pmt)]);
  return Math.min(RATIO_CAP, annualize(r));
}

/** PD سالانه مدل ALM از حد نصاب امتیاز (منحنی نمایی هموار به‌جای پله‌ای). */
export function almPd(minScore: number): number {
  return clamp(0.2 * Math.exp(-(minScore - 400) / 120), 0.01, 0.2);
}

// --------------- تخصیص مشتری به گزینه‌های منو (۲۵۰ ترکیب) ---------------

export interface WaitAllocation {
  amountBoostMonths: number;
  tenorBoostMonths: number;
  rateCutMonths: number;
}

/**
 * تولید همهٔ ترکیبات معتبر تخصیص ماه‌های انتظار اضافی
 * به سه مزیت (افزایش مبلغ/اقساط/کاهش سود)
 */
export function enumerateWaitAllocations(maxExtraMonths: number = 10, cfg: ProductConfig): WaitAllocation[] {
  const out: WaitAllocation[] = [];
  const { maxAmountBoostMonths, maxTenorBoostMonths, maxRateCutMonths } = cfg.points;
  for (let a = 0; a <= Math.min(maxExtraMonths, maxAmountBoostMonths); a++) {
    for (let t = 0; t <= Math.min(maxExtraMonths - a, maxTenorBoostMonths); t++) {
      const r = maxExtraMonths - a - t;
      if (r >= 0 && r <= maxRateCutMonths) {
        out.push({ amountBoostMonths: a, tenorBoostMonths: t, rateCutMonths: r });
      }
    }
  }
  return out;
}

/** پله پایه (کوتاه‌ترین انتظار) — مبدأ منوی سه‌گانه. */
function baseTier(cfg: ProductConfig): { alpha: number; tenor: number; rate: number; minWait: number } {
  const pts = cfg.points;
  const minWait = Math.max(1, Math.ceil(pts.minHoldingDays / 30));
  const sorted = [...(pts.tiers ?? [])].sort((a, b) => a.waitingMonths - b.waitingMonths);
  const t0 = sorted[0];
  return t0
    ? { alpha: t0.loanToAvgDepositPct, tenor: t0.repaymentMonths, rate: t0.rate, minWait: Math.max(minWait, t0.waitingMonths) }
    : { alpha: 25, tenor: 16, rate: 23, minWait };
}

/**
 * تولید تمام ~۲۵۰ گزینه انتخابی مشتری برای یک میانگین سپرده معین (میلیون تومان)
 */
export function generateNeginOptions(
  avgBalanceMillionToman: number,
  cfg: ProductConfig,
  opportunityRatePct: number = 23,
): NeginCustomerOption[] {
  const pts = cfg.points;
  const base = baseTier(cfg);
  const maxWait = 12;
  const alphaMax = base.alpha + pts.maxAmountBoostMonths * pts.alphaStepPerWaitMonth;
  const tenorMax = base.tenor + pts.maxTenorBoostMonths * pts.tenorStepPerWaitMonth;
  const rateMin = Math.max(0, base.rate - pts.maxRateCutMonths * pts.rateCutPerWaitMonth);
  const isQard = cfg.contract === "qard";
  const pd = almPd(cfg.risk.minScore);
  const lgd = (COLLATERALS[cfg.risk.collateral] ?? COLLATERALS.scoring).lgd;
  const out: NeginCustomerOption[] = [];
  let idx = 0;
  for (let wait = base.minWait; wait <= maxWait; wait++) {
    const extra = wait - base.minWait;
    for (const alloc of enumerateWaitAllocations(extra, cfg)) {
      const alphaPct = clamp(base.alpha + alloc.amountBoostMonths * pts.alphaStepPerWaitMonth, 0, alphaMax);
      const tenor = Math.round(clamp(base.tenor + alloc.tenorBoostMonths * pts.tenorStepPerWaitMonth, 1, tenorMax));
      const rate = clamp(base.rate - alloc.rateCutMonths * pts.rateCutPerWaitMonth, rateMin, base.rate);
      const loan = Math.min((alphaPct / 100) * avgBalanceMillionToman, pts.individualLoanCap);
      const installment = pmtFor(isQard ? "qard" : "murabaha", loan, rate, tenor);
      const totalRepay = installment * tenor;
      const allIn = customerAllInCost(loan, avgBalanceMillionToman, wait, installment, tenor, opportunityRatePct, pts.depositRate);
      // بازده بانک پس از زیان مورد انتظار (اقساط × (۱ − PD×LGD))
      const bankYield = bankEffectiveYield(
        loan, avgBalanceMillionToman, wait, installment * (1 - pd * lgd), tenor,
        cfg.funding.costOfFunds, pts.depositRate, cfg.funding.reserveRatio,
      );
      // مطلوبیت مشتری (۰ تا ۱۰۰): وام بیشتر، اقساط بلندتر، نرخ کمتر، انتظار کوتاه‌تر
      const loanScore = clamp((loan / Math.max(1, pts.individualLoanCap)) * 100, 0, 100);
      const rateScore = base.rate > rateMin ? clamp(((base.rate - rate) / (base.rate - rateMin)) * 100, 0, 100) : 0;
      const tenorScore = tenorMax > base.tenor ? clamp(((tenor - base.tenor) / (tenorMax - base.tenor)) * 100, 0, 100) : 0;
      const waitPenalty = (wait / 12) * 50;
      const customerUtility = clamp(loanScore * 0.3 + rateScore * 0.4 + tenorScore * 0.3 - waitPenalty + 50, 0, 100);
      out.push({
        comboId: `c${idx++}`,
        loanAmount: Math.round(loan * 100) / 100,
        tenor,
        rate,
        alpha: alphaPct,
        waitingMonths: wait,
        monthlyInstallment: Math.round(installment * 1000) / 1000,
        totalRepayment: Math.round(totalRepay * 100) / 100,
        opportunityCost: Math.round(allIn.opportunityCost * 100) / 100,
        effectiveCustomerCost: Math.round((totalRepay + allIn.opportunityCost) * 100) / 100,
        bankEffectiveYield: Math.round(bankYield * 100) / 100,
        customerUtility,
        paretoOptimal: false,
      });
    }
  }
  // نقاط پارتو (غیرمغلوب): مطلوبیت مشتری بالاتر و بازده بانک بیشتر
  for (let i = 0; i < out.length; i++) {
    let dominated = false;
    for (let j = 0; j < out.length && !dominated; j++) {
      if (i === j) continue;
      dominated =
        out[j].customerUtility >= out[i].customerUtility &&
        out[j].bankEffectiveYield >= out[i].bankEffectiveYield &&
        (out[j].customerUtility > out[i].customerUtility || out[j].bankEffectiveYield > out[i].bankEffectiveYield);
    }
    out[i].paretoOptimal = !dominated;
  }
  return out;
}

// --------------- هسته شبیه‌سازی جریان نقد ALM ---------------

export interface AlmSimInput {
  cfg: ProductConfig;
  totalDepositBillionToman: number; // کل سپرده جذب شده (میلیارد تومان)
  avgTicketMillionToman: number; // میانگین سپرده هر مشتری
  horizonMonths: number;
  takeUpRatePct: number;
  approvalRatePct: number;
  runoffRatePct: number; // نرخ خروج سپرده وام‌گیرندگان در زمان اعطا
  churnRatePct: number; // نرخ خروج سپرده سایر سپرده‌گذاران در پایان انتظار
  interbankRatePct: number;
  opportunityRatePct: number;
  reserveRatioPct: number;
  seed?: number;
  /** بازده سرمایه‌گذاری مازاد نقد (٪ سالانه)؛ پیش‌فرض = نرخ انتقال وجوه (FTP) محصول، متقارن با هزینه کسری. */
  surplusRatePct?: number;
  /** تولید منوی ~۲۵۰ گزینه مشتری (در تحلیل‌های تکراری خاموش می‌شود). */
  withOptions?: boolean;
}

/** پله‌های مؤثر محصول؛ در حالت ساده یک پله معادل ساخته می‌شود. */
export function effectiveTiers(cfg: ProductConfig): TieredMurabahaTier[] {
  const pts = cfg.points;
  if (pts.mode === "tiered_murabaha" && pts.tiers && pts.tiers.length > 0) {
    return pts.tiers.map((t, i) => ({ ...t, id: t.id ?? `t${i}` }));
  }
  return [{
    name: "تک‌حالت",
    waitingMonths: Math.max(1, Math.ceil(pts.minHoldingDays / 30)),
    repaymentMonths: Math.max(1, Math.round(cfg.credit.tenor)),
    loanToAvgDepositPct: clamp(pts.coefficient * 100, 25, 400),
    rate: cfg.contract === "qard" ? pts.loanFee : cfg.credit.rate,
    minAvgDeposit: 0,
    expectedTakeUpShare: 100,
    id: "t0",
  }];
}

export function simulateAlm(inp: AlmSimInput): AlmResult {
  const t0 = Date.now();
  const { cfg, avgTicketMillionToman, opportunityRatePct } = inp;
  const pts = cfg.points;
  const contract: "qard" | "murabaha" = cfg.contract === "qard" ? "qard" : "murabaha";
  const totalDeposit = Math.max(0, inp.totalDepositBillionToman);
  const avgTicket = Math.max(1e-6, avgTicketMillionToman / 1000); // میلیارد
  const nCustomers = Math.round(totalDeposit / avgTicket);
  const H = Math.max(1, Math.round(inp.horizonMonths));
  const rr = clamp(inp.reserveRatioPct, 0, 100) / 100;
  const takeUp = clamp(inp.takeUpRatePct, 0, 100) / 100;
  const approval = clamp(inp.approvalRatePct, 0, 100) / 100;
  const runoff = clamp(inp.runoffRatePct, 0, 100) / 100;
  const churn = clamp(inp.churnRatePct, 0, 100) / 100;
  const borrowerShare = takeUp * approval;
  const pd = almPd(cfg.risk.minScore);
  const lgd = (COLLATERALS[cfg.risk.collateral] ?? COLLATERALS.scoring).lgd;
  const el = pd * lgd;

  const tiers = effectiveTiers(cfg);
  const rawShare = sum(tiers.map((t) => Math.max(0, t.expectedTakeUpShare)));
  const shareOf = (t: TieredMurabahaTier) => (rawShare > 0 ? Math.max(0, t.expectedTakeUpShare) / rawShare : 1 / tiers.length);

  const rows: AlmMonthRow[] = [];
  for (let t = 0; t <= H; t++) {
    rows.push({
      t, depositGross: 0, reserveHeld: 0, reserveRelease: 0, depositNet: 0,
      pmtInflow: 0, principalIn: 0, incomeIn: 0, inflow: 0,
      loanOut: 0, withdrawalOut: 0, profitPaid: 0, fundingCost: 0, surplusIncome: 0,
      provisionCost: 0, writeOff: 0, outflow: 0, ncf: 0, cum: 0,
      depositBalance: 0, loanBook: 0, cumMargin: 0, events: [],
    });
  }
  const depBal = new Array(H + 1).fill(0) as number[]; // مانده سپرده پایان ماه
  const loanBal = new Array(H + 1).fill(0) as number[]; // مانده ناخالص تسهیلات پایان ماه
  const ev = (t: number, e: AlmFlowEvent) => rows[t].events.push(e);

  const tierResults: AlmTierResult[] = [];
  let totalCommitment = 0, totalWithdrawal = 0, totalPmt = 0, totalIncome = 0, pmtBeyond = 0;
  let totalProvision = 0, totalWriteOff = 0, borrowers = 0;
  let walANum = 0, walADen = 0, walLNum = 0, walLDen = 0;

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const id = tier.id ?? `t${i}`;
    const base = { tierId: id, tierName: tier.name, tierIndex: i, vintageMonth: 0 };
    const share = shareOf(tier);
    const D = totalDeposit * share;
    const tierCustomers = Math.round(nCustomers * share);
    const tDep = Math.max(0, Math.round(tier.waitingMonths));
    const n = Math.max(1, Math.round(tier.repaymentMonths));
    const rate = tier.rate;
    const capPct = ((pts.individualLoanCap / 1000) / avgTicket) * 100; // سقف فردی بر حسب درصد میانگین سپرده
    const depositOk = avgTicket >= tier.minAvgDeposit / 1000;
    const alphaEff = depositOk ? Math.max(0, Math.min(tier.loanToAvgDepositPct, capPct)) : 0;
    const capBinding = depositOk && tier.loanToAvgDepositPct > capPct;
    const eligible = depositOk && alphaEff > 0;
    const disbursed = eligible && tDep <= H;
    const lends = eligible;

    // ورود سپرده در ماه ۰
    const reserve = D * rr;
    rows[0].depositGross += D;
    rows[0].reserveHeld += reserve;
    rows[0].depositNet += D - reserve;
    ev(0, { type: "deposit", ...base, amount: D });
    ev(0, { type: "reserve", ...base, amount: reserve });

    // برداشت ناخالص در پایان انتظار (وام‌گیرندگان runoff، بقیه churn)
    const wFrac = eligible ? borrowerShare * runoff + (1 - borrowerShare) * churn : churn;
    const W = D * wFrac;
    const C = eligible ? D * borrowerShare * (alphaEff / 100) : 0;
    const tW = Math.min(tDep, H + 1);

    // مانده سپرده و سود ماه‌شمار (پرداخت پایان هر ماه روی مانده ابتدای ماه)
    for (let t = 0; t <= H; t++) {
      const balance = t >= tW ? D - W : D;
      depBal[t] += balance;
      if (t >= 1) {
        const opening = t - 1 >= tW ? D - W : D;
        rows[t].profitPaid += (opening * pts.depositRate) / 1200;
      }
    }

    if (tW <= H && W > 0) {
      rows[tW].withdrawalOut += W;
      rows[tW].reserveRelease += W * rr;
      ev(tW, { type: "withdrawal", ...base, amount: W });
      ev(tW, { type: "release", ...base, amount: W * rr });
      walLNum += tW * W;
      walLDen += W;
    }
    // باقی‌مانده سپرده در افق سررسید فرض می‌شود (برای WAL بدهی)
    walLNum += H * (D - (tW <= H ? W : 0));
    walLDen += D - (tW <= H ? W : 0);

    let unitPay = 0;
    let totalRepayTier = 0;
    let totalIncomeTier = 0;
    let provision = 0;
    if (disbursed && C > 0) {
      const sch = splitSchedule(contract, C, rate, n);
      unitPay = sch.pmt;
      totalRepayTier = sch.pmt * n;
      totalIncomeTier = sum(sch.inc);
      rows[tDep].loanOut += C;
      ev(tDep, { type: "loan", ...base, amount: C, instFrom: tDep + 1, instTo: Math.min(H, tDep + n), instTotal: n });
      provision = C * el;
      rows[tDep].provisionCost += provision;
      totalProvision += provision;
      if (provision > 0) ev(tDep, { type: "provision", ...base, amount: provision });
      for (let t = tDep; t <= H; t++) loanBal[t] += C;
      for (let k = 0; k < n; k++) {
        const t = tDep + 1 + k;
        const cash = sch.pmt * (1 - el);
        walANum += t * sch.prin[k];
        walADen += sch.prin[k];
        if (t > H) {
          pmtBeyond += cash;
          continue;
        }
        rows[t].pmtInflow += cash;
        rows[t].principalIn += sch.prin[k] * (1 - el);
        rows[t].incomeIn += sch.inc[k] * (1 - el);
        totalPmt += cash;
        totalIncome += sch.inc[k] * (1 - el);
        // مانده ناخالص قراردادی پس از قسط k
        for (let s = t; s <= H; s++) loanBal[s] += -sch.prin[k];
        ev(t, { type: "pmt", ...base, amount: cash, instFrom: k + 1, instTo: k + 1, instTotal: n });
      }
      const maturity = tDep + n;
      if (maturity <= H && provision > 0) {
        rows[maturity].writeOff += provision;
        totalWriteOff += provision;
        ev(maturity, { type: "writeoff", ...base, amount: provision });
      }
      totalCommitment += C;
    }
    totalWithdrawal += tW <= H ? W : 0;
    const tierBorrowers = eligible ? Math.round(tierCustomers * borrowerShare) : 0;
    borrowers += disbursed ? tierBorrowers : 0;

    // سنجه‌های مشتری نمونه (میلیون تومان)
    const B = avgTicketMillionToman;
    const unitLoan = (alphaEff / 100) * B;
    const unitPmt = unitLoan > 0 ? pmtFor(contract, unitLoan, rate, n) : 0;
    const allIn = customerAllInCost(unitLoan, B, tDep, unitPmt, n, opportunityRatePct, pts.depositRate);

    tierResults.push({
      tier, index: i, share: share * 100,
      deposit: D, alphaEff, capBinding, repBalance: C,
      eligible, lends, effectiveRate: rate, commitment: C, withdrawal: W,
      monthlyPmt: unitPay, totalRepay: totalRepayTier, totalIncome: totalIncomeTier,
      borrowers: tierBorrowers,
      customers: tierCustomers,
      firstMaturity: disbursed ? tDep + 1 : null,
      lastMaturity: disbursed ? tDep + n : null,
      unitPay: unitPmt,
      customerOpportunityCost: allIn.opportunityCost,
      customerEffectiveCost: unitPmt * n + allIn.opportunityCost,
      customerIrr: allIn.cost,
      interestGap: allIn.cost - opportunityRatePct,
    });
  }

  // نهایی‌سازی ردیف‌ها: NCF، کسری انباشته و هزینه بین‌بانکی
  // کسری ماه قبل با نرخ بین‌بانکی تأمین می‌شود و مازاد ماه قبل با نرخ FTP در خزانه سرمایه‌گذاری می‌شود
  const surplusRate = Math.max(0, inp.surplusRatePct ?? cfg.funding.costOfFunds);
  let cum = 0, cumMargin = 0, interbankCost = 0, surplusIncome = 0, peakOutflow = 0, peakMonth = 0;
  for (let t = 0; t <= H; t++) {
    const r = rows[t];
    r.fundingCost = t > 0 && cum < 0 ? (-cum * inp.interbankRatePct) / 1200 : 0;
    r.surplusIncome = t > 0 && cum > 0 ? (cum * surplusRate) / 1200 : 0;
    interbankCost += r.fundingCost;
    surplusIncome += r.surplusIncome;
    // درآمد مازاد در سود و زیان (cumMargin/netMargin) می‌آید، نه در نقدینگی مستقل محصول؛
    // تا حفره نقدینگی ساختاری محصول با درآمد خزانه پوشانده نشود (رویکرد محافظه‌کارانه).
    r.inflow = r.depositGross + r.pmtInflow + r.reserveRelease;
    r.outflow = r.reserveHeld + r.loanOut + r.withdrawalOut + r.profitPaid + r.fundingCost;
    r.ncf = r.inflow - r.outflow;
    cum += r.ncf;
    r.cum = cum;
    r.depositBalance = depBal[t];
    r.loanBook = Math.max(0, loanBal[t]);
    cumMargin += r.incomeIn + r.surplusIncome - r.profitPaid - r.fundingCost - r.provisionCost;
    r.cumMargin = cumMargin;
    if (r.outflow > peakOutflow) {
      peakOutflow = r.outflow;
      peakMonth = t;
    }
  }
  const totalProfitPaid = sum(rows.map((r) => r.profitPaid));

  // KPIهای نقدینگی
  let minCum = Infinity, minCumMonth = 0, maxHole = 0, deficitMonths = 0;
  let tippingPoint: number | null = null;
  let recoveryMonth: number | null = null;
  for (let t = 0; t <= H; t++) {
    const c = rows[t].cum;
    if (c < minCum) { minCum = c; minCumMonth = t; }
    if (c < -1e-9) {
      maxHole = Math.max(maxHole, -c);
      deficitMonths++;
      if (tippingPoint === null) tippingPoint = t;
      recoveryMonth = null;
    } else if (tippingPoint !== null && recoveryMonth === null) {
      recoveryMonth = t;
    }
  }
  const netDeposit = totalDeposit * (1 - rr);
  const leverage = netDeposit > 0 ? (totalCommitment + totalWithdrawal) / netDeposit : RATIO_CAP;
  const netInterestIncome = totalIncome - totalProfitPaid;
  const netMargin = netInterestIncome + surplusIncome - interbankCost - totalProvision;
  const marginOnNet = netDeposit > 0 ? (netMargin / netDeposit) * 100 : 0;

  // LCR آموزشی (رو به جلو، ۳۰ روز): HQLA = مازاد نقد؛ خروج = خروج قراردادی ماه بعد + ۵٪ فرار سپرده؛
  // ورود = ۵۰٪ اقساط ماه بعد و حداکثر ۷۵٪ خروج (مطابق ساختار بازل ۳).
  let minLcr = RATIO_CAP;
  for (let t = 0; t < H; t++) {
    const nx = rows[t + 1];
    const out30 = nx.loanOut + nx.withdrawalOut + nx.profitPaid + 0.05 * rows[t].depositBalance;
    const in30 = Math.min(0.5 * nx.pmtInflow, 0.75 * out30);
    const netOut = out30 - in30;
    if (netOut > 1e-9) minLcr = Math.min(minLcr, (Math.max(0, rows[t].cum) / netOut) * 100);
  }
  // NSFR آموزشی در ماه ۱۲: ASF = ۹۰٪ سپرده خرد، RSF = ۸۵٪ تسهیلات (وزن ریسک > ۳۵٪)
  const r12 = rows[Math.min(12, H)];
  const rsf = 0.85 * r12.loanBook;
  const nsfr = rsf > 1e-9 ? Math.min(RATIO_CAP, ((0.9 * r12.depositBalance) / rsf) * 100) : RATIO_CAP;
  const walAssets = walADen > 0 ? walANum / walADen : 0;
  const walLiabilities = walLDen > 0 ? walLNum / walLDen : 0;

  const kpis: AlmKpis = {
    totalDeposit, netDeposit, reserveHeld: rows[0].reserveHeld, totalCommitment, totalWithdrawal, leverage,
    minCum: minCum === Infinity ? 0 : minCum, minCumMonth, maxHole, tippingPoint,
    recoveryMonth, deficitMonths, endCum: rows[H].cum, totalPmtInHorizon: totalPmt,
    totalIncomeInHorizon: totalIncome, pmtBeyondHorizon: pmtBeyond,
    interbankCost, surplusIncome, borrowers, peakOutflow, peakOutflowMonth: peakMonth,
    totalProfitPaid, netInterestIncome, totalProvision, totalWriteOff, netMargin,
    marginOnNetDeposit: marginOnNet, minLcr, nsfrAt12: nsfr, walAssets, walLiabilities,
    maturityGap: walAssets - walLiabilities,
  };

  const customerOptions = inp.withOptions === false ? [] : generateNeginOptions(100, cfg, opportunityRatePct);
  const paretoFrontier = customerOptions.filter((o) => o.paretoOptimal);

  return { rows, tiers: tierResults, kpis, customerOptions, paretoFrontier, durationMs: Date.now() - t0 };
}

// --------------- تحلیل استرس، گردبادی و مونت‌کارلو ALM ---------------

const quick = (inp: AlmSimInput): AlmSimInput => ({ ...inp, withOptions: false });

export function runAlmStressGrid(
  baseInput: AlmSimInput,
  takeUpShocks: number[] = [-30, -15, 0, 15, 30],
  approvalShocks: number[] = [-20, -10, 0, 10, 20],
): LiquidityStressCell[] {
  const cells: LiquidityStressCell[] = [];
  for (const tu of takeUpShocks) {
    for (const ap of approvalShocks) {
      const res = simulateAlm(quick({
        ...baseInput,
        takeUpRatePct: clamp(baseInput.takeUpRatePct + tu, 0, 100),
        approvalRatePct: clamp(baseInput.approvalRatePct + ap, 0, 100),
      }));
      cells.push({
        takeUpShock: tu, approvalShock: ap, maxHole: res.kpis.maxHole, tippingPoint: res.kpis.tippingPoint,
        netMargin: res.kpis.netMargin, leverage: res.kpis.leverage,
      });
    }
  }
  return cells;
}

export function runAlmTornado(baseInput: AlmSimInput): TornadoItem[] {
  const base = simulateAlm(quick(baseInput));
  const shocks: { key: string; label: string; lowLabel: string; highLabel: string; prop: keyof AlmSimInput; delta: number; max: number }[] = [
    { key: "takeUp", label: "نرخ تقاضای وام", lowLabel: "−۲۰ واحد", highLabel: "+۲۰ واحد", prop: "takeUpRatePct", delta: 20, max: 100 },
    { key: "approval", label: "نرخ تأیید", lowLabel: "−۲۰ واحد", highLabel: "+۲۰ واحد", prop: "approvalRatePct", delta: 20, max: 100 },
    { key: "runoff", label: "نرخ خروج وام‌گیرندگان", lowLabel: "−۲۰ واحد", highLabel: "+۲۰ واحد", prop: "runoffRatePct", delta: 20, max: 100 },
    { key: "churn", label: "نرخ ریزش سایر سپرده‌گذاران", lowLabel: "−۲۰ واحد", highLabel: "+۲۰ واحد", prop: "churnRatePct", delta: 20, max: 100 },
    { key: "interbank", label: "نرخ بین‌بانکی", lowLabel: "−۴ واحد", highLabel: "+۴ واحد", prop: "interbankRatePct", delta: 4, max: 200 },
    { key: "reserve", label: "سپرده قانونی", lowLabel: "−۲ واحد", highLabel: "+۲ واحد", prop: "reserveRatioPct", delta: 2, max: 100 },
  ];
  const tornado: TornadoItem[] = [];
  for (const s of shocks) {
    const v = baseInput[s.prop] as number;
    const low = simulateAlm(quick({ ...baseInput, [s.prop]: Math.max(0, v - s.delta) })).kpis.maxHole;
    const high = simulateAlm(quick({ ...baseInput, [s.prop]: Math.min(s.max, v + s.delta) })).kpis.maxHole;
    const baseVal = base.kpis.maxHole;
    tornado.push({
      key: s.key, label: s.label, lowLabel: s.lowLabel, highLabel: s.highLabel, low, high, base: baseVal,
      swing: Math.max(low, high, baseVal) - Math.min(low, high, baseVal),
    });
  }
  return tornado.sort((a, b) => b.swing - a.swing);
}

export function runAlmMonteCarlo(baseInput: AlmSimInput, runs: number = 200, intensity: number = 50, seed?: number): {
  runs: number;
  pTipping: number;
  pLoss: number;
  p5: number; p50: number; p95: number; p99: number;
  worstCaseMaxHole: number;
  samples: number[];
} {
  const R = Math.max(1, Math.round(runs));
  const rng = mulberry32(seed ?? 1405);
  const holes: number[] = [];
  let tippingCount = 0;
  let lossCount = 0;
  const shock = intensity / 100;
  for (let i = 0; i < R; i++) {
    const inp: AlmSimInput = quick({ ...baseInput });
    inp.takeUpRatePct = clamp(inp.takeUpRatePct + normal(rng) * shock * 20, 0, 100);
    inp.approvalRatePct = clamp(inp.approvalRatePct + normal(rng) * shock * 15, 0, 100);
    inp.runoffRatePct = clamp(inp.runoffRatePct + normal(rng) * shock * 15, 0, 100);
    inp.churnRatePct = clamp(inp.churnRatePct + normal(rng) * shock * 15, 0, 100);
    inp.interbankRatePct = Math.max(0, inp.interbankRatePct + normal(rng) * shock * 5);
    const res = simulateAlm(inp);
    holes.push(res.kpis.maxHole);
    if (res.kpis.tippingPoint !== null) tippingCount++;
    if (res.kpis.netMargin < 0) lossCount++;
  }
  holes.sort((a, b) => a - b);
  return {
    runs: R,
    pTipping: (tippingCount / R) * 100,
    pLoss: (lossCount / R) * 100,
    p5: quantile(holes, 0.05),
    p50: quantile(holes, 0.5),
    p95: quantile(holes, 0.95),
    p99: quantile(holes, 0.99),
    worstCaseMaxHole: holes[R - 1],
    samples: holes,
  };
}

/** گردکردن سهم‌ها به اعداد صحیح با مجموع دقیق ۱۰۰ (روش بزرگ‌ترین باقی‌مانده). */
export function roundShares(weights: number[]): number[] {
  const total = sum(weights);
  if (!(total > 0)) return weights.map((_, i) => (i === 0 ? 100 : 0));
  const raw = weights.map((w) => (w / total) * 100);
  const out = raw.map(Math.floor);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < 100 - sum(out); k++) out[order[k % order.length][1]]++;
  return out;
}

/**
 * بهینه‌یاب معکوس پله‌ها: سهم پله‌ها با پارامتر «شیب انتظار» θ جابه‌جا می‌شود
 * (sᵢ ∝ s⁰ᵢ · e^{θ·zᵢ} که zᵢ انتظار استانداردشده است) و بهترین طرح امکان‌پذیر گزارش می‌شود.
 * برای هر تعداد پله کار می‌کند.
 */
export function inverseTierDesigner(
  baseInput: AlmSimInput,
  constraints: { maxHoleBillion?: number; minMarginPct?: number; maxLeverage?: number; targetObjective?: "margin" | "liquidity" | "reach" } = {},
) {
  const cfg = JSON.parse(JSON.stringify(baseInput.cfg)) as ProductConfig;
  const originalTiers = cfg.points.tiers ?? [];
  if (originalTiers.length < 2) return null;
  const waits = originalTiers.map((t) => t.waitingMonths);
  const mu = sum(waits) / waits.length;
  const sd = Math.sqrt(sum(waits.map((w) => (w - mu) ** 2)) / waits.length) || 1;
  const baseShares = originalTiers.map((t) => Math.max(1, t.expectedTakeUpShare));
  let best: { score: number; res: AlmResult; violations: string[]; tiers: TieredMurabahaTier[] } | null = null;
  for (let step = -15; step <= 15; step++) {
    const theta = step / 10;
    const shares = roundShares(baseShares.map((s, i) => s * Math.exp(theta * ((waits[i] - mu) / sd))));
    const tiers = originalTiers.map((t, i) => ({ ...t, expectedTakeUpShare: shares[i] }));
    const res = simulateAlm(quick({ ...baseInput, cfg: { ...cfg, points: { ...cfg.points, tiers } } }));
    const violations: string[] = [];
    if (constraints.maxHoleBillion !== undefined && res.kpis.maxHole > constraints.maxHoleBillion) {
      violations.push(`حداکثر حفره ${res.kpis.maxHole.toFixed(1)} میلیارد بیش از سقف ${constraints.maxHoleBillion.toFixed(1)} است`);
    }
    if (constraints.minMarginPct !== undefined && res.kpis.marginOnNetDeposit < constraints.minMarginPct) {
      violations.push(`حاشیه ${res.kpis.marginOnNetDeposit.toFixed(1)}٪ کمتر از حد ${constraints.minMarginPct}٪ است`);
    }
    if (constraints.maxLeverage !== undefined && res.kpis.leverage > constraints.maxLeverage) {
      violations.push(`اهرم ${res.kpis.leverage.toFixed(2)} بیش از سقف ${constraints.maxLeverage} است`);
    }
    const objective =
      constraints.targetObjective === "liquidity" ? -res.kpis.maxHole :
      constraints.targetObjective === "reach" ? res.kpis.borrowers :
      res.kpis.netMargin;
    const score = violations.length === 0 ? objective : -1e9 * violations.length - res.kpis.maxHole;
    if (!best || score > best.score) best = { score, res, violations, tiers };
  }
  return best ? { tiers: best.tiers, objective: best.score, kpis: best.res.kpis, constraintViolations: best.violations } : null;
}

// --------------- ماژول ریسک پیش‌پرداخت ---------------

/**
 * پیش‌پرداخت عقلایی زمانی رخ می‌دهد که نرخ قرارداد از نرخ بازار بالاتر باشد (انگیزه تأمین مجدد).
 * وام ارزان‌تر از بازار معمولاً تا سررسید نگه داشته می‌شود؛ پس فقط نرخ پایه اعمال می‌شود.
 * CPR سالانه به SMM ماهانه تبدیل و درآمد ازدست‌رفته/جریان نقد پیش‌افتاده به‌صورت انتظار دقیق محاسبه می‌شود.
 */
export function modelPrepayment(cfg: ProductConfig, res: AlmResult, marketRatePct: number = 23) {
  if (!cfg.prepayment?.enabled) return undefined;
  const pm: PrepaymentModel = cfg.prepayment;
  const contract: "qard" | "murabaha" = cfg.contract === "qard" ? "qard" : "murabaha";
  let weighted = 0;
  let lostIncome = 0;
  let acceleratedCf = 0;
  const totalC = res.tiers.reduce((s, t) => s + (t.firstMaturity !== null ? t.commitment : 0), 0);
  for (const tr of res.tiers) {
    if (!tr.lends || tr.firstMaturity === null || tr.commitment <= 0) continue;
    const gap = Math.max(0, tr.effectiveRate - marketRatePct);
    const cpr = clamp(pm.baseRate + pm.sensitivityToRateGap * gap, 0, Math.min(100, pm.maxRate)) / 100;
    const smm = 1 - Math.pow(1 - cpr, 1 / 12);
    const sch = splitSchedule(contract, tr.commitment, tr.effectiveRate, tr.tier.repaymentMonths);
    let survive = 1;
    for (let k = 0; k < sch.n; k++) {
      // درآمد قسط k فقط اگر وام تا آن ماه پیش‌پرداخت نشده باشد دریافت می‌شود
      lostIncome += (1 - survive) * sch.inc[k];
      if (k < sch.n - 1) {
        acceleratedCf += survive * smm * sch.bal[k];
        survive *= 1 - smm;
      }
    }
    weighted += cpr * 100 * (totalC > 0 ? tr.commitment / totalC : 0);
  }
  return { avgPrepaymentRate: weighted, lostInterestIncome: lostIncome, acceleratedCashflow: acceleratedCf };
}

// --------------- گیمیفیکیشن سفر انتظار ---------------

export function buildGamificationJourney(cfg: ProductConfig): GameTierResult[] {
  if (!cfg.gamification?.enabled || !cfg.points.tiers.length) return [];
  const g = cfg.gamification;
  const minWait = Math.min(...cfg.points.tiers.map((t) => t.waitingMonths));
  return [...cfg.points.tiers]
    .sort((a, b) => a.waitingMonths - b.waitingMonths)
    .map((tier) => {
      const extraWait = Math.max(0, tier.waitingMonths - minWait);
      const benefit = tier.rate <= 7 ? "تخفیف کارمزد + ورود به قرعه‌کشی بزرگ" :
        tier.loanToAvgDepositPct >= 150 ? "ضریب ۱.۵–۲ برابری تسهیلات" :
        tier.repaymentMonths >= 48 ? "اقساط فوق‌بلند ۴۸–۶۰ ماهه" : "شروع سفر";
      return {
        waitMonths: tier.waitingMonths,
        pointsEarned: extraWait * g.pointsPerExtraWaitMonth,
        benefitUnlocked: benefit,
        tierName: tier.name,
        lotteryChancePct: Math.min(100, extraWait * g.lotteryChancePerMonth),
      };
    });
}

/** جایزه فرضی هر برنده قرعه‌کشی (میلیارد تومان = ۱ میلیون تومان). */
const LOTTERY_PRIZE_B = 0.001;

export function calcGamificationImpact(cfg: ProductConfig, res: AlmResult) {
  if (!cfg.gamification?.enabled) return undefined;
  const g = cfg.gamification;
  // مبنای «انتظار اضافه» کوتاه‌ترین انتظار منوی پله‌هاست
  const minWait = res.tiers.length ? Math.min(...res.tiers.map((t) => t.tier.waitingMonths)) : 0;
  let points = 0, lottery = 0, customers = 0, upgraded = 0;
  for (const t of res.tiers) {
    const extra = Math.max(0, t.tier.waitingMonths - minWait);
    const n = t.customers ?? 0;
    points += n * extra * g.pointsPerExtraWaitMonth;
    lottery += n * Math.min(1, (extra * g.lotteryChancePerMonth) / 100) * LOTTERY_PRIZE_B;
    customers += n;
    if (extra > 0) upgraded += n;
  }
  // فرض: هر ۵۰ امتیاز میانگین به ازای مشتری، ۰.۲ واحد درصد ریزش را کم می‌کند (حداکثر ۱۵٪)
  const avgPoints = customers > 0 ? points / customers : 0;
  const retentionUplift = clamp((avgPoints / 50) * 0.2, 0, 15);
  return {
    totalPointsIssued: points,
    expectedLotteryPayouts: lottery,
    tierUpgradeRate: customers > 0 ? (upgraded / customers) * 100 : 0,
    estimatedRetentionUpliftPct: retentionUplift,
  };
}

// --------------- ماژول ضدنگین (تسهیلات فوری بدون انتظار) ---------------

/** سهم سپرده جدید از مشتریان «عجول» نسبت به سپرده پایه طرح (فرض آموزشی). */
export const ANTI_NEGIN_DEPOSIT_SHARE = 0.15;

/**
 * مشتریان عجول سپرده جدید D_f می‌آورند و همان ماه ۰ وام فوری α_f × D_f می‌گیرند.
 * سپرده آن‌ها مانند وام‌گیرندگان نگین با نرخ runoff پس از اعطا خارج می‌شود (نگه‌داشتن اجباری = سپرده جبرانی ممنوع)؛
 * باقی‌مانده در سررسید وام فوری با نرخ churn خارج می‌شود. مانده نقد این جریان در ماه کف نقدینگی طرح پایه، معیار پوشش حفره است.
 */
export function calcAntiNegin(
  cfg: ProductConfig,
  res: AlmResult,
  reserveRatioPct = cfg.funding.reserveRatio,
  churnRatePct = 40,
  runoffRatePct = 85,
) {
  if (!cfg.antiNegin?.enabled) return undefined;
  const a = cfg.antiNegin;
  const rr = reserveRatioPct / 100;
  const Df = res.kpis.totalDeposit * ANTI_NEGIN_DEPOSIT_SHARE;
  const L = Df * (a.fastLoanAlphaPct / 100);
  const n = Math.max(1, Math.round(a.fastLoanTenor));
  const el = almPd(cfg.risk.minScore) * (COLLATERALS[cfg.risk.collateral] ?? COLLATERALS.scoring).lgd;
  const sch = splitSchedule("murabaha", L, a.fastLoanRate, n);
  const H = res.rows.length - 1;
  const trough = res.kpis.minCumMonth;
  const runoff = clamp(runoffRatePct, 0, 100) / 100;
  // سپرده خالص پس از ذخیره قانونی − وام فوری − خروج سپرده پس از اعطا (ذخیره متناظر آزاد می‌شود)
  let cumAtTrough = Df * (1 - rr) - L - runoff * Df * (1 - rr);
  let income = 0;
  for (let k = 0; k < n; k++) {
    const t = k + 1;
    if (t > H) break;
    income += sch.inc[k] * (1 - el);
    if (t <= trough) cumAtTrough += sch.pmt * (1 - el);
  }
  if (n <= trough) cumAtTrough -= (1 - runoff) * Df * (churnRatePct / 100) * (1 - rr);
  const coverage = res.kpis.maxHole > 1e-9 ? clamp(cumAtTrough / res.kpis.maxHole, 0, 1) : 1;
  return { fastLoanVolume: L, fastLoanIncome: income, holeCoverageByFastLoans: coverage * 100, cashAtTrough: cumAtTrough };
}

// --------------- تابع ورودی اصلی برای اجرای کامل همه تحلیل‌ها ---------------

/** بازار هدف سپرده بالقوه: ۵۰ همت = ۵۰٬۰۰۰ میلیارد تومان (فرض آموزشی). */
export const ALM_MARKET_DEPOSITS_B = 50_000;

export interface AlmDesignerConstraints {
  /** سقف حفره نقدینگی به‌صورت درصد کل سپرده (پیش‌فرض ۴۰٪) */
  maxHolePct?: number;
  /** حداقل حاشیه روی سپرده خالص در افق (٪، پیش‌فرض ۲) */
  minMarginPct?: number;
  /** سقف اهرم تعهدات (پیش‌فرض ۲٫۵) */
  maxLeverage?: number;
  objective?: "margin" | "liquidity" | "reach";
}

export interface FullAlmParams {
  product: ProductConfig;
  marketShare: number; // درصد
  horizon: number;
  scenario?: "base" | "stress" | "fast_growth";
  seed?: number;
  /** نرخ فرصت سپرده‌گذاری مشتری (٪ سالانه، پیش‌فرض ۲۳) — مبنای هزینه تمام‌شده مشتری */
  opportunityRatePct?: number;
  designer?: AlmDesignerConstraints;
}

export function almBaseInput(params: FullAlmParams): AlmSimInput {
  const { product, marketShare, horizon, seed } = params;
  const base: AlmSimInput = {
    cfg: product,
    totalDepositBillionToman: ALM_MARKET_DEPOSITS_B * (marketShare / 100),
    avgTicketMillionToman: 100,
    horizonMonths: horizon,
    takeUpRatePct: product.points.usageRate,
    approvalRatePct: 85,
    runoffRatePct: 85,
    churnRatePct: 40,
    interbankRatePct: 24,
    opportunityRatePct: clamp(params.opportunityRatePct ?? 23, 0, 100),
    reserveRatioPct: product.funding.reserveRatio,
    seed,
  };
  if (params.scenario === "stress") {
    base.takeUpRatePct = clamp(base.takeUpRatePct + 15, 0, 100);
    base.runoffRatePct = clamp(base.runoffRatePct + 10, 0, 100);
    base.churnRatePct = clamp(base.churnRatePct + 20, 0, 100);
    base.interbankRatePct += 6;
  } else if (params.scenario === "fast_growth") {
    base.totalDepositBillionToman *= 1.5;
    base.takeUpRatePct = clamp(base.takeUpRatePct + 10, 0, 100);
    base.approvalRatePct = clamp(base.approvalRatePct + 5, 0, 100);
  }
  return base;
}

export function runFullAlmAnalysis(params: FullAlmParams): FullAlmResult {
  const base = almBaseInput(params);
  const product = params.product;
  const alm = simulateAlm(base);
  const tornado = runAlmTornado(base);
  const stressGrid = runAlmStressGrid(base);
  const mc = runAlmMonteCarlo(base, 300, 50, params.seed);
  const d = params.designer ?? {};
  const opti = inverseTierDesigner(base, {
    maxHoleBillion: base.totalDepositBillionToman * (clamp(d.maxHolePct ?? 40, 0, 100) / 100),
    minMarginPct: d.minMarginPct ?? 2,
    maxLeverage: d.maxLeverage ?? 2.5,
    targetObjective: d.objective ?? "margin",
  });
  return {
    alm,
    analysis: { stressGrid, tornado, monteCarlo: mc, optimalTierDesign: opti ?? undefined },
    prepayment: modelPrepayment(product, alm, base.opportunityRatePct),
    gamification: calcGamificationImpact(product, alm),
    antiNegin: calcAntiNegin(product, alm, base.reserveRatioPct, base.churnRatePct, base.runoffRatePct),
    gamificationJourney: buildGamificationJourney(product),
  };
}

/** پرکردن KPIهای مرتبط سیمرغ از نتیجه ALM (واحدها: میلیارد تومان). */
export function mergeAlmKpisIntoCore(almKpis: AlmKpis, baseKpis: Kpis): Kpis {
  return {
    ...baseKpis,
    depositsAvg: almKpis.totalDeposit,
    fundingCost: almKpis.totalProfitPaid + almKpis.interbankCost,
    fundingBenefit: almKpis.netInterestIncome,
    sourceUseRatio: almKpis.leverage > 0 ? Math.min(RATIO_CAP, 1 / almKpis.leverage) : RATIO_CAP,
  };
}

/** خلاصه یک اجرای ALM برای تاریخچه و مقایسه نسخه‌های طراحی (شامل تصویر پله‌ها). */
export function summarizeAlm(full: FullAlmResult, params: Omit<FullAlmParams, "product">, cfg: ProductConfig): Record<string, unknown> {
  const k = full.alm.kpis;
  const mc = full.analysis.monteCarlo;
  return {
    maxHole: k.maxHole,
    holePct: k.totalDeposit > 0 ? (k.maxHole / k.totalDeposit) * 100 : 0,
    tippingPoint: k.tippingPoint,
    recoveryMonth: k.recoveryMonth,
    netMargin: k.netMargin,
    marginOnNetDeposit: k.marginOnNetDeposit,
    leverage: k.leverage,
    minLcr: k.minLcr,
    nsfrAt12: k.nsfrAt12,
    totalDeposit: k.totalDeposit,
    borrowers: k.borrowers,
    pTipping: mc?.pTipping ?? null,
    p95Hole: mc?.p95 ?? null,
    marketShare: params.marketShare,
    horizon: params.horizon,
    scenario: params.scenario ?? "base",
    opportunityRatePct: params.opportunityRatePct ?? 23,
    tiers: effectiveTiers(cfg).map((t) => ({
      name: t.name, wait: t.waitingMonths, alpha: t.loanToAvgDepositPct, rate: t.rate, tenor: t.repaymentMonths, share: t.expectedTakeUpShare,
    })),
  };
}

/** نسخه فشرده نتیجه برای ذخیره در پایگاه داده (بدون رویدادهای ماهانه و منوی گزینه‌ها که قابل بازتولیدند). */
export function compactAlmResult(full: FullAlmResult): FullAlmResult {
  return {
    ...full,
    alm: {
      ...full.alm,
      rows: full.alm.rows.map((r) => ({ ...r, events: [] })),
      customerOptions: [],
      paretoFrontier: full.alm.paretoFrontier,
    },
    analysis: full.analysis.monteCarlo
      ? { ...full.analysis, monteCarlo: { ...full.analysis.monteCarlo, samples: [] } }
      : full.analysis,
  };
}
