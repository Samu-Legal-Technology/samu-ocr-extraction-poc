import { Handler, SNSEvent } from 'aws-lambda';
import {
  Block,
  GetDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommandOutput,
  TextractClient,
} from '@aws-sdk/client-textract';
import {
  DynamoDBClient,
  PutItemCommand,
  ReturnValue,
} from '@aws-sdk/client-dynamodb';

const db = new DynamoDBClient({});
const textract = new TextractClient({});

interface TextractRecord {
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

async function getDocumentText(jobId: string): Promise<string[]> {
  let nextToken = undefined;
  let text: string[] = [];
  do {
    console.debug('Getting Text Result', nextToken);
    const res: GetDocumentTextDetectionCommandOutput = await textract.send(
      new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken,
      })
    );
    nextToken = res.NextToken;

    console.debug('Got', res.Blocks?.length, 'blocks');
    let lines = res.Blocks?.reduce((lines: string[], block: Block) => {
      if (block.BlockType === 'LINE' && block.Text) {
        console.debug(
          'found',
          block.BlockType,
          'blockText',
          block.Text?.split(' ', 3)
        );
        return lines.concat(block.Text);
      }
      return lines;
    }, []);
    if (lines) {
      text = text.concat(lines);
    }
  } while (nextToken);
  return text;
}

export const handler: Handler = async (event: SNSEvent): Promise<any> => {
  console.log('Event: ', JSON.stringify(event));
  const results = event.Records.map(async (record) => {
    const jobData = JSON.parse(record.Sns.Message) as TextractRecord;
    const docId = jobData.JobTag;
    console.debug('Document ID', docId);

    const text = await getDocumentText(jobData.JobId);

    const res = await db.send(
      new PutItemCommand({
        TableName: process.env.DOC_INFO_TABLE_NAME,
        Item: {
          documentId: {
            S: docId,
          },
          rawText: {
            L: text.map((line) => ({ S: line })),
          },
        },
        ReturnValues: ReturnValue.NONE,
      })
    );
    return res.$metadata.httpStatusCode;
  });
  return Promise.allSettled(results);
};
