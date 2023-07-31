import { Handler } from 'aws-cdk-lib/aws-lambda';
import { TextExtractor, TextractRecord } from './text-extractor';
import * as DynamoDBPersistor from './dynamodb-persistor';
import { SNSEvent } from 'aws-lambda';
import * as s3 from './aws/s3';
import { TextComprehend } from './text-comprehend';

export const handler: Handler = async (event: SNSEvent): Promise<any> => {
  console.log('Got SNS Event', event);
  const results = event.Records.map(async (record) => {
    const jobData = JSON.parse(record.Sns.Message) as TextractRecord;
    const documentId = jobData.JobTag;
    const jobId = jobData.JobId;

    const extractor = new TextExtractor({});
    const extraction = await extractor.fetchJobOutputFrom({ jobId });

    await s3.saveText(extraction.join('\n'), `${documentId}/textract/extracted.txt`)

    const comprehend = new TextComprehend();
    // TODO: explore the async way
    // await comprehend.extractEntitiesAsync({
    //   srcBucket: s3.BUCKET,
    //   srcKey: `${documentId}/textract/extracted.txt`,
    //   outputBucket: s3.BUCKET,
    //   outputKey: `${documentId}/entities`,
    // })

    const entities = await comprehend.extractEntities([
      { Text: extraction.join('\n') }
    ])

    const status = await DynamoDBPersistor.persist(
      process.env.DOC_INFO_TABLE_NAME,
      documentId,
      {
        type: { S: 'correspondence' },
        extraction: {
          L: extraction.map((line) => ({ S: line })),
        },
        entities: {
          L: entities.map((e) => ({ S: e })),
        },
      }
    );

    return status;
  });

  return Promise.allSettled(results);
};
