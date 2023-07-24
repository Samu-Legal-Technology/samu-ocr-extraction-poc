import {
  ComprehendMedicalClient,
  StartICD10CMInferenceJobCommand,
  LanguageCode,
} from '@aws-sdk/client-comprehendmedical';
import { S3Location } from './s3';

const comprehend = new ComprehendMedicalClient({});

const DEFAULT_LANGUAGE = LanguageCode.EN;

const DATA_ACCESS_ROLE_ARN = process.env.COMPREHEND_DATA_ACCESS_ROLE_ARN;

export async function extractBillingCodes(
  source: S3Location,
  documentId: string
) {
  return await comprehend.send(
    new StartICD10CMInferenceJobCommand({
      InputDataConfig: {
        S3Bucket: source.bucket,
        S3Key: source.key,
      },
      OutputDataConfig: {
        S3Bucket: source.bucket,
        S3Key: `${documentId}/comprehendmedical/icd10`,
      },
      DataAccessRoleArn: DATA_ACCESS_ROLE_ARN,
      JobName: `ICD10-${documentId}`,
      LanguageCode: DEFAULT_LANGUAGE,
    })
  );
}
