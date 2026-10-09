import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { ApiError } from "@/lib/api";
import { products, simulations } from "@/db/schema";
import { analyzeResult } from "@/lib/engine/advisor";
import { QUICK_PARAMS, simulatePortfolio } from "@/lib/engine/simulator";
import { normalizeConfig, SEED_TEMPLATE_KEYS, templateConfig } from "@/lib/engine/templates";
import type { FullResult, ProductConfig } from "@/lib/engine/types";

let ready: Promise<void> | null = null;

/** Self-healing schema (mirrors src/db/schema.ts) + first-run seeding with research-based templates. */
export function ensureDb(): Promise<void> {
  if (!ready) {
    ready = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(731405)`);
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS "products" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "code" varchar(40) NOT NULL,
        "family" varchar(16) NOT NULL,
        "kind" varchar(24) NOT NULL,
        "config" jsonb NOT NULL,
        "health_score" integer,
        "status" varchar(16) DEFAULT 'draft' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )`);
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS "simulations" (
        "id" serial PRIMARY KEY NOT NULL,
        "product_id" integer NOT NULL,
        "type" varchar(24) NOT NULL,
        "scenario" varchar(32) NOT NULL,
        "summary" jsonb NOT NULL,
        "result" jsonb NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "simulations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action
      )`);
      const r = await tx.select({ n: sql<number>`count(*)::int` }).from(products);
      if ((r[0]?.n ?? 0) === 0) {
        for (const key of SEED_TEMPLATE_KEYS) {
          const cfg = templateConfig(key);
          if (!cfg) continue;
          const full = analyzeResult(cfg, simulatePortfolio(cfg, QUICK_PARAMS));
          await tx.insert(products).values({
            name: cfg.name,
            code: cfg.code,
            family: cfg.family,
            kind: cfg.kind,
            config: cfg,
            healthScore: full.health.score,
          });
        }
      }
    }).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export interface SimSummary {
  id: number;
  type: string;
  scenario: string;
  summary: Record<string, unknown>;
  createdAt: string;
}

export interface ProductItem {
  id: number;
  name: string;
  code: string;
  family: string;
  kind: string;
  config: ProductConfig;
  healthScore: number | null;
  status: string;
  updatedAt: string;
  latest: SimSummary | null;
}

export async function listProducts(): Promise<ProductItem[]> {
  await ensureDb();
  const rows = await db.select().from(products).orderBy(desc(products.updatedAt));
  const sims = await db
    .selectDistinctOn([simulations.productId], { id: simulations.id, productId: simulations.productId, type: simulations.type, scenario: simulations.scenario, summary: simulations.summary, createdAt: simulations.createdAt })
    .from(simulations)
    .where(eq(simulations.type, "monte_carlo"))
    .orderBy(simulations.productId, desc(simulations.createdAt), desc(simulations.id));
  const latest = new Map<number, SimSummary>();
  for (const s of sims) {
    if (!latest.has(s.productId)) {
      latest.set(s.productId, { id: s.id, type: s.type, scenario: s.scenario, summary: s.summary, createdAt: s.createdAt.toISOString() });
    }
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    family: r.family,
    kind: r.kind,
    config: normalizeConfig(r.config),
    healthScore: r.healthScore,
    status: r.status,
    updatedAt: r.updatedAt.toISOString(),
    latest: latest.get(r.id) && new Date(latest.get(r.id)!.createdAt) >= r.updatedAt ? latest.get(r.id)! : null,
  }));
}

export async function getProduct(id: number) {
  await ensureDb();
  if (!Number.isFinite(id)) return null;
  const [r] = await db.select().from(products).where(eq(products.id, id));
  if (!r) return null;
  return {
    id: r.id,
    config: normalizeConfig(r.config),
    healthScore: r.healthScore,
    status: r.status,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function createProduct(cfg: ProductConfig, healthScore: number | null) {
  await ensureDb();
  const c = normalizeConfig(cfg);
  const [r] = await db
    .insert(products)
    .values({ name: c.name.slice(0, 200), code: c.code.slice(0, 40), family: c.family, kind: c.kind, config: c, healthScore })
    .returning({ id: products.id });
  return r;
}

export async function updateProduct(id: number, cfg: ProductConfig, extra: { healthScore?: number | null; status?: string } = {}) {
  await ensureDb();
  const c = normalizeConfig(cfg);
  await db
    .update(products)
    .set({
      name: c.name.slice(0, 200),
      code: c.code.slice(0, 40),
      family: c.family,
      kind: c.kind,
      config: c,
      ...(extra.healthScore !== undefined ? { healthScore: extra.healthScore } : {}),
      ...(extra.status ? { status: extra.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(products.id, id));
}

export async function deleteProduct(id: number) {
  await ensureDb();
  await db.delete(products).where(eq(products.id, id));
}

export async function saveSimulation(productId: number, type: string, scenario: string, summary: Record<string, unknown>, result: unknown) {
  await ensureDb();
  const [r] = await db.insert(simulations).values({ productId, type, scenario, summary, result }).returning({ id: simulations.id });
  return r.id;
}

/** Persist a result only for the exact configuration that was simulated. */
export async function savePortfolioResult(productId: number, cfg: ProductConfig, full: FullResult): Promise<number> {
  await ensureDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(products).where(eq(products.id, productId)).for("update");
    if (!row) throw new ApiError("محصول یافت نشد", 404);
    if (JSON.stringify(normalizeConfig(row.config)) !== JSON.stringify(cfg)) {
      throw new ApiError("محصول هنگام محاسبه تغییر کرده است؛ شبیه‌سازی را دوباره اجرا کنید.", 409);
    }
    const [saved] = await tx.insert(simulations).values({ productId, type: "monte_carlo", scenario: full.sim.params.scenario, summary: summarize(full), result: full }).returning({ id: simulations.id });
    // Do not overwrite config or its edit timestamp with an old simulation snapshot.
    await tx.update(products).set({ healthScore: full.health.score, status: "simulated" }).where(eq(products.id, productId));
    return saved.id;
  });
}

export async function listSimulations(productId: number): Promise<SimSummary[]> {
  await ensureDb();
  const rows = await db
    .select({ id: simulations.id, type: simulations.type, scenario: simulations.scenario, summary: simulations.summary, createdAt: simulations.createdAt })
    .from(simulations)
    .where(eq(simulations.productId, productId))
    .orderBy(desc(simulations.createdAt))
    .limit(40);
  return rows.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }));
}

export async function latestFullResult(productId: number): Promise<FullResult | null> {
  await ensureDb();
  const [r] = await db
    .select({ result: simulations.result })
    .from(simulations)
    .innerJoin(products, eq(products.id, simulations.productId))
    .where(and(eq(simulations.productId, productId), eq(simulations.type, "monte_carlo"), gte(simulations.createdAt, products.updatedAt)))
    .orderBy(desc(simulations.createdAt))
    .limit(1);
  return r ? (r.result as FullResult) : null;
}

export function summarize(full: FullResult): Record<string, unknown> {
  const k = full.sim.kpis;
  return {
    netProfit: k.netProfit,
    raroc: k.raroc,
    roa: k.roa,
    nplEnd: k.nplEnd,
    approvalRate: k.approvalRate,
    volume: k.volume,
    apr: k.apr,
    realProfit: k.realProfit,
    loyaltyRoi: k.loyaltyRoi,
    inclusion: k.inclusion,
    health: full.health.score,
    grade: full.health.grade,
    compliance: full.compliance.score,
    runs: full.sim.params.runs,
    customers: full.sim.params.customers,
    horizon: full.sim.params.horizon,
  };
}
