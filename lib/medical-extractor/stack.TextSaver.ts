import { Handler, SNSEvent } from 'aws-lambda';
import * as db from '../dynamodb-persistor';
import { TextExtractor, TextractRecord } from '../text-extractor';
import { extractBillingCodes } from '../aws/comprehend-medical';
import { startStateMachine } from '../aws/step-fuctions';
import * as s3 from '../aws/s3';

const extractor = new TextExtractor({});

const INFER_JOB_MAX_INPUT_SIZE = 10000;

const textToPages = (text: string[]): string[] => {
  return text.reduce((pages: string[], line: string) => {
    const page = pages.pop();
    if (!page) return [line];
    if (page.length + line.length > INFER_JOB_MAX_INPUT_SIZE) {
      return pages.concat(page, line);
    }
    return pages.concat(page + line);
  }, []);
};

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
    const pages = await extractor.fetchJobOutputPages({
      jobId: jobData.JobId,
      documentId: docId,
    });
    console.debug(`found ${pages.length} pages`, pages);

    const [persistResult, ...saveLocations] = await Promise.allSettled([
      db.update(process.env.DOC_INFO_TABLE_NAME, docId, {
        rawText: {
          L: text.map((line) => ({ S: line })),
        },
      }),
      ...pages.map((page, i) =>
        s3.saveText(page, `${docId}/textract/extracted${i}.txt`)
      ),
    ]);
    console.debug('Finished persiting', persistResult, saveLocations);
    if (
      saveLocations.some((saveLocation) => saveLocation.status != 'fulfilled')
    ) {
      throw Error('Failed to save text output to intermediate bucket');
    }
    await startStateMachine(docId, {
      location: (saveLocations[0] as PromiseFulfilledResult<s3.S3Location>)
        .value,
    });
  });
  return Promise.all(results);
};
