// =========================================================================
//  موتور شبیه‌سازی ALM (دارایی-بدهی) برای محصولات امتیازی چندپله‌ای
//  پورت و بسط‌یافته از مخزن alm-simulation-engine-development برای سیمرغ
// =========================================================================
import type {
  AlmFlowEvent,
  AlmKpis,
  AlmMonthRow,
  AlmResult,
  AlmTierResult,
  FullAlmResult,
  GameTierResult,
  Kpis,
  NeginCustomerOption,
  PrepaymentModel,
  ProductConfig,
  SimParams,
  TieredMurabahaTier,
} from "./types";

// --------------- ابزارهای ریاضی پایه ---------------

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  // بوکس-مولر
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** قسط ماهانه قرض‌الحسنه با کارمزد ساده سالانه */
export function pmtQard(principal: number, feePct: number, months: number): number {
  const fee = principal * (feePct / 100) * (months / 12);
  return months > 0 ? (principal + fee) / months : principal;
}

/** قسط ماهانه مرابحه (اقساط مساوی = فرمول استاندارد وام) */
export function pmtMurabaha(principal: number, annualRatePct: number, months: number): number {
  if (annualRatePct <= 0 || months <= 0) return months > 0 ? principal / months : principal;
  const rm = annualRatePct / 100 / 12;
  return (principal * rm * Math.pow(1 + rm, months)) / (Math.pow(1 + rm, months) - 1);
}

export function pmtFor(contract: "qard" | "murabaha", principal: number, rate: number, months: number): number {
  return contract === "qard" ? pmtQard(principal, rate, months) : pmtMurabaha(principal, rate, months);
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

/**
 * تولید تمام ~۲۵۰ گزینه انتخابی مشتری برای یک میانگین سپرده معین
 */
export function generateNeginOptions(
  avgBalanceMillionToman: number,
  cfg: ProductConfig,
  opportunityRatePct: number = 23,
): NeginCustomerOption[] {
  const pts = cfg.points;
  const minWait = Math.ceil(pts.minHoldingDays / 30);
  const maxWait = 12;
  const out: NeginCustomerOption[] = [];
  let idx = 0;
    for (let wait = minWait; wait <= maxWait; wait++) {
    const extra = wait - minWait;
    const allocs = enumerateWaitAllocations(extra, cfg);
    for (const alloc of allocs) {
      const alphaPct = clamp(25 + alloc.amountBoostMonths * pts.alphaStepPerWaitMonth, 25, 200);
      const tenor = clamp(16 + alloc.tenorBoostMonths * pts.tenorStepPerWaitMonth, 16, 60);
      const rate = clamp(23 - alloc.rateCutMonths * pts.rateCutPerWaitMonth, 5, 23);
      let loan = (alphaPct / 100) * avgBalanceMillionToman;
      loan = Math.min(loan, pts.individualLoanCap);
      const alphaVal = alphaPct;
      const installment = pmtMurabaha(loan, rate, tenor);
      const totalRepay = installment * tenor;
      const interest = totalRepay - loan;
      // هزینه فرصت سپرده‌گذاری (با نرخ فرصت بازار منهای سود پرداختی بانک)
      const oppCost = avgBalanceMillionToman * ((opportunityRatePct - pts.depositRate) / 100) * (wait / 12);
      const depositProfit = avgBalanceMillionToman * (pts.depositRate / 100) * (wait / 12);
      const effectiveCost = totalRepay + oppCost - depositProfit;
      // محاسبه بازده مؤثر سالانه بانک (با تقریب ساده)
      const annFactor = rate > 0 ? (Math.pow(1 + rate / 1200, tenor) - 1) / (rate / 1200 * Math.pow(1 + rate / 1200, tenor)) : tenor;
      const bankAnnualYield = annFactor > 0 ? (installment * 12) / (loan * annFactor) * (tenor / 12) * 100 : 0;
      // مطلوبیت مشتری (۰ تا ۱۰۰): وام بیشتر، اقساط بلندتر، نرخ کمتر، انتظار کوتاه‌تر
      const loanScore = clamp(loan / Math.max(1, pts.individualLoanCap) * 100, 0, 100);
      const rateScore = clamp((23 - rate) / 18 * 100, 0, 100);
      const tenorScore = clamp((tenor - 16) / 44 * 100, 0, 100);
      const waitPenalty = wait / 12 * 50;
      const customerUtility = clamp(loanScore * 0.3 + rateScore * 0.4 + tenorScore * 0.3 - waitPenalty + 50, 0, 100);
      out.push({
        comboId: `c${idx++}`,
        loanAmount: Math.round(loan * 100) / 100,
        tenor,
        rate,
        alpha: alphaVal,
        waitingMonths: wait,
        monthlyInstallment: Math.round(installment * 1000) / 1000,
        totalRepayment: Math.round(totalRepay * 100) / 100,
        opportunityCost: Math.round(oppCost * 100) / 100,
        effectiveCustomerCost: Math.round(effectiveCost * 100) / 100,
        bankEffectiveYield: Math.max(0, rate - 2), // ساده‌سازی
        customerUtility,
        paretoOptimal: false,
      });
    }
  }
  // محاسبه نقاط پارتو (غیرمغلوب)
  // نقاطی بهترند که هم مطلوبیت مشتری بالاتر و هم بازده بانک بیشتر باشد
  for (let i = 0; i < out.length; i++) {
    let dominated = false;
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue;
      if (
        out[j].customerUtility >= out[i].customerUtility &&
        out[j].bankEffectiveYield >= out[i].bankEffectiveYield &&
        (out[j].customerUtility > out[i].customerUtility || out[j].bankEffectiveYield > out[i].bankEffectiveYield)
      ) {
        dominated = true;
        break;
      }
    }
    out[i].paretoOptimal = !dominated;
  }
  return out;
}

