import type { FastifyReply, FastifyRequest } from 'fastify';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF protection for cookie-authenticated requests, in addition to SameSite=Lax cookies.
 * Browsers always send Origin on cross-origin POST/PUT/PATCH/DELETE and Sec-Fetch-Site on
 * modern versions, so a forged request from another site is identified and rejected.
 * Requests without both headers come from non-browser clients, which cannot carry a
 * victim's cookies, and are allowed (the Next.js server calls the API this way).
 */
export function createCsrfHook(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return async function csrfHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!UNSAFE_METHODS.has(request.method)) return;
    if (request.url.startsWith('/api/v1/webhooks/')) return; // signed server-to-server calls

    const fetchSite = request.headers['sec-fetch-site'];
    const origin = request.headers.origin;
    const crossSite = fetchSite === 'cross-site';
    const foreignOrigin = typeof origin === 'string' && origin !== 'null' && !allowed.has(origin);
    const opaqueOrigin = origin === 'null';

    if (crossSite || foreignOrigin || opaqueOrigin) {
      await reply
        .status(403)
        .header('content-type', 'application/problem+json')
        .send({
          type: 'about:blank',
          title: 'Access denied',
          status: 403,
          code: 'FORBIDDEN',
          detail: 'Cross-site request rejected',
          instance: request.url.split('?')[0],
          requestId: String(request.id),
        });
    }
  };
}
