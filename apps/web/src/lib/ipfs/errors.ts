export class IpfsError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "IpfsError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
