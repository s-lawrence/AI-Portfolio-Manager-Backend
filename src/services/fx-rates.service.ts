import { FxRateSnapshot } from "@prisma/client";

import {
  getLatestFxRateSnapshot,
  listFxRateSnapshots,
  upsertFxRateSnapshot as upsertFxRateSnapshotRepository,
} from "../repositories/fx-rate-snapshots.repository";

export interface UpsertFxRateSnapshotInput {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  capturedAt: Date;
  source?: string | null;
}

export async function upsertFxRateSnapshot(
  input: UpsertFxRateSnapshotInput,
): Promise<{ snapshot: FxRateSnapshot; created: boolean; updated: boolean }> {
  return upsertFxRateSnapshotRepository(input);
}

export async function getLatestFxRate(
  baseCurrency: string,
  quoteCurrency: string,
): Promise<FxRateSnapshot | null> {
  return getLatestFxRateSnapshot(baseCurrency, quoteCurrency);
}

export async function listFxRateHistory(
  baseCurrency: string,
  quoteCurrency: string,
  limit?: number,
): Promise<FxRateSnapshot[]> {
  return listFxRateSnapshots(baseCurrency, quoteCurrency, limit);
}
