import { promises as fs } from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { Redis } from "@upstash/redis";
import {
  defaultState,
  normalizeState,
  type AppState,
  type PersistenceBackend,
} from "@/lib/types";

const KEY = "wed-preps:state";
const ROW_ID = "shared";
const FILE = path.join(process.cwd(), "data", "store.json");

type GlobalStore = {
  state?: AppState;
};

const memory = globalThis as typeof globalThis & {
  __wedPrepsStore?: GlobalStore;
};

function getPostgresUrl() {
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ""
  );
}

type SqlClient = {
  query: (query: string, params?: unknown[]) => Promise<unknown>;
};

function getSql(): SqlClient | null {
  const url = getPostgresUrl();
  if (!url) return null;
  return neon(url);
}

function getRedis() {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function readFileState(): Promise<AppState | null> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return JSON.parse(raw) as AppState;
  } catch {
    return null;
  }
}

async function writeFileState(state: AppState) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(state, null, 2), "utf8");
}

async function ensureNeonTable(sql: SqlClient) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS wed_preps_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readNeonState(sql: SqlClient): Promise<AppState | null> {
  await ensureNeonTable(sql);
  const rows = (await sql.query(
    "SELECT data FROM wed_preps_state WHERE id = $1 LIMIT 1",
    [ROW_ID]
  )) as { data: AppState }[];
  return rows[0]?.data ?? null;
}

async function writeNeonState(sql: SqlClient, state: AppState) {
  await ensureNeonTable(sql);
  await sql.query(
    `INSERT INTO wed_preps_state (id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [ROW_ID, JSON.stringify(state)]
  );
}

export async function getState(): Promise<{
  state: AppState;
  backend: PersistenceBackend;
}> {
  const sql = getSql();
  if (sql) {
    const stored = await readNeonState(sql);
    if (stored) return { state: normalizeState(stored), backend: "neon" };
    const initial = defaultState();
    await writeNeonState(sql, initial);
    return { state: initial, backend: "neon" };
  }

  const redis = getRedis();
  if (redis) {
    const stored = await redis.get<AppState>(KEY);
    if (stored) return { state: normalizeState(stored), backend: "kv" };
    const initial = defaultState();
    await redis.set(KEY, initial);
    return { state: initial, backend: "kv" };
  }

  if (!process.env.VERCEL) {
    const fromFile = await readFileState();
    if (fromFile) return { state: normalizeState(fromFile), backend: "file" };
    const initial = defaultState();
    await writeFileState(initial);
    return { state: initial, backend: "file" };
  }

  if (!memory.__wedPrepsStore) memory.__wedPrepsStore = {};
  if (!memory.__wedPrepsStore.state) {
    memory.__wedPrepsStore.state = defaultState();
  }
  return { state: normalizeState(memory.__wedPrepsStore.state), backend: "memory" };
}

export async function saveState(state: AppState): Promise<PersistenceBackend> {
  const sql = getSql();
  if (sql) {
    await writeNeonState(sql, state);
    return "neon";
  }

  const redis = getRedis();
  if (redis) {
    await redis.set(KEY, state);
    return "kv";
  }

  if (!process.env.VERCEL) {
    await writeFileState(state);
    return "file";
  }

  if (!memory.__wedPrepsStore) memory.__wedPrepsStore = {};
  memory.__wedPrepsStore.state = state;
  return "memory";
}
