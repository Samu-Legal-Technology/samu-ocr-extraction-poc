import { Handler } from 'aws-lambda';
import {
  ComprehendMedicalAsyncJobProperties,
  ICD10CMEntity,
} from '@aws-sdk/client-comprehendmedical';
import * as S3Helper from '../aws/s3';

export const handler: Handler = async (event: {
  icd10Job: {
    status: {
      ComprehendMedicalAsyncJobProperties: ComprehendMedicalAsyncJobProperties;
    };
  };
}): Promise<any> => {
  console.log('Event', JSON.stringify(event));
  const outputConfig =
    event.icd10Job.status.ComprehendMedicalAsyncJobProperties.OutputDataConfig;
  if (outputConfig) {
    const files = await S3Helper.getFilesForPrefix(
      outputConfig.S3Bucket!,
      outputConfig.S3Key!
    );
    files?.map((file) => {
      const json = JSON.parse(file) as { Entities: ICD10CMEntity[] };
      console.debug('Parsed file: ', json);
    });
  }
  return event;
};
