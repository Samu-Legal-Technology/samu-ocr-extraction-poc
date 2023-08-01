import {
  DynamoDBClient,
  PutItemCommand,
  PutItemInput,
  ReturnValue,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

const db = new DynamoDBClient({});

export const persist = async (
  tableName: string | undefined,
  docId: string,
  item: PutItemInput['Item']
): Promise<number | undefined> => {
  if (!tableName) throw new Error('Undefined table name');

  let status: number | undefined;

  try {
    const res = await db.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          documentId: {
            S: docId,
          },
          ...item,
        },
        ReturnValues: ReturnValue.NONE,
      })
    );
  
    status = res.$metadata.httpStatusCode
  } catch (err) {
    console.debug('Could not persist to dynamo:', err)
  }

  console.debug('Dynamo db status:', status)

  return status;
};

export const update = async (
  tableName: string | undefined,
  docId: string,
  item: NonNullable<PutItemInput['Item']>
): Promise<number | undefined> => {
  if (!tableName) throw new Error('Undefined table name');

  const updates = Object.keys(item!).reduce(
    (attrs, key) => ({
      ...attrs,
      [key]: {
        Action: 'PUT',
        Value: item[key],
      },
    }),
    {}
  );
  const res = await db.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: {
        documentId: {
          S: docId,
        },
      },
      AttributeUpdates: updates,
      ReturnValues: ReturnValue.NONE,
    })
  );
  return res.$metadata.httpStatusCode;
};
