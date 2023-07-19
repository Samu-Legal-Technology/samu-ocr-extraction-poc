import { DynamoDBClient, PutItemCommand, PutItemInput, ReturnValue } from "@aws-sdk/client-dynamodb";


const db = new DynamoDBClient({});

export class DynamoDBPersistor {

    async persist(tableName: string | undefined, docId: string, item: PutItemInput["Item"]): Promise<number | undefined> {
        if (!tableName)
          throw new Error('Undefined table name');

        const res = await db.send(
          new PutItemCommand({
            TableName: tableName,
            Item: {
              documentId: {
                S: docId,
              },
              ...item
            },
            ReturnValues: ReturnValue.NONE,
          })
        );
        return res.$metadata.httpStatusCode;
    }
}