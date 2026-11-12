import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "./schema.js";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  fill_only_during_market_hours INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cash_cents INTEGER NOT NULL,
  starting_cash_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id TEXT NOT NULL UNIQUE REFERENCES portfolios(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  status TEXT NOT NULL,
  max_order_cents INTEGER NOT NULL,
  max_trades_per_day INTEGER NOT NULL,
  allowed_symbols TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  microshares INTEGER NOT NULL,
  avg_cost_ticks INTEGER NOT NULL,
  PRIMARY KEY (portfolio_id, symbol)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  agent_id TEXT,
  agent_name TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  amount_type TEXT NOT NULL,
  amount_micro INTEGER,
  amount_cents INTEGER,
  status TEXT NOT NULL,
  requested_price_ticks INTEGER,
  fill_price_ticks INTEGER,
  fill_microshares INTEGER,
  fill_cents INTEGER,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  filled_at INTEGER
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  equity_cents INTEGER NOT NULL,
  cash_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, symbol)
);
CREATE TABLE IF NOT EXISTS applied_actions (
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (portfolio_id, action_id)
);
CREATE INDEX IF NOT EXISTS orders_portfolio_created ON orders(portfolio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS snapshots_portfolio_at ON snapshots(portfolio_id, at);
`;

export function openDatabase(file: string) {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON");
  if (file !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.exec(MIGRATION);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export type AppDb = ReturnType<typeof openDatabase>["db"];