// --------------- هسته شبیه‌سازی جریان نقد ALM ---------------

export interface AlmSimInput {
  cfg: ProductConfig;
  totalDepositBillionToman: number; // کل سپرده جذب شده (میلیارد تومان)
  avgTicketMillionToman: number;   // میانگین سپرده هر مشتری
  horizonMonths: number;
  takeUpRatePct: number;
  approvalRatePct: number;
  runoffRatePct: number;     // نرخ خروج سپرده وام‌گیرندگان
  churnRatePct: number;      // نرخ خروج سپرده انصرافی‌ها
  interbankRatePct: number;
  opportunityRatePct: number;
  reserveRatioPct: number;
  seed?: number;
}

export function simulateAlm(inp: AlmSimInput): AlmResult {
  const t0 = Date.now();
  const {
    cfg,
    totalDepositBillionToman,
    avgTicketMillionToman,
    horizonMonths,
    takeUpRatePct,
    approvalRatePct,
    runoffRatePct,
    churnRatePct,
    interbankRatePct,
    opportunityRatePct,
    reserveRatioPct,
  } = inp;
  const totalDeposit = totalDepositBillionToman; // به میلیارد
  const avgTicket = avgTicketMillionToman / 1000; // به میلیارد
  const pts = cfg.points;
  const isQard = cfg.contract === "qard";
  const nCustomers = Math.round(totalDeposit / avgTicket);

  // نرمال‌سازی سهم تخصیص پله‌ها
  let tiers: TieredMurabahaTier[] = [];
  if (pts.mode === "tiered_murabaha" && pts.tiers && pts.tiers.length > 0) {
    tiers = pts.tiers.map((t, i) => ({ ...t, id: t.id ?? `t${i}` }));
  } else {
    // اگر پله تعریف نشده، یک پله تکی ساده بساز
    tiers = [{
      name: "تک‌حالت",
      waitingMonths: Math.max(1, Math.ceil(pts.minHoldingDays / 30)),
      repaymentMonths: cfg.credit.tenor,
      loanToAvgDepositPct: clamp(pts.coefficient * 100, 25, 200),
      rate: isQard ? pts.loanFee : cfg.credit.rate,
      minAvgDeposit: 0,
      expectedTakeUpShare: 100,
      id: "t0",
    }];
  }
  const totalShare = Math.max(1, sum(tiers.map((t) => t.expectedTakeUpShare)));

  // آماده‌سازی آرایه ماه‌ها
  const H = Math.max(1, horizonMonths);
  const rows: AlmMonthRow[] = [];
  for (let t = 0; t <= H; t++) {
    rows.push({
      t, depositGross: 0, reserveHeld: 0, reserveRelease: 0, depositNet: 0,
      pmtInflow: 0, principalIn: 0, incomeIn: 0, inflow: 0,
      loanOut: 0, withdrawalOut: 0, profitPaid: 0, fundingCost: 0,
      provisionCost: 0, writeOff: 0, outflow: 0, ncf: 0, cum: 0,
      depositBalance: 0, loanBook: 0, cumMargin: 0, events: [],
    });
  }

  const tierResults: AlmTierResult[] = [];
  let totalCommitment = 0, totalWithdrawal = 0, totalPmt = 0, totalIncome = 0;
  let totalProfitPaid = 0, totalProvision = 0, totalWriteOff = 0, interbankCost = 0;
  let borrowers = 0, peakOutflow = 0, peakMonth = 0;
  let cum = 0, cumMargin = 0;
  let depositBalance = 0, loanBook = 0;
  let reserveHeld = 0, netDeposit = 0;

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const tierDepositShare = tier.expectedTakeUpShare / totalShare;
    const tierDeposit = totalDeposit * tierDepositShare;
    const tierCustomers = Math.round(nCustomers * tierDepositShare);
    const rate = tier.rate;
    const tDep = tier.waitingMonths;
    const tLoan = tier.repaymentMonths;
    const alphaPct = tier.loanToAvgDepositPct;
    const alphaEff = Math.min(alphaPct, (pts.individualLoanCap / 1000) / Math.max(0.001, avgTicket)) * (tier.minAvgDeposit / 1000 <= avgTicket ? 1 : 0);
    const alphaDecimal = alphaEff / 100;
    const capBinding = alphaPct > (pts.individualLoanCap / 1000) / Math.max(0.001, avgTicket);
    const eligible = avgTicket >= tier.minAvgDeposit / 1000 && alphaEff > 0;
    const lends = eligible;

    // ورود سپرده در ماه ۰ (ورود یکجا - برای سادگی می‌توان در نسخه بعدی زمان‌بندی uniform/custom اضافه کرد)
    const depMonth = 0;
    const depositGross = tierDeposit;
    const reserve = depositGross * (reserveRatioPct / 100);
    const depNet = depositGross - reserve;
    if (depMonth <= H) {
      rows[depMonth].depositGross += depositGross;
      rows[depMonth].reserveHeld += reserve;
      rows[depMonth].depositNet += depNet;
      depositBalance += depositGross;
      reserveHeld += reserve;
      netDeposit += depNet;
      rows[depMonth].events.push({
        type: "deposit", tierId: tier.id!, tierName: tier.name, tierIndex: i, amount: depositGross, vintageMonth: depMonth,
      });
      rows[depMonth].events.push({
        type: "reserve", tierId: tier.id!, tierName: tier.name, tierIndex: i, amount: reserve, vintageMonth: depMonth,
      });
    }

    // محاسبه تعهد و خروج در سررسید انتظار
    const commitment = lends ? depNet * (takeUpRatePct / 100) * (approvalRatePct / 100) * alphaDecimal : 0;
    const withdrawal = lends
      ? depNet * ((takeUpRatePct / 100) * (runoffRatePct / 100) + (1 - takeUpRatePct / 100) * (churnRatePct / 100))
      : depNet * (churnRatePct / 100);

    // نرخ نکول و ذخیره (از پارامتر محصول)
    const pd = clamp(cfg.risk.minScore < 550 ? 0.08 : 0.04, 0.005, 0.2);
    const lgd = 0.65;
    const provision = commitment * pd * lgd;
    const writeOff = provision; // در پایان افق سوخت می‌شود (ساده‌سازی)

    // اقساط
    const monthlyPmt = pmtFor(isQard ? "qard" : "murabaha", commitment, rate, tLoan);
    const totalRepay = monthlyPmt * tLoan;
    const totalIncomeTier = totalRepay - commitment;
    const pmtPerMonth = monthlyPmt;

    const disbMonth = Math.min(H, tDep);
    if (disbMonth <= H) {
      rows[disbMonth].loanOut += commitment;
      rows[disbMonth].withdrawalOut += withdrawal;
      loanBook += commitment;
      // سود ماه‌شمار روی مانده سپرده تا این ماه
      for (let m = depMonth; m < disbMonth && m <= H; m++) {
        const avgBal = depositBalance; // ساده‌سازی
        const profit = avgBal * (pts.depositRate / 100) / 12 * tierDepositShare;
        rows[m].profitPaid += profit;
        totalProfitPaid += profit;
      }
      rows[disbMonth].events.push({
        type: "loan", tierId: tier.id!, tierName: tier.name, tierIndex: i, amount: commitment,
        vintageMonth: depMonth, instFrom: disbMonth, instTo: Math.min(H, disbMonth + tLoan - 1), instTotal: tLoan,
      });
      rows[disbMonth].events.push({
        type: "withdrawal", tierId: tier.id!, tierName: tier.name, tierIndex: i, amount: withdrawal, vintageMonth: depMonth,
      });
      rows[disbMonth].provisionCost += provision;
      totalProvision += provision;
    }

    // اقساط ماهانه
    for (let k = 0; k < tLoan; k++) {
      const m = disbMonth + k;
      if (m > H) break;
      let principal = 0; let income = 0;
      if (isQard) {
        principal = commitment / tLoan;
        income = (commitment * (rate / 100) * (tLoan / 12)) / tLoan; // کارمزد توزیع یکنواخت
      } else {
        const rm = rate / 100 / 12;
        const balStart = k === 0 ? commitment : (rows[m-1] ? (loanBook - commitment) : commitment); // ساده‌سازی
        const interest = commitment * rm * Math.pow(1 + rm, k) / (Math.pow(1 + rm, tLoan) - 1);
        principal = pmtPerMonth - interest;
        income = interest;
      }
      rows[m].pmtInflow += pmtPerMonth;
      rows[m].principalIn += principal;
      rows[m].incomeIn += income;
      if (m <= H) loanBook = Math.max(0, loanBook - principal);
      totalPmt += pmtPerMonth;
      totalIncome += income;
      if (m <= H) {
        rows[m].events.push({
          type: "pmt", tierId: tier.id!, tierName: tier.name, tierIndex: i, amount: pmtPerMonth,
          vintageMonth: depMonth, instFrom: m, instTo: m, instTotal: 1,
        });
      }
    }

    // آزادسازی سپرده قانونی در زمان خروج
    const withMonth = Math.min(H, disbMonth);
    if (withMonth <= H) {
      const resRel = reserve;
      rows[withMonth].reserveRelease += resRel;
      reserveHeld -= resRel;
      depositBalance -= depositGross * (takeUpRatePct / 100) * (runoffRatePct / 100);
      depositBalance -= depositGross * (1 - takeUpRatePct / 100) * (churnRatePct / 100);
    }

    // هزینه فرصت و شکاف منافع برای مشتری
    const unitDep = avgTicket; // به میلیارد
    const unitLoan = (alphaEff / 100) * unitDep;
    const unitPmt = pmtFor(isQard ? "qard" : "murabaha", unitLoan, rate, tLoan);
    const oppCost = unitDep * ((opportunityRatePct - pts.depositRate) / 100) * (tDep / 12);
    const custEffCost = unitPmt * tLoan + oppCost - unitDep * (pts.depositRate / 100) * (tDep / 12);
    // IRR ساده مشتری
    const custIrr = unitLoan > 0 && unitPmt > 0 ? ((unitPmt * tLoan - unitLoan) / unitLoan) * (12 / tLoan) * 100 : 0;
    const interestGap = rate - custIrr; // مثبت یعنی سود بانک بیشتر از نرخ اسمی

    tierResults.push({
      tier, index: i, share: tierDepositShare * 100,
      deposit: tierDeposit, alphaEff, capBinding, repBalance: commitment,
      eligible, lends, effectiveRate: rate, commitment, withdrawal,
      monthlyPmt: pmtPerMonth, totalRepay, totalIncome: totalIncomeTier,
      borrowers: Math.round(tierCustomers * (takeUpRatePct / 100) * (approvalRatePct / 100)),
      firstMaturity: disbMonth, lastMaturity: disbMonth + tLoan,
      unitPay: unitPmt, customerOpportunityCost: oppCost * 1000, // میلیون تومان
      customerEffectiveCost: custEffCost * 1000, customerIrr: custIrr, interestGap,
    });
    totalCommitment += commitment;
    totalWithdrawal += withdrawal;
    borrowers += Math.round(tierCustomers * (takeUpRatePct / 100) * (approvalRatePct / 100));
  }

  // نهایی‌سازی ردیف‌های ماهانه و محاسبه NCF و Cum
  for (let t = 0; t <= H; t++) {
    const r = rows[t];
    r.inflow = r.depositNet + r.pmtInflow + r.reserveRelease;
    r.outflow = r.loanOut + r.withdrawalOut + r.profitPaid + r.fundingCost;
    r.ncf = r.inflow - r.outflow;
    cum += r.ncf;
    r.cum = cum;
    r.depositBalance = depositBalance;
    r.loanBook = loanBook;
    // هزینه تأمین بین‌بانکی برای کسری
    if (cum < 0) {
      r.fundingCost = (-cum) * (interbankRatePct / 100) / 12;
      interbankCost += r.fundingCost;
      cum += r.ncf; // r.cum به‌روز شد
      r.outflow += r.fundingCost;
      r.cum = cum;
    }
    cumMargin += r.incomeIn - r.profitPaid - r.fundingCost - r.provisionCost;
    r.cumMargin = cumMargin;
    if (t === H) totalWriteOff += totalProvision * 0.5; // فرض سوخت نهایی ۵۰٪ ذخایر
    const outflowT = r.outflow;
    if (outflowT > peakOutflow) {
      peakOutflow = outflowT;
      peakMonth = t;
    }
  }

  // محاسبه KPIهای نقدینگی
  let minCum = Infinity, minCumMonth = -1, maxHole = 0;
  let tippingPoint: number | null = null;
  let recoveryMonth: number | null = null;
  let deficitMonths = 0;
  for (let t = 0; t <= H; t++) {
    const c = rows[t].cum;
    if (c < minCum) { minCum = c; minCumMonth = t; }
    if (c < 0) {
      maxHole = Math.max(maxHole, -c);
      deficitMonths++;
      if (tippingPoint === null) tippingPoint = t;
    } else if (c >= 0 && tippingPoint !== null && recoveryMonth === null) {
      recoveryMonth = t;
    }
  }
  const endCum = rows[H].cum;
  const leverage = netDeposit > 0 ? (totalCommitment + totalWithdrawal) / netDeposit : Infinity;
  const netInterestIncome = totalIncome - totalProfitPaid;
  const netMargin = netInterestIncome - interbankCost - totalProvision;
  const marginOnNet = netDeposit !== 0 ? (netMargin / netDeposit) * 100 : (netMargin >= 0 ? Infinity : -Infinity);

  // سنجه‌های مقرراتی آموزشی
  // LCR ساده: HQLA ≈ CumLiq مثبت، خروج استرس = با فرض ۳۰ روز
  let minLcr = Infinity;
  for (let t = 1; t <= H; t++) {
    const out30 = rows[t].outflow + 0.05 * Math.max(0, rows[t].depositBalance);
    if (out30 > 0) {
      const lcr = Math.max(0, rows[t].cum) / out30 * 100;
      if (lcr < minLcr) minLcr = lcr;
    }
  }
  // NSFR در ماه ۱۲ (درصد)
  const r12 = rows[Math.min(12, H)];
  const nsfr = r12.loanBook > 0 ? (r12.depositBalance * 0.9) / (r12.loanBook * 0.85) * 100 : 0;
  // WAL (میانگین وزنی سررسید) ساده
  let walA = 0, walL = 0, wA = 0, wL = 0;
  for (const tr of tierResults) {
    if (tr.commitment > 0) {
      walA += (tr.firstMaturity! + tr.tier.repaymentMonths / 2) * tr.commitment;
      wA += tr.commitment;
    }
    if (tr.withdrawal > 0) {
      walL += tr.firstMaturity! * tr.withdrawal;
      wL += tr.withdrawal;
    }
  }
  const walAssets = wA > 0 ? walA / wA : 0;
  const walLiabilities = wL > 0 ? walL / wL : 0;
  const maturityGap = walAssets - walLiabilities;

  const kpis: AlmKpis = {
    totalDeposit, netDeposit, reserveHeld, totalCommitment, totalWithdrawal, leverage,
    minCum: minCum === Infinity ? 0 : minCum, minCumMonth, maxHole, tippingPoint,
    recoveryMonth, deficitMonths, endCum, totalPmtInHorizon: totalPmt,
    totalIncomeInHorizon: totalIncome, pmtBeyondHorizon: 0,
    interbankCost, borrowers, peakOutflow, peakOutflowMonth: peakMonth,
    totalProfitPaid, netInterestIncome, totalProvision, totalWriteOff, netMargin,
    marginOnNetDeposit: marginOnNet, minLcr: minLcr === Infinity ? 0 : minLcr,
    nsfrAt12: nsfr, walAssets, walLiabilities, maturityGap,
  };

  // گزینه‌های مشتری (برای یک مشتری با میانگین سپرده معیار ۱۰۰ میلیون)
  const customerOptions = generateNeginOptions(100, cfg, opportunityRatePct);
  const paretoFrontier = customerOptions.filter((o) => o.paretoOptimal);

  return {
    rows, tiers: tierResults, kpis, customerOptions, paretoFrontier,
    durationMs: Date.now() - t0,
  };
}

