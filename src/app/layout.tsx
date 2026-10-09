import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "@fontsource-variable/vazirmatn";
import "./globals.css";

export const metadata: Metadata = {
  title: "سیمرغ | شبیه‌ساز هوشمند تولید محصولات اعتباری و امتیازی",
  description:
    "کارخانه هوشمند طراحی، شبیه‌سازی مونت‌کارلو، تست استرس و بهینه‌سازی محصولات بانکی اعتباری و امتیازی بر پایه مقررات بانک مرکزی ایران",
};

const NAV = [
  { href: "/", label: "داشبورد", icon: "🏠" },
  { href: "/studio", label: "کارگاه طراحی", icon: "🧪" },
  { href: "/persona", label: "سفر مشتری", icon: "🧭" },
  { href: "/compare", label: "مقایسه محصولات", icon: "⚖️" },
  { href: "/knowledge", label: "دانشنامه", icon: "📚" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen text-slate-900 antialiased">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/90 text-white backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-amber-400 text-xl shadow-lg shadow-indigo-500/30">
                🦅
              </span>
              <span className="leading-tight">
                <span className="block text-lg font-black tracking-tight">سیمرغ</span>
                <span className="block text-[11px] text-slate-300">شبیه‌ساز هوشمند محصولات اعتباری و امتیازی</span>
              </span>
            </Link>
            <nav className="mr-auto flex flex-wrap items-center gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-lg px-3 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white"
                >
                  <span className="ml-1">{n.icon}</span>
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-center text-xs text-slate-500">
          سیمرغ — موتور شبیه‌سازی مونت‌کارلو، مدل IRB بازل، عامل سیستماتیک واسیچک، انتشار باس و قواعد بانک مرکزی ایران (۱۴۰۵).
          نتایج آموزشی و تحلیلی است.
        </footer>
      </body>
    </html>
  );
}
