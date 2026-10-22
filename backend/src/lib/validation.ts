import { z, type ZodError, type ZodType } from 'zod';

/**
 * Request-body validation schemas.
 *
 * Every HTTP-reachable body parser funnels through `parseBody` with one of the
 * schemas below, replacing the previous hand-rolled `typeof`/`as` casting. The
 * bounds mirror what the handlers actually accept (see the per-schema notes);
 * where a bound is stricter than the old code it is called out explicitly.
 *
 * Sync mutations are validated *loosely* at the envelope level on purpose: the
 * sync engine resolves per-mutation outcomes (conflict / applied) individually,
 * so a single malformed mutation must not fail the whole request here.
 */

/** Same shape login.ts has always enforced (kept for exact parity). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shared email field: trimmed, lowercased, structurally plausible. */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320, 'Email must be at most 320 characters')
  .regex(EMAIL_PATTERN, 'A valid email is required');

/**
 * `POST /projects` — create. The name is trimmed before length checks, so a
 * whitespace-only name fails `min(1)` and the stored value is the trimmed one.
 * `description`/`color`/`icon` stay optional and nullable, matching the old
 * `parseOptionalString` behavior (non-strings used to collapse to `null`; now
 * they are rejected as 400s instead of being silently coerced).
 */
export const projectCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Project name is required')
    .max(200, 'Project name must be at most 200 characters'),
  description: z
    .string()
    .max(2000, 'Description must be at most 2000 characters')
    .nullish(),
  color: z.string().max(64, 'Color must be at most 64 characters').nullish(),
  icon: z.string().max(64, 'Icon must be at most 64 characters').nullish(),
});

/**
 * `PATCH /projects/:id` — update. Same bounds as create, everything optional,
 * but at least one field must be present (a no-op empty patch is rejected).
 * The name rule is deliberately identical to create so both paths trim and
 * length-validate symmetrically.
 */
export const projectUpdateSchema = projectCreateSchema
  .partial()
  .refine(
    (patch) =>
      patch.name !== undefined ||
      patch.description !== undefined ||
      patch.color !== undefined ||
      patch.icon !== undefined,
    { message: 'At least one of name, description, color, icon is required' }
  );

/**
 * `POST /projects/:id/invitations` — create. `expiresInDays` is coerced
 * (numeric strings accepted), bounded to a 1–30 day window, and defaults to
 * the 7 days the handler used to fall back to. `role` accepts the four valid
 * roles and defaults to `editor`; granting `owner` is rejected by the handler
 * with its dedicated message, as before.
 */
export const invitationCreateSchema = z.object({
  email: emailSchema.nullish(),
  role: z.enum(['viewer', 'editor', 'admin', 'owner']).default('editor'),
  expiresInDays: z.coerce
    .number()
    .int('expiresInDays must be a whole number')
    .min(1, 'expiresInDays must be at least 1')
    .max(30, 'expiresInDays must be at most 30')
    .default(7),
});

/**
 * `POST /auth/request-code`.
 *
 * Requester-supplied display names are deliberately NOT accepted: the address
 * is unverified at request time, so persisting or emailing the name would hand
 * attackers an injection/harassment vector (the email body must contain no
 * attacker-chosen text). Unknown fields — including a legacy `display_name` —
 * are stripped by zod's default object parsing, so existing clients that still
 * send one keep working; the value is simply ignored.
 */
export const loginRequestSchema = z.object({
  email: emailSchema,
});

/** `POST /auth/verify` — email plus the 8-digit code. */
export const loginVerifySchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{8}$/, 'An 8-digit code is required'),
});

/**
 * Absolute envelope bound for one sync request. The per-deployment quota
 * (`checkSyncMutationsPerRequest`) may still tighten this dynamically; this cap
 * exists so a single request cannot carry an unbounded array at all.
 */
export const MAX_SYNC_MUTATIONS = 500;

/**
 * `POST /projects/:id/sync` — envelope only. Each mutation must at least
 * identify itself (`clientMutationId`) for idempotency; remaining fields are
 * passed through untouched because the sync engine owns per-mutation
 * validation and outcomes.
 */
export const syncPayloadSchema = z.object({
  lastCursor: z.number().nullish(),
  mutations: z
    .array(z.looseObject({ clientMutationId: z.string() }))
    .max(MAX_SYNC_MUTATIONS, `Sync request allows at most ${MAX_SYNC_MUTATIONS} mutations`)
    .optional(),
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;
export type LoginRequestInput = z.infer<typeof loginRequestSchema>;
export type LoginVerifyInput = z.infer<typeof loginVerifySchema>;
export type SyncPayloadInput = z.infer<typeof syncPayloadSchema>;

/**
 * Flatten a `ZodError` into a per-field summary (`{ field: firstMessage }`).
 * Top-level (object-level) issues are keyed as `_`. Only the first message per
 * field is reported — the summary is for clients, not exhaustive reporting.
 */
export function fieldErrorSummary(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    if (!(key in details)) details[key] = issue.message;
  }
  return details;
}

/** Result of `parseBody`: the parsed (transformed) value or a field summary. */
export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; details: Record<string, string> };

/**
 * Validate an already-read JSON body against a schema. Returns the parsed data
 * on success, or a field-level error summary suitable for `badRequest(
 * 'Invalid request', details)` on failure. Never throws.
 */
export function parseBody<T>(
  schema: ZodType<T>,
  body: unknown
): ParseResult<T> {
  const result = schema.safeParse(body);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, details: fieldErrorSummary(result.error) };
}
