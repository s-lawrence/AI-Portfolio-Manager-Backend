import { FxRateSnapshot } from "@prisma/client";

import {
  getLatestFxRateSnapshotAsOf,
  getLatestFxRateSnapshot,
  listFxRateSnapshots,
  upsertFxRateSnapshot as upsertFxRateSnapshotRepository,
} from "../repositories/fx-rate-snapshots.repository";
import type { CadConversionStatus } from "../types/services";

export interface UpsertFxRateSnapshotInput {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  capturedAt: Date;
  source?: string | null;
}

export interface ConvertMoneyToCadInput {
  amount: number;
  currency: string;
  asOf?: Date;
}

export interface ConvertMoneyToCadResult {
  amountCad: number | null;
  fxRate: number | null;
  fxRateSource: string | null;
  fxRateCapturedAt: Date | null;
  conversionStatus: CadConversionStatus;
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

export function convertAmountWithRate(amount: number, rate: number): number {
  return amount * rate;
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

export async function getLatestFxRateAsOf(
  baseCurrency: string,
  quoteCurrency: string,
  asOf: Date,
): Promise<FxRateSnapshot | null> {
  return getLatestFxRateSnapshotAsOf(baseCurrency, quoteCurrency, asOf);
}

export async function listFxRateHistory(
  baseCurrency: string,
  quoteCurrency: string,
  limit?: number,
): Promise<FxRateSnapshot[]> {
  return listFxRateSnapshots(baseCurrency, quoteCurrency, limit);
}

export async function convertMoneyToCad(
  input: ConvertMoneyToCadInput,
): Promise<ConvertMoneyToCadResult> {
  const currency = normalizeCurrency(input.currency);

  if (currency === "CAD") {
    return {
      amountCad: input.amount,
      fxRate: 1,
      fxRateSource: null,
      fxRateCapturedAt: null,
      conversionStatus: "DIRECT_CAD",
    };
  }

  if (currency === "USD") {
    const snapshot = input.asOf
      ? await getLatestFxRateAsOf("USD", "CAD", input.asOf)
      : await getLatestFxRate("USD", "CAD");

    if (!snapshot) {
      return {
        amountCad: null,
        fxRate: null,
        fxRateSource: null,
        fxRateCapturedAt: null,
        conversionStatus: "MISSING_FX",
      };
    }

    return {
      amountCad: convertAmountWithRate(input.amount, snapshot.rate),
      fxRate: snapshot.rate,
      fxRateSource: snapshot.source ?? null,
      fxRateCapturedAt: snapshot.capturedAt,
      conversionStatus: "CONVERTED",
    };
  }

  return {
    amountCad: null,
    fxRate: null,
    fxRateSource: null,
    fxRateCapturedAt: null,
    conversionStatus: "UNSUPPORTED_CURRENCY",
  };
}
