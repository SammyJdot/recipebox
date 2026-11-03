import { z } from "zod";
const text = (max) => z.string().trim().max(max);
const minutes = z.number().int().min(0).max(100000).nullable().default(null);
export const recipeSchema = z
  .object({
    title: text(200).min(1),
    description: text(10000).default(""),
    servings: z.number().positive().max(10000),
    prep_minutes: minutes,
    cook_minutes: minutes,
    source: text(2000).default(""),
    ingredients: z
      .array(
        z
          .object({
            quantity: text(80).nullable().default(null),
            unit: text(80).default(""),
            item: text(300).min(1),
            note: text(500).default(""),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    steps: z
      .array(z.object({ text: text(5000).min(1) }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export const boxSchema = z
  .object({ name: text(120).min(1), description: text(2000).default("") })
  .strict();
export const credentialsSchema = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_.-]{3,64}$/),
    password: z
      .string()
      .min(12)
      .refine(
        (s) => Buffer.byteLength(s) <= 72,
        "Password must be at most 72 UTF-8 bytes",
      ),
  })
  .strict();
export const registerSchema = credentialsSchema.extend({
  display_name: text(120).min(1),
  email: z.union([z.email().max(254), z.literal("")]).optional(),
});
export const coverSchema = z
  .object({ cover_photo_id: z.number().int().positive() })
  .strict();
export const linkSchema = z
  .object({ recipe_id: z.number().int().positive() })
  .strict();
export function validate(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HttpError(
      400,
      result.error.issues
        .map((i) => `${i.path.join(".") || "request"}: ${i.message}`)
        .join("; ")
        .slice(0, 1200),
    );
  return result.data;
}
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function id(value) {
  if (!/^[1-9]\d{0,14}$/.test(String(value)))
    throw new HttpError(400, "Invalid ID");
  return Number(value);
}
