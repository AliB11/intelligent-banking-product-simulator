import { NextResponse } from "next/server";
import { runFullAlmAnalysis } from "@/lib/engine/alm";
import { templateConfig, normalizeConfig } from "@/lib/engine/templates";
import type { ProductConfig } from "@/lib/engine/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      product,
      templateKey,
      marketShare = 5,
      horizon = 60,
      scenario = "base",
      seed,
    } = body as {
      product?: unknown;
      templateKey?: string;
      marketShare?: number;
      horizon?: number;
      scenario?: string;
      seed?: number;
    };

    let cfg: ProductConfig;
    if (product) {
      cfg = normalizeConfig(product);
    } else if (templateKey) {
      const tpl = templateConfig(templateKey);
      if (!tpl) {
        return NextResponse.json({ error: "الگو یافت نشد" }, { status: 404 });
      }
      cfg = tpl;
    } else {
      return NextResponse.json({ error: "یا product یا templateKey باید ارسال شود" }, { status: 400 });
    }

    const result = runFullAlmAnalysis({
      product: cfg,
      marketShare: Math.max(0.1, Math.min(50, Number(marketShare) || 5)),
      horizon: Math.max(12, Math.min(120, Number(horizon) || 60)),
      scenario,
      seed: seed ? Number(seed) : 1405,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "خطای داخلی", detail: message }, { status: 500 });
  }
}
