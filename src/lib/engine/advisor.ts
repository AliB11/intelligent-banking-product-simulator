import { CBI, CONTRACTS, SCENARIOS, rewardRate } from "./catalog";
import { aprFor, clamp } from "./math";
import type {
  ComplianceItem,
  ComplianceReport,
  DnaAxis,
  FullResult,
  Health,
  Insight,
  ProductConfig,
  SimResult,
} from "./types";

const NF = [0, 1, 2].map((d) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: d }));
const fa = (v: number, d = 1) => (Number.isFinite(v) ? NF[Math.min(2, Math.max(0, d))].format(v) : "—");

// ======================= Compliance (CBI + Sharia) =======================
export function checkCompliance(cfg: ProductConfig): ComplianceReport {
  const items: ComplianceItem[] = [];
  const cr = cfg.credit;
  const k = cfg.kind;
  const ct = CONTRACTS[cfg.contract];
  const isPoints = k === "points_loan";
  const isLoyalty = k === "loyalty";
  const isCredit = !isPoints && !isLoyalty;
  const add = (id: string, level: ComplianceItem["level"], title: string, detail: string, ref: string) =>
    items.push({ id, level, title, detail, ref });

  if (isCredit) {
    // rate caps
    if (cfg.contract === "qard") {
      if (cr.rate > CBI.qardFeeCap) add("qard_fee", "fail", "کارمزد قرض‌الحسنه", `کارمزد ${fa(cr.rate)}٪ از سقف ${CBI.qardFeeCap}٪ بیشتر است.`, "ضوابط تسهیلات قرض‌الحسنه");
      else add("qard_fee", "pass", "کارمزد قرض‌الحسنه", `کارمزد ${fa(cr.rate)}٪ در محدوده مجاز (حداکثر ۴٪).`, "ضوابط تسهیلات قرض‌الحسنه");
    } else if (ct.type === "مشارکتی") {
      if (cr.rate > CBI.participatoryHardCap) add("rate_cap", "fail", "سقف نرخ مورد انتظار مشارکتی", `نرخ ${fa(cr.rate)}٪ بیش از ۲۴٪ است و نیازمند طرح توجیهی و تأیید بانک مرکزی است.`, "مصوبه شورای پول و اعتبار");
      else if (cr.rate > CBI.participatoryCap) add("rate_cap", "warn", "سقف نرخ مورد انتظار مشارکتی", `نرخ ${fa(cr.rate)}٪ بالاتر از ۲۳٪؛ در مرز مجاز.`, "مصوبه شورای پول و اعتبار");
      else add("rate_cap", "pass", "نرخ مورد انتظار مشارکتی", `نرخ علی‌الحساب ${fa(cr.rate)}٪ (سقف ۲۳٪). تسویه نهایی بر اساس سود واقعی طرح.`, "مصوبه شورای پول و اعتبار");
    } else {
      if (cr.rate > CBI.loanRateCap) add("rate_cap", "fail", "سقف نرخ سود عقود مبادله‌ای", `نرخ ${fa(cr.rate)}٪ از سقف مصوب ۲۳٪ بیشتر است؛ تخلف محسوب می‌شود.`, "مصوبه شورای پول و اعتبار (۲۳٪)");
      else add("rate_cap", "pass", "سقف نرخ سود عقود مبادله‌ای", `نرخ ${fa(cr.rate)}٪ ≤ ۲۳٪.`, "مصوبه شورای پول و اعتبار (۲۳٪)");
    }
    // compensating deposit
    if (cr.compensatingDeposit > 0) add("comp_dep", "fail", "سپرده جبرانی / معدل‌گیری اجباری", `الزام ${fa(cr.compensatingDeposit)}٪ سپرده مسدودی، نرخ مؤثر را پنهانی افزایش می‌دهد و ممنوع است.`, "بخشنامه‌های بانک مرکزی درباره منع سپرده جبرانی");
    else add("comp_dep", "pass", "عدم دریافت سپرده جبرانی", "هیچ سپرده جبرانی شرط اعطای تسهیلات نشده است.", "بخشنامه‌های بانک مرکزی");
    // contract–purpose (Sharia) fit
    if (!ct.purposes.includes(cfg.purpose)) {
      const severe = cfg.purpose === "cash" || ct.type === "مشارکتی" || cfg.contract === "salaf";
      add("sharia_purpose", severe ? "fail" : "warn", "تطابق عقد با موضوع (شرعی)", `عقد «${ct.label}» برای موضوع انتخاب‌شده مناسب نیست؛ ${ct.note}. خطر صوری‌شدن قرارداد.`, "قانون عملیات بانکی بدون ربا");
    } else add("sharia_purpose", "pass", "تطابق عقد با موضوع (شرعی)", `عقد «${ct.label}» با موضوع تسهیلات سازگار است.`, "قانون عملیات بانکی بدون ربا");
    // credit card rules
    if (k === "credit_card") {
      if (cfg.contract !== "murabaha") add("card_contract", "fail", "عقد کارت اعتباری", "کارت اعتباری باید مبتنی بر مرابحه باشد.", "دستورالعمل کارت اعتباری مرابحه");
      if (cr.tenor < CBI.cardTenorMin || cr.tenor > CBI.cardTenorMax) add("card_tenor", "fail", "دوره تقسیط کارت", `دوره ${fa(cr.tenor, 0)} ماه خارج از بازه مجاز ۱۲ تا ۳۶ ماه است.`, "بخشنامه کارت اعتباری مرابحه");
      else add("card_tenor", "pass", "دوره تقسیط کارت", `دوره ${fa(cr.tenor, 0)} ماه در بازه ۱۲ تا ۳۶ ماه.`, "بخشنامه کارت اعتباری مرابحه");
      if (cr.prepayDiscount < CBI.cardPrepayDiscountMin) add("card_prepay", "fail", "تخفیف بازپرداخت زودهنگام", `تخفیف ${fa(cr.prepayDiscount, 0)}٪ کمتر از حداقل ۹۰٪ سود مستتر است.`, "بخشنامه کارت اعتباری مرابحه");
      else add("card_prepay", "pass", "تخفیف بازپرداخت زودهنگام", `تخفیف ${fa(cr.prepayDiscount, 0)}٪ ≥ ۹۰٪.`, "بخشنامه کارت اعتباری مرابحه");
      if (cr.maxAmount > CBI.microLoanCap) add("card_cap", "fail", "سقف کارت اعتباری", `سقف ${fa(cr.maxAmount, 0)} میلیون تومان از ۴۰۰ میلیون بیشتر است.`, "بانک مرکزی (شهریور ۱۴۰۴)");
      if (cfg.purpose === "cash") add("card_cash", "fail", "برداشت نقدی از کارت مرابحه", "کارت مرابحه فقط برای خرید کالا و خدمات است؛ برداشت نقدی مجاز نیست.", "دستورالعمل کارت اعتباری مرابحه");
    }
    // micro loans without guarantor
    if ((cfg.risk.collateral === "scoring" || cfg.risk.collateral === "e_promissory") && cr.maxAmount > CBI.microLoanCap) {
      add("micro_cap", "warn", "سقف تسهیلات خرد", `سقف ${fa(cr.maxAmount, 0)} میلیون با تضمین سبک، از سقف تسهیلات خرد (۴۰۰ میلیون) فراتر است.`, "دستورالعمل تسهیلات خرد");
    }
    if (cfg.contract === "qard" && cr.maxAmount > CBI.qardBankCap) add("qard_cap", "warn", "سقف قرض‌الحسنه اشخاص", `سقف ${fa(cr.maxAmount, 0)} میلیون از ۵۰۰ میلیون تومان بیشتر است.`, "بانک مرکزی");
    if (k === "bnpl") {
      if (cr.tenor > 24) add("bnpl_tenor", "warn", "دوره اعتبار خرید", "بازار BNPL ایران معمولاً ۵ تا ۲۴ ماه است؛ دوره طولانی ماهیت محصول را تغییر می‌دهد.", "رویه بازار (لندو، دیجی‌پی، بامیلوپی)");
      if (cfg.purpose === "cash") add("bnpl_cash", "fail", "نقدی‌شدن اعتبار خرید", "اعتبار خرید باید مستقیم به پذیرنده پرداخت شود.", "ضوابط اعتبار خرید کالا");
    }
    // APR transparency
    const apr = aprFor(cfg);
    if (apr - cr.rate > 5) add("transparency", "warn", "شفافیت هزینه", `نرخ مؤثر سالانه ${fa(apr)}٪ است؛ بیش از ۵ واحد بالاتر از نرخ اسمی. هزینه‌های پنهان را افشا کنید.`, "اصول حمایت از مصرف‌کننده بانکی");
    else add("transparency", "pass", "شفافیت هزینه", `نرخ مؤثر ${fa(apr)}٪ و نرخ اسمی ${fa(cr.rate)}٪.`, "اصول حمایت از مصرف‌کننده بانکی");
  }

  if (isPoints) {
    const pt = cfg.points;
    const qard = cfg.contract === "qard";
    const tiered = pt.mode === "tiered_murabaha" && pt.tiers.length > 0;
    if (!qard) add("pts_contract", "info", "عقد وام امتیازی", `وام امتیازی بر پایه «${ct.label}» است؛ سقف نرخ عقود مبادله‌ای (۲۳٪) به‌جای سقف کارمزد قرض‌الحسنه اعمال می‌شود.`, "مصوبه شورای پول و اعتبار");
    if (qard) {
      if (pt.loanFee > CBI.qardFeeCap) add("pts_fee", "fail", "کارمزد وام امتیازی", `کارمزد ${fa(pt.loanFee)}٪ از سقف ۴٪ بیشتر است.`, "ضوابط قرض‌الحسنه");
      else add("pts_fee", "pass", "کارمزد وام امتیازی", `کارمزد ${fa(pt.loanFee)}٪ (حداکثر ۴٪).`, "ضوابط قرض‌الحسنه");
    } else {
      const rates = tiered ? pt.tiers.map((t) => t.rate) : [cr.rate];
      const top = Math.max(...rates);
      if (top > CBI.loanRateCap) add("pts_rate", "fail", "سقف نرخ وام امتیازی", `${tiered ? "بالاترین نرخ پله‌ها" : "نرخ"} ${fa(top)}٪ از سقف ۲۳٪ بیشتر است.`, "مصوبه شورای پول و اعتبار (۲۳٪)");
      else add("pts_rate", "pass", "سقف نرخ وام امتیازی", `${tiered ? `نرخ پله‌ها ${fa(Math.min(...rates))} تا ${fa(top)}٪` : `نرخ ${fa(top)}٪`} ≤ ۲۳٪.`, "مصوبه شورای پول و اعتبار (۲۳٪)");
    }
    if (qard) {
      if (pt.depositRate > 0) add("pts_deprate", "warn", "سود حساب قرض‌الحسنه", "حساب قرض‌الحسنه سود قطعی ندارد؛ فقط جوایز و امتیاز مجاز است.", "قانون عملیات بانکی بدون ربا");
      else add("pts_deprate", "pass", "ماهیت حساب", "حساب قرض‌الحسنه بدون سود؛ پاداش در قالب امتیاز وام.", "قانون عملیات بانکی بدون ربا");
      if (Math.min(cfg.credit.maxAmount, pt.maxLoan) > CBI.qardBankCap) add("pts_cap", "warn", "سقف تسهیلات قرض‌الحسنه", `سقف ${fa(Math.min(cfg.credit.maxAmount, pt.maxLoan), 0)} میلیون از ۵۰۰ میلیون تومان (بانک‌های قرض‌الحسنه) فراتر است.`, "بانک مرکزی");
    }
    if (tiered) {
      const bad = pt.tiers.filter((t) => t.waitingMonths < 1 || t.repaymentMonths < 1 || t.loanToAvgDepositPct <= 0);
      if (bad.length) add("pts_tiers", "warn", "پله‌های نامعتبر", `${fa(bad.length, 0)} پله با انتظار/دوره/ضریب صفر تعریف شده است.`, "طراحی محصول");
      const share = pt.tiers.reduce((a, t) => a + t.expectedTakeUpShare, 0);
      if (Math.abs(share - 100) > 1) add("pts_share", "info", "جمع سهم انتخاب پله‌ها", `جمع سهم‌ها ${fa(share, 0)}٪ است؛ مدل آن را به ۱۰۰٪ نرمال می‌کند.`, "طراحی محصول");
    }
    if (pt.transferable) add("pts_transfer", "info", "انتقال امتیاز", "انتقال امتیاز به بستگان/کارکنان مجاز است؛ مراقب شکل‌گیری بازار خاکستری خرید و فروش امتیاز باشید.", "رویه نیک‌وام ملت و مهر ایران");
    if (!tiered && pt.coefficient > 3.5) add("pts_coef", "warn", "پایداری ضریب تبدیل", `ضریب ${fa(pt.coefficient)} بسیار سخاوتمندانه است؛ تراز پول–زمان منفی می‌شود.`, "قاعده پول–زمان");
  }

  if (isLoyalty || cfg.family === "hybrid") {
    const ly = cfg.loyalty;
    if (ly.expiryMonths > 0 && ly.expiryMonths < 6) add("loy_expiry", "warn", "انقضای امتیاز", "انقضای کمتر از ۶ ماه منصفانه نیست و اعتماد مشتری را کاهش می‌دهد.", "اصول حمایت از مصرف‌کننده");
    if (ly.breakage > 40) add("loy_breakage", "warn", "اتکا به سوخت امتیاز", `فرض سوخت ${fa(ly.breakage, 0)}٪ یعنی مدل درآمدی متکی بر استفاده‌نشدن پاداش است.`, "اصول حمایت از مصرف‌کننده");
    else add("loy_breakage", "pass", "سوخت امتیاز", `نرخ سوخت ${fa(ly.breakage, 0)}٪ در محدوده متعارف (۱۰ تا ۳۰٪).`, "استانداردهای بین‌المللی وفاداری");
  }

  // common
  if (!isLoyalty) {
    if (cfg.credit.latePenaltySpread > CBI.latePenaltySpreadCap) add("late_penalty", "fail", "وجه التزام تأخیر", `${fa(cfg.credit.latePenaltySpread)}٪ مازاد بر نرخ قرارداد؛ سقف قانونی ۶٪ است.`, "تبصره ماده ۱۵ قانون عملیات بانکی بدون ربا");
    else add("late_penalty", "pass", "وجه التزام تأخیر", `نرخ قرارداد + ${fa(cfg.credit.latePenaltySpread)}٪ (سقف ۶٪).`, "تبصره ماده ۱۵ قانون عملیات بانکی بدون ربا");
    if (cfg.risk.maxDti > 50) add("dti", "warn", "حمایت از مصرف‌کننده (DTI)", `سقف ${fa(cfg.risk.maxDti, 0)}٪ درآمد برای اقساط، خطر بیش‌بدهکاری خانوار را بالا می‌برد.`, "اصول اعتباردهی مسئولانه");
    if (cfg.risk.maxAge > 75) add("age", "warn", "سقف سن", "سن پایان قرارداد بیش از ۷۵ سال ریسک بیمه عمر و وصول را افزایش می‌دهد.", "سیاست اعتباری");
  }
  if (cfg.funding.targetCar < CBI.minCar) add("car", "fail", "کفایت سرمایه", `نسبت ${fa(cfg.funding.targetCar)}٪ کمتر از حداقل ۸٪ است.`, "آیین‌نامه کفایت سرمایه");
  if (cfg.funding.reserveRatio < CBI.reserveRange[0] && (isPoints || isLoyalty)) add("reserve", "warn", "سپرده قانونی", "نرخ سپرده قانونی کمتر از ۱۰٪ فرض شده است.", "بانک مرکزی (۱۰ تا ۱۵٪)");

  const fails = items.filter((i) => i.level === "fail").length;
  const warns = items.filter((i) => i.level === "warn").length;
  return { score: clamp(100 - fails * 25 - warns * 7, 0, 100), fails, warns, items };
}

