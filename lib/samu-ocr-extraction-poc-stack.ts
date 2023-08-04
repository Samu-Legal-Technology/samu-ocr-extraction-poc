import * as cdk from 'aws-cdk-lib';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import MedicalExtractor from './medical-extractor/stack';
import CorrespondenceExtractor from './correspondence-extractor/correspondence-extractor';

export interface TableAttributes {
  name: cdk.CfnOutput;
  arn: cdk.CfnOutput;
}
export interface TopicAttributes {
  arn: cdk.CfnOutput;
}
export interface BucketAttributes {
  name: cdk.CfnOutput;
}

export class SamuOcrExtractionPocStack extends cdk.Stack {
  readonly docTable: TableAttributes;
  readonly caseTable: TableAttributes;
  readonly resultTopic: TopicAttributes;
  readonly resultsBucket: BucketAttributes;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const caseTable = new dynamo.Table(this, 'CaseInfo', {
      tableName: 'CaseInfo',
      partitionKey: {
        type: dynamo.AttributeType.STRING,
        name: 'caseId',
      },
    });
    const docTable = new dynamo.Table(this, 'DocumentInfo', {
      tableName: 'DocumentInfo',
      partitionKey: {
        type: dynamo.AttributeType.STRING,
        name: 'documentId',
      },
      // sortKey: {
      //   type: dynamo.AttributeType.STRING,
      //   name: "caseId",
      // },
    });

    const rawResults = new s3.Bucket(this, 'RawExtractionResults', {});

    const resultTopic = new sns.Topic(this, 'ExtractionResult', {
      topicName: 'ExtractionResultNotification',
    });
    ['shem.sedrick@caylent.com', 'christian.angelone@caylent.com'].forEach(
      (email: string) =>
        resultTopic.addSubscription(new subs.EmailSubscription(email))
    );

    this.docTable = {
      name: new cdk.CfnOutput(this, 'DocumentInfoTableName', {
        value: docTable.tableName,
        exportName: 'DocumentInfoTableName',
      }),
      arn: new cdk.CfnOutput(this, 'DocumentInfoTableArn', {
        value: docTable.tableArn,
        exportName: 'DocumentInfoTableArn',
      }),
    };
    this.caseTable = {
      name: new cdk.CfnOutput(this, 'CaseInfoTableName', {
        value: caseTable.tableName,
        exportName: 'CaseInfoTableName',
      }),
      arn: new cdk.CfnOutput(this, 'CaseInfoTableArn', {
        value: caseTable.tableArn,
        exportName: 'CaseInfoTableArn',
      }),
    };
    this.resultTopic = {
      arn: new cdk.CfnOutput(this, 'ResultTopicArn', {
        value: resultTopic.topicArn,
        exportName: 'ResultTopicArn',
      }),
    };
    this.resultsBucket = {
      name: new cdk.CfnOutput(this, 'ResultsBucketName', {
        value: rawResults.bucketName,
        exportName: 'ResultsBucketName',
      }),
    };
  }
}
