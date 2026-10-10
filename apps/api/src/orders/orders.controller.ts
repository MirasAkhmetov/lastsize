import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  addCartItemRequestSchema,
  type Cart,
  cartSchema,
  checkoutRequestSchema,
  orderAccessQuerySchema,
  type OrderCreated,
  orderCreatedSchema,
  type OrderDetail,
  orderDetailSchema,
  orderListSchema,
  type OrderSummary,
  updateCartItemRequestSchema,
} from '@lastsize/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { CustomerSessionService } from '../customer/customer-session.service';
import { RateLimiterService } from '../security/rate-limiter.service';
import { ValidationFailedException, ZodValidationPipe } from '../security/zod-validation.pipe';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import { OrderSecrets } from './order-secrets';
import { OrdersService } from './orders.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const orderNumber = new ParseIntPipe({ errorHttpStatusCode: 404 });
const idempotencyKeySchema = z.uuid();
const CHALLENGE_LIMIT = { name: 'altcha:ip', limit: 30, windowSeconds: 10 * 60 };

/**
 * Guest buyers: cart, checkout and their orders. No account and no SMS; the device cookie
 * (or the order-link token) is the key, and all amounts come from the database.
 */
@Controller()
export class OrdersController {
  constructor(
    private readonly sessions: CustomerSessionService,
    private readonly cart: CartService,
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
    private readonly secrets: OrderSecrets,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Public()
  @Get('cart')
  async getCart(@Req() request: FastifyRequest): Promise<Cart> {
    const customer = await this.sessions.resolve(request);
    return cartSchema.parse((await this.cart.view(customer?.id ?? null)).cart);
  }

  @Public()
  @Get('cart/count')
  async cartCount(@Req() request: FastifyRequest): Promise<{ count: number }> {
    const customer = await this.sessions.resolve(request);
    return { count: await this.cart.count(customer?.id ?? null) };
  }

  @Public()
  @Post('cart/items')
  async addItem(
    @Body(new ZodValidationPipe(addCartItemRequestSchema))
    body: z.output<typeof addCartItemRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Cart> {
    const customer = await this.sessions.getOrCreate(request, reply);
    await this.cart.add(customer.id, body.variantId);
    return cartSchema.parse((await this.cart.view(customer.id)).cart);
  }

  @Public()
  @Patch('cart/items/:variantId')
  async updateItem(
    @Param('variantId', uuid) variantId: string,
    @Body(new ZodValidationPipe(updateCartItemRequestSchema))
    body: z.output<typeof updateCartItemRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Cart> {
    const customer = await this.sessions.getOrCreate(request, reply);
    await this.cart.setQuantity(customer.id, variantId, body.quantity);
    return cartSchema.parse((await this.cart.view(customer.id)).cart);
  }

  @Public()
  @Delete('cart/items/:variantId')
  async removeItem(
    @Param('variantId', uuid) variantId: string,
    @Req() request: FastifyRequest,
  ): Promise<Cart> {
    const customer = await this.sessions.resolve(request);
    if (customer) await this.cart.remove(customer.id, variantId);
    return cartSchema.parse((await this.cart.view(customer?.id ?? null)).cart);
  }

  /** Proof-of-work challenge for the checkout form (ALTCHA, solved in the browser). */
  @Public()
  @Get('orders/challenge')
  async challenge(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    await this.rateLimiter.consume(CHALLENGE_LIMIT, request.ip);
    void reply.header('cache-control', 'no-store');
    return this.secrets.altchaChallenge();
  }

  @Public()
  @Post('orders')
  async place(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(checkoutRequestSchema))
    body: z.output<typeof checkoutRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OrderCreated> {
    if (!idempotencyKeySchema.safeParse(idempotencyKey).success)
      throw new ValidationFailedException([
        { path: 'idempotencyKey', message: 'idempotencyKey.invalid' },
      ]);
    const customer = await this.sessions.getOrCreate(request, reply);
    return orderCreatedSchema.parse(
      await this.checkout.place(customer.id, body, idempotencyKey!, request),
    );
  }

  @Public()
  @Get('orders')
  async list(@Req() request: FastifyRequest): Promise<OrderSummary[]> {
    const customer = await this.sessions.resolve(request);
    return orderListSchema.parse(await this.orders.listForCustomer(customer?.id ?? null));
  }

  @Public()
  @Get('orders/:number')
  async detail(
    @Param('number', orderNumber) number: number,
    @Query(new ZodValidationPipe(orderAccessQuerySchema))
    query: z.output<typeof orderAccessQuerySchema>,
    @Req() request: FastifyRequest,
  ): Promise<OrderDetail> {
    const customer = await this.sessions.resolve(request);
    return orderDetailSchema.parse(
      await this.orders.detail(number, { customerId: customer?.id ?? null, token: query.t }),
    );
  }

  @Public()
  @Post('orders/:number/parts/:partId/cancel')
  @HttpCode(200)
  async cancel(
    @Param('number', orderNumber) number: number,
    @Param('partId', uuid) partId: string,
    @Query(new ZodValidationPipe(orderAccessQuerySchema))
    query: z.output<typeof orderAccessQuerySchema>,
    @Req() request: FastifyRequest,
  ): Promise<OrderDetail> {
    const customer = await this.sessions.resolve(request);
    const access = { customerId: customer?.id ?? null, token: query.t };
    await this.orders.cancelByCustomer(number, partId, access, request);
    return orderDetailSchema.parse(await this.orders.detail(number, access));
  }
}
