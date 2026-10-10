import type {
  Channel,
  Collateral,
  Contract,
  Family,
  Kind,
  MacroScenario,
  Purpose,
  Repayment,
  ScenarioId,
  Segment,
} from "./types";

// ===== Central Bank of Iran (CBI) regulatory constants — status 1405 =====
/**
 * Liquidity-risk assumptions for deposit-funded (points) products — educational, Basel III inspired.
 * bufferRunoff: HQLA buffer as % of product deposits (LCR run-off for less-stable retail deposits);
 * stressRunoff / stressSpread: extra outflow (%) refinanced at a stressed premium over FTP (percentage points)
 * → liquidity capital = deposits × stressRunoff × stressSpread (one-year cost at risk held as capital).
 */
export const LIQUIDITY = { bufferRunoff: 10, stressRunoff: 20, stressSpread: 8 };

export const CBI = {
  loanRateCap: 23, // max rate for non-participatory contracts
  participatoryCap: 23, // expected rate for participatory contracts (tolerance up to 24)
  participatoryHardCap: 24,
  qardFeeCap: 4, // qard al-hasan fee cap
  latePenaltySpreadCap: 6, // late penalty = contract rate + 6
  microLoanCap: 400, // million toman (micro loans & credit cards since Shahrivar 1404)
  qardBankCap: 500, // million toman (individuals at qard banks)
  cardTenorMin: 12,
  cardTenorMax: 36,
  cardPrepayDiscountMin: 90,
  minCar: 8,
  reserveRange: [10, 15] as [number, number],
  deposits: { shortTerm: 5, special3m: 12, special6m: 17, oneYear: 20.5, twoYear: 21.5, threeYear: 22.5 },
  interbank: 24,
  specialCd: 30,
  inflation: { y1401: 46.5, y1402: 40.7, y1403: 32.5, y1404: 36.3, y1404sci: 50.6, khordad1405: 62, khordad1405p2p: 89 },
};

export const FAMILIES: Record<Family, { label: string; desc: string; emoji: string }> = {
  credit: { label: "اعتباری", desc: "تسهیلات، کارت اعتباری، اعتبار خرید و خط اعتباری", emoji: "💳" },
  points: { label: "امتیازی", desc: "وام امتیازی سپرده‌محور و باشگاه وفاداری", emoji: "⭐" },
  hybrid: { label: "ترکیبی", desc: "محصول اعتباری با لایه امتیاز و پاداش خوش‌حسابی", emoji: "🔀" },
};

export const KINDS: Record<Kind, { label: string; family: Family[]; emoji: string; desc: string }> = {
  installment: { label: "تسهیلات اقساطی", family: ["credit", "hybrid"], emoji: "🏦", desc: "وام با جدول اقساط مشخص" },
  credit_card: { label: "کارت اعتباری", family: ["credit", "hybrid"], emoji: "💳", desc: "اعتبار گردان مبتنی بر مرابحه" },
  bnpl: { label: "اعتبار خرید (BNPL)", family: ["credit", "hybrid"], emoji: "🛍️", desc: "الان بخر، بعدا پرداخت کن" },
  credit_line: { label: "خط اعتباری", family: ["credit", "hybrid"], emoji: "📈", desc: "سرمایه در گردش گردان برای کسب‌وکار" },
  points_loan: { label: "وام امتیازی سپرده‌محور", family: ["points"], emoji: "⭐", desc: "امتیاز پول–زمان از سپرده قرض‌الحسنه" },
  loyalty: { label: "باشگاه امتیاز و وفاداری", family: ["points"], emoji: "🎁", desc: "امتیاز خرید، کش‌بک و سطوح عضویت" },
};

export const CONTRACTS: Record<
  Contract,
  { label: string; type: "قرض" | "مبادله‌ای" | "مشارکتی"; purposes: Purpose[]; note: string }
> = {
  qard: { label: "قرض‌الحسنه", type: "قرض", purposes: ["goods", "service", "cash", "housing", "vehicle", "working_capital", "education", "medical"], note: "بدون سود؛ فقط کارمزد تا ۴٪" },
  murabaha: { label: "مرابحه", type: "مبادله‌ای", purposes: ["goods", "service", "housing", "vehicle", "education", "medical", "working_capital"], note: "خرید واقعی کالا/خدمت توسط بانک و فروش اقساطی با سود معین" },
  installment_sale: { label: "فروش اقساطی", type: "مبادله‌ای", purposes: ["goods", "vehicle", "housing", "working_capital"], note: "فروش کالای تملک‌شده به‌صورت اقساط" },
  ijara: { label: "اجاره به شرط تملیک", type: "مبادله‌ای", purposes: ["vehicle", "housing", "goods"], note: "دارایی بادوام؛ مالکیت در پایان منتقل می‌شود" },
  joaleh: { label: "جعاله", type: "مبادله‌ای", purposes: ["service", "housing", "education", "medical"], note: "انجام خدمت/تعمیر در ازای جُعل معین" },
  musharaka: { label: "مشارکت مدنی", type: "مشارکتی", purposes: ["working_capital", "housing"], note: "سود علی‌الحساب؛ تسویه بر اساس سود واقعی طرح" },
  mudaraba: { label: "مضاربه", type: "مشارکتی", purposes: ["working_capital"], note: "فقط فعالیت بازرگانی؛ تقسیم سود" },
  salaf: { label: "سلف", type: "مبادله‌ای", purposes: ["working_capital"], note: "پیش‌خرید محصول تولیدی" },
  istisna: { label: "استصناع", type: "مبادله‌ای", purposes: ["housing", "working_capital", "goods"], note: "سفارش ساخت" },
};

