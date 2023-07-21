import { Handler } from 'aws-lambda';
import { TriggerEvent } from './shared';
import {
  StartExpenseAnalysisCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import * as crypto from 'crypto';
import { TextExtractor } from './text-extractor';
import { generateId } from './utils';

const textract = new TextractClient({});
const extractor = new TextExtractor({
  roleArn: process.env.NOTIFICATION_ROLE_ARN,
  topicArn: process.env.NOTIFICATION_TOPIC_ARN,
});

interface Result {
  documentId: string;
  detectTextJobId?: string;
  analyseExpenseJobId?: string;
}

export const handler: Handler = async (
  event: TriggerEvent
): Promise<Result> => {
  console.log('Got Event', event);
  const documentId = generateId(event.key);
  console.debug('Doc Id', documentId);
  const docLocation = {
    S3Object: {
      Bucket: event.bucket,
      Name: event.key,
    },
  };
  const extractTextJob = await extractor.asyncExtract(
    event.bucket,
    event.key,
    documentId
  );
  const expenseJob = await textract.send(
    new StartExpenseAnalysisCommand({
      JobTag: documentId,
      DocumentLocation: docLocation,
      NotificationChannel: {
        RoleArn: process.env.NOTIFICATION_ROLE_ARN,
        SNSTopicArn: process.env.NOTIFICATION_TOPIC_ARN,
      },
      ClientRequestToken: documentId,
    })
  );
  return {
    documentId,
    detectTextJobId: extractTextJob.jobId,
    analyseExpenseJobId: expenseJob.JobId,
  };
};
