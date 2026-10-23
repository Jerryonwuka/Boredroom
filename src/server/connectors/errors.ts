/**
 * Connected apps: errors people see (owner decisions, 22 October 2026: connectors; spec §11.7). A ConnectorError's
 * message is for logs only; people get the fixed words from lib/connectors/words for its code, never a provider's text.
 */
import { AppError } from "@/server/lib/errors";
import { CONNECTORS_NOT_READY, errorWords } from "@/lib/connectors/words";
import { PROVIDER_LABELS } from "@/lib/connectors/types";
import { ConnectorError, type ConnectorErrorCode, type ProviderId } from "./types";

const STATUS: Record<ConnectorErrorCode, number> = {
  REAUTH_REQUIRED: 409, REVOKED: 409, RATE_LIMITED: 429, FORBIDDEN: 403, NOT_FOUND: 404, PROVIDER_DOWN: 502, BAD_RESPONSE: 502,
  ADMIN_APPROVAL: 403, NOT_ALLOWED: 403, TOO_LARGE: 413, CONFLICT: 409, NOT_CONFIGURED: 404,
};

export const notReadyError = () => new AppError(503, "CONNECTORS_NOT_READY", CONNECTORS_NOT_READY);

/** The AppError for a fixed code, in the words people see. */
export function toPublicError(code: ConnectorErrorCode, provider: ProviderId, o: { time?: string } = {}): AppError {
  return new AppError(STATUS[code] ?? 400, `CONNECTOR_${code}`, errorWords(code, provider, o) ?? `${PROVIDER_LABELS[provider]} had a problem.`);
}

/** Any error from connector code as one people may see: ConnectorErrors by code; AppErrors as they are; the rest rethrown. */
export function publicOrRethrow(err: unknown, provider: ProviderId): AppError {
  if (err instanceof ConnectorError) return toPublicError(err.code, provider);
  if (err instanceof AppError) return err;
  throw err;
}
