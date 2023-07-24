import { Handler } from 'aws-lambda';
import { ComprehendMedicalAsyncJobProperties } from '@aws-sdk/client-comprehendmedical';
import { S3Client } from '@aws-sdk/client-s3';

export const handler: Handler = (event: {
  icd10: {
    status: ComprehendMedicalAsyncJobProperties;
  };
}): any => {
  console.log('Event', JSON.stringify(event));
  return event;
};
