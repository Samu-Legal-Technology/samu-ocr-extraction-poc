import { Handler, SNSEvent } from 'aws-lambda';
import {
  LineItemFields,
  ExpenseDocument,
  GetExpenseAnalysisCommand,
  GetExpenseAnalysisCommandOutput,
  TextractClient,
  ExpenseField,
} from '@aws-sdk/client-textract';
import * as db from '../dynamodb-persistor';
import * as Utils from '../utils';
import { sendExtractionMessage } from '../reporter';
import { TextractRecord } from '../text-extractor';
import { AttributeValue } from '@aws-sdk/client-dynamodb';

const textract = new TextractClient({});

interface Expense {
  price: number;
  productCode: string | undefined;
  description: string | undefined;
  unitPrice: number | undefined;
}

interface ExpenseData {
  total: number;
  paid: number;
  due: number;
  expenses: Expense[];
}

function parseDocumentValue(rawTotal: string | undefined): number | undefined {
  if (rawTotal) {
    const parsed = parseFloat(Utils.sanitizeExpenseValue(rawTotal));
    console.debug('Parsed Total', parsed);
    if (!isNaN(parsed)) {
      return parsed;
    }
    return undefined;
  }
  return undefined;
}

function isFieldType(field: ExpenseField, type: string): boolean {
  return field.Type?.Text?.toUpperCase() === type.toUpperCase();
}
const filterFields = (type: string) => (field: ExpenseField) =>
  isFieldType(field, type);

function getDocumentTotal(document: ExpenseDocument): number | undefined {
  const docTotal = document.SummaryFields?.find((field) =>
    isFieldType(field, 'TOTAL')
  )?.ValueDetection?.Text;
  console.debug('Unparsed total', docTotal);
  return parseDocumentValue(docTotal);
}
function getDocumentDue(document: ExpenseDocument): number | undefined {
  const docDue = document.SummaryFields?.find((field) =>
    isFieldType(field, 'AMOUNT_DUE')
  )?.ValueDetection?.Text;
  console.debug('Unparsed total', docDue);
  return parseDocumentValue(docDue);
}
function getDocumentPaid(document: ExpenseDocument): number | undefined {
  const docPaid = document.SummaryFields?.find((field) =>
    isFieldType(field, 'AMOUNT_PAID')
  )?.ValueDetection?.Text;
  console.debug('Unparsed paid', docPaid);
  return parseDocumentValue(docPaid);
}

function parseFieldText(field?: ExpenseField): number | undefined {
  return parseFloat(Utils.sanitizeExpenseValue(field?.ValueDetection?.Text!));
}

function getItemText(item: LineItemFields, type: string): string | undefined {
  return item.LineItemExpenseFields?.find(filterFields(type))?.ValueDetection
    ?.Text;
}

function getIndividualExpenses(
  document: ExpenseDocument
): Expense[] | undefined {
  return document.LineItemGroups?.map(
    (group) =>
      group.LineItems?.map((lineItem: LineItemFields) => ({
        price: parseFieldText(
          lineItem.LineItemExpenseFields?.find(filterFields('PRICE'))
        )!,
        productCode: getItemText(lineItem, 'PRODUCT_CODE'),
        description: getItemText(lineItem, 'ITEM'),
        unitPrice: parseFieldText(
          lineItem.LineItemExpenseFields?.find(filterFields('UNIT_PRICE'))
        ),
      }))
  )
    .flat()
    .filter((expense): expense is Expense => !!expense);
}

async function getExpenseAnalysis(jobId: string) {
  let data: ExpenseData = {
    expenses: [],
    total: 0.0,
    paid: 0.0,
    due: 0.0,
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
      ({ expenses, total, paid, due }, doc) => {
        const docTotal = getDocumentTotal(doc);
        console.debug('Doc total', docTotal);
        const docPaid = getDocumentPaid(doc);
        const docDue = getDocumentDue(doc);
        const lineItemExpenses = getIndividualExpenses(doc);
        console.debug('Doc expenses', lineItemExpenses);
        return {
          total: total + (docTotal ?? 0),
          paid: paid + (docPaid ?? 0),
          due: due + (docDue ?? 0),
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
  { total, expenses, paid, due }: ExpenseData
): Promise<number | undefined> {
  return await db.update(process.env.DOC_INFO_TABLE_NAME, docId, {
    type: {
      S: 'medical',
    },
    totalExpenses: {
      N: total.toFixed(2),
    },
    totalPaid: {
      N: paid.toFixed(2),
    },
    totalDue: {
      N: due.toFixed(2),
    },
    expenses: {
      L: expenses.map((expense) => {
        const result: Record<string, AttributeValue> = {
          price: {
            N: expense.price.toFixed(2),
          },
        };
        if (expense.productCode) {
          result.productCode = {
            S: expense.productCode,
          };
        }
        if (expense.description) {
          result.description = {
            S: expense.description,
          };
        }
        if (expense.unitPrice) {
          result.unitPrice = {
            N: expense.unitPrice.toFixed(2),
          };
        }
        return {
          M: result,
        };
      }),
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
