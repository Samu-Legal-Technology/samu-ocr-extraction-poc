import { Handler } from 'aws-cdk-lib/aws-lambda';
import { TriggerEvent } from './shared';
import { TextExtractor, TextExtractorAsyncResult } from './text-extractor';
import * as DynamoDBPersistor from './dynamodb-persistor';
import * as s3 from './aws/s3';
import * as Utils from './utils';
import { TextComprehend } from './text-comprehend';

export const handler: Handler = async (
  event: TriggerEvent
): Promise<{ result: TextExtractorAsyncResult | string; extra?: any }> => {
  console.log('Got Correspondence Event', event);

  const extractor = new TextExtractor({
    roleArn: process.env.NOTIFICATION_ROLE_ARN,
    topicArn: process.env.NOTIFICATION_TOPIC_ARN,
  });

  const comprehend = new TextComprehend()

  if (event.key.endsWith('.eml')) {
    const { documentId, extraction } = await extractor.extractEmail(
      event.bucket,
      event.key
    );

    const entities = await comprehend.extractEntities([
      { Text: extraction.body },
    ]);

    const status = await DynamoDBPersistor.persist(
      process.env.DOC_INFO_TABLE_NAME,
      documentId,
      {
        originalFile: {
          S: event.key,
        },
        type: { S: 'correspondence' },
        subtype: { S: 'email' },
        extraction: {
          M: extraction.toDynamo(),
        },
        entities: {
          L: entities.map((e) => ({ S: e })),
        },
      }
    );

    for (const attachment of extraction.attachmentsWithContent ?? []) {
      await s3.saveText(
        attachment.content,
        `${documentId}/attachments/${attachment.filename}`
      );
    }

    return {
      result: 'Email processed',
      extra: {
        documentId,
        dynanoDbStatus: status,
      },
    };
  }

  if (event.key.endsWith('.json')) {
    console.log('Assuming JSON file is a transcript');
    const { documentId, extraction } = await extractor.extractJSON(
      event.bucket,
      event.key
    );

    const entities = await comprehend.extractEntities(
      extraction.Transcript.reduce(
        (acc: [{ Text: string }], text: { Content: String }) => {
          return [{ Text: `${acc[0].Text}\n${text.Content}` }];
        },
        [{ Text: '' }]
      )
    );

    const transcript = extraction.Transcript.map((t: any) => ({
      M: {
        text: { S: t.Content },
        sentiment: { S: t.Sentiment },
        participant: { S: t.ParticipantId },
      },
    }));

    const status = await DynamoDBPersistor.persist(
      process.env.DOC_INFO_TABLE_NAME,
      documentId,
      {
        originalFile: {
          S: event.key,
        },
        type: { S: 'correspondence' },
        subtype: { S: 'transcript' },
        extraction: {
          L: transcript,
        },
        entities: {
          L: entities.map((e) => ({ S: e })),
        },
      }
    );

    return {
      result: 'Transcript processed',
      extra: {
        documentId,
        dynanoDbStatus: status,
      },
    };
  }

  if (event.key.endsWith('.pdf')) {
    const status = await DynamoDBPersistor.persist(
      process.env.DOC_INFO_TABLE_NAME,
      Utils.generateId(event.key),
      {
        originalFile: {
          S: event.key,
        },
      }
    );

    const extraction = await extractor.asyncExtract(event.bucket, event.key);

    return {
      result: extraction,
      extra: {
        dynanoDbStatus: status,
      },
    };
  }

  return { result: 'Unknown file type' };
};
