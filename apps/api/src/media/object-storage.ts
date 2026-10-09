import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ApiEnv } from '../config/api-env';

/** Where files go. Implemented by S3 today; any S3-compatible service works (SeaweedFS, MinIO, cloud). */
export interface ObjectStorage {
  readonly publicBucket: string;
  readonly privateBucket: string;
  ensureBuckets(): Promise<void>;
  put(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl?: string,
  ): Promise<void>;
  deleteMany(bucket: string, keys: string[]): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export class S3ObjectStorage implements ObjectStorage {
  readonly publicBucket: string;
  readonly privateBucket: string;
  private readonly client: S3Client;

  constructor(
    env: Pick<
      ApiEnv,
      | 'S3_ENDPOINT'
      | 'S3_REGION'
      | 'S3_ACCESS_KEY'
      | 'S3_SECRET_KEY'
      | 'S3_BUCKET_PUBLIC'
      | 'S3_BUCKET_PRIVATE'
    >,
  ) {
    this.publicBucket = env.S3_BUCKET_PUBLIC;
    this.privateBucket = env.S3_BUCKET_PRIVATE;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
  }

  private bucketsReady: Promise<void> | null = null;

  /** Creates the buckets once per process; a failure is retried on the next call. */
  ensureBuckets(): Promise<void> {
    this.bucketsReady ??= this.createBuckets().catch((error: unknown) => {
      this.bucketsReady = null;
      throw error;
    });
    return this.bucketsReady;
  }

  private async createBuckets(): Promise<void> {
    for (const bucket of [this.publicBucket, this.privateBucket]) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        await this.client
          .send(new CreateBucketCommand({ Bucket: bucket }))
          .catch((error: { name?: string }) => {
            // Another instance created it in the meantime.
            if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists')
              throw error;
          });
      }
    }
  }

  async put(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl?: string,
  ): Promise<void> {
    await this.ensureBuckets();
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  async deleteMany(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}
