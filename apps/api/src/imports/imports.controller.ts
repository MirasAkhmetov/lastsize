import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  connectWildberriesRequestSchema,
  createImportRequestSchema,
  type ImportJob,
  type ImportJobList,
  importJobListSchema,
  importJobSchema,
  importMappingRequestSchema,
  importPriceRequestSchema,
  importPublishRequestSchema,
  type ImportPublishResult,
  importPublishResultSchema,
  type ImportRow,
  importRowPageSchema,
  type ImportRowPage,
  importRowQuerySchema,
  importRowSchema,
  importSelectionRequestSchema,
  type Integration,
  integrationListSchema,
  integrationProviderSchema,
  updateImportRowRequestSchema,
  genderSchema,
} from '@lastsize/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, RequireStoreAccess } from '../auth/decorators';
import { RateLimiterService } from '../security/rate-limiter.service';
import { ValidationFailedException, ZodValidationPipe } from '../security/zod-validation.pipe';
import { MAX_FILE_BYTES } from './import-file';
import { ImportsService } from './imports.service';
import { IntegrationsService } from './integrations.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const CONNECT_LIMIT = { name: 'integration:connect', limit: 10, windowSeconds: 60 * 60 };
const IMPORT_LIMIT = { name: 'import:create', limit: 20, windowSeconds: 60 * 60 };
const PUBLISH_LIMIT = { name: 'import:publish', limit: 1500, windowSeconds: 60 * 60 };

