import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

let cachedDb: NodePgDatabase | undefined;

/**
 * Pool به‌صورت تنبل (lazy) ساخته می‌شود تا import این ماژول در زمان build
 * (مثلاً مرحلهٔ «Collecting page data» در Vercel) به DATABASE_URL نیاز نداشته باشد.
 * اگر متغیر تنظیم نشده باشد، خطا فقط هنگام اولین استفادهٔ واقعی از دیتابیس رخ می‌دهد.
 */
export function getPool(): Pool {
  if (globalForDb.__arenaNextJsPostgresqlPool) {
    return globalForDb.__arenaNextJsPostgresqlPool;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10,
    statement_timeout: 15000,
    query_timeout: 20000,
  });
  // An idle connection can fail outside an awaited query; without a listener pg emits a fatal error.
  pool.on("error", (error) => {
    console.error("Idle PostgreSQL connection failed", { code: (error as { code?: string }).code, message: error.message });
  });

  // در production هم کش می‌کنیم تا در هر invocation یک Pool جدید ساخته نشود.
  globalForDb.__arenaNextJsPostgresqlPool = pool;
  return pool;
}

export function getDb(): NodePgDatabase {
  cachedDb ??= drizzle(getPool());
  return cachedDb;
}

/** سازگار با کد قبلی: `db.select()...` همچنان کار می‌کند ولی اتصال تنبل است. */
export const db = new Proxy({} as NodePgDatabase, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