// ======================= Insights (expert system) =======================
export function generateInsights(cfg: ProductConfig, sim: SimResult, comp: ComplianceReport): Insight[] {
  const out: Insight[] = [];
  const kp = sim.kpis;
  const pr = sim.pricing;
  const cr = cfg.credit;
  const k = cfg.kind;
  const isPoints = k === "points_loan";
  const isLoyalty = k === "loyalty";
  const isCredit = !isPoints && !isLoyalty;
  const cap = cfg.contract === "qard" ? 4 : 23;

  // compliance-first
  if (cr.compensatingDeposit > 0 && isCredit) {
    out.push({ id: "comp_dep", level: "critical", title: "حذف سپرده جبرانی", body: `سپرده جبرانی ${fa(cr.compensatingDeposit)}٪ ممنوع است و نرخ مؤثر را به ${fa(kp.apr)}٪ رسانده است. حذف آن تقاضا را افزایش می‌دهد.`, action: { label: "حذف سپرده جبرانی", patch: { credit: { compensatingDeposit: 0 } } } });
  }
  if (isCredit && cfg.contract !== "qard" && cr.rate > 23) {
    out.push({ id: "rate_cap", level: "critical", title: "نرخ بالاتر از سقف قانونی", body: `نرخ ${fa(cr.rate)}٪ تخلف است. نرخ را به ۲۳٪ برسانید و کسری را با کارمزد پذیرنده یا کاهش هزینه جبران کنید.`, action: { label: "تنظیم نرخ روی ۲۳٪", patch: { credit: { rate: 23 } } } });
  }
  if (k === "credit_card" && cr.prepayDiscount < 90) {
    out.push({ id: "prepay", level: "critical", title: "تخفیف بازپرداخت زودهنگام", body: "طبق بخشنامه، تخفیف حداقل ۹۰٪ سود مستتر الزامی است.", action: { label: "تخفیف ۹۰٪", patch: { credit: { prepayDiscount: 90 } } } });
  }
  if (comp.fails > 0 && out.length === 0) {
    out.push({ id: "comp_any", level: "critical", title: `${fa(comp.fails, 0)} مورد مغایرت مقرراتی`, body: "پیش از عرضه، موارد قرمز گزارش انطباق را برطرف کنید." });
  }

  // profitability & pricing
  if (kp.netProfit < 0) {
    if (isCredit && pr.breakEven > pr.productRate && pr.breakEven <= cap) {
      const target = Math.min(cap, Math.ceil(pr.riskBased * 2) / 2);
      out.push({ id: "price_up", level: "critical", title: "محصول زیان‌ده است", body: `نرخ سربه‌سر ${fa(pr.breakEven)}٪ و نرخ مبتنی بر ریسک ${fa(pr.riskBased)}٪ است در حالی که نرخ محصول ${fa(pr.productRate)}٪ است. زیان خالص: ${fa(kp.netProfit, 0)} میلیارد تومان.`, impact: "بازگشت به سودآوری", action: { label: `افزایش نرخ به ${fa(target)}٪`, patch: { credit: { rate: target } } } });
    } else if (isCredit && pr.breakEven > cap) {
      out.push({ id: "rationing", level: "critical", title: "شکاف ساختاری قیمت‌گذاری (سقف دستوری)", body: `حتی با سقف ${fa(cap, 0)}٪ محصول سربه‌سر نمی‌شود (نرخ سربه‌سر ${fa(pr.breakEven)}٪). این همان «جیره‌بندی اعتبار» استیگلیتز–وایس است: باید ریسک را کاهش داد، نه قیمت را افزایش.`, action: { label: "سخت‌گیری اعتباری + کانال دیجیتال", patch: { risk: { minScore: Math.min(720, cfg.risk.minScore + 40), altData: true }, channel: "digital", credit: { upfrontFee: Math.min(3, cr.upfrontFee + 1) } } } });
    } else if (isPoints && cfg.points.mode === "tiered_murabaha" && cfg.points.tiers.length > 0) {
      out.push({ id: "pts_loss", level: "critical", title: "طرح امتیازی زیان‌ده است", body: `ارزش منابع ارزان (${fa(kp.fundingBenefit, 0)} میلیارد) زیان پله‌های کم‌نرخ را پوشش نمی‌دهد. نرخ پله‌های بلندمدت یا ضریب α آن‌ها را بازبینی کنید (آزمایشگاه ALM ← طراح معکوس پله‌ها).`, action: { label: "نرخ پله‌ها +۲ واحد (حداکثر ۲۳٪)", patch: { points: { tiers: cfg.points.tiers.map((t) => ({ ...t, rate: Math.min(CBI.loanRateCap, t.rate + 2) })) } } } });
    } else if (isPoints && cfg.contract !== "qard") {
      out.push({ id: "pts_loss", level: "critical", title: "طرح امتیازی زیان‌ده است", body: `ارزش منابع ارزان (${fa(kp.fundingBenefit, 0)} میلیارد) هزینه وام‌ها را پوشش نمی‌دهد. ضریب تبدیل ${fa(cfg.points.coefficient)} را کاهش یا نرخ سود را افزایش دهید.`, action: { label: "ضریب −۱۵٪ و نرخ +۲", patch: { points: { coefficient: Math.max(1, Math.round(cfg.points.coefficient * 0.85 * 10) / 10) }, credit: { rate: Math.min(CBI.loanRateCap, cfg.credit.rate + 2) } } } });
    } else if (isPoints) {
      out.push({ id: "pts_loss", level: "critical", title: "طرح امتیازی زیان‌ده است", body: `ارزش منابع ارزان (${fa(kp.fundingBenefit, 0)} میلیارد) هزینه تأمین وام‌های کم‌کارمزد را پوشش نمی‌دهد. ضریب تبدیل ${fa(cfg.points.coefficient)} را کاهش یا کارمزد را تا ۴٪ افزایش دهید.`, action: { label: "ضریب −۱۵٪ و کارمزد ۴٪", patch: { points: { coefficient: Math.max(1, Math.round(cfg.points.coefficient * 0.85 * 10) / 10), loanFee: 4 } } } });
    } else if (isLoyalty) {
      out.push({ id: "loy_loss", level: "critical", title: "بازده منفی باشگاه وفاداری", body: `هزینه پاداش ${fa(kp.rewardCost, 0)} میلیارد از درآمد افزایشی ${fa(kp.incrementalRevenue, 0)} میلیارد بیشتر است. ارزش امتیاز را کاهش یا سهم شرکا را افزایش دهید.`, action: { label: "ارزش امتیاز −۲۵٪، سهم شرکا ۴۵٪", patch: { loyalty: { pointValue: Math.max(5, Math.round(cfg.loyalty.pointValue * 0.75)), partnerShare: Math.max(45, cfg.loyalty.partnerShare) } } } });
    }
  } else if (kp.raroc >= cfg.funding.targetRoe && isCredit) {
    out.push({ id: "value", level: "positive", title: "محصول ارزش‌آفرین است", body: `بازده تعدیل‌شده با ریسک (RAROC) ${fa(kp.raroc)}٪ از نرخ هدف ${fa(cfg.funding.targetRoe, 0)}٪ بالاتر است؛ سود خالص ${fa(kp.netProfit, 0)} میلیارد تومان.` });
  } else if (isCredit && kp.raroc < cfg.funding.targetRoe && kp.netProfit >= 0) {
    out.push({ id: "below_hurdle", level: "warning", title: "سودآور اما زیر نرخ هدف سرمایه", body: `RAROC ${fa(kp.raroc)}٪ کمتر از نرخ هدف ${fa(cfg.funding.targetRoe, 0)}٪ است؛ محصول سرمایه را با بازده کافی جبران نمی‌کند.` });
  }

  // real economics
  if (isCredit && kp.realYield < 0) {
    out.push({ id: "real", level: "warning", title: "بازده واقعی منفی در تورم بالا", body: `با تورم ${fa(kp.inflation, 0)}٪، بازده واقعی دارایی ${fa(kp.realYield)}٪ است. سررسید کوتاه‌تر یا بازپرداخت پلکانی، فرسایش ارزش واقعی مطالبات را کم می‌کند.`, action: cr.repayment === "step_up" ? undefined : { label: "اقساط پلکانی ۲۰٪ سالانه", patch: { credit: { repayment: "step_up", stepUp: 20 } } } });
  }

  // risk
  if (kp.nplEnd > 8 && !isLoyalty) {
    out.push({ id: "npl", level: "critical", title: "نسبت مطالبات غیرجاری بالا", body: `NPL پایان افق ${fa(kp.nplEnd)}٪ است (هدف کمتر از ۵٪). حد نصاب امتیاز را افزایش دهید یا اعتبارسنجی با داده جایگزین را فعال کنید.`, action: { label: "حد نصاب +۴۰ و داده جایگزین", patch: { risk: { minScore: Math.min(760, cfg.risk.minScore + 40), altData: true, behavioral: true } } } });
  } else if (kp.nplEnd > 5 && !isLoyalty) {
    out.push({ id: "npl_mid", level: "warning", title: "ریسک اعتباری در حال افزایش", body: `NPL ${fa(kp.nplEnd)}٪؛ فعال‌سازی پایش رفتاری و افزایش شدت وصول توصیه می‌شود.`, action: cfg.risk.behavioral ? undefined : { label: "فعال‌سازی پایش رفتاری", patch: { risk: { behavioral: true, collectionsIntensity: 70 } } } });
  }
  const market = sim.params.marketRate;
  if (isCredit && kp.apr > market + 2) {
    out.push({ id: "adverse", level: "warning", title: "خطر انتخاب نامطلوب", body: `نرخ مؤثر ${fa(kp.apr)}٪ بالاتر از بازار است؛ مشتریان خوش‌حساب جذب رقبا می‌شوند و ریسک سبد بالا می‌رود (اثر استیگلیتز–وایس).` });
  }

  // access & inclusion
  if (isCredit && kp.approvalRate < 35) {
    out.push({ id: "approval", level: "warning", title: "نرخ تأیید پایین", body: `فقط ${fa(kp.approvalRate)}٪ متقاضیان تأیید می‌شوند. کاهش حد نصاب همراه با داده جایگزین، رشد بدون افزایش ریسک می‌دهد.`, action: { label: "حد نصاب −۳۰ + داده جایگزین", patch: { risk: { minScore: Math.max(400, cfg.risk.minScore - 30), altData: true } } } });
  }
  if (isCredit && cfg.risk.collateral === "guarantor") {
    out.push({ id: "guarantor", level: "opportunity", title: "حذف ضامن: بزرگ‌ترین اصطکاک بازار", body: "الزام ضامن تقاضا را تا ۴۵٪ کاهش می‌دهد. جایگزینی با سفته الکترونیک + اعتبارسنجی (مدل دیجی‌پی و بلو) دسترسی را افزایش می‌دهد.", action: { label: "سفته الکترونیک + داده جایگزین", patch: { risk: { collateral: "e_promissory", altData: true, minScore: Math.min(700, cfg.risk.minScore + 20) } } } });
  }
  if (isCredit && !cfg.risk.altData && kp.inclusion < 25) {
    out.push({ id: "altdata", level: "opportunity", title: "شمول مالی با داده جایگزین", body: `سهم کم‌درآمدها و فاقدین سابقه در سبد ${fa(kp.inclusion)}٪ است. داده‌های جایگزین (گردش حساب، قبوض، تراکنش‌ها) تمایز ریسک این گروه را بهبود می‌دهد.`, action: { label: "فعال‌سازی داده جایگزین", patch: { risk: { altData: true } } } });
  }
  if (Math.abs(kp.fairnessGap) > 40 && !isLoyalty) {
    out.push({ id: "fair", level: "warning", title: "شکاف عدالت اعتباری", body: `اختلاف نرخ تأیید پردرآمدها و کم‌درآمدها ${fa(kp.fairnessGap, 0)} واحد درصد است. سقف مبلغ پلکانی بر اساس درآمد را بررسی کنید.` });
  }
  if (isCredit && kp.customerBurden > 42) {
    out.push({ id: "burden", level: "warning", title: "فشار اقساط بر خانوار", body: `میانگین نسبت اقساط به درآمد ${fa(kp.customerBurden)}٪ است؛ اعتباردهی مسئولانه سقف ۳۵ تا ۴۰٪ را توصیه می‌کند.`, action: { label: "سقف DTI ۳۸٪", patch: { risk: { maxDti: 38 } } } });
  }

  // cost structure
  const revenue = kp.interestIncome + kp.feeIncome + kp.fundingBenefit + kp.incrementalRevenue;
  if (revenue > 0 && kp.opex / revenue > 0.25 && cfg.channel === "branch") {
    out.push({ id: "digital", level: "opportunity", title: "دیجیتال‌سازی کانال", body: `هزینه عملیاتی ${fa((kp.opex / revenue) * 100, 0)}٪ درآمد است. کانال تمام‌دیجیتال هزینه هر حساب را حدود ۶۰٪ کاهش می‌دهد.`, action: { label: "کانال تمام‌دیجیتال", patch: { channel: "digital" } } });
  }

  // points specific
  const tieredPts = isPoints && cfg.points.mode === "tiered_murabaha" && cfg.points.tiers.length > 0;
  if (isPoints) {
    // coefficient / minimum-holding knobs do not exist in a tiered menu → only advise them in simple mode
    if (tieredPts) {
      /* tier economics are reviewed in the ALM lab */
    } else if (kp.moneyTimeRatio > 0 && kp.moneyTimeRatio < 1) {
      out.push({ id: "src_use", level: "critical", title: "مصارف بیش از منابع", body: `تراز پول–زمان (سپرده‌ماه به وام‌ماه در کل عمر) ${fa(kp.moneyTimeRatio, 2)} است؛ بانک بیش از پول–زمان دریافتی وام می‌دهد.`, action: { label: "ضریب تبدیل −۱۵٪", patch: { points: { coefficient: Math.max(1, Math.round(cfg.points.coefficient * 0.85 * 10) / 10) } } } });
    } else if (kp.moneyTimeRatio > 2.2 && kp.netProfit > 0) {
      out.push({ id: "src_surplus", level: "opportunity", title: "مازاد منابع: فرصت سخاوت بیشتر", body: `تراز پول–زمان ${fa(kp.moneyTimeRatio, 1)} است (منابع بیش از دو برابر مصارف). افزایش ضریب تبدیل جذابیت و جذب سپرده را بالا می‌برد.`, action: { label: "ضریب تبدیل +۱۵٪", patch: { points: { coefficient: Math.round(cfg.points.coefficient * 1.15 * 10) / 10 } } } });
    }
    if (!tieredPts && kp.avgWaitDays > 200) {
      out.push({ id: "wait", level: "warning", title: "انتظار طولانی برای امتیاز", body: `متوسط زمان انباشت امتیاز ${fa(kp.avgWaitDays, 0)} روز است و مشتریان کم‌حوصله ریزش می‌کنند.`, action: { label: "حداقل نگهداری ۳۰ روز", patch: { points: { minHoldingDays: 30 } } } });
    }
    if (!cfg.points.transferable) {
      out.push({ id: "transfer", level: "opportunity", title: "قابلیت انتقال امتیاز", body: "امکان انتقال امتیاز به بستگان درجه یک (مانند نیک‌وام ملت) جذابیت را حدود ۱۵٪ افزایش می‌دهد.", action: { label: "فعال‌سازی انتقال امتیاز", patch: { points: { transferable: true } } } });
    }
  }

  // loyalty specific
  if (isLoyalty || cfg.family === "hybrid") {
    const ly = cfg.loyalty;
    if (!ly.tiers) out.push({ id: "tiers", level: "opportunity", title: "سطوح عضویت", body: "سطوح نقره‌ای/طلایی/الماس انگیزه افزایش گردش را ایجاد می‌کند (افزایش ۲۵٪ اثر).", action: { label: "فعال‌سازی سطوح", patch: { loyalty: { tiers: true } } } });
    if (!ly.gamification) out.push({ id: "gamify", level: "opportunity", title: "گیمیفیکیشن", body: "مأموریت‌ها و چالش‌های ماهانه تعامل را حدود ۲۰٪ افزایش می‌دهد.", action: { label: "فعال‌سازی مأموریت‌ها", patch: { loyalty: { gamification: true } } } });
    if (rewardRate(ly.pointsPer100k, ly.pointValue) > 1.5) out.push({ id: "rr", level: "warning", title: "نرخ پاداش بالا", body: `بازگشت ${fa(rewardRate(ly.pointsPer100k, ly.pointValue))}٪ از خرید بالاتر از درآمد کارمزدی معمول است.` });
  }

  // tail risk
  if (sim.profitDist.probLoss > 25 && kp.netProfit > 0) {
    out.push({ id: "tail", level: "warning", title: "نوسان بالای سودآوری", body: `در ${fa(sim.profitDist.probLoss, 0)}٪ سناریوهای مونت‌کارلو محصول زیان می‌دهد (VaR۹۵ = ${fa(sim.profitDist.var95, 0)} میلیارد). سقف مبلغ را کاهش یا تضامین را تقویت کنید.` });
  }

  const order = { critical: 0, warning: 1, opportunity: 2, positive: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]).slice(0, 12);
}

