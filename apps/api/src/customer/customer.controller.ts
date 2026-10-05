import { Body, Controller, Get, Inject, Patch, Req, Res } from '@nestjs/common';
import {
  type CustomerProfile,
  customerProfileSchema,
  updateCustomerProfileRequestSchema,
} from '@lastsize/contracts';
import { customers, type Database, eq } from '@lastsize/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public } from '../auth/decorators';
import { DATABASE } from '../infrastructure/infrastructure.module';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { CustomerSessionService } from './customer-session.service';

/** The guest's own contact details, used to prefill checkout. */
@Controller('customer')
export class CustomerController {
  constructor(
    private readonly customerSessions: CustomerSessionService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Public()
  @Get('me')
  async me(@Req() request: FastifyRequest): Promise<CustomerProfile> {
    const customer = await this.customerSessions.resolve(request);
    return customerProfileSchema.parse({
      name: customer?.name ?? null,
      phone: customer?.phone ?? null,
      locale: customer?.locale ?? 'ru',
    });
  }

  @Public()
  @Patch('me')
  async update(
    @Body(new ZodValidationPipe(updateCustomerProfileRequestSchema))
    body: z.output<typeof updateCustomerProfileRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CustomerProfile> {
    const customer = await this.customerSessions.getOrCreate(request, reply);
    const [updated] = await this.db
      .update(customers)
      .set(body)
      .where(eq(customers.id, customer.id))
      .returning();
    return customerProfileSchema.parse({
      name: updated!.name,
      phone: updated!.phone,
      locale: updated!.locale,
    });
  }
}
