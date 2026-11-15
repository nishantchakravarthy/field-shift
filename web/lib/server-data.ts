import { promises as fs } from "fs";
import path from "path";
import {
  CROPS,
  SCENARIOS,
  type Crop,
  type MetaFile,
  type Scenario,
  type SuitabilityFile,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8")) as T;
  } catch {
    return null;
  }
}

export const readMeta = () => readJson<MetaFile>("meta.json");

export interface Finding {
  crop: Crop;
  scenario: Scenario;
  total: number;
  losing: number;
  gaining: number;
  /** Districts scoring ≥ 50 at baseline that fall below 50 by 2050. */
  dropBelow50: number;
  meanChange: number;
  worst: { id: string; baseline: number; y2050: number; change: number } | null;
}

export async function readFindings(): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const crop of CROPS)
    for (const scenario of SCENARIOS) {
      const f = await readJson<SuitabilityFile>(`suitability_${crop}_${scenario}.json`);
      if (!f || f.districts.length === 0) continue;
      const d = f.districts;
      const worst = [...d].sort((a, b) => a.change - b.change)[0];
      out.push({
        crop,
        scenario,
        total: d.length,
        losing: d.filter((r) => r.change < 0).length,
        gaining: d.filter((r) => r.change > 0).length,
        dropBelow50: d.filter((r) => r.baseline >= 50 && r.y2050 < 50).length,
        meanChange: d.reduce((s, r) => s + r.change, 0) / d.length,
        worst: worst ?? null,
      });
    }
  return out;
}
