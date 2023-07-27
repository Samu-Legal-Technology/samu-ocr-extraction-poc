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

const MIN_CONCEPT_CONFIDENCE_SCORE = parseFloat(
  process.env.MIN_CONCEPT_CONFIDENCE_SCORE!
);
const MIN_CONDITION_CONFIDENCE_SCORE = parseFloat(
  process.env.MIN_CONDITION_CONFIDENCE_SCORE!
);
const MIN_ATTRIBUTE_CONFIDENCE_SCORE = parseFloat(
  process.env.MIN_ATTRIBUTE_CONFIDENCE_SCORE!
);

function getConfidentConcepts(
  entity: ICD10CMEntity
): ICD10CMConcept[] | undefined {
  return entity.ICD10CMConcepts?.filter(
    (concept) => concept.Score && concept.Score > MIN_CONCEPT_CONFIDENCE_SCORE
  );
}
function getConfidentAttributes(
  entity: ICD10CMEntity
): ICD10CMAttribute[] | undefined {
  return entity.Attributes?.filter(
    (concept) => concept.Score && concept.Score > MIN_ATTRIBUTE_CONFIDENCE_SCORE
  );
}
function transformConcept(concept: ICD10CMConcept | undefined) {
  if (concept) {
    return {
      code: concept.Code,
      description: concept.Description,
    };
  }
  return;
}

export const handler: Handler = async (event: {
  documentId: string;
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
            entity.Score > MIN_CONDITION_CONFIDENCE_SCORE
        )
          .map((entity) => {
            const code = transformConcept(
              getConfidentConcepts(entity)?.shift()
            );
            if (code) {
              return {
                condition: entity.Text,
                attributes:
                  getConfidentAttributes(entity)?.map(
                    (attribute) => attribute.Text
                  ) ?? [],
                ...code,
              };
            }
            return;
          })
          .filter((res) => !!res);
        console.debug('Parsed file: ', entities);
        return entities;
      })
      .flat();
    await db.update(
      process.env.DOC_INFO_TABLE_NAME,
      event.documentId,
      Utils.toDynamo({
        icd10Conditions: Array.from(new Set(results)),
      })
    );
  }
  return event;
};
