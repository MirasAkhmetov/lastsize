import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  loginRequestSchema,
  type MeResponse,
  meResponseSchema,
  type MfaSetupResponse,
  mfaSetupResponseSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  totpCodeRequestSchema,
} from '@lastsize/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import { CurrentAuth, Public } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema))
    body: z.output<typeof registerRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    return meResponseSchema.parse(await this.auth.register(body, request, reply));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: z.output<typeof loginRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    return meResponseSchema.parse(await this.auth.login(body, request, reply));
  }

  /** Sets a new password from the one-time link the Telegram bot sends. */
  @Public()
  @Post('password-reset')
  @HttpCode(204)
  async resetPassword(
    @Body(new ZodValidationPipe(passwordResetRequestSchema))
    body: z.output<typeof passwordResetRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.auth.resetPassword(body.token, body.password, request);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(auth, request, reply);
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext): MeResponse {
    return meResponseSchema.parse(this.auth.me(auth));
  }

  @Post('mfa/setup')
  @HttpCode(200)
  async setupMfa(@CurrentAuth() auth: AuthContext): Promise<MfaSetupResponse> {
    return mfaSetupResponseSchema.parse(await this.auth.startMfaSetup(auth));
  }

  @Post('mfa/activate')
  @HttpCode(200)
  async activateMfa(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(totpCodeRequestSchema))
    body: z.output<typeof totpCodeRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<MeResponse> {
    return meResponseSchema.parse(await this.auth.activateMfa(auth, body.code, request));
  }

  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(totpCodeRequestSchema))
    body: z.output<typeof totpCodeRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<MeResponse> {
    return meResponseSchema.parse(await this.auth.verifyMfa(auth, body.code, request));
  }
}
