import { deleteProduct, getProduct, listSimulations, updateProduct } from "@/db/repo";
import { analyzeResult } from "@/lib/engine/advisor";
import { QUICK_PARAMS, simulatePortfolio } from "@/lib/engine/simulator";
import { normalizeConfig } from "@/lib/engine/templates";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const product = await getProduct(Number(id));
  if (!product) return Response.json({ error: "محصول یافت نشد" }, { status: 404 });
  const history = await listSimulations(product.id);
  return Response.json({ product, history });
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const product = await getProduct(Number(id));
    if (!product) return Response.json({ error: "محصول یافت نشد" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { config?: unknown };
    const cfg = normalizeConfig(body.config);
    const full = analyzeResult(cfg, simulatePortfolio(cfg, QUICK_PARAMS));
    await updateProduct(product.id, cfg, { healthScore: full.health.score, status: "draft" });
    return Response.json({ id: product.id, config: cfg });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await deleteProduct(Number(id));
  return Response.json({ ok: true });
}