// ======================= Health & DNA =======================
export function innovationScore(cfg: ProductConfig): number {
  let s = 20;
  if (cfg.channel === "digital" || cfg.channel === "embedded") s += 20;
  if (cfg.risk.altData) s += 15;
  if (cfg.risk.behavioral) s += 8;
  if (cfg.risk.collateral === "scoring" || cfg.risk.collateral === "e_promissory") s += 12;
  if (cfg.family === "hybrid") s += 12;
  if (cfg.credit.repayment === "step_up") s += 10;
  if (cfg.loyalty.gamification && (cfg.kind === "loyalty" || cfg.family === "hybrid")) s += 8;
  if (cfg.points.transferable && cfg.kind === "points_loan") s += 8;
  if (cfg.kind === "bnpl") s += 6;
  return clamp(s, 0, 100);
}

export function computeHealth(cfg: ProductConfig, sim: SimResult, comp: ComplianceReport): Health {
  const kp = sim.kpis;
  const isLoyalty = cfg.kind === "loyalty";
  const profitability = isLoyalty ? clamp(50 + kp.loyaltyRoi / 3, 0, 100) : clamp(45 + kp.raroc * 0.9, 0, 100);
  const risk = isLoyalty ? 90 : clamp(100 - kp.nplEnd * 7, 0, 100);
  const customer = isLoyalty
    ? clamp(40 + rewardRate(cfg.loyalty.pointsPer100k, cfg.loyalty.pointValue) * 40, 0, 100)
    : clamp(100 - Math.max(0, kp.apr - 18) * 3 - Math.max(0, kp.customerBurden - 35) * 2, 0, 100);
  const inclusion = clamp(kp.inclusion * 1.6 + kp.approvalRate * 0.45, 0, 100);
  const resilience = clamp(100 - sim.profitDist.probLoss * 1.2 - (sim.profitDist.var95 / Math.max(1, Math.abs(sim.profitDist.mean))) * 12, 0, 100);
  const parts = [
    { key: "profit", label: "سودآوری", value: profitability, weight: 0.25 },
    { key: "risk", label: "ریسک", value: risk, weight: 0.2 },
    { key: "compliance", label: "انطباق", value: comp.score, weight: 0.2 },
    { key: "customer", label: "ارزش مشتری", value: customer, weight: 0.15 },
    { key: "inclusion", label: "شمول و دسترسی", value: inclusion, weight: 0.1 },
    { key: "resilience", label: "تاب‌آوری", value: resilience, weight: 0.1 },
  ];
  let score = parts.reduce((s, p) => s + p.value * p.weight, 0);
  if (comp.fails > 0) score = Math.min(score, 49);
  if (kp.netProfit < 0) score = Math.min(score, 58);
  score = Math.round(score);
  const grade = score >= 85 ? "A+" : score >= 75 ? "A" : score >= 65 ? "B" : score >= 55 ? "C" : score >= 45 ? "D" : "E";
  const label =
    score >= 85 ? "ستاره بازار" : score >= 75 ? "آماده عرضه" : score >= 65 ? "قابل عرضه با اصلاحات جزئی" : score >= 55 ? "نیازمند بهینه‌سازی" : score >= 45 ? "پرریسک" : "غیرقابل عرضه";
  return { score, grade, label, parts };
}

