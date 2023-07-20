import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

const s3 = new S3Client({});

export const readFileAsString = async (
  bucketName: string,
  key: string
): Promise<string> => {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  );

  const str = (await response?.Body?.transformToString()) || '';
  return str;
};
