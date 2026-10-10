import { index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import type { ProductConfig } from "../lib/engine/types";

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: varchar("code", { length: 40 }).notNull(),
  family: varchar("family", { length: 16 }).notNull(),
  kind: varchar("kind", { length: 24 }).notNull(),
  config: jsonb("config").$type<ProductConfig>().notNull(),
  configVersion: integer("config_version").notNull().default(1),
  healthScore: integer("health_score"),
  healthEngineVersion: varchar("health_engine_version", { length: 40 }),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const simulations = pgTable("simulations", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  // Legacy rows intentionally have no revision; retain their history, but never treat them as current.
  configVersion: integer("config_version"),
  engineVersion: varchar("engine_version", { length: 40 }).notNull().default("legacy"),
  type: varchar("type", { length: 24 }).notNull(),
  scenario: varchar("scenario", { length: 32 }).notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  result: jsonb("result").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("simulations_latest_idx").on(table.productId, table.type, table.configVersion, table.engineVersion, table.createdAt.desc(), table.id.desc()),
  index("simulations_history_idx").on(table.productId, table.createdAt.desc(), table.id.desc()),
]);

export type ProductRow = typeof products.$inferSelect;
export type SimulationRow = typeof simulations.$inferSelect;