export function computeDna(cfg: ProductConfig, sim: SimResult, comp: ComplianceReport, health: Health): DnaAxis[] {
  const kp = sim.kpis;
  const isLoyalty = cfg.kind === "loyalty";
  return [
    { axis: "جذابیت قیمت", value: isLoyalty ? clamp(rewardRate(cfg.loyalty.pointsPer100k, cfg.loyalty.pointValue) * 60, 0, 100) : clamp(100 - (kp.apr - 4) * 3, 0, 100) },
    { axis: "دسترسی", value: clamp(kp.approvalRate * 0.6 + kp.takeUpRate * 1.5, 0, 100) },
    { axis: "سودآوری", value: health.parts.find((p) => p.key === "profit")?.value ?? 0 },
    { axis: "ایمنی ریسک", value: isLoyalty ? 90 : clamp(100 - kp.nplEnd * 8, 0, 100) },
    { axis: "شمول مالی", value: clamp(kp.inclusion * 2.2, 0, 100) },
    { axis: "انطباق", value: comp.score },
    { axis: "نوآوری", value: innovationScore(cfg) },
    { axis: "تاب‌آوری", value: health.parts.find((p) => p.key === "resilience")?.value ?? 0 },
  ];
}

export function analyzeResult(cfg: ProductConfig, sim: SimResult): FullResult {
  const compliance = checkCompliance(cfg);
  const insights = generateInsights(cfg, sim, compliance);
  const health = computeHealth(cfg, sim, compliance);
  const dna = computeDna(cfg, sim, compliance, health);
  return { sim, insights, health, compliance, dna };
}

