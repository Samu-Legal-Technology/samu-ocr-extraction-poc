import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

const BUCKET = process.env.STORAGE_BUCKET!;

export interface S3Location {
  bucket: string;
  key: string;
}

export async function saveText(
  contents: string,
  key: string
): Promise<S3Location> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: contents,
    })
  );
  return {
    bucket: BUCKET,
    key: key,
  };
}
