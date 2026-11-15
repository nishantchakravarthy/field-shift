import type {
  Crop,
  DistrictCollection,
  DistrictFile,
  MetaFile,
  StateCollection,
  Scenario,
  SuitabilityFile,
  SuitabilityIndex,
} from "./types";
import { CROPS, SCENARIOS } from "./types";

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const API_TIMEOUT_MS = 3000;

let apiDown = false;

async function getJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return (await res.json()) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** API first; bundled copy in /data when the API is unset, slow (>3 s) or down. */
async function load<T>(apiPath: string, bundledPath: string): Promise<T> {
  if (API && !apiDown) {
    try {
      return await getJson<T>(`${API}${apiPath}`, API_TIMEOUT_MS);
    } catch {
      apiDown = true;
    }
  }
  return getJson<T>(bundledPath);
}

const cache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    const p = fn().catch((e) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, p);
  }
  return cache.get(key) as Promise<T>;
}

export const getDistricts = () =>
  cached("districts", () => load<DistrictCollection>("/api/districts", "/data/districts.geojson"));

export const getSuitability = (crop: Crop, scenario: Scenario) =>
  cached(`s:${crop}:${scenario}`, () =>
    load<SuitabilityFile>(
      `/api/suitability?crop=${crop}&scenario=${scenario}`,
      `/data/suitability_${crop}_${scenario}.json`,
    ),
  );

export const getDistrict = (id: string) =>
  cached(`d:${id}`, () =>
    load<DistrictFile>(
      `/api/district/${encodeURIComponent(id)}`,
      `/data/district_${encodeURIComponent(id)}.json`,
    ),
  );

/** State outlines (bundled only). Resolves to null when the file is absent, e.g. a one-state build. */
export const getStates = () =>
  cached("states", () => getJson<StateCollection>("/data/states.geojson").catch(() => null));

export const getMeta = () => cached("meta", () => load<MetaFile>("/api/meta", "/data/meta.json"));

export const suitKey = (crop: Crop, scenario: Scenario) => `${crop}_${scenario}`;

/** All six crop × scenario tables, indexed by key then district id. */
export async function getAllSuitability(): Promise<SuitabilityIndex> {
  const out: SuitabilityIndex = {};
  await Promise.all(
    CROPS.flatMap((crop) =>
      SCENARIOS.map(async (scenario) => {
        const file = await getSuitability(crop, scenario);
        out[suitKey(crop, scenario)] = Object.fromEntries(file.districts.map((d) => [d.id, d]));
      }),
    ),
  );
  return out;
}
