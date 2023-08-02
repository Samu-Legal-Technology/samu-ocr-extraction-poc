import { Handler } from 'aws-lambda';
import { TriggerEvent } from '../shared';
import {
  StartExpenseAnalysisCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import * as crypto from 'crypto';
import { TextExtractor } from '../text-extractor';
import { generateId } from '../utils';
import * as db from '../dynamodb-persistor';

const textract = new TextractClient({});
const extractor = new TextExtractor({
  roleArn: process.env.NOTIFICATION_ROLE_ARN,
  topicArn: process.env.NOTIFICATION_TOPIC_ARN,
});

interface Result {
  documentId: string;
  documentAnalysisJobId: string;
}

function getJobId(
  result: PromiseSettledResult<{ jobId?: string; JobId?: string }>
): string {
  if (result.status === 'fulfilled') {
    return result.value.jobId ?? result.value.JobId ?? 'NoJobId';
  }
  return result.reason;
}

export const handler: Handler = async (
  event: TriggerEvent
): Promise<Result> => {
  console.log('Got Event', event);
  const documentId = generateId(event.key);
  console.debug('Doc Id', documentId);
  const _ = await db.persist(process.env.DOC_INFO_TABLE_NAME, documentId, {
    type: {
      S: 'pleading',
    },
    originalFile: {
      S: event.key,
    },
  });
  const [extractTextJob] = await Promise.allSettled([
    extractor.analyzeDocument(event.bucket, event.key, documentId, [
      { Text: 'Who is the plaintif?', Alias: 'plaintif', Pages: ['1'] },
      { Text: 'Who are the defendents?', Alias: 'defendents', Pages: ['1'] },
      { Text: 'In which state is this filed?', Alias: 'state', Pages: ['1'] },
      { Text: 'In which county is this filed?', Alias: 'county', Pages: ['1'] },
      { Text: 'In which court is this filed?', Alias: 'court', Pages: ['1'] },
      // { Text: 'Give me all the numbered paragraphs?', Alias: 'paragraphs', Pages: ["1"] },
    ]),
  ]);
  return {
    documentId,
    documentAnalysisJobId: getJobId(extractTextJob),
  };
};
