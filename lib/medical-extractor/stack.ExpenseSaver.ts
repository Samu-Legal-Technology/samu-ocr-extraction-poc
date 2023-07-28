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

const textract = new TextractClient({});

interface Expense {
  price: number;
  productCode?: string;
  description?: string;
  diagnosisCode?: string;
  provider?: string;
  unitPrice?: number;
  quantity?: number;
}

interface ReceiptInfo {
  accountNumbers: string[];
  provider: {
    names: string[];
    addresses: string[];
  };
  receiver: {
    names: string[];
    addresses: string[];
  };
}

interface ExpenseData {
  total: number;
  paid: number;
  due: number;
  receiptInfo: ReceiptInfo;
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
  return parseDocumentValue(docTotal);
}
function getDocumentDue(document: ExpenseDocument): number | undefined {
  const docDue = document.SummaryFields?.find((field) =>
    isFieldType(field, 'AMOUNT_DUE')
  )?.ValueDetection?.Text;
  return parseDocumentValue(docDue);
}
function getDocumentPaid(document: ExpenseDocument): number | undefined {
  const docPaid = document.SummaryFields?.find((field) =>
    isFieldType(field, 'AMOUNT_PAID')
  )?.ValueDetection?.Text;
  return parseDocumentValue(docPaid);
}

function getAllValuesForType(
  fields: ExpenseField[],
  fieldName: string
): string[] {
  const values = new Set<string>();
  fields.filter(filterFields(fieldName)).forEach((field) => {
    const text = field.ValueDetection?.Text;
    if (text) values.add(text);
  });
  return Array.from(values);
}

function getReceiptInfo(document: ExpenseDocument): ReceiptInfo {
  const fields = document.SummaryFields ?? [];
  return {
    accountNumbers: getAllValuesForType(fields, 'ACCOUNT_NUMBER'),
    receiver: {
      names: getAllValuesForType(fields, 'RECEIVER_NAME'),
      addresses: getAllValuesForType(fields, 'RECEIVER_ADDRESS'),
    },
    provider: {
      names: getAllValuesForType(fields, 'VENDOR_NAME'),
      addresses: getAllValuesForType(fields, 'VENDOR_ADDRESS'),
    },
  };
}

function parseFieldText(field?: ExpenseField): number | undefined {
  const text = field?.ValueDetection?.Text;
  return parseDocumentValue(text);
}

function getItemText(item: LineItemFields, type: string): string | undefined {
  return item.LineItemExpenseFields?.find(filterFields(type))?.ValueDetection
    ?.Text;
}

function hasLabel(field: ExpenseField, labelText: string): boolean {
  return field.LabelDetection?.Text?.toUpperCase() === labelText.toUpperCase();
}

function getOtherField(
  item: LineItemFields,
  labelText: string
): string | undefined {
  return item.LineItemExpenseFields?.find(
    (field) => isFieldType(field, 'OTHER') && hasLabel(field, labelText)
  )?.ValueDetection?.Text;
}

function getIndividualExpenses(
  document: ExpenseDocument
): Expense[] | undefined {
  return document.LineItemGroups?.map(
    (group) =>
      group.LineItems?.map((lineItem: LineItemFields) => {
        const price = parseFieldText(
          lineItem.LineItemExpenseFields?.find(filterFields('PRICE'))
        );
        if (!price) {
          return;
        }
        return {
          price,
          productCode: getItemText(lineItem, 'PRODUCT_CODE'),
          description: getItemText(lineItem, 'ITEM'),
          unitPrice: parseFieldText(
            lineItem.LineItemExpenseFields?.find(filterFields('UNIT_PRICE'))
          ),
          diagnosisCode: getOtherField(lineItem, 'Diagnosis'),
          provider: getOtherField(lineItem, 'provider'),
          quantity: parseFieldText(
            lineItem.LineItemExpenseFields?.find(filterFields('QUANTITY'))
          ),
        } as Expense;
      })
  )
    .flat()
    .filter((expense): expense is Expense => !!expense);
}

async function getExpenseAnalysis(jobId: string) {
  let pages: ExpenseData[] = [];
  let nextToken: string | undefined = undefined;
  do {
    const expenseResult: GetExpenseAnalysisCommandOutput = await textract.send(
      new GetExpenseAnalysisCommand({
        JobId: jobId,
        NextToken: nextToken,
      })
    );
    nextToken = expenseResult.NextToken;
    const newPages = expenseResult.ExpenseDocuments?.map((doc) => {
      const docTotal = getDocumentTotal(doc);
      console.debug('Doc total', docTotal);
      const docPaid = getDocumentPaid(doc);
      const docDue = getDocumentDue(doc);
      const lineItemExpenses = getIndividualExpenses(doc);
      const receiptInfo = getReceiptInfo(doc);
      console.debug('Doc expenses', lineItemExpenses);
      return {
        total: docTotal ?? 0,
        paid: docPaid ?? 0,
        due: docDue ?? 0,
        receiptInfo,
        expenses: lineItemExpenses ?? [],
      };
    });
    pages = pages.concat(...(newPages ?? []));
  } while (nextToken);

  return pages;
}

async function getDocumentExpenses(jobId: string): Promise<ExpenseData[]> {
  return getExpenseAnalysis(jobId);
}

async function saveExpenseData(
  docId: string,
  pages: ExpenseData[]
): Promise<number | undefined> {
  return await db.update(
    process.env.DOC_INFO_TABLE_NAME,
    docId,
    Utils.toDynamo({
      type: 'medical',
      expensesByPage: pages.map(
        ({ total, paid, due, expenses, receiptInfo }) => ({
          totalExpenses: total.toFixed(2),
          totalPaid: paid.toFixed(2),
          totalDue: due.toFixed(2),
          receiptInfo: receiptInfo,
          expenses: expenses.map((expense) => {
            const result: Record<string, number | string> = {
              price: expense.price.toFixed(2),
            };
            Object.keys(expense)
              .filter((key) => key !== 'price')
              .forEach((key) => {
                const value = expense[key as keyof Expense];
                if (value) {
                  if (typeof value === 'number') {
                    result[key] = value.toFixed(2);
                  } else {
                    result[key] = value;
                  }
                }
                if (expense.provider) {
                  result.provider = expense.provider;
                }
                if (expense.provider) {
                  result.provider = expense.provider;
                }
              });
            return result;
          }),
        })
      ),
    })
  );
}

export const handler: Handler = async (event: SNSEvent): Promise<any> => {
  console.log('Event: ', JSON.stringify(event));
  const results = event.Records.map(async (record) => {
    const jobData = JSON.parse(record.Sns.Message) as TextractRecord;
    const docId = jobData.JobTag;
    console.debug('Document ID', docId);

    const pages = await getDocumentExpenses(jobData.JobId);
    await saveExpenseData(docId, pages);
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
