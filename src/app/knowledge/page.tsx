import Link from "next/link";
import type { ReactNode } from "react";
import { CBI, COLLATERALS, CONTRACTS, SCENARIOS } from "@/lib/engine/catalog";
import { fmt } from "@/lib/format";

const nikvam = [
  ["۱ ماه", "۲۷٪", "۱۵٪", "۱۰٪", "–", "–"],
  ["۲ ماه", "۵۵٪", "۳۰٪", "۲۰٪", "۱۵٪", "–"],
  ["۳ ماه", "۸۰٪", "۴۰٪", "۳۰٪", "۲۰٪", "۱۵٪"],
  ["۴ ماه", "۱۱۰٪", "۵۵٪", "۴۰٪", "۳۰٪", "۲۰٪"],
  ["۶ ماه", "۱۶۰٪", "۸۰٪", "۶۰٪", "۴۵٪", "۳۰٪"],
  ["۱۲ ماه", "۳۲۰٪", "۱۶۰٪", "۱۱۰٪", "۸۰٪", "۶۰٪"],
];

const bnpl = [
  ["لندو", "۲۰–۵۰", "۲۳٪", "۱۲ ماه", "سفته الکترونیک"],
  ["دیجی‌پی", "۱۰–۱۰۰", "۲۳٪", "۶–۱۲ ماه", "۵۵٪ فقط سفته الکترونیک، ۴۵٪ یک چک صیادی"],
  ["بامیلوپی", "۴۰–۲۰۰", "۲۳٪", "۱۲/۱۸/۲۴ ماه", "سفته الکترونیک"],
  ["ازکی‌وام", "۱۰–۷۵", "۲۲٪", "۱۲–۱۸ ماه", "پیش‌پرداخت"],
  ["قسطا", "۵–۵۰", "متغیر", "متغیر", "پیش‌پرداخت ۱۴–۱۵٪"],
  ["بلوبانک «به‌جا»", "تا ۲۰۰", "–", "–", "رتبه اعتباری + میانگین موجودی، بدون ضامن"],
  ["ویپاد «پیمان»", "تا ۴۰۰", "–", "–", "امتیاز و اعتبارسنجی، چک دیجیتال"],
  ["رفاه «کارگشا»", "تا ۴۰۰", "–", "–", "کسر از حقوق"],
];

const sources = [
  ["نرخ‌های سود و سقف تسهیلات", "irib-news.ir • asriran.com • tinn.ir • etemadonline.com • finai.ir • nabzgheymat.ir"],
  ["طرح‌های امتیازی", "cafeneti.com (نیک‌وام ملت) • novacafenet.ir (رسالت) • sharghdaily.com (مهر ایران) • delgarm.com (مهربانی ملی)"],
  ["اعتبارسنجی", "ics24.ir • gholakban.com • karnameh.com • myestelam.com"],
  ["تسهیلات خرد و سفته الکترونیک", "ibena.ir • andishemoaser.ir • nabzgheymat.ir"],
  ["کارت اعتباری مرابحه", "bank-maskan.ir • irib-news.ir • mycredit.ir"],
  ["وجه التزام تأخیر", "avash.ir • hamilaw.ir • rade.ir"],
  ["تورم", "fa.wikipedia.org • eghtesadnews.com • zoomit.ir"],
  ["سپرده قانونی و کفایت سرمایه", "rade.ir • eghtesademoaser.ir • آیین‌نامه کفایت سرمایه ۱۳۸۲"],
];

function Section({ id, title, icon, children }: { id: string; title: string; icon: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-slate-900">
        <span>{icon}</span>
        {title}
      </h2>
      <div className="text-sm leading-7 text-slate-700">{children}</div>
    </section>
  );
}

