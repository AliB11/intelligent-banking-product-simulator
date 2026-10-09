"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section role="alert" className="mx-auto my-16 max-w-lg rounded-3xl border border-rose-100 bg-white p-8 text-center shadow-sm">
    <div aria-hidden="true" className="text-4xl">☁</div>
    <h1 className="mt-4 text-xl font-black">این بخش موقتاً در دسترس نیست</h1>
    <p className="my-4 text-sm leading-7 text-slate-500">ممکن است اتصال به پایگاه داده قطع شده باشد. دوباره تلاش کنید یا به کارگاه طراحی برگردید.</p>
    <button onClick={reset} className="rounded-xl bg-indigo-600 px-5 py-2 text-white">تلاش دوباره</button>
    <Link href="/studio" className="mr-4 text-sm text-indigo-700">کارگاه طراحی ←</Link>
  </section>;
}
