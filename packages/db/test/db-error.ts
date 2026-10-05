import { DrizzleQueryError } from 'drizzle-orm';

/** The PostgreSQL error behind a failed query (Drizzle wraps it in DrizzleQueryError). */
export interface PgError {
  message: string;
  code?: string;
  constraint?: string;
}

export async function dbError(promise: Promise<unknown>): Promise<PgError> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof DrizzleQueryError ? error.cause : error;
    return cause as PgError;
  }
  throw new Error('Expected the query to fail, but it succeeded');
}

/** Constraint name and message in one string, for readable assertions. */
export function describePgError(error: PgError): string {
  return `${error.constraint ?? ''} ${error.message}`;
}
