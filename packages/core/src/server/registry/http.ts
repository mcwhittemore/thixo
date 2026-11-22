import type { ServerContext } from "../context.js";
import { fail } from "./errors.js";

export async function readBody(ctx: ServerContext, request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail(ctx, 400, "The body is not valid JSON", "bad_json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(ctx, 400, "The body must be a JSON object", "bad_json");
  return value as Record<string, unknown>;
}

export function wholeNumber(ctx: ServerContext, value: unknown, name: string): number {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) fail(ctx, 400, `${name} must be a whole number from 1`, "bad_request");
  return n;
}

export function text(ctx: ServerContext, value: unknown, name: string): string {
  if (typeof value !== "string" || !value) fail(ctx, 400, `${name} must be a non-empty string`, "bad_request");
  return value;
}
