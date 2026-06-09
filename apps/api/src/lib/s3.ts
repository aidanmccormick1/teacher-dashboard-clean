import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';

import type { AppConfig } from '../config.js';

export function createS3Client(config: AppConfig): S3Client | null {
  if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) return null;

  const clientConfig: S3ClientConfig = {
    region: config.S3_REGION,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY
    }
  };

  if (config.S3_ENDPOINT) {
    clientConfig.endpoint = config.S3_ENDPOINT;
  }

  if (config.S3_FORCE_PATH_STYLE) {
    clientConfig.forcePathStyle = true;
  }

  return new S3Client(clientConfig);
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
