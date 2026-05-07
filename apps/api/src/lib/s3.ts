import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';

import type { AppConfig } from '../config.js';

export function createS3Client(config: AppConfig): S3Client | null {
  if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    region: config.S3_REGION,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY
    }
  });
}

export async function createSignedUploadUrl(params: {
  client: S3Client | null;
  bucket?: string;
  objectKey: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string | null> {
  const { client, bucket, objectKey, contentType, expiresInSeconds = 900 } = params;
  if (!client || !bucket) return null;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}
