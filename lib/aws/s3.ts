import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({});

const BUCKET = process.env.STORAGE_BUCKET!;

export interface S3Location {
  bucket: string;
  key: string;
  prefix: string;
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
  const parts = key.split('/');
  parts.pop();
  return {
    bucket: BUCKET,
    key: key,
    prefix: parts.join('/'),
  };
}

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

export async function getFilesForPrefix(
  bucketName: string,
  prefix: string,
  keyFilter?: (key: string) => boolean
): Promise<string[] | undefined> {
  const res = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
    })
  );
  console.debug('Listed objects', res);
  return Promise.all(
    (res.Contents ?? [])
      .filter((obj) => (keyFilter && obj.Key ? keyFilter(obj.Key) : true))
      .map(async (object) => await readFileAsString(bucketName, object.Key!))
  );
}
