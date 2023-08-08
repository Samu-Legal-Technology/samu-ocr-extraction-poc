import { Handler } from 'aws-lambda';
import { TriggerEvent } from '../shared';
import { TextExtractor } from '../text-extractor';
import { generateId, getJobId } from '../utils';
import * as db from '../dynamodb-persistor';

const extractor = new TextExtractor({
  roleArn: process.env.NOTIFICATION_ROLE_ARN,
  topicArn: process.env.NOTIFICATION_TOPIC_ARN,
});

interface Result {
  documentId: string;
  expenseJobId?: string;
}

export const handler: Handler = async (
  event: TriggerEvent
): Promise<Result> => {
  console.log('Got Event', event);
  const documentId = generateId(event.key);
  console.debug('Doc Id', documentId);

  const saveInitial = await db.persist(
    process.env.DOC_INFO_TABLE_NAME,
    documentId,
    {
      type: {
        S: 'expense',
      },
      originalFile: {
        S: event.key,
      },
    }
  );
  const [expenseJob] = await Promise.allSettled([
    extractor.asyncExtractExpense(event.bucket, event.key, documentId),
  ]);

  return {
    documentId,
    expenseJobId: getJobId(expenseJob),
  };
};