const fillRequestSchema = z
  .strictObject({
    gender: genderSchema,
    categoryId: z.number().int().positive(),
    colorId: z.number().int().positive(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'fill.empty' });

/**
 * Marketplace connections and the import wizard. Only the store owner may connect a
 * marketplace or import (`integration:manage`); every query is scoped by the verified store id.
 */
@Controller('seller/stores/:storeId')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly integrations: IntegrationsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Get('integrations')
  @RequireStoreAccess('integration:manage')
  async listIntegrations(@Param('storeId') storeId: string): Promise<Integration[]> {
    return integrationListSchema.parse(await this.integrations.list(storeId));
  }

  @Post('integrations/wildberries')
  @HttpCode(200)
  @RequireStoreAccess('integration:manage')
  async connectWildberries(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(connectWildberriesRequestSchema))
    body: z.output<typeof connectWildberriesRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<Integration[]> {
    await this.rateLimiter.consume(CONNECT_LIMIT, storeId);
    await this.integrations.connectWildberries(storeId, body.token, {
      userId: auth.user.id,
      request,
    });
    return integrationListSchema.parse(await this.integrations.list(storeId));
  }

  @Delete('integrations/:provider')
  @HttpCode(204)
  @RequireStoreAccess('integration:manage')
  async disconnect(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Param('provider', new ZodValidationPipe(integrationProviderSchema))
    provider: z.output<typeof integrationProviderSchema>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.integrations.disconnect(storeId, provider, { userId: auth.user.id, request });
  }

  @Get('imports')
  @RequireStoreAccess('integration:manage')
  async list(@Param('storeId') storeId: string): Promise<ImportJobList> {
    return importJobListSchema.parse(await this.imports.listJobs(storeId));
  }

  @Post('imports')
  @RequireStoreAccess('integration:manage')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(createImportRequestSchema))
    body: z.output<typeof createImportRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<ImportJob> {
    await this.rateLimiter.consume(IMPORT_LIMIT, storeId);
    const actor = { userId: auth.user.id, request };
    const jobId =
      body.source === 'WILDBERRIES'
        ? await this.imports.createFromWildberries(storeId, actor)
        : await this.imports.createFromKaspi(storeId, body.url, actor);
    return importJobSchema.parse(await this.imports.job(storeId, jobId));
  }

  /** Excel (.xlsx), CSV or a Kaspi XML file in field "file". */
  @Post('imports/file')
  @RequireStoreAccess('integration:manage')
  async createFromFile(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Req() request: FastifyRequest,
  ): Promise<ImportJob> {
    await this.rateLimiter.consume(IMPORT_LIMIT, storeId);
    if (!request.isMultipart())
      throw new ValidationFailedException([{ path: 'file', message: 'file.required' }]);
    const part = await request.file({ limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
    if (!part || part.fieldname !== 'file')
      throw new ValidationFailedException([{ path: 'file', message: 'file.required' }]);
    const tooLarge = () => new HttpException('Файл больше 5 МБ', HttpStatus.PAYLOAD_TOO_LARGE);
    const buffer = await part.toBuffer().catch(() => {
      throw tooLarge();
    });
    if (part.file.truncated) throw tooLarge();
    const jobId = await this.imports.createFromFile(storeId, buffer, {
      userId: auth.user.id,
      request,
    });
    return importJobSchema.parse(await this.imports.job(storeId, jobId));
  }

  @Get('imports/:jobId')
  @RequireStoreAccess('integration:manage')
  async job(
    @Param('storeId') storeId: string,
    @Param('jobId', uuid) jobId: string,
  ): Promise<ImportJob> {
    return importJobSchema.parse(await this.imports.job(storeId, jobId));
  }

  @Get('imports/:jobId/rows')
  @RequireStoreAccess('integration:manage')
  async rows(
    @Param('storeId') storeId: string,
    @Param('jobId', uuid) jobId: string,
    @Query(new ZodValidationPipe(importRowQuerySchema))
    query: z.output<typeof importRowQuerySchema>,
  ): Promise<ImportRowPage> {
    return importRowPageSchema.parse(
      await this.imports.rows(storeId, jobId, query.filter, query.limit, query.offset),
    );
  }

  @Patch('imports/:jobId/rows/:rowId')
  @RequireStoreAccess('integration:manage')
  async updateRow(
    @Param('storeId') storeId: string,
    @Param('jobId', uuid) jobId: string,
    @Param('rowId', uuid) rowId: string,
    @Body(new ZodValidationPipe(updateImportRowRequestSchema))
    body: z.output<typeof updateImportRowRequestSchema>,
  ): Promise<ImportRow> {
    return importRowSchema.parse(await this.imports.updateRow(storeId, jobId, rowId, body));
  }

  @Post('imports/:jobId/mappings')
  @RequireStoreAccess('integration:manage')
  async remember(
    @Param('storeId') storeId: string,
    @Param('jobId', uuid) jobId: string,
    @Body(new ZodValidationPipe(importMappingRequestSchema))
    body: z.output<typeof importMappingRequestSchema>,
  ): Promise<ImportJob> {
    await this.imports.remember(storeId, jobId, body);
    return importJobSchema.parse(await this.imports.job(storeId, jobId));
  }

  @Post('imports/:jobId/fill')
  @RequireStoreAccess('integration:manage')
  async fill(
    @Param('storeId') storeId: string,
    @Param('jobId', uuid) jobId: string,
    @Body(new ZodValidationPipe(fillRequestSchema)) body: z.output<typeof fillRequestSchema>,
  ): Promise<ImportJob> {
    await this.imports.fill(storeId, jobId, body);
    return importJobSchema.parse(await this.imports.job(storeId, jobId));
  }

  @Post('imports/:jobId/prices')
  @RequireStoreAccess('integration:manage')
  async prices(
    @Param('storeId') storeId: string,
    @Param('jobId', uuid) jobId: string,
    @Body(new ZodValidationPipe(importPriceRequestSchema))
    body: z.output<typeof importPriceRequestSchema>,
  ): Promise<ImportJob> {
    await this.imports.setPrices(storeId, jobId, body.percent);
    return importJobSchema.parse(await this.imports.job(storeId, jobId));
  }

  @Post('imports/:jobId/selection')
  @RequireStoreAccess('integration:manage')
  async selection(
    @Param('storeId') storeId: string,
    @Param('jobId', uuid) jobId: string,
    @Body(new ZodValidationPipe(importSelectionRequestSchema))
    body: z.output<typeof importSelectionRequestSchema>,
  ): Promise<ImportJob> {
    await this.imports.select(storeId, jobId, body.selected);
    return importJobSchema.parse(await this.imports.job(storeId, jobId));
  }

  @Post('imports/:jobId/publish')
  @HttpCode(200)
  @RequireStoreAccess('integration:manage')
  async publish(
    @CurrentAuth() auth: AuthContext,
    @Param('storeId') storeId: string,
    @Param('jobId', uuid) jobId: string,
    @Body(new ZodValidationPipe(importPublishRequestSchema))
    body: z.output<typeof importPublishRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<ImportPublishResult> {
    await this.rateLimiter.consume(PUBLISH_LIMIT, storeId);
    return importPublishResultSchema.parse(
      await this.imports.publish(storeId, jobId, body.mode, { userId: auth.user.id, request }),
    );
  }
}
