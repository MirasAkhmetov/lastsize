import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@lastsize/contracts';

/**
 * A 409 the client handles by its code (OUT_OF_STOCK, PRICE_CHANGED, CART_CHANGED);
 * `errors` points at the affected items.
 */
export class CodedConflictException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    detail: string,
    readonly errors: { path: string; message: string }[] = [],
  ) {
    super(detail, HttpStatus.CONFLICT);
  }
}
