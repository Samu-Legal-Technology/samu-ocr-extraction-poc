import {
  ComprehendClient,
  StartEntitiesDetectionJobCommandOutput,
  DetectEntitiesCommand,
  StartEntitiesDetectionJobCommand,
} from '@aws-sdk/client-comprehend';
import { generateId } from './utils';

export interface TextComprehendAsyncResult {
  documentId?: string;
  jobId?: string;
  outputS3Uri?: string;
}

const comprehend = new ComprehendClient({});

export class TextComprehend {
  
  async extractEntities(
    texts: { Text: string | null | undefined }[]
  ): Promise<string[]> {
    const entities = new Set<string>();

    console.debug('Extracting entities');
    for (const text of texts) {
      if (!text.Text) continue;

      const command = new DetectEntitiesCommand({
        LanguageCode: 'en',
        Text: text.Text,
      });
      const response = await comprehend.send(command);

      const resolvedEntities =
        response.Entities?.map((b) => b.Type ?? '') ?? [];

      for (const e of resolvedEntities) {
        entities.add(e);
      }
    }

    return Array.from(entities);
  }

  async extractEntitiesAsync(options: {
    srcBucket: string,
    srcKey: string,
    outputBucket: string,
    outputKey: string
  }): Promise<TextComprehendAsyncResult> {
    const command = new StartEntitiesDetectionJobCommand({
      LanguageCode: 'en',
      EntityRecognizerArn: undefined,
      DataAccessRoleArn: process.env.COMPREHEND_ACCESS_ROLE,
      InputDataConfig: {
        S3Uri: `s3://${options.srcBucket}/${options.srcKey}`
      },
      OutputDataConfig: {
        S3Uri: `s3://${options.outputBucket}/${options.outputKey}`
      }
    });
    
    const response = await comprehend.send(command);

    return {
      jobId: response.JobId,
      outputS3Uri: `s3://${options.outputBucket}/${options.outputKey}`
    }
  }
}
