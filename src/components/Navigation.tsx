"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "نمای کلی", icon: "◈" },
  { href: "/studio", label: "کارگاه طراحی", icon: "✧" },
  { href: "/persona", label: "سفر مشتری", icon: "◎" },
  { href: "/compare", label: "مقایسه محصولات", icon: "⇄" },
  { href: "/knowledge", label: "دانشنامه", icon: "▤" },
];

export default function Navigation() {
  const path = usePathname();
  return (
    <nav aria-label="ناوبری اصلی" className="scrollbar-thin mr-auto flex max-w-full items-center gap-1 overflow-x-auto text-sm">
      {links.map(({ href, label, icon }) => {
        const active = href === "/" ? path === href : path.startsWith(href);
        return <Link key={href} href={href} aria-current={active ? "page" : undefined}
          className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 transition ${active ? "bg-white/15 text-white ring-1 ring-white/20" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
          <span aria-hidden="true" className={active ? "text-teal-300" : "text-slate-400"}>{icon}</span>{label}
        </Link>;
      })}
    </nav>
  );
}
