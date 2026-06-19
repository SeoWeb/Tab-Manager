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
