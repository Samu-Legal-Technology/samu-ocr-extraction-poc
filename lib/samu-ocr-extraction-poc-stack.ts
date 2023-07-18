import * as cdk from 'aws-cdk-lib';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import MedicalExtractor from './medical-extractor';
import CorrespondenceExtractor from './correspondence-extractor';

export class SamuOcrExtractionPocStack extends cdk.Stack {
  readonly docTable: dynamo.Table;
  readonly caseTable: dynamo.Table;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const caseTable = new dynamo.Table(this, 'CaseInfo', {
      partitionKey: {
        type: dynamo.AttributeType.STRING,
        name: 'caseId',
      },
    })
    const documentTable = new dynamo.Table(this, 'DocumentInfo', {
      partitionKey: {
        type: dynamo.AttributeType.STRING,
        name: 'documentId',
      },
      sortKey: {
        type: dynamo.AttributeType.STRING,
        name: 'caseId',
      },
    })

    this.docTable = documentTable;
    this.caseTable = caseTable;
  }
}
