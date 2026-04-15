import type { z } from "zod";
import { ZodError } from "zod";

import { AppError } from "@/server/errors/app-error";

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new AppError("INVALID_JSON", "Expected JSON body", 400);
  }
  return parseWithSchema(json, schema);
}

export function parseWithSchema<TSchema extends z.ZodTypeAny>(
  value: unknown,
  schema: TSchema,
): z.infer<TSchema> {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError("VALIDATION_FAILED", "Validation failed", 400, {
        issues: error.flatten(),
      });
    }
    throw error;
  }
}
