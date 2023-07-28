import { Handler } from 'aws-lambda';
import {
  ComprehendMedicalAsyncJobProperties,
  ICD10CMAttribute,
  ICD10CMConcept,
  ICD10CMEntity,
} from '@aws-sdk/client-comprehendmedical';
import * as S3Helper from '../aws/s3';
import * as db from '../dynamodb-persistor';
import * as Utils from '../utils';
import * as filters from './filters';

function transformConcept(concept: ICD10CMConcept | undefined) {
  if (concept && concept.Code) {
    return {
      code: concept.Code,
      description: concept.Description,
    };
  }
  return;
}

interface Condition {
  code: string;
  description: string | undefined;
  condition: string;
  attributes: string[];
}

export const handler: Handler = async (event: {
  documentId: string;
  ICD10CM: {
    status: {
      ComprehendMedicalAsyncJobProperties: ComprehendMedicalAsyncJobProperties;
    };
  };
}): Promise<any> => {
  console.log('Event', JSON.stringify(event));
  const outputConfig =
    event.ICD10CM.status.ComprehendMedicalAsyncJobProperties.OutputDataConfig;
  if (outputConfig) {
    const files = await S3Helper.getFilesForPrefix(
      outputConfig.S3Bucket!,
      outputConfig.S3Key!,
      (key: string) => !key.includes('Manifest')
    );
    console.debug('loaded files', files);
    const results = files
      ?.map((file) => {
        const json = JSON.parse(file) as {
          Entities: Required<ICD10CMEntity>[];
        };
        const entities = json.Entities.filter(
          (entity) =>
            entity.Category === 'MEDICAL_CONDITION' &&
            entity.Score > filters.MIN_ENTITY_CONFIDENCE_SCORE
        )
          .map((entity) => {
            const code = transformConcept(
              filters.getConfidentConcepts(entity.ICD10CMConcepts)?.shift()
            );
            if (code) {
              return {
                condition: entity.Text,
                attributes:
                  filters
                    .getConfidentAttributes(entity)
                    ?.map((attribute) => attribute.Text) ?? [],
                ...code,
              };
            }
            return;
          })
          .filter((res) => !!res);
        console.debug('Parsed file: ', entities);
        return entities;
      })
      .flat()
      .filter((condition): condition is Condition => !!condition);
    if (results) {
      await db.update(
        process.env.DOC_INFO_TABLE_NAME,
        event.documentId,
        Utils.toDynamo({
          icd10Conditions: Utils.dedup(results, (condition) => condition.code),
        })
      );
    }
  }
  return event;
};
