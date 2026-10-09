import Link from "next/link";

/** A task-first entry point, rather than requiring users to understand the model first. */
export default function Launchpad() {
  const tasks = [
    { number: "۰۱", href: "/studio", title: "یک ایده را به محصول تبدیل کن", text: "از یک الگو شروع کن؛ نرخ، ریسک و منابع را کنار هم بسنج.", tag: "طراحی و پیش‌نمایش", color: "bg-indigo-50 text-indigo-700" },
    { number: "۰۲", href: "/persona", title: "از نگاه مشتری تصمیم بگیر", text: "توان بازپرداخت و مسیر دریافت اعتبار را برای یک پرسونا ببین.", tag: "آزمایش تجربه مشتری", color: "bg-teal-50 text-teal-700" },
    { number: "۰۳", href: "/compare", title: "گزینه‌ها را کنار هم بسنج", text: "قبل از انتخاب، تفاوت سودآوری، ریسک و شمول مالی را ببین.", tag: "مقایسه و تصمیم", color: "bg-amber-50 text-amber-700" },
  ];
  return <section aria-labelledby="launchpad-title" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="mb-1 text-xs font-bold text-teal-700">میز کار تصمیم‌گیری</p><h2 id="launchpad-title" className="text-xl font-black">امروز چه چیزی را می‌خواهید بسنجید؟</h2></div>
      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">طراحی ← آزمایش ← تصمیم</span>
    </div>
    <div className="grid gap-3 md:grid-cols-3">{tasks.map(t => <Link href={t.href} key={t.href} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-teal-300 hover:shadow-lg">
      <div className="mb-5 flex items-center justify-between"><span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${t.color}`}>{t.tag}</span><span className="font-mono text-xl text-slate-300">{t.number}</span></div>
      <h3 className="font-bold text-slate-900">{t.title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{t.text}</p>
      <span className="mt-4 block text-sm font-bold text-teal-700">شروع مسیر <span aria-hidden="true">←</span></span>
    </Link>)}</div>
    <p className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-xs leading-6 text-amber-900">محیط آزمایش، نه توصیه مالی: جمعیت مصنوعی و مفروضات مدل جایگزین داده واقعی، اعتبارسنجی مستقل یا تأیید حقوقی مقررات نیستند. مقادیر کلان از کاتالوگ داخلی خوانده می‌شوند و زنده نیستند.</p>
  </section>;
}
