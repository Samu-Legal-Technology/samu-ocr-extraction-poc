import { Handler } from 'aws-lambda';
import { TriggerEvent } from './shared';
import {
  StartDocumentTextDetectionCommand,
  StartExpenseAnalysisCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import * as crypto from 'crypto';

const textract = new TextractClient({});

interface TextExtract extends TriggerEvent {}

interface Result {
  documentId: string;
  detectTextJobId?: string;
  analyseExpenseJobId?: string;
}

function getDocumentId(key: string): string {
  // return uuid();
  const hash = crypto.createHash('sha256');
  hash.update(key);
  return hash.digest('hex');
}

export const handler: Handler = async (
  event: TriggerEvent
): Promise<Result> => {
  console.log('Got Event', event);
  const documentId = getDocumentId(event.key);
  console.debug('Doc Id', documentId);
  const docLocation = {
    S3Object: {
      Bucket: event.bucket,
      Name: event.key,
    },
  };
  const extractTextJob = await textract.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: docLocation,
      ClientRequestToken: documentId,
      NotificationChannel: {
        RoleArn: process.env.NOTIFICATION_ROLE_ARN,
        SNSTopicArn: process.env.NOTIFICATION_TOPIC_ARN,
      },
      JobTag: documentId,
    })
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
    detectTextJobId: extractTextJob.JobId,
    analyseExpenseJobId: expenseJob.JobId,
  };
};
