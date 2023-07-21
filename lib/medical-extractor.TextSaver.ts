import { Handler, SNSEvent } from 'aws-lambda';
import { persist } from './dynamodb-persistor';
import { TextExtractor, TextractRecord } from './text-extractor';

const extractor = new TextExtractor({});

export const handler: Handler = async (event: SNSEvent): Promise<any> => {
  console.log('Event: ', JSON.stringify(event));
  const results = event.Records.map(async (record) => {
    const jobData = JSON.parse(record.Sns.Message) as TextractRecord;
    const docId = jobData.JobTag;
    console.debug('Document ID', docId);

    const text = await extractor.fetchJobOutputFrom({
      jobId: jobData.JobId,
      documentId: docId,
    });

    return await persist(process.env.DOC_INFO_TABLE_NAME, docId, {
      rawText: {
        L: text.map((line) => ({ S: line })),
      },
    });
  });
  return Promise.allSettled(results);
};
