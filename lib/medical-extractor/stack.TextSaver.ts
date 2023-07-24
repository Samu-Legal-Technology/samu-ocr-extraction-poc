import { Handler, SNSEvent } from 'aws-lambda';
import { persist } from '../dynamodb-persistor';
import { TextExtractor, TextractRecord } from '../text-extractor';
import { extractBillingCodes } from '../aws/comprehend-medical';
import { startStateMachine } from '../aws/step-fuctions';
import * as s3 from '../aws/s3';

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

    const [_, saveLocation] = await Promise.all([
      persist(process.env.DOC_INFO_TABLE_NAME, docId, {
        rawText: {
          L: text.map((line) => ({ S: line })),
        },
      }),
      s3.saveText(text.join('\n'), `${docId}/textract/extracted.txt`),
    ]);
    await startStateMachine(docId, {
      location: saveLocation,
    });
  });
  return Promise.all(results);
};
