export type ApiErrorJson = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorJson) {
    super(body.error?.message ?? `Request failed (${status})`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = body.error?.code;
    this.details = body.error?.details;
  }
}

export async function readJsonOrEmpty(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export async function parseResponse<T>(res: Response): Promise<T> {
  const data = (await readJsonOrEmpty(res)) as T | ApiErrorJson;
  if (!res.ok) {
    throw new ApiRequestError(res.status, data as ApiErrorJson);
  }
  return data as T;
}
