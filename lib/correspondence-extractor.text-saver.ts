import { Handler } from 'aws-cdk-lib/aws-lambda';
import { TextExtractor, TextractRecord } from './text-extractor';
import { DynamoDBPersistor } from './dynamodb-persistor';
import { SNSEvent } from 'aws-lambda';

export const handler: Handler = async (event: SNSEvent): Promise<any> => {
  console.log('Got SNS Event', event);
  const results = event.Records.map(async (record) => {
    const jobData = JSON.parse(record.Sns.Message) as TextractRecord;
    const documentId = jobData.JobTag;
    const jobId = jobData.JobId;

    const extractor = new TextExtractor({});
    const extraction = await extractor.fetchJobOutputFrom({ jobId });

    const persistor = new DynamoDBPersistor();
    const status = await persistor.persist(
      process.env.DOC_INFO_TABLE_NAME,
      documentId,
      {
        type: { S: 'correspondence' },
        rawText: {
          L: extraction.map((line) => ({ S: line })),
        },
      }
    );
    return status;
  });

  return Promise.allSettled(results);
};
