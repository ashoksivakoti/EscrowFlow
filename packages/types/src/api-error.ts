/**
 * Standard error body for REST JSON responses (non-2xx).
 */

export type ApiErrorBody = {
  /** Machine-readable code, e.g. `UNAUTHORIZED`, `VALIDATION_FAILED`. */
  code: string;
  message: string;
  details?: Record<string, unknown>;
  /** Correlate with server logs / tracing. */
  requestId?: string;
};

export type ApiSuccessEnvelope<T> = {
  data: T;
};

export type ApiErrorEnvelope = {
  error: ApiErrorBody;
};
