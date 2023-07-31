import { Handler } from 'aws-lambda';
import {
  ComprehendMedicalAsyncJobProperties,
  RxNormAttribute,
  RxNormConcept,
  RxNormEntity,
} from '@aws-sdk/client-comprehendmedical';
import * as S3Helper from '../aws/s3';
import * as db from '../dynamodb-persistor';
import * as Utils from '../utils';

const MIN_ENTITY_CONFIDENCE_SCORE = parseFloat(
  process.env.MIN_ENTITY_CONFIDENCE_SCORE!
);
const MIN_CONCEPT_CONFIDENCE_SCORE = parseFloat(
  process.env.MIN_CONCEPT_CONFIDENCE_SCORE!
);
const MIN_ATTRIBUTE_CONFIDENCE_SCORE = parseFloat(
  process.env.MIN_ATTRIBUTE_CONFIDENCE_SCORE!
);

function getConfidentAttributes(
  entity: RxNormEntity
): RxNormAttribute[] | undefined {
  return entity.Attributes?.filter(
    (concept) => concept.Score && concept.Score > MIN_ATTRIBUTE_CONFIDENCE_SCORE
  );
}

function getConfidentConcepts(
  entity: RxNormEntity
): RxNormConcept[] | undefined {
  return entity.RxNormConcepts?.filter(
    (concept) => concept.Score && concept.Score > MIN_CONCEPT_CONFIDENCE_SCORE
  );
}
function transformConcept(concept: RxNormConcept | undefined) {
  if (concept) {
    return {
      code: concept.Code,
      description: concept.Description,
    };
  }
  return;
}

interface Prescription {
  code: string;
  name: string;
  description: string | undefined;
  type: string;
  attributes: string[];
}

export const handler: Handler = async (event: {
  documentId: string;
  RxNorm: {
    status: {
      ComprehendMedicalAsyncJobProperties: ComprehendMedicalAsyncJobProperties;
    };
  };
}): Promise<any> => {
  console.log('Event', JSON.stringify(event));
  const outputConfig =
    event.RxNorm.status.ComprehendMedicalAsyncJobProperties.OutputDataConfig;
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
          Entities: Required<RxNormEntity>[];
        };
        const entities = json.Entities.filter(
          (entity) =>
            entity.Category === 'MEDICATION' &&
            entity.Score > MIN_ENTITY_CONFIDENCE_SCORE
        )
          .map((entity) => {
            const code = transformConcept(
              getConfidentConcepts(entity)?.shift()
            );
            if (code) {
              return {
                type: entity.Type,
                name: entity.Text,
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
      .flat()
      .filter((prescription): prescription is Prescription => !!prescription);

    if (results) {
      await db.update(
        process.env.DOC_INFO_TABLE_NAME,
        event.documentId,
        Utils.toDynamo({
          prescriptions: Utils.dedup(
            results,
            (prescription) => prescription.code
          ),
        })
      );
    }
  }
  return event;
};
