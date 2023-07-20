import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { MessageAttributeDataType } from 'aws-cdk-lib/aws-stepfunctions-tasks';

const sns = new SNSClient({});

interface ResultContext {
  documentId: string;
  jobId: string;
}

export async function sendExtractionResult(
  topicArn: string,
  context: ResultContext,
  data: Record<string | number, any>
) {
  return await sendExtractionMessage(
    topicArn,
    context,
    'Extraction Result Ready',
    JSON.stringify({
      ...context,
      ...data,
    })
  );
}

export async function sendExtractionMessage(
  topicArn: string,
  context: ResultContext,
  subject: string,
  message: string
) {
  return await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Message: message,
      Subject: subject,
      MessageAttributes: {
        documentId: {
          DataType: MessageAttributeDataType.STRING,
          StringValue: context.documentId,
        },
        jobId: {
          DataType: MessageAttributeDataType.STRING,
          StringValue: context.jobId,
        },
      },
    })
  );
}