export const COLLATERALS: Record<
  Collateral,
  { label: string; lgd: number; pdEffect: number; friction: number; note: string }
> = {
  scoring: { label: "فقط اعتبارسنجی", lgd: 0.75, pdEffect: 0.05, friction: 1.18, note: "بدون ضامن؛ مبتنی بر رتبه اعتباری" },
  e_promissory: { label: "سفته الکترونیک", lgd: 0.65, pdEffect: -0.08, friction: 1.1, note: "صدور برخط در سامانه سفته و برات" },
  cheque: { label: "چک صیادی", lgd: 0.55, pdEffect: -0.22, friction: 0.88, note: "نیازمند دسته‌چک و نداشتن چک برگشتی" },
  guarantor: { label: "ضامن", lgd: 0.45, pdEffect: -0.32, friction: 0.55, note: "بزرگ‌ترین اصطکاک تقاضا در بازار ایران" },
  salary: { label: "کسر از حقوق", lgd: 0.22, pdEffect: -0.8, friction: 0.96, note: "فقط حقوق‌بگیران و بازنشستگان" },
  deposit_lien: { label: "مسدودی سپرده", lgd: 0.08, pdEffect: -0.9, friction: 0.6, note: "نیازمند نقدینگی معادل" },
  property: { label: "وثیقه ملکی", lgd: 0.3, pdEffect: -0.42, friction: 0.45, note: "کارشناسی و ترهین؛ زمان‌بر" },
  shares: { label: "سهام / سهام عدالت", lgd: 0.42, pdEffect: -0.2, friction: 0.78, note: "توثیق سهام در سامانه" },
  asset: { label: "خود دارایی (رهن کالا)", lgd: 0.4, pdEffect: -0.3, friction: 0.92, note: "مناسب خودرو و کالای بادوام" },
  gold: { label: "طلا / گواهی سکه", lgd: 0.16, pdEffect: -0.5, friction: 0.72, note: "نقدشوندگی بالا در تورم" },
};

export const SEGMENTS: Record<Segment, { label: string; desc: string }> = {
  mass: { label: "عموم مردم", desc: "بازار انبوه" },
  salaried: { label: "حقوق‌بگیران", desc: "کارکنان دولت، خصوصی و بازنشستگان" },
  youth: { label: "جوانان", desc: "زیر ۳۰ سال، دیجیتال‌محور" },
  newlywed: { label: "زوج‌های جوان", desc: "ازدواج و فرزندآوری" },
  sme: { label: "کسب‌وکارهای کوچک", desc: "صاحبان مشاغل و بنگاه‌های خرد" },
  freelancer: { label: "مشاغل آزاد و فریلنسرها", desc: "درآمد نامنظم" },
  retiree: { label: "بازنشستگان", desc: "درآمد ثابت و ریسک پایین" },
  affluent: { label: "مشتریان ممتاز", desc: "درآمد بالا" },
};

export const CHANNELS: Record<Channel, { label: string; opex: number; cac: number }> = {
  digital: { label: "تمام‌دیجیتال (اپ)", opex: 0.45, cac: 0.7 },
  branch: { label: "شعبه", opex: 1.25, cac: 1 },
  omni: { label: "همه‌کاناله", opex: 0.85, cac: 0.9 },
  embedded: { label: "تعبیه‌شده در فروشگاه/سوپراپ", opex: 0.5, cac: 0.5 },
};

export const REPAYMENTS: Record<Repayment, { label: string; desc: string }> = {
  annuity: { label: "اقساط مساوی", desc: "قسط ثابت ماهانه" },
  equal_principal: { label: "اصل مساوی (کاهنده)", desc: "قسط نزولی" },
  step_up: { label: "پلکانی ضدتورم", desc: "افزایش سالانه قسط همگام با درآمد" },
  balloon: { label: "بالونی", desc: "بخشی از اصل در سررسید" },
  bullet: { label: "یکجا در سررسید", desc: "پرداخت سود ماهانه، اصل در پایان" },
  seasonal: { label: "فصلی (سه‌ماهه)", desc: "مناسب کشاورزی و فصلی" },
};

export const PURPOSES: Record<Purpose, string> = {
  goods: "خرید کالا",
  service: "خرید خدمات",
  cash: "نقدی (مصرف آزاد)",
  housing: "مسکن",
  vehicle: "خودرو",
  working_capital: "سرمایه در گردش",
  education: "آموزش",
  medical: "درمان",
};

