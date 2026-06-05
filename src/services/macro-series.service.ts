import { MacroSeriesObservation } from "@prisma/client";

import {
  getLatestMacroSeriesObservation,
  listMacroSeriesObservations,
  upsertMacroSeriesObservation as upsertMacroSeriesObservationRepository,
} from "../repositories/macro-series-observations.repository";

export interface UpsertMacroSeriesObservationInput {
  provider: string;
  seriesId: string;
  observedAt: Date;
  value: number;
  name?: string | null;
  country?: string | null;
  category?: string | null;
  unit?: string | null;
}

export async function upsertMacroSeriesObservation(
  input: UpsertMacroSeriesObservationInput,
): Promise<{ observation: MacroSeriesObservation; created: boolean; updated: boolean }> {
  return upsertMacroSeriesObservationRepository(input);
}

export async function getLatestMacroObservation(
  provider: string,
  seriesId: string,
): Promise<MacroSeriesObservation | null> {
  return getLatestMacroSeriesObservation(provider, seriesId);
}

export async function listMacroSeriesHistory(
  provider: string,
  seriesId: string,
  limit?: number,
): Promise<MacroSeriesObservation[]> {
  return listMacroSeriesObservations({
    provider,
    seriesId,
    limit,
  });
}

export async function listLatestMacroByProvider(
  provider: string,
): Promise<MacroSeriesObservation[]> {
  const observations = await listMacroSeriesObservations({
    provider,
    limit: 2000,
  });

  const latestBySeries = new Map<string, MacroSeriesObservation>();

  for (const observation of observations) {
    if (!latestBySeries.has(observation.seriesId)) {
      latestBySeries.set(observation.seriesId, observation);
    }
  }

  return [...latestBySeries.values()].sort(
    (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
  );
}
