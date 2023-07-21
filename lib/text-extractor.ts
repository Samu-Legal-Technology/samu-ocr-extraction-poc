import {
  DetectDocumentTextCommand,
  GetDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommandOutput,
  StartDocumentTextDetectionCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import { generateId } from './utils';

const textract = new TextractClient({});

export interface TextExtractorAsyncResult {
  documentId?: string;
  jobId?: string;
}

export interface TextExtractorSyncResult {
  documentId: string;
  extraction: string[];
}

export interface TextractRecord {
  JobId: string;
  Status: string;
  API: string;
  JobTag: string;
  Timestamp: number;
  DocumentLocation: {
    S3ObjectName: string;
    S3Bucket: string;
  };
}

export class TextExtractor {
  notify: { topicArn?: string; roleArn?: string };

  constructor(notify: { topicArn?: string; roleArn?: string }) {
    this.notify = notify;
  }

  // Only for .jpg or .png files (for .pdf use async)
  async syncExtract(
    bucket: string,
    key: string
  ): Promise<TextExtractorSyncResult> {
    const documentId = generateId(key);
    const extraction = await textract.send(
      new DetectDocumentTextCommand({
        Document: {
          S3Object: {
            Bucket: bucket,
            Name: key,
          },
        },
      })
    );

    const extractedLines =
      extraction.Blocks?.filter(
        (block) => block.BlockType === 'LINE' && block.Text
      )?.map((block) => block.Text!) || [];

    return {
      documentId,
      extraction: extractedLines,
    };
  }

  async asyncExtract(
    bucket: string,
    key: string,
    documentId?: string
  ): Promise<TextExtractorAsyncResult> {
    if (!this.notify.roleArn) throw Error('Missing notify roleArn');

    if (!this.notify.topicArn) throw Error('Missing notify topicArn');

    const id = documentId ?? generateId(key);

    const extractTextJob = await textract.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: bucket,
            Name: key,
          },
        },
        ClientRequestToken: id,
        NotificationChannel: {
          RoleArn: this.notify.roleArn,
          SNSTopicArn: this.notify.topicArn,
        },
        JobTag: id,
      })
    );
    return {
      documentId,
      jobId: extractTextJob.JobId,
    };
  }

  async fetchJobOutputFrom(
    result: TextExtractorAsyncResult
  ): Promise<string[]> {
    if (!result.jobId) {
      throw new Error('missing job id');
    }

    let nextToken = undefined;
    let text: string[] = [];
    do {
      console.debug('Getting Text Result', nextToken);
      const extraction: GetDocumentTextDetectionCommandOutput =
        await textract.send(
          new GetDocumentTextDetectionCommand({
            JobId: result.jobId,
            NextToken: nextToken,
          })
        );
      nextToken = extraction.NextToken;

      console.debug('Got', extraction.Blocks?.length, 'blocks');
      const lines =
        extraction.Blocks?.filter(
          (block) => block.BlockType === 'LINE' && block.Text
        )?.map((block) => block.Text!) || [];

      text = text.concat(...lines);
    } while (nextToken);

    return text;
  }
}
