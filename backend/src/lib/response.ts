export function jsonResponse<T>(body: T, init: ResponseInit = {}): Response {
  return Response.json(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    ...init,
  });
}

export function errorResponse(
  status: number,
  message: string,
  details?: unknown
): Response {
  return jsonResponse(
    {
      error: {
        message,
        details,
      },
    },
    { status }
  );
}

export function notFound(message = 'Not found'): Response {
  return errorResponse(404, message);
}

export function methodNotAllowed(allowed: string[]): Response {
  return errorResponse(405, 'Method not allowed', { allowed });
}

export function unauthorized(message = 'Unauthorized'): Response {
  return errorResponse(401, message);
}

export function forbidden(message = 'Forbidden'): Response {
  return errorResponse(403, message);
}

export function badRequest(message: string, details?: unknown): Response {
  return errorResponse(400, message, details);
}

/**
 * `429 Too Many Requests` with `Retry-After` and the `X-RateLimit-*` headers
 * derived from the limiter decision. CORS-wrapped by the caller.
 */
export function rateLimited(
  retryAfter: number,
  decision: { limit: number; remaining: number; resetAt: number }
): Response {
  return jsonResponse(
    {
      error: {
        message: 'Too many requests',
        retryAfter,
      },
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(decision.limit),
        'X-RateLimit-Remaining': String(decision.remaining),
        'X-RateLimit-Reset': String(Math.floor(decision.resetAt / 1000)),
      },
    }
  );
}

/** `403` for a resource-quota breach (max projects/members/entities). */
export function quotaExceeded(message: string): Response {
  return errorResponse(403, message);
}

/** `413 Payload Too Large` for a request body over the configured max size. */
export function payloadTooLarge(maxBytes: number): Response {
  return errorResponse(413, 'Request body too large', {
    maxBytes,
  });
}

/** Default maximum JSON request-body size (1 MB). */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Shared JSON body parser with a size guard. Checks `Content-Length` first,
 * then reads and bounds the body, returning a `400`/`413` `Response` on
 * malformed or oversized input. Used by `index.ts` routing and `lib/auth.ts`
 * so every JSON endpoint enforces the same limit.
 */
export async function readJson(
  request: Request,
  options: { maxBytes?: number } = {}
): Promise<unknown | Response> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BODY_BYTES;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return badRequest('Content-Type must be application/json');
  }

  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return payloadTooLarge(maxBytes);
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await request.arrayBuffer();
  } catch {
    return badRequest('Invalid JSON body');
  }
  if (buffer.byteLength > maxBytes) {
    return payloadTooLarge(maxBytes);
  }

  const text = new TextDecoder().decode(buffer);
  try {
    return JSON.parse(text);
  } catch {
    return badRequest('Invalid JSON body');
  }
}
