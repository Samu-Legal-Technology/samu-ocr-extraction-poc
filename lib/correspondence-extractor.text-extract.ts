import { Handler } from 'aws-cdk-lib/aws-lambda';
import { TriggerEvent } from './shared';
import { TextExtractor, TextExtractorAsyncResult } from './text-extractor';

export const handler: Handler = async (
  event: TriggerEvent
): Promise<TextExtractorAsyncResult> => {
  console.log('Got Correspondence Event', event);

  const extractor = new TextExtractor({
    roleArn: process.env.NOTIFICATION_ROLE_ARN,
    topicArn: process.env.NOTIFICATION_TOPIC_ARN,
  });
  const extraction = await extractor.asyncExtract(event.bucket, event.key);

  return extraction;
};
