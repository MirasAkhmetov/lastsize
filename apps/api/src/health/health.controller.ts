import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { LivenessResponse, ReadinessResponse } from '@lastsize/contracts';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/decorators';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is up. Does not touch dependencies. */
  @Get()
  @HttpCode(200)
  live(): LivenessResponse {
    return { status: 'ok' };
  }

  /** Readiness: Postgres and Redis respond. 503 tells the proxy to stop routing traffic here. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    reply.status(result.status === 'ready' ? 200 : 503);
    return result;
  }
}
