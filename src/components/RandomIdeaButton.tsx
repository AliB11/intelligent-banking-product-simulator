"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export default function RandomIdeaButton({ className = "", children }: { className?: string; children: ReactNode }) {
  const router = useRouter();

  const createIdea = () => {
    const values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    const seed = (values[0] % 999_999) + 1;
    router.push(`/studio?random=${seed}`);
  };

  return (
    <button type="button" onClick={createIdea} className={className}>
      {children}
    </button>
  );
}
