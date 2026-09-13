import { promises as fs } from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
import {
  defaultState,
  type AppState,
  type PersistenceBackend,
} from "@/lib/types";

const KEY = "wed-preps:state";
const FILE = path.join(process.cwd(), "data", "store.json");

type GlobalStore = {
  state?: AppState;
};

const memory = globalThis as typeof globalThis & {
  __wedPrepsStore?: GlobalStore;
};

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

export async function getState(): Promise<{
  state: AppState;
  backend: PersistenceBackend;
}> {
  const redis = getRedis();
  if (redis) {
    const stored = await redis.get<AppState>(KEY);
    if (stored) return { state: stored, backend: "kv" };
    const initial = defaultState();
    await redis.set(KEY, initial);
    return { state: initial, backend: "kv" };
  }

  if (!process.env.VERCEL) {
    const fromFile = await readFileState();
    if (fromFile) return { state: fromFile, backend: "file" };
    const initial = defaultState();
    await writeFileState(initial);
    return { state: initial, backend: "file" };
  }

  if (!memory.__wedPrepsStore) memory.__wedPrepsStore = {};
  if (!memory.__wedPrepsStore.state) {
    memory.__wedPrepsStore.state = defaultState();
  }
  return { state: memory.__wedPrepsStore.state, backend: "memory" };
}

export async function saveState(state: AppState): Promise<PersistenceBackend> {
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
