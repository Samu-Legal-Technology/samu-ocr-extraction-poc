import { Handler } from 'aws-cdk-lib/aws-lambda';
import { TriggerEvent } from './shared';
import { TextExtractor, TextExtractorAsyncResult } from './text-extractor';
import * as DynamoDBPersistor from './dynamodb-persistor';

export const handler: Handler = async (
  event: TriggerEvent
): Promise<{ result: TextExtractorAsyncResult | string; extra?: any }> => {
  console.log('Got Correspondence Event', event);

  const extractor = new TextExtractor({
    roleArn: process.env.NOTIFICATION_ROLE_ARN,
    topicArn: process.env.NOTIFICATION_TOPIC_ARN,
  });

  if (event.key.endsWith('.eml')) {
    const { documentId, extraction } = await extractor.extractEmail(
      event.bucket,
      event.key
    );
    const status = await DynamoDBPersistor.persist(
      process.env.DOC_INFO_TABLE_NAME,
      documentId,
      {
        type: { S: 'correspondence' },
        subtype: { S: 'email' },
        extraction: {
          M: extraction.toDynamo(),
        },
      }
    );

    return {
      result: 'Email processed',
      extra: {
        dynanoDbStatus: status,
      },
    };
  }

  if (event.key.endsWith('.json')) {
    console.log('Assuming JSON file is a transcript')
    const { documentId, extraction } = await extractor.extractJSON(
      event.bucket,
      event.key
    );

    const transcript = extraction.Transcript.map((t: any) => (
      {
        M: {
          text: { S: t.Content },
          sentiment: { S: t.Sentiment },
          participant: { S: t.ParticipantId },
        }
      }
    ))

    const status = await DynamoDBPersistor.persist(
      process.env.DOC_INFO_TABLE_NAME,
      documentId,
      {
        type: { S: 'correspondence' },
        subtype: { S: 'transcript' },
        extraction: {
          L: transcript,
        },
      }
    );

    return {
      result: 'Transcript processed',
      extra: {
        dynanoDbStatus: status,
      },
    };
  }

  if (event.key.endsWith('.pdf')) {
    const extraction = await extractor.asyncExtract(event.bucket, event.key);

    return { result: extraction };
  }

  return { result: 'Unknown file type' };
};
