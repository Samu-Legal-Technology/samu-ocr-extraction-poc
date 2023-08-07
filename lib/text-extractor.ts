import * as Utils from './utils';
import {
  Block,
  DetectDocumentTextCommand,
  FeatureType,
  GetDocumentAnalysisCommand,
  GetDocumentAnalysisCommandOutput,
  GetDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommandOutput,
  Query,
  StartDocumentAnalysisCommand,
  StartDocumentTextDetectionCommand,
  StartExpenseAnalysisCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import * as S3Helper from './aws/s3';
import {
  AddressObject,
  Attachment,
  ParsedMail,
  simpleParser,
} from 'mailparser';
import { AttributeValue } from '@aws-sdk/client-dynamodb';

const textract = new TextractClient({});

export interface TextExtractorAsyncResult {
  documentId?: string;
  jobId?: string;
}

export interface TextExtractorSyncResult {
  documentId: string;
  extraction: string[];
}
export class TextExtractorEmailResult {
  messageId?: string | null;
  date?: string | null;
  from: string[] | null;
  to: string[] | null;
  cc: string[] | null;
  bcc: string[] | null;
  subject?: string | null;
  body?: string | null;
  references?: string[] | null;
  attachments?: string[] | null;

  attachmentsWithContent?: { filename: string; content: string }[] | null;

  constructor(parsed: ParsedMail) {
    this.messageId = parsed.messageId || null;
    this.date = parsed?.date?.toUTCString() || null;

    this.from = Array.isArray(parsed.from)
      ? parsed.from?.map((recipient: AddressObject) => recipient.text) || null
      : parsed.from
      ? [parsed.from.text]
      : null;

    this.to = Array.isArray(parsed.to)
      ? parsed.to?.map((recipient: AddressObject) => recipient.text) || null
      : parsed.to
      ? [parsed.to.text]
      : null;

    this.cc = Array.isArray(parsed.cc)
      ? parsed.cc?.map((recipient: AddressObject) => recipient.text) || null
      : parsed.cc
      ? [parsed.cc.text]
      : null;

    this.bcc = Array.isArray(parsed.bcc)
      ? parsed.bcc?.map((recipient: AddressObject) => recipient.text) || null
      : parsed.bcc
      ? [parsed.bcc.text]
      : null;

    this.references = Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references
      ? [parsed.references]
      : null;

    this.attachments =
      parsed.attachments?.map((a: Attachment) => {
        return a.filename!;
      }) || null;

    this.attachmentsWithContent =
      parsed.attachments?.map((a: Attachment) => {
        return {
          filename: a.filename!,
          content: a.content.toString(),
        };
      }) || null;

    this.subject = parsed.subject || null;
    this.body = parsed.text || null;
  }

  toDynamo(): Record<string, AttributeValue> {
    return Utils.toDynamo({
      messageId: this.messageId,
      date: this.date,
      from: this.from,
      to: this.to,
      cc: this.cc,
      bcc: this.bcc,
      subject: this.subject,
      body: this.body,
      references: this.references,
      attachments: this.attachments,
    });
  }
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

  async extractJSON(bucket: string, key: string) {
    const fileString = await S3Helper.readFileAsString(bucket, key);
    const json = JSON.parse(fileString);
    const documentId = Utils.generateId(key);
    return {
      documentId,
      extraction: json,
    };
  }

  async extractEmail(bucket: string, key: string) {
    const fileString = await S3Helper.readFileAsString(bucket, key);
    const parsed: ParsedMail = await simpleParser(fileString);
    const documentId = Utils.generateId(key);
    return {
      documentId,
      extraction: new TextExtractorEmailResult(parsed),
    };
  }

  // Only for .jpg or .png files (for .pdf use async)
  async syncExtract(
    bucket: string,
    key: string
  ): Promise<TextExtractorSyncResult> {
    const documentId = Utils.generateId(key);
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

  async analyzeDocument(
    bucket: string,
    key: string,
    documentId?: string,
    queries?: Query[]
  ): Promise<TextExtractorAsyncResult> {
    if (!this.notify.roleArn) throw Error('Missing notify roleArn');
    if (!this.notify.topicArn) throw Error('Missing notify topicArn');

    const id = documentId ?? Utils.generateId(key);

    const features: FeatureType[] = [];
    if (queries) {
      features.push(FeatureType.QUERIES);
    }
    const documentAnalysisJob = await textract.send(
      new StartDocumentAnalysisCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: bucket,
            Name: key,
          },
        },
        NotificationChannel: {
          RoleArn: this.notify.roleArn,
          SNSTopicArn: this.notify.topicArn,
        },
        FeatureTypes: features,
        QueriesConfig: {
          Queries: queries,
        },
        JobTag: id,
      })
    );
    return {
      documentId: id,
      jobId: documentAnalysisJob.JobId,
    };
  }

  async asyncExtract(
    bucket: string,
    key: string,
    documentId?: string
  ): Promise<TextExtractorAsyncResult> {
    if (!this.notify.roleArn) throw Error('Missing notify roleArn');

    if (!this.notify.topicArn) throw Error('Missing notify topicArn');

    const id = documentId ?? Utils.generateId(key);

    const extractTextJob = await textract.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: bucket,
            Name: key,
          },
        },
        // ClientRequestToken: id,
        NotificationChannel: {
          RoleArn: this.notify.roleArn,
          SNSTopicArn: this.notify.topicArn,
        },
        JobTag: id,
      })
    );
    return {
      documentId: id,
      jobId: extractTextJob.JobId,
    };
  }

  async asyncExtractExpense(
    bucket: string,
    key: string,
    documentId?: string
  ): Promise<TextExtractorAsyncResult> {
    const id = documentId ?? Utils.generateId(key);

    const extractExpensesJob = await textract.send(
      new StartExpenseAnalysisCommand({
        JobTag: documentId,
        DocumentLocation: {
          S3Object: {
            Bucket: bucket,
            Name: key,
          },
        },
        NotificationChannel: {
          RoleArn: this.notify.roleArn,
          SNSTopicArn: this.notify.topicArn,
        },
      })
    );

    return {
      documentId: id,
      jobId: extractExpensesJob.JobId,
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
  async fetchJobOutputPages(
    result: TextExtractorAsyncResult
  ): Promise<string[]> {
    if (!result.jobId) {
      throw new Error('missing job id');
    }

    let nextToken = undefined;
    let pages: string[] = [];
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
      extraction.Blocks?.filter(
        (block) => block.BlockType === 'LINE' && block.Text
      )?.forEach((block) => {
        if (block.Page) {
          const currentPage = pages[block.Page] || '';
          pages[block.Page] = currentPage + ` \n ` + block.Text;
        }
      });
    } while (nextToken);

    return pages;
  }

  async fetchAnalysisJobOutputFrom(
    result: TextExtractorAsyncResult
  ): Promise<string[]> {
    if (!result.jobId) {
      throw new Error('missing job id');
    }

    let nextToken = undefined;
    let text: string[] = [];
    do {
      console.debug('Getting Text Result', nextToken);
      const extraction: GetDocumentAnalysisCommandOutput = await textract.send(
        new GetDocumentAnalysisCommand({
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
  async fetchAnalysisJobOutput(
    result: TextExtractorAsyncResult
  ): Promise<Block[]> {
    if (!result.jobId) {
      throw new Error('missing job id');
    }

    let nextToken = undefined;
    let blocks: Block[] = [];
    do {
      console.debug('Getting Text Result', nextToken);
      const extraction: GetDocumentAnalysisCommandOutput = await textract.send(
        new GetDocumentAnalysisCommand({
          JobId: result.jobId,
          NextToken: nextToken,
        })
      );
      nextToken = extraction.NextToken;

      console.debug('Got', extraction.Blocks?.length, 'blocks');
      blocks = blocks.concat(...(extraction.Blocks ?? []));
    } while (nextToken);

    return blocks;
  }
}