function T({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-slate-50 text-slate-600">
            {head.map((h) => (
              <th key={h} className="p-2 text-right">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-50">
              {r.map((c, j) => (
                <td key={j} className={`p-2 ${j === 0 ? "font-semibold" : ""}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function KnowledgePage() {
  const toc = [
    ["taxonomy", "نقشه محصولات"],
    ["contracts", "عقود اسلامی"],
    ["rules", "مقررات بانک مرکزی"],
    ["points", "محصولات امتیازی"],
    ["bnpl", "اعتبار خرید و نئوبانک‌ها"],
    ["scoring", "اعتبارسنجی"],
    ["macro", "اقتصاد کلان"],
    ["models", "مدل‌های شبیه‌ساز"],
    ["sources", "منابع"],
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 text-sm font-black">📚 فهرست</div>
          <nav className="space-y-1 text-sm">
            {toc.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block rounded-lg px-2 py-1 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">{label}</a>
            ))}
          </nav>
        </div>
      </aside>
      <div className="space-y-5">
        <div className="rounded-3xl bg-gradient-to-l from-indigo-700 to-slate-900 p-6 text-white">
          <h1 className="text-2xl font-black">📚 دانشنامه تحقیق و توسعه محصولات اعتباری و امتیازی</h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-indigo-100">
            پشتوانه پژوهشی شبیه‌ساز سیمرغ: مقررات جاری بانک مرکزی (۱۴۰۵)، الگوهای واقعی بازار ایران (طرح‌های امتیازی رسالت، ملت، مهر ایران و ملی؛
            اعتبار خرید لندو، دیجی‌پی و بامیلوپی؛ نئوبانک‌ها)، مدل‌های بین‌المللی ریسک اعتباری و اقتصاد کلان تورمی.
          </p>
        </div>

        <Section id="taxonomy" title="نقشه محصولات" icon="🗺️">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-indigo-50 p-3">
              <div className="font-bold text-indigo-800">💳 اعتباری</div>
              <ul className="mt-1 list-inside list-disc text-xs leading-6">
                <li>تسهیلات اقساطی مبتنی بر عقود (مرابحه، فروش اقساطی، اجاره به شرط تملیک، جعاله…)</li>
                <li>کارت اعتباری مرابحه (اقساط ۱۲ تا ۳۶ ماه)</li>
                <li>اعتبار خرید / BNPL با سفته الکترونیک</li>
                <li>وام خرد آنی بدون ضامن مبتنی بر اعتبارسنجی</li>
                <li>خط اعتباری سرمایه در گردش (مشارکت مدنی)</li>
                <li>قرض‌الحسنه تکلیفی (ازدواج، فرزندآوری)</li>
              </ul>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <div className="font-bold text-amber-800">⭐ امتیازی</div>
              <ul className="mt-1 list-inside list-disc text-xs leading-6">
                <li>وام امتیازی سپرده‌محور (قاعده پول–زمان)</li>
                <li>امتیاز قابل انتقال به بستگان/کارکنان</li>
                <li>باشگاه مشتریان، کش‌بک و سطوح عضویت</li>
                <li>امتیاز رفتاری و پاداش خوش‌حسابی</li>
              </ul>
            </div>
            <div className="rounded-xl bg-cyan-50 p-3">
              <div className="font-bold text-cyan-800">🔀 ترکیبی (نوآوری)</div>
              <ul className="mt-1 list-inside list-disc text-xs leading-6">
                <li>کارت اعتباری امتیازی با پاداش پرداخت به‌موقع</li>
                <li>وام سبز امتیازی با مشارکت صندوق انرژی</li>
                <li>اقساط پلکانی ضدتورم هم‌گام با درآمد</li>
                <li>اعتبار طلامحور با LGD پایین</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section id="contracts" title="عقود اسلامی در تسهیلات (قانون عملیات بانکی بدون ربا)" icon="📜">
          <T head={["عقد", "نوع", "کاربرد مجاز", "نکته کلیدی"]} rows={Object.values(CONTRACTS).map((c) => [c.label, c.type, c.purposes.length >= 8 ? "همه موارد" : `${fmt(c.purposes.length)} موضوع`, c.note])} />
          <p className="mt-2 text-xs text-slate-500">شبیه‌ساز تطابق عقد با موضوع را بررسی می‌کند؛ مثلاً مرابحه نقدی یا مشارکت مدنی برای مصرف شخصی به‌عنوان «خطر صوری‌شدن» علامت‌گذاری می‌شود.</p>
        </Section>

        <Section id="rules" title="مقررات کلیدی بانک مرکزی (وضعیت ۱۴۰۵)" icon="🏛️">
          <T
            head={["قاعده", "مقدار", "اثر در شبیه‌ساز"]}
            rows={[
              ["سقف نرخ سود عقود مبادله‌ای", `${fmt(CBI.loanRateCap)}٪`, "تخلف در صورت عبور؛ پیشنهاد اصلاح خودکار"],
              ["نرخ مورد انتظار عقود مشارکتی", "۲۳٪ (تا ۲۴٪ با طرح توجیهی)", "هشدار/مغایرت"],
              ["سود سپرده کوتاه‌مدت / ویژه ۳ و ۶ ماهه", "۵٪ / ۱۲٪ / ۱۷٪", "مبنای بهای تمام‌شده وجوه"],
              ["سود سپرده یک، دو و سه‌ساله", "۲۰.۵٪ / ۲۱.۵٪ / ۲۲.۵٪", "مبنای بهای تمام‌شده وجوه"],
              ["نرخ بازار بین‌بانکی", `حدود ${fmt(CBI.interbank)}٪`, "هزینه نهایی تأمین مالی"],
              ["وجه التزام تأخیر تأدیه", "نرخ قرارداد + ۶٪", "درآمد جریمه و کنترل سقف"],
              ["سقف تسهیلات خرد و کارت اعتباری", `${fmt(CBI.microLoanCap)} میلیون تومان (از شهریور ۱۴۰۴)`, "کنترل سقف محصولات بدون ضامن"],
              ["سقف قرض‌الحسنه اشخاص در بانک‌های قرض‌الحسنه", `${fmt(CBI.qardBankCap)} میلیون تومان`, "کنترل سقف"],
              ["کارمزد قرض‌الحسنه", "حداکثر ۴٪", "سقف کارمزد وام امتیازی"],
              ["کارت اعتباری مرابحه", "اقساط ۱۲–۳۶ ماه، تخفیف ≥۹۰٪ سود مستتر، بدون سود در دوره تنفس", "قواعد اختصاصی کارت"],
              ["سپرده جبرانی / معدل‌گیری اجباری", "ممنوع", "افزایش پنهان نرخ مؤثر؛ مغایرت"],
              ["سپرده قانونی", "۱۰ تا ۱۵٪ (افزایش ۰.۷۵ واحد در مهر ۱۴۰۴)", "کسر از ارزش منابع امتیازی"],
              ["حداقل نسبت کفایت سرمایه", `${fmt(CBI.minCar)}٪`, "سرمایه قانونی و RAROC"],
              ["ابزارهای وثیقه تسهیلات خرد", "چک، سفته الکترونیک، سهام، حساب یارانه، کسر از حقوق", "کتابخانه تضامین"],
            ]}
          />
        </Section>

        <Section id="points" title="محصولات امتیازی: قاعده پول–زمان" icon="⭐">
          <div className="rounded-xl bg-amber-50 p-3 font-mono text-sm ltr text-left">L × N = k × B × H &nbsp;&nbsp;→&nbsp;&nbsp; L = k·B·H / N</div>
          <ul className="mt-3 list-inside list-disc space-y-1">
            <li><b>بانک رسالت (k = ۲):</b> هر ۱ میلیون تومان در ۲۴ ساعت ≈ ۵٬۵۰۰ تومان امتیاز وام ۱۲ ماهه. میانگین ۱۰۰ میلیون در ۶ ماه = وام ۱۰۰ میلیونی ۱۲ ماهه (یا ۱۲۰ میلیون ۱۰ ماهه). بدون مسدودی.</li>
            <li><b>نیک‌وام بانک ملت (k ≈ ۳.۲):</b> سقف = معدل × ضریب جدول؛ کارمزد ۴٪، امتیاز قابل انتقال، سقف یک میلیارد تومان.</li>
            <li><b>بانک مهر ایران:</b> امتیاز بر اساس میانگین موجودی حساب قرض‌الحسنه و توان بازپرداخت؛ کارمزد ۴٪، ۲٪ یا صفر؛ امکان فروش امتیاز.</li>
            <li><b>طرح مهربانی بانک ملی:</b> تا ۳۰۰ میلیون تومان، امتیاز از کارکرد روزانه، قابل انتقال به کارکنان.</li>
          </ul>
          <div className="mt-3 text-xs font-bold">جدول ضرایب نیک‌وام (درصد معدل، بر حسب مدت نگهداری × مدت بازپرداخت):</div>
          <T head={["نگهداری", "۱۲ ماه", "۲۴ ماه", "۳۶ ماه", "۴۸ ماه", "۶۰ ماه"]} rows={nikvam} />
          <p className="mt-2 text-xs text-slate-500">
            اقتصاد طرح: ارزش منابع ارزان (سپرده × [(۱−سپرده قانونی) × FTP − سود پرداختی]) باید هزینه تأمین وام‌های کم‌کارمزد را بپوشاند. «تراز پول–زمان» و «نرخ سوخت امتیاز» پایداری را تعیین می‌کنند.
          </p>
        </Section>

        <Section id="bnpl" title="اعتبار خرید (BNPL) و نئوبانک‌ها" icon="🛍️">
          <T head={["بازیگر", "سقف (میلیون تومان)", "نرخ", "مدت", "تضمین"]} rows={bnpl} />
          <p className="mt-2 text-xs text-slate-500">مدل درآمدی BNPL: کارمزد پذیرنده (MDR) + کارمزد مشتری + سود؛ تکرار خرید پس از تسویه در شبیه‌ساز مدل شده است.</p>
        </Section>

        <Section id="scoring" title="اعتبارسنجی (سامانه ICS24)" icon="🎯">
          <T
            head={["رتبه", "بازه امتیاز", "وضعیت"]}
            rows={[
              ["A1–A3", "۶۴۰ تا ۹۰۰", "ریسک خیلی پایین"],
              ["B1–B3", "۵۸۰ تا ۶۳۹", "خوب"],
              ["C1–C3", "۵۲۰ تا ۵۷۹", "متوسط"],
              ["D1–D3", "۴۶۰ تا ۵۱۹", "ضعیف"],
              ["E1–E3", "۰ تا ۴۵۹", "خیلی ضعیف"],
            ]}
          />
          <p className="mt-2 text-xs text-slate-500">
            در شبیه‌ساز، امتیاز مشاهده‌شده = امتیاز واقعی + نویز اندازه‌گیری؛ داده‌های جایگزین نویز را کاهش و تمایز ریسک فاقدین سابقه (Thin-file) را بهبود می‌دهد.
          </p>
          <div className="mt-3 text-xs font-bold">کتابخانه تضامین و پارامترهای ریسک:</div>
          <T head={["تضمین", "LGD پایه", "اثر بر PD (لوجیت)", "ضریب تقاضا", "توضیح"]} rows={Object.values(COLLATERALS).map((c) => [c.label, `${fmt(c.lgd * 100)}٪`, fmt(c.pdEffect, 2), fmt(c.friction, 2), c.note])} />
        </Section>

        <Section id="macro" title="اقتصاد کلان و سناریوها" icon="🔥">
          <T
            head={["سال", "تورم سالانه"]}
            rows={[
              ["۱۴۰۱", "۴۶.۵٪"],
              ["۱۴۰۲", "۴۰.۷٪"],
              ["۱۴۰۳", "۳۲.۵٪"],
              ["۱۴۰۴", "۳۶.۳٪ تا ۵۰.۶٪ (بسته به مرجع)"],
              ["خرداد ۱۴۰۵", "۶۲٪ سالانه • ۸۹٪ نقطه‌به‌نقطه"],
            ]}
          />
          <p className="mt-2">با سقف نرخ ۲۳٪ و تورم بالای ۵۰٪، نرخ سود واقعی به‌شدت منفی است؛ بنابراین ساختارهای پلکانی، سررسید کوتاه و عقود مشارکتی با تسویه بر اساس سود واقعی اهمیت دارند.</p>
          <div className="mt-3 text-xs font-bold">سناریوهای تست استرس:</div>
          <T head={["سناریو", "تورم", "ضریب PD", "تغییر LGD", "ضریب تقاضا", "شوک هزینه وجوه"]} rows={Object.values(SCENARIOS).map((s) => [s.label, `${fmt(s.inflation)}٪`, fmt(s.pdMultiplier, 2), `${fmt(s.lgdShift * 100)} واحد`, fmt(s.demandMultiplier, 2), `${fmt(s.fundingShift)} واحد`])} />
        </Section>

        <Section id="models" title="مدل‌های تحلیلی موتور شبیه‌ساز" icon="🧠">
          <ol className="list-inside list-decimal space-y-1.5">
            <li><b>جمعیت مصنوعی:</b> اشتغال (دولتی، خصوصی، آزاد، بازنشسته، دانشجو، بیکار)، منطقه، درآمد لگ‌نرمال، بدهی فعلی، دارایی (ملک، سهام عدالت، طلا)، چک صیادی، سپرده، تمایل دیجیتال و حساسیت قیمتی.</li>
            <li><b>مدل تقاضا:</b> تناسب بخش × کانال × قیمت نسبی (کشش قیمتی) × اصطکاک تضمین (ضامن بزرگ‌ترین مانع) × ساختار (تنفس، پیش‌پرداخت، کارمزد) × جذابیت امتیاز/پاداش.</li>
            <li><b>اعتبارسنجی:</b> حد نصاب امتیاز، سن پایان قرارداد، دسترسی به وثیقه، سقف DTI با کاهش خودکار مبلغ.</li>
            <li><b>PD قابل‌توضیح (لوجیت):</b> ریسک پنهان + DTI + اشتغال + تضمین + نوع محصول + انتخاب نامطلوب استیگلیتز–وایس + سن + دوره + پایش رفتاری + شرایط کلان.</li>
            <li><b>مونت‌کارلو:</b> عامل سیستماتیک تک‌عاملی واسیچک (ρ=۰.۰۵): PD شرطی = Φ((Φ⁻¹(PD)+√ρ·Z)/√(1−ρ))، منحنی فصلی‌شدن نکول، پیش‌پرداخت، تأخیر و وجه التزام.</li>
            <li><b>زمان‌بندی جذب:</b> مدل انتشار باس (p=۰.۰۲۵، q=۰.۲۸).</li>
            <li><b>سرمایه:</b> فرمول IRB بازل برای خرده‌فروشی (QRRE=۴٪، رهنی=۱۵٪، سایر ۳–۱۶٪، اطمینان ۹۹.۹٪) در کنار سرمایه قانونی (ضریب ریسک × CAR).</li>
            <li><b>شاخص‌ها:</b> EL = PD×LGD×EAD، RAROC، ROA، NIM، NPV، بازده واقعی (فیشر)، شمول مالی، شکاف عدالت دهک‌ها، VaR۹۵.</li>
            <li><b>قیمت‌گذاری ریسک‌محور:</b> هزینه وجوه + EL + هزینه عملیاتی − کارمزد + هزینه سرمایه؛ به تفکیک رتبه اعتباری و مقایسه با سقف دستوری (جیره‌بندی اعتبار).</li>
            <li><b>هوش مصنوعی تصمیم:</b> سیستم خبره با بیش از ۲۵ قاعده و اصلاح یک‌کلیکی، بهینه‌ساز (جستجوی تصادفی + جستجوی محلی نخبه‌گرا) با قید انطباق و مرز پارتو، تحلیل حساسیت گردبادی و ۷ سناریوی استرس.</li>
          </ol>
        </Section>

        <Section id="sources" title="منابع تحقیق" icon="🔗">
          <T head={["موضوع", "منابع"]} rows={sources} />
          <div className="mt-4">
            <Link href="/studio" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">🧪 شروع طراحی بر پایه این تحقیق</Link>
          </div>
        </Section>
      </div>
    </div>
  );
}
