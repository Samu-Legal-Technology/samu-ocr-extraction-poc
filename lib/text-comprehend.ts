import {
  ComprehendClient,
  StartEntitiesDetectionJobCommandOutput,
  DetectEntitiesCommand,
  StartEntitiesDetectionJobCommand,
  DetectSentimentCommand,
  DetectKeyPhrasesCommand,
} from '@aws-sdk/client-comprehend';
import { generateId } from './utils';

export interface TextComprehendAsyncResult {
  documentId?: string;
  jobId?: string;
  outputS3Uri?: string;
}

const comprehend = new ComprehendClient({});

export class TextComprehend {

  async extractSentimentsFromTranscript(transcript: {Sentiment: string | undefined}[]): Promise<string[]> {
    const sentiments = new Set<string>();

    console.debug('Extracting sentiments');
    for (const s of transcript) {
      if (s && s.Sentiment !== undefined)
        sentiments.add(s.Sentiment)
    }

    return Array.from(sentiments);
  }

  async extractSentiments(
    texts: { Text: string | null | undefined }[]
  ): Promise<string[]> {
    const sentiments = new Set<string>();

    console.debug('Extracting sentiments');
    for (const text of texts) {
      if (!text.Text) continue;

      const command = new DetectSentimentCommand({
        LanguageCode: 'en',
        Text: text.Text,
      });
      const response = await comprehend.send(command);

      const sentiment = response.Sentiment

      if(sentiment)
        sentiments.add(sentiment);
    }

    return Array.from(sentiments);
  }

  async extractKeyPhrases(
    texts: { Text: string | null | undefined }[]
  ): Promise<string[]> {
    const phrases = new Set<string>();

    console.debug('Extracting key phrases');
    for (const text of texts) {
      if (!text.Text) continue;

      const command = new DetectKeyPhrasesCommand({
        LanguageCode: 'en',
        Text: text.Text,
      });
      const response = await comprehend.send(command);

      const keyPhareses = response.KeyPhrases

      for (const kp of keyPhareses ?? []) {
        if(kp.Text)
          phrases.add(kp.Text);
      }
    }

    return Array.from(phrases);
  }
  
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