// ======================= Executive narrative =======================
export function executiveSummary(cfg: ProductConfig, full: FullResult): string[] {
  const k = full.sim.kpis;
  const p = full.sim.params;
  const isPoints = cfg.kind === "points_loan";
  const isLoyalty = cfg.kind === "loyalty";
  const scen = SCENARIOS[p.scenario]?.label ?? "";
  const money = (b: number) => (Math.abs(b) >= 1000 ? `${fa(b / 1000, 1)} همت` : `${fa(b, 0)} میلیارد تومان`);
  const cnt = (n: number) => (n >= 1e6 ? `${fa(n / 1e6, 2)} میلیون` : n >= 1e3 ? `${fa(n / 1e3, 0)} هزار` : fa(n, 0));
  const out: string[] = [];
  if (isLoyalty) {
    out.push(`«${cfg.name}» در سناریوی «${scen}» حدود ${cnt(k.booked)} عضو جذب می‌کند؛ با هزینه پاداش ${money(k.rewardCost)} و درآمد افزایشی ${money(k.incrementalRevenue)}، سود خالص ${money(k.netProfit)} و بازده ${fa(k.loyaltyRoi, 0)}٪ دارد.`);
  } else {
    out.push(`«${cfg.name}» در سناریوی «${scen}» از ${cnt(k.applicants)} متقاضی، ${fa(k.approvalRate, 0)}٪ را تأیید و ${money(k.volume)} ${isPoints ? "وام امتیازی" : "اعتبار"} اعطا می‌کند. سود خالص ${money(k.netProfit)} با RAROC ${fa(k.raroc, 0)}٪ و NPL پایدار ${fa(k.nplEnd, 1)}٪ برآورد می‌شود.`);
    out.push(`نرخ مؤثر برای مشتری ${fa(k.apr, 1)}٪ و نرخ سربه‌سر بانک ${fa(full.sim.pricing.breakEven, 1)}٪ است؛ با تورم ${fa(k.inflation, 0)}٪، سود واقعی ${money(k.realProfit)} و بازده واقعی دارایی ${fa(k.realYield, 1)}٪ خواهد بود.`);
  }
  if (isPoints) {
    out.push(`میانگین سپرده امتیازی ${money(k.depositsAvg)} با ارزش منابع ارزان ${money(k.fundingBenefit)}؛ تراز پول–زمان ${fa(k.moneyTimeRatio, 2)} و انتظار متوسط مشتری ${fa(k.avgWaitDays, 0)} روز است.`);
  }
  out.push(`در ${fa(full.sim.profitDist.probLoss, 0)}٪ اجراهای مونت‌کارلو زیان رخ می‌دهد (VaR۹۵: ${money(full.sim.profitDist.var95)}). امتیاز سلامت ${fa(full.health.score, 0)} (${full.health.grade} — ${full.health.label}) و امتیاز انطباق ${fa(full.compliance.score, 0)} از ۱۰۰ است.`);
  const top = full.insights.find((i) => i.level === "critical") ?? full.insights[0];
  if (top) out.push(`مهم‌ترین اقدام پیشنهادی: ${top.title}${top.action ? ` — «${top.action.label}»` : ""}.`);
  return out;
}
