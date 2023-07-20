import { Handler, SNSEvent } from 'aws-lambda';
import {
  LineItemFields,
  ExpenseDocument,
  GetExpenseAnalysisCommand,
  GetExpenseAnalysisCommandOutput,
  TextractClient,
} from '@aws-sdk/client-textract';
import { sanitizeExpenseValue } from './utils';
import { persist } from './dynamodb-persistor';
import { sendExtractionMessage } from './reporter';
import { TextractRecord } from './text-extractor';

const textract = new TextractClient({});

interface ExpenseData {
  total: number;
  expenses: number[];
}

function parseDocumentTotal(rawTotal: string | undefined): number | undefined {
  if (rawTotal) {
    const parsed = parseFloat(sanitizeExpenseValue(rawTotal));
    console.debug('Parsed Total', parsed);
    if (!isNaN(parsed)) {
      return parsed;
    }
    return undefined;
  }
  return undefined;
}

function getDocumentTotal(document: ExpenseDocument): number | undefined {
  const docTotal = document.SummaryFields?.find(
    (field) => field.Type?.Text === 'TOTAL'
  )?.ValueDetection?.Text;
  console.debug('Unparsed total', docTotal);
  return parseDocumentTotal(docTotal);
}

function getIndividualExpenses(
  document: ExpenseDocument
): number[] | undefined {
  return document.LineItemGroups?.map(
    (group) =>
      group.LineItems?.map(
        (lineItem: LineItemFields) =>
          lineItem.LineItemExpenseFields?.find(
            (field) => field.Type?.Text === 'PRICE'
          )?.ValueDetection?.Text
      )
  )
    .flat()
    .map((val) => parseFloat(sanitizeExpenseValue(val!)));
}

async function getExpenseAnalysis(jobId: string) {
  let data: ExpenseData = {
    expenses: [],
    total: 0.0,
  };
  let nextToken: string | undefined = undefined;
  do {
    const expenseResult: GetExpenseAnalysisCommandOutput = await textract.send(
      new GetExpenseAnalysisCommand({
        JobId: jobId,
        NextToken: nextToken,
      })
    );
    nextToken = expenseResult.NextToken;
    const newData = expenseResult.ExpenseDocuments?.reduce(
      ({ expenses, total }, doc) => {
        const docTotal = getDocumentTotal(doc);
        console.debug('Doc total', docTotal);
        const lineItemExpenses = getIndividualExpenses(doc);
        console.debug('Doc expenses', lineItemExpenses);
        return {
          total: total + (docTotal ?? 0),
          expenses: expenses.concat(lineItemExpenses ?? []),
        };
      },
      data
    );
    data = newData ?? data;
  } while (nextToken);

  return data;
}

async function getDocumentExpenses(jobId: string): Promise<ExpenseData> {
  return getExpenseAnalysis(jobId);
}

async function saveExpenseData(
  docId: string,
  { total, expenses }: ExpenseData
): Promise<number | undefined> {
  return await persist(process.env.DOC_INFO_TABLE_NAME, docId, {
    type: {
      S: 'medical',
    },
    totalExpenses: {
      N: total.toFixed(2),
    },
    expenses: {
      L: expenses.map((expense) => ({ N: expense.toFixed(2) })),
    },
  });
}

export const handler: Handler = async (event: SNSEvent): Promise<any> => {
  console.log('Event: ', JSON.stringify(event));
  const results = event.Records.map(async (record) => {
    const jobData = JSON.parse(record.Sns.Message) as TextractRecord;
    const docId = jobData.JobTag;
    console.debug('Document ID', docId);

    const data = await getDocumentExpenses(jobData.JobId);
    console.debug('Total', data.total);
    console.debug('Expenses', data.expenses);

    await saveExpenseData(docId, data);
    await sendExtractionMessage(
      process.env.RESULT_TOPIC_ARN!,
      {
        documentId: docId,
        jobId: jobData.JobId,
      },
      'Finished Extracting Medical Expenses',
      `Medical Expenses have been extracted for document "${jobData.DocumentLocation.S3ObjectName}".
The document has the following id: ${docId}
The extraction job id is: ${jobData.JobId}
`
    );
  });
  return Promise.all(results);
};
