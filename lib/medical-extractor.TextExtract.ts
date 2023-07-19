import { Handler } from "aws-lambda";
import { TriggerEvent } from './shared';
import { StartDocumentTextDetectionCommand, TextractClient } from '@aws-sdk/client-textract';
import { v4 as uuid } from 'uuid';

const textract = new TextractClient({});

interface TextExtract extends TriggerEvent {

}

interface Result {
  documentId: string;
  detectTextJobId?: string;
}

export const handler: Handler = async (event: TriggerEvent): Promise<Result> => {
  const documentId = uuid();
  console.log('Got Event', event);
  const extractTextJob = await textract.send(new StartDocumentTextDetectionCommand({
    DocumentLocation: {
      S3Object: {
        Bucket: event.bucket,
        Name: event.key,
      },
    },
    ClientRequestToken: documentId,
    NotificationChannel: {
      RoleArn: process.env.NOTIFICATION_ROLE_ARN,
      SNSTopicArn: process.env.NOTIFICATION_TOPIC_ARN,
    },
    JobTag: documentId,
  }))
  return {
    documentId,
    detectTextJobId: extractTextJob.JobId,
  };
}