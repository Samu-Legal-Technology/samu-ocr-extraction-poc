import { Handler } from 'aws-cdk-lib/aws-lambda';
import { TextExtractor, TextractRecord } from '../text-extractor';
import * as DynamoDBPersistor from '../dynamodb-persistor';
import { SNSEvent } from 'aws-lambda';
import * as s3 from '../aws/s3';
import { TextComprehend } from '../text-comprehend';

export const handler: Handler = async (event: SNSEvent): Promise<any> => {
  console.log('Got SNS Event', event);
  const results = event.Records.map(async (record) => {
    const jobData = JSON.parse(record.Sns.Message) as TextractRecord;
    const documentId = jobData.JobTag;
    const jobId = jobData.JobId;

    const extractor = new TextExtractor({});
    const extraction = await extractor.fetchJobOutputFrom({ jobId });

    const text = extraction.join('\n')

    await s3.saveText(text, `${documentId}/textract/extracted.txt`)

    const comprehend = new TextComprehend();
    // TODO: explore the async way
    // await comprehend.extractEntitiesAsync({
    //   srcBucket: s3.BUCKET,
    //   srcKey: `${documentId}/textract/extracted.txt`,
    //   outputBucket: s3.BUCKET,
    //   outputKey: `${documentId}/entities`,
    // })

    const entities = await comprehend.extractEntities([
      { Text: text }
    ])

    const sentiments = await comprehend.extractSentiments([
      { Text: text },
    ]);

    const keyPhrases = await comprehend.extractKeyPhrases([
      { Text: text },
    ]);

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
        sentiments: {
          L: sentiments.map((e) => ({ S: e })),
        },
        keyPhrases: {
          L: keyPhrases.map((kp) => ({ S: kp })),
        },
      }
    );

    return status;
  });

  return Promise.allSettled(results);
};