// --------------- تحلیل استرس، گردبادی و مونت‌کارلو ALM ---------------

export function runAlmStressGrid(baseInput: AlmSimInput, paramOverrides: Partial<AlmSimInput>[]): {
  results: AlmResult[];
  tornado?: import("./types").TornadoItem[];
} {
  const results: AlmResult[] = [];
  for (const ov of paramOverrides) {
    results.push(simulateAlm({ ...baseInput, ...ov }));
  }
  return { results };
}

export function runAlmTornado(baseInput: AlmSimInput): import("./types").TornadoItem[] {
  const base = simulateAlm(baseInput);
  const shocks: { key: string; label: string; lowLabel: string; highLabel: string; prop: keyof AlmSimInput; delta: number }[] = [
    { key: "takeUp", label: "نرخ تقاضای وام", lowLabel: "-۲۰٪", highLabel: "+۲۰٪", prop: "takeUpRatePct", delta: 20 },
    { key: "approval", label: "نرخ تأیید", lowLabel: "-۲۰٪", highLabel: "+۲۰٪", prop: "approvalRatePct", delta: 20 },
    { key: "runoff", label: "نرخ خروج وام‌گیرندگان", lowLabel: "-۲۰٪", highLabel: "+۲۰٪", prop: "runoffRatePct", delta: 20 },
    { key: "churn", label: "نرخ ریزش انصرافی‌ها", lowLabel: "-۲۰٪", highLabel: "+۲۰٪", prop: "churnRatePct", delta: 20 },
    { key: "interbank", label: "نرخ بین‌بانکی", lowLabel: "-۴٪", highLabel: "+۴٪", prop: "interbankRatePct", delta: 4 },
    { key: "reserve", label: "سپرده قانونی", lowLabel: "-۲٪", highLabel: "+۲٪", prop: "reserveRatioPct", delta: 2 },
  ];
  const tornado: import("./types").TornadoItem[] = [];
  for (const s of shocks) {
    const lowInp = { ...baseInput };
    (lowInp as any)[s.prop] = Math.max(0, (baseInput[s.prop] as number) - s.delta);
    const highInp = { ...baseInput };
    (highInp as any)[s.prop] = Math.min(100, (baseInput[s.prop] as number) + s.delta);
    const lowRes = simulateAlm(lowInp);
    const highRes = simulateAlm(highInp);
    const low = lowRes.kpis.maxHole;
    const high = highRes.kpis.maxHole;
    const baseVal = base.kpis.maxHole;
    const swing = Math.max(low, high, baseVal) - Math.min(low, high, baseVal);
    tornado.push({
      key: s.key, label: s.label, lowLabel: s.lowLabel, highLabel: s.highLabel,
      low, high, base: baseVal, swing,
    });
  }
  tornado.sort((a, b) => b.swing - a.swing);
  return tornado;
}

