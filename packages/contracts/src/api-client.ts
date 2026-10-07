import { type ProblemDetails, problemDetailsSchema } from './problem.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | null,
    readonly retryAfterSeconds: number | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `Request failed with ${status}`);
    this.name = 'ApiError';
  }

  /** Field-level messages keyed by field name, for forms. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(
      (this.problem?.errors ?? []).map((error) => [error.path, error.message]),
    );
  }
}

export class NetworkError extends Error {
  constructor() {
    super('Network request failed');
    this.name = 'NetworkError';
  }
}

/**
 * Browser-side call to the page's own origin (/api is proxied to the API), used by the storefront
 * and the admin panel. Session cookies are HttpOnly and never touched by JavaScript.
 */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = problemDetailsSchema.safeParse(payload);
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new ApiError(
      response.status,
      problem.success ? problem.data : null,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  return payload as T;
}
