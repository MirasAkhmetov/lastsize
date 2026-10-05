import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { ErrorCode, ProblemDetails } from '@lastsize/contracts';
import type { Logger } from '@lastsize/logger';
import type { FastifyReply, FastifyRequest } from 'fastify';

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

const TITLE_BY_STATUS: Partial<Record<number, string>> = {
  400: 'Bad request',
  401: 'Authentication required',
  403: 'Access denied',
  404: 'Not found',
  409: 'Conflict',
  422: 'Validation failed',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

/**
 * Converts every error into RFC 9457 problem details. Unexpected errors are logged with the
 * request id and returned as a generic 500: stack traces and internal messages never reach clients.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const status = this.statusOf(exception);
    const problem: ProblemDetails = {
      type: 'about:blank',
      title: TITLE_BY_STATUS[status] ?? 'Error',
      status,
      code: CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
      instance: request.url.split('?')[0],
      requestId: String(request.id),
    };

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId: request.id, url: problem.instance },
        'unhandled error',
      );
    } else if (exception instanceof HttpException) {
      const detail = this.publicDetail(exception);
      if (detail) problem.detail = detail;
    }

    void reply.status(status).header('content-type', 'application/problem+json').send(problem);
  }

  private statusOf(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    // Fastify's own errors (body too large, malformed JSON) carry a 4xx statusCode.
    const statusCode = (exception as { statusCode?: unknown } | null)?.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) return statusCode;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private publicDetail(exception: HttpException): string | undefined {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
}