export const SCENARIOS: Record<ScenarioId, MacroScenario> = {
  base: {
    id: "base",
    label: "پایه ۱۴۰۵",
    description: "تورم بالا و پایدار، نرخ سقف ۲۳٪، بین‌بانکی ۲۴٪",
    inflation: 50,
    pdMultiplier: 1,
    lgdShift: 0,
    demandMultiplier: 1,
    fundingShift: 0,
    incomeGrowth: 40,
    depositShift: 1,
    spendShift: 1,
    color: "#6366f1",
  },
  stagflation: {
    id: "stagflation",
    label: "رکود تورمی شدید",
    description: "تورم ۷۵٪، افت درآمد واقعی و افزایش نکول",
    inflation: 75,
    pdMultiplier: 1.6,
    lgdShift: 0.07,
    demandMultiplier: 0.88,
    fundingShift: 3,
    incomeGrowth: 35,
    depositShift: 0.85,
    spendShift: 0.92,
    color: "#ef4444",
  },
  recession: {
    id: "recession",
    label: "رکود عمیق",
    description: "بیکاری بالا، کاهش تقاضا و نکول گسترده",
    inflation: 35,
    pdMultiplier: 1.9,
    lgdShift: 0.1,
    demandMultiplier: 0.7,
    fundingShift: 1,
    incomeGrowth: 15,
    depositShift: 0.9,
    spendShift: 0.8,
    color: "#f97316",
  },
  boom: {
    id: "boom",
    label: "رونق اقتصادی",
    description: "رشد درآمد، کاهش ریسک و افزایش تقاضا",
    inflation: 30,
    pdMultiplier: 0.75,
    lgdShift: -0.05,
    demandMultiplier: 1.2,
    fundingShift: -1,
    incomeGrowth: 35,
    depositShift: 1.15,
    spendShift: 1.15,
    color: "#22c55e",
  },
  fx_shock: {
    id: "fx_shock",
    label: "شوک ارزی",
    description: "جهش نرخ ارز، تورم ۹۰٪ و هجوم به خرید کالا",
    inflation: 90,
    pdMultiplier: 1.4,
    lgdShift: 0.04,
    demandMultiplier: 1.1,
    fundingShift: 4,
    incomeGrowth: 30,
    depositShift: 0.8,
    spendShift: 1.05,
    color: "#a855f7",
  },
  liquidity_crunch: {
    id: "liquidity_crunch",
    label: "بحران نقدینگی",
    description: "خروج سپرده‌ها و جهش هزینه تأمین مالی",
    inflation: 55,
    pdMultiplier: 1.25,
    lgdShift: 0.03,
    demandMultiplier: 0.92,
    fundingShift: 6,
    incomeGrowth: 35,
    depositShift: 0.75,
    spendShift: 0.95,
    color: "#0ea5e9",
  },
  disinflation: {
    id: "disinflation",
    label: "ثبات و کاهش تورم",
    description: "تورم ۲۰٪ و کاهش هزینه وجوه",
    inflation: 20,
    pdMultiplier: 0.9,
    lgdShift: -0.02,
    demandMultiplier: 1.05,
    fundingShift: -3,
    incomeGrowth: 22,
    depositShift: 1.1,
    spendShift: 1.05,
    color: "#14b8a6",
  },
};

export const SCORE_BANDS: { label: string; lo: number; hi: number; grade: string }[] = [
  { label: "زیر ۴۶۰ (E)", lo: 0, hi: 460, grade: "E" },
  { label: "۴۶۰–۵۱۹ (D)", lo: 460, hi: 520, grade: "D" },
  { label: "۵۲۰–۵۷۹ (C)", lo: 520, hi: 580, grade: "C" },
  { label: "۵۸۰–۶۳۹ (B)", lo: 580, hi: 640, grade: "B" },
  { label: "۶۴۰–۶۹۹ (A3)", lo: 640, hi: 700, grade: "A" },
  { label: "۷۰۰–۷۹۹ (A2)", lo: 700, hi: 800, grade: "A" },
  { label: "۸۰۰+ (A1)", lo: 800, hi: 901, grade: "A" },
];

export function scoreGrade(score: number): string {
  if (score >= 640) return "A";
  if (score >= 580) return "B";
  if (score >= 520) return "C";
  if (score >= 460) return "D";
  return "E";
}

export const EMPLOYMENT_LABELS: Record<string, string> = {
  gov: "کارمند دولت",
  private: "کارمند خصوصی",
  self: "شغل آزاد",
  retired: "بازنشسته",
  student: "دانشجو",
  unemployed: "بدون درآمد ثابت",
};

export const REGION_LABELS: Record<string, string> = {
  tehran: "تهران",
  metro: "کلان‌شهر",
  city: "شهر کوچک",
  rural: "روستا",
};

export function rewardRate(pointsPer100k: number, pointValue: number): number {
  // % of spend returned to customer
  return (pointsPer100k * pointValue) / 1000;
}
