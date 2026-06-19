import type { Env } from '../types';

function getAllowedOrigins(env: Env): string[] {
  const configured = env.ALLOWED_ORIGINS?.trim();
  if (!configured) return ['*'];
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveOrigin(request: Request, env: Env): string | null {
  const requestOrigin = request.headers.get('Origin');
  if (!requestOrigin) return null;

  const allowedOrigins = getAllowedOrigins(env);
  if (allowedOrigins.includes('*')) return requestOrigin;
  if (allowedOrigins.includes(requestOrigin)) return requestOrigin;

  return null;
}

export function corsHeaders(
  request: Request,
  env: Env
): Record<string, string> {
  const origin = resolveOrigin(request, env);
  if (!origin) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

export function preflightHeaders(
  request: Request,
  env: Env
): Record<string, string> {
  const origin = resolveOrigin(request, env);
  if (!origin) return {};

  const requestMethod = request.headers.get('Access-Control-Request-Method');
  const requestHeaders = request.headers.get('Access-Control-Request-Headers');

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods':
      requestMethod ?? 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      requestHeaders ?? 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function withCors(
  response: Response,
  request: Request,
  env: Env
): Response {
  const headers = corsHeaders(request, env);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}
