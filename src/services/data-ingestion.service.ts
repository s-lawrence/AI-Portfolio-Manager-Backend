import { DataIngestionLog } from "@prisma/client";

import {
  createDataIngestionLog,
  updateDataIngestionLog,
} from "../repositories/data-ingestion-logs.repository";
import { normalizeTickerOrThrow } from "../types/common";
import { IngestionWrapOptions } from "../types/services";

export interface IngestionResult {
  recordsCreated?: number;
  recordsUpdated?: number;
}

export interface LoggedCallbackResult<T> {
  data: T;
  recordsCreated?: number;
  recordsUpdated?: number;
}

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function isLoggedCallbackResult<T>(
  value: T | LoggedCallbackResult<T>,
): value is LoggedCallbackResult<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    Object.prototype.hasOwnProperty.call(value, "data")
  );
}

export async function startIngestionLog(
  jobName: string,
  provider?: string,
  ticker?: string,
): Promise<DataIngestionLog> {
  const normalizedJobName = assertNonBlank(jobName, "jobName");
  const normalizedTicker = ticker ? normalizeTickerOrThrow(ticker) : undefined;

  return createDataIngestionLog({
    jobName: normalizedJobName,
    provider,
    ticker: normalizedTicker,
    status: "RUNNING",
    startedAt: new Date(),
  });
}

export async function finishIngestionLog(
  logId: string,
  result: IngestionResult,
): Promise<DataIngestionLog> {
  const normalizedLogId = assertNonBlank(logId, "logId");

  return updateDataIngestionLog(normalizedLogId, {
    status: "SUCCESS",
    finishedAt: new Date(),
    recordsCreated: result.recordsCreated ?? 0,
    recordsUpdated: result.recordsUpdated ?? 0,
    errorMessage: null,
  });
}

export async function failIngestionLog(
  logId: string,
  error: unknown,
): Promise<DataIngestionLog> {
  const normalizedLogId = assertNonBlank(logId, "logId");

  return updateDataIngestionLog(normalizedLogId, {
    status: "FAILED",
    finishedAt: new Date(),
    errorMessage: toErrorMessage(error),
  });
}

/**
 * Runs an async ingestion callback while automatically creating and closing logs.
 */
export async function withIngestionLogging<T>(
  jobName: string,
  callback: (log: DataIngestionLog) => Promise<T | LoggedCallbackResult<T>>,
  options?: IngestionWrapOptions,
): Promise<T> {
  const log = await startIngestionLog(jobName, options?.provider, options?.ticker);

  try {
    const callbackResult = await callback(log);

    if (isLoggedCallbackResult(callbackResult)) {
      await finishIngestionLog(log.id, {
        recordsCreated: callbackResult.recordsCreated,
        recordsUpdated: callbackResult.recordsUpdated,
      });

      return callbackResult.data;
    }

    await finishIngestionLog(log.id, {});
    return callbackResult;
  } catch (error) {
    await failIngestionLog(log.id, error);
    throw error;
  }
}
