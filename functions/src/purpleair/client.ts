/**
 * Thin PurpleAir API client with exponential backoff on HTTP 429.
 *
 * The API returns column-oriented data: a `fields` array naming each column
 * and a `data` array of rows. `rowsToObjects` turns that into plain objects.
 */
import axios, { AxiosError, AxiosInstance } from "axios";
import * as logger from "firebase-functions/logger";
import { BACKOFF, BOUNDING_BOX, PURPLEAIR_SENSORS_URL, REQUESTED_FIELDS } from "./config";

export interface PurpleAirResponse {
  api_version: string;
  time_stamp: number;
  data_time_stamp: number;
  max_age?: number;
  fields: string[];
  data: Array<Array<string | number | null>>;
}

export type PurpleAirRow = Record<string, string | number | null>;

export class PurpleAirRateLimitError extends Error {
  constructor(public readonly attempts: number) {
    super(`PurpleAir rate limit (429) persisted after ${attempts} attempts`);
    this.name = "PurpleAirRateLimitError";
  }
}

export interface ClientOptions {
  http?: AxiosInstance;
  sleep?: (ms: number) => Promise<void>;
  /** Override for tests. Defaults to BOUNDING_BOX. */
  bbox?: typeof BOUNDING_BOX;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Delay before retry `attempt` (1-based), honouring Retry-After when present. */
export function backoffDelayMs(attempt: number, retryAfterHeader?: string | number | null): number {
  if (retryAfterHeader != null) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, BACKOFF.maxDelayMs);
    }
  }
  const exp = BACKOFF.baseDelayMs * Math.pow(2, attempt - 1);
  return Math.min(exp, BACKOFF.maxDelayMs);
}

export function rowsToObjects(resp: Pick<PurpleAirResponse, "fields" | "data">): PurpleAirRow[] {
  const { fields, data } = resp;
  return (data || []).map((row) => {
    const obj: PurpleAirRow = {};
    fields.forEach((field, i) => {
      obj[field] = row[i] ?? null;
    });
    return obj;
  });
}

/**
 * Fetch every sensor inside the bounding box. Throws on non-429 HTTP errors
 * and network failures so the caller can decide to skip the cycle.
 */
export async function fetchSensors(apiKey: string, opts: ClientOptions = {}): Promise<PurpleAirResponse> {
  const http = opts.http ?? axios.create({ timeout: 20000 });
  const sleep = opts.sleep ?? defaultSleep;
  const bbox = opts.bbox ?? BOUNDING_BOX;

  for (let attempt = 1; attempt <= BACKOFF.maxAttempts; attempt++) {
    try {
      const resp = await http.get<PurpleAirResponse>(PURPLEAIR_SENSORS_URL, {
        headers: { "X-API-Key": apiKey },
        params: {
          fields: REQUESTED_FIELDS.join(","),
          nwlng: bbox.nwlng,
          nwlat: bbox.nwlat,
          selng: bbox.selng,
          selat: bbox.selat,
        },
      });
      return resp.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status;
      if (status === 429 && attempt < BACKOFF.maxAttempts) {
        const retryAfter = axiosErr.response?.headers?.["retry-after"] as string | undefined;
        const delay = backoffDelayMs(attempt, retryAfter);
        logger.warn("PurpleAir 429, backing off", { attempt, delayMs: delay });
        await sleep(delay);
        continue;
      }
      if (status === 429) throw new PurpleAirRateLimitError(attempt);
      throw err;
    }
  }
  // Unreachable, loop either returns or throws.
  throw new PurpleAirRateLimitError(BACKOFF.maxAttempts);
}