export function runAlmMonteCarlo(baseInput: AlmSimInput, runs: number = 200, intensity: number = 50, seed?: number): {
  runs: number;
  pTipping: number;
  pLoss: number;
  p5: number; p50: number; p95: number; p99: number;
  worstCaseMaxHole: number;
  samples: number[];
} {
  const rng = mulberry32(seed ?? 1405);
  const holes: number[] = [];
  let tippingCount = 0;
  let lossCount = 0;
  for (let i = 0; i < runs; i++) {
    const inp: AlmSimInput = { ...baseInput };
    const shock = intensity / 100;
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
  const idx = (p: number) => clamp(Math.floor(p * runs), 0, runs - 1);
  return {
    runs,
    pTipping: (tippingCount / runs) * 100,
    pLoss: (lossCount / runs) * 100,
    p5: holes[idx(0.05)],
    p50: holes[idx(0.5)],
    p95: holes[idx(0.95)],
    p99: holes[idx(0.99)],
    worstCaseMaxHole: holes[runs - 1],
    samples: holes,
  };
}

/** بهینه‌یاب معکوس پله‌ها: جست‌وجو برای یافتن تخصیص بهینه با قیود نقدینگی */
export function inverseTierDesigner(
  baseInput: AlmSimInput,
  constraints: { maxHoleBillion?: number; minMarginPct?: number; maxLeverage?: number; targetObjective?: "margin" | "liquidity" | "reach" } = {},
) {
  const cfg = JSON.parse(JSON.stringify(baseInput.cfg)) as ProductConfig;
  const originalTiers = cfg.points.tiers;
  let best: { score: number; res: AlmResult; violations: string[]; tiers: TieredMurabahaTier[] } | null = null;

  // جست‌وجوی شبکه‌ای روی سهم‌های تخصیص
  const shareGrid = [5, 10, 15, 20, 25, 30];
  for (let s0 = 5; s0 <= 40; s0 += 5) {
    for (let s6 = 2; s6 <= 15; s6 += 1) {
      const remaining = 100 - s0 - s6;
      const rest = [0.2, 0.18, 0.14, 0.1, 0.07];
      if (remaining < 30) continue;
      const shares = [s0, ...rest.map((_r, i) => i === rest.length - 1 ? remaining - sum(rest.slice(0, -1).map(rrest => rrest * remaining)) : Math.round(_r * remaining)), s6];
      // اطمینان از مجموع ۱۰۰
      const total = sum(shares);
      for (let i = 0; i < shares.length; i++) shares[i] = Math.round(shares[i] / total * 100);
      const diff = 100 - sum(shares);
      shares[0] += diff;
      cfg.points.tiers = originalTiers.map((t, i) => ({ ...t, expectedTakeUpShare: shares[i] }));
      const inp = { ...baseInput, cfg };
      const res = simulateAlm(inp);
      const violations: string[] = [];
      if (constraints.maxHoleBillion && res.kpis.maxHole > constraints.maxHoleBillion) {
        violations.push(`حداکثر حفره ${res.kpis.maxHole.toFixed(1)} میلیارد بیش از سقف ${constraints.maxHoleBillion} است`);
      }
      if (constraints.minMarginPct && res.kpis.marginOnNetDeposit < constraints.minMarginPct) {
        violations.push(`حاشیه ${res.kpis.marginOnNetDeposit.toFixed(1)}٪ کمتر از حد ${constraints.minMarginPct}٪ است`);
      }
      if (constraints.maxLeverage && isFinite(res.kpis.leverage) && res.kpis.leverage > constraints.maxLeverage) {
        violations.push(`اهرم ${res.kpis.leverage.toFixed(2)} بیش از سقف ${constraints.maxLeverage} است`);
      }
      const score = violations.length === 0
        ? (constraints.targetObjective === "margin" ? res.kpis.netMargin :
           constraints.targetObjective === "liquidity" ? -res.kpis.maxHole :
           res.kpis.borrowers)
        : -violations.length * 1e6 - res.kpis.maxHole;
      if (!best || score > best.score) {
        best = { score, res, violations, tiers: cfg.points.tiers };
      }
    }
  }
  return best ? {
    tiers: best.tiers, objective: best.score, kpis: best.res.kpis, constraintViolations: best.violations,
  } : null;
}

// --------------- ماژول ریسک پیش‌پرداخت ---------------

export function modelPrepayment(cfg: ProductConfig, res: AlmResult, marketRatePct: number = 23) {
  if (!cfg.prepayment?.enabled) return undefined;
  const pm: PrepaymentModel = cfg.prepayment;
  let totalPrepayPct = 0;
  let lostIncome = 0;
  let acceleratedCf = 0;
  let count = 0;
  for (const tr of res.tiers) {
    if (!tr.lends) continue;
    const rateGap = Math.max(0, marketRatePct - tr.effectiveRate); // وام ارزان‌تر از بازار = پیش‌پرداخت بیشتر
    const prepayRate = clamp(pm.baseRate + pm.sensitivityToRateGap * rateGap, 0, pm.maxRate);
    totalPrepayPct += prepayRate * (tr.commitment / Math.max(0.001, res.kpis.totalCommitment));
    // درآمد از دست رفته (اقساط باقی‌مانده که نرخش جذاب است و پیش‌پرداخت می‌شود)
    const remainingIncome = tr.totalIncome * (prepayRate / 100) * 0.5; // میانگین نصف عمر
    lostIncome += remainingIncome;
    acceleratedCf += tr.commitment * (prepayRate / 100);
    count++;
  }
  return {
    avgPrepaymentRate: count > 0 ? totalPrepayPct : 0,
    lostInterestIncome: lostIncome,
    acceleratedCashflow: acceleratedCf,
  };
}

// --------------- گیمیفیکیشن سفر انتظار ---------------

export function buildGamificationJourney(cfg: ProductConfig): GameTierResult[] {
  if (!cfg.gamification?.enabled || !cfg.points.tiers.length) return [];
  const g = cfg.gamification;
  const pts = cfg.points;
  const journey: GameTierResult[] = [];
  let cumulativePoints = 0;
  for (const tier of pts.tiers) {
    const extraWait = Math.max(0, tier.waitingMonths - Math.ceil(pts.minHoldingDays / 30));
    cumulativePoints += extraWait * g.pointsPerExtraWaitMonth;
    const benefit = tier.rate <= 7 ? "تخفیف ۱۰۰٪ کارمزد + ورود به قرعه‌کشی بزرگ" :
      tier.loanToAvgDepositPct >= 150 ? "ضریب ۱.۵–۲ برابری تسهیلات" :
      tier.repaymentMonths >= 48 ? "اقساط فوق‌بلند ۴۸–۶۰ ماهه" : "شروع سفر";
    journey.push({
      waitMonths: tier.waitingMonths,
      pointsEarned: cumulativePoints,
      benefitUnlocked: benefit,
      tierName: tier.name,
      lotteryChancePct: extraWait * g.lotteryChancePerMonth,
    });
  }
  return journey;
}

export function calcGamificationImpact(cfg: ProductConfig, res: AlmResult) {
  if (!cfg.gamification?.enabled) return undefined;
  // تخمین تأثیر گیمیفیکیشن بر اساس افزایش ماندگاری و مشارکت
  const g = cfg.gamification;
  // فرض: به ازای هر ۵۰ امتیاز در ماه، ۰.۲ واحد درصد نرخ ریزش کاهش می‌یابد
  const maxPoints = sum(res.tiers.map((t) => Math.max(0, t.tier.waitingMonths - 2))) * g.pointsPerExtraWaitMonth;
  const retentionUplift = clamp(maxPoints / 50 * 0.2, 1, 15); // تا ۱۵٪ کاهش ریزش
  const borrowersExtra = res.kpis.borrowers * (retentionUplift / 100);
  const totalPoints = maxPoints * res.kpis.borrowers / 1000000; // ساده‌سازی
  const expectedLottery = res.kpis.borrowers * sum(res.tiers.map(t =>
    Math.max(0, t.tier.waitingMonths - 2) * g.lotteryChancePerMonth / 100)) * 0.001; // جایزه ۰.۰۰۱ میلیارد برای هر برنده
  return {
    totalPointsIssued: totalPoints,
    expectedLotteryPayouts: expectedLottery,
    tierUpgradeRate: 12 + retentionUplift, // درصد
    estimatedRetentionUpliftPct: retentionUplift,
  };
}

// --------------- ماژول ضدنگین (تسهیلات فوری بدون انتظار) ---------------

export function calcAntiNegin(cfg: ProductConfig, res: AlmResult) {
  if (!cfg.antiNegin?.enabled) return undefined;
  const a = cfg.antiNegin;
  // فرض: ۱۵٪ از سپرده‌گذاران بالقوه که صبر ندارند، به تسهیلات فوری ۲۳٪ مراجعه می‌کنند
  const potentialDepositors = res.kpis.totalDeposit / 0.1; // فرض اینکه سپرده نگین ۱۰٪ بازار است
  const fastDeposits = potentialDepositors * 0.15; // جذب سپرده جدید از طریق این محصول
  const fastLoanVolume = fastDeposits * (a.fastLoanAlphaPct / 100);
  const fastPmt = pmtMurabaha(fastLoanVolume, a.fastLoanRate, a.fastLoanTenor);
  const fastIncome = fastPmt * a.fastLoanTenor - fastLoanVolume;
  // پوشش حفره: این تسهیلات کوتاه‌مدت و با نرخ بالا هستند و جریان نقد ورودی زودهنگام ایجاد می‌کنند
  const holeCoverage = Math.min(1, fastIncome / Math.max(0.001, res.kpis.maxHole));
  return {
    fastLoanVolume,
    fastLoanIncome: fastIncome,
    holeCoverageByFastLoans: holeCoverage * 100,
  };
}

// --------------- تابع ورودی اصلی برای اجرای کامل همه تحلیل‌ها ---------------

export interface FullAlmParams {
  product: ProductConfig;
  marketShare: number; // درصد
  horizon: number;
  scenario?: "base" | "stress" | "fast_growth";
  seed?: number;
}

export function runFullAlmAnalysis(params: FullAlmParams): FullAlmResult {
  const { product, marketShare, horizon, seed } = params;
  // فرض بازار هدف ۵۰ هزار میلیارد تومان سپرده بالقوه
  const totalDepB = 50 * (marketShare / 100);
  const base: AlmSimInput = {
    cfg: product,
    totalDepositBillionToman: totalDepB,
    avgTicketMillionToman: 100,
    horizonMonths: horizon,
    takeUpRatePct: product.points.usageRate,
    approvalRatePct: 85,
    runoffRatePct: 85,
    churnRatePct: 40,
    interbankRatePct: 24,
    opportunityRatePct: 23,
    reserveRatioPct: product.funding.reserveRatio,
    seed,
  };
  const alm = simulateAlm(base);
  const tornado = runAlmTornado(base);
  const mc = runAlmMonteCarlo(base, 300, 50, seed);
  const opti = inverseTierDesigner(base, { maxHoleBillion: totalDepB * 0.4, minMarginPct: 2, maxLeverage: 2.5, targetObjective: "margin" });
  const prepayment = modelPrepayment(product, alm);
  const gamificationJourney = buildGamificationJourney(product);
  const gamification = calcGamificationImpact(product, alm);
  const antiNegin = calcAntiNegin(product, alm);

  return {
    alm,
    analysis: {
      stressGrid: [],
      tornado,
      monteCarlo: mc,
      optimalTierDesign: opti ?? undefined,
    },
    prepayment,
    gamification,
    antiNegin,
    gamificationJourney,
  };
}

// تابع کمکی برای پرکردن KPI اصلی شبیه‌ساز سیمرغ از نتیجه ALM
export function mergeAlmKpisIntoCore(almKpis: AlmKpis, baseKpis: Kpis): Kpis {
  const out = { ...baseKpis };
  out.depositsAvg = almKpis.totalDeposit * 1000; // به میلیون
  out.fundingCost = almKpis.totalProfitPaid + almKpis.interbankCost;
  out.fundingBenefit = almKpis.netInterestIncome;
  out.sourceUseRatio = isFinite(almKpis.leverage) ? 1 / Math.max(0.01, almKpis.leverage) : 0;
  out.moneyTimeRatio = almKpis.tippingPoint === null ? 100 : Math.max(0, 100 - almKpis.deficitMonths * 3);
  return out;
}
