export class AppError extends Error {
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
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static unauthenticated(message = "Authentication required"): AppError {
    return new AppError("UNAUTHENTICATED", message, 401);
  }

  static forbidden(message = "You do not have permission to perform this action"): AppError {
    return new AppError("FORBIDDEN", message, 403);
  }

  static notFound(code: string, message: string): AppError {
    return new AppError(code, message, 404);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
