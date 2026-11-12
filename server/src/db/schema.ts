import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  fillOnlyDuringMarketHours: integer("fill_only_during_market_hours", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash").on(table.tokenHash)],
);

export const portfolios = sqliteTable("portfolios", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  cashCents: integer("cash_cents").notNull(),
  startingCashCents: integer("starting_cash_cents").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    status: text("status").notNull(),
    maxOrderCents: integer("max_order_cents").notNull(),
    maxTradesPerDay: integer("max_trades_per_day").notNull(),
    allowedSymbols: text("allowed_symbols").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("agents_key_hash").on(table.keyHash), uniqueIndex("agents_portfolio").on(table.portfolioId)],
);

export const positions = sqliteTable("positions", {
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  microshares: integer("microshares").notNull(),
  avgCostTicks: integer("avg_cost_ticks").notNull(),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  agentId: text("agent_id"),
  agentName: text("agent_name"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  amountType: text("amount_type").notNull(),
  amountMicro: integer("amount_micro"),
  amountCents: integer("amount_cents"),
  status: text("status").notNull(),
  requestedPriceTicks: integer("requested_price_ticks"),
  fillPriceTicks: integer("fill_price_ticks"),
  fillMicroshares: integer("fill_microshares"),
  fillCents: integer("fill_cents"),
  reason: text("reason"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  filledAt: integer("filled_at"),
});

export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  at: integer("at").notNull(),
  equityCents: integer("equity_cents").notNull(),
  cashCents: integer("cash_cents").notNull(),
});

export const watchlist = sqliteTable("watchlist", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const appliedActions = sqliteTable("applied_actions", {
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  actionId: text("action_id").notNull(),
  appliedAt: integer("applied_at").notNull(),
});

export const schema = {
  users,
  sessions,
  portfolios,
  agents,
  positions,
  orders,
  snapshots,
  watchlist,
  appliedActions,
};
