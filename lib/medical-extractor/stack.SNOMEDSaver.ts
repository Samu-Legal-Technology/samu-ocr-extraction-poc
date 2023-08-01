import { Handler } from 'aws-lambda';
import {
  ComprehendMedicalAsyncJobProperties,
  SNOMEDCTEntity,
  SNOMEDCTAttribute,
  SNOMEDCTConcept,
  SNOMEDCTTrait,
} from '@aws-sdk/client-comprehendmedical';
import * as S3Helper from '../aws/s3';
import * as db from '../dynamodb-persistor';
import * as Utils from '../utils';
import * as filters from './filters';

// Takes a concept and extracts the necessary information
function transformConcept(concept: SNOMEDCTConcept | undefined) {
  if (concept) {
    return {
      code: concept.Code,
      description: concept.Description,
    };
  }
  return;
}

interface Diagnosis {
  code: string;
  name: string;
  description: string | undefined;
  type: string;
  category: string;
  attributes: string[];
  traits: string[];
}

// Load the results from the s3 object
// Map through and filter out API concepts that are not confident enough
// Format them and save it to DynamoDB
export const handler: Handler = async (event: {
  documentId: string;
  SNOMEDCT: {
    status: {
      ComprehendMedicalAsyncJobProperties: ComprehendMedicalAsyncJobProperties;
    };
  };
}): Promise<any> => {
  console.log('Event', JSON.stringify(event));
  const outputConfig =
    event.SNOMEDCT.status.ComprehendMedicalAsyncJobProperties.OutputDataConfig;
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
          Entities: Required<SNOMEDCTEntity>[];
        };
        const entities = json.Entities.filter(
          (entity) => entity.Score > filters.MIN_ENTITY_CONFIDENCE_SCORE
        )
          .map((entity) => {
            const code = transformConcept(
              filters.getConfidentConcepts(entity.SNOMEDCTConcepts)?.shift()
            );
            if (code) {
              return {
                type: entity.Type,
                category: entity.Category,
                name: entity.Text,
                traits:
                  filters
                    .getConfidentTraits(entity)
                    ?.map((trait) => trait.Name) ?? [],
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
      .filter((diagnosis): diagnosis is Diagnosis => !!diagnosis);

    if (results) {
      await db.update(
        process.env.DOC_INFO_TABLE_NAME,
        event.documentId,
        Utils.toDynamo({
          snomedCodes: Utils.dedup(results, (diagnosis) => diagnosis.code),
        })
      );
    }
  }
  return event;
};
