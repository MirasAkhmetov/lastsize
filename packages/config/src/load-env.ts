import type { z } from 'zod';

export class EnvValidationError extends Error {
  readonly issues: readonly { variable: string; problem: string }[];

  constructor(issues: readonly { variable: string; problem: string }[]) {
    // Only variable names and the kind of problem are reported, never the values:
    // a misconfigured secret must not end up in logs or crash reports.
    super(
      `Invalid environment configuration:\n${issues
        .map((issue) => `  - ${issue.variable}: ${issue.problem}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Validates `source` (usually `process.env`) against `schema` and returns a frozen, typed config.
 * Throws {@link EnvValidationError} listing every invalid variable at once.
 */
export function loadEnv<TSchema extends z.ZodType<Record<string, unknown>>>(
  schema: TSchema,
  source: Record<string, string | undefined> = process.env,
): Readonly<z.infer<TSchema>> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => {
        const variable = issue.path.join('.') || '(root)';
        const missing = typeof issue.path[0] === 'string' && source[issue.path[0]] === undefined;
        return { variable, problem: missing ? 'is required' : issue.message };
      }),
    );
  }
  return Object.freeze(result.data);
}
