import { createProduct, listProducts } from "@/db/repo";
import { analyzeResult } from "@/lib/engine/advisor";
import { QUICK_PARAMS, simulatePortfolio } from "@/lib/engine/simulator";
import { normalizeConfig } from "@/lib/engine/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await listProducts();
    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { config?: unknown };
    const cfg = normalizeConfig(body.config);
    const full = analyzeResult(cfg, simulatePortfolio(cfg, QUICK_PARAMS));
    const row = await createProduct(cfg, full.health.score);
    return Response.json({ id: row.id }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
