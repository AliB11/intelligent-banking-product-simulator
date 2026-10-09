import type { Metadata } from "next";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import type { ReactNode } from "react";
import "@fontsource-variable/vazirmatn";
import "./globals.css";

export const metadata: Metadata = {
  title: "سیمرغ | شبیه‌ساز هوشمند تولید محصولات اعتباری و امتیازی",
  description:
    "کارخانه هوشمند طراحی، شبیه‌سازی مونت‌کارلو، تست استرس و بهینه‌سازی محصولات بانکی اعتباری و امتیازی بر پایه مقررات بانک مرکزی ایران",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen text-slate-900 antialiased">
        <a href="#main-content" className="skip-link">رفتن به محتوای اصلی</a>
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
            <Navigation />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-center text-xs text-slate-500">
          سیمرغ — موتور شبیه‌سازی مونت‌کارلو، مدل IRB بازل، عامل سیستماتیک واسیچک، انتشار باس و قواعد بانک مرکزی ایران (۱۴۰۵).
          نتایج آموزشی و تحلیلی است.
        </footer>
      </body>
    </html>
  );
}
