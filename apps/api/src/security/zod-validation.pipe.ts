import { HttpException, HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class ValidationFailedException extends HttpException {
  constructor(readonly errors: { path: string; message: string }[]) {
    super('Request validation failed', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** Validates and normalises input with a zod schema; unknown fields are rejected by strict schemas. */
@Injectable()
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw new ValidationFailedException(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
    );
  }
}
