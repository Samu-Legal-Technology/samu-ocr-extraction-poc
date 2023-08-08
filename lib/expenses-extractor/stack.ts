import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as jsLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  BucketAttributes,
  TableAttributes,
  TopicAttributes,
} from '../samu-ocr-extraction-poc-stack';

interface ExpenseExtractorProps extends cdk.StackProps {
  docTable: TableAttributes;
  resultTopic: TopicAttributes;
  resultsBucket: BucketAttributes;
}

export default class ExpenseExtractor extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ExpenseExtractorProps) {
    super(scope, id, props);

    const expensesTopic = new sns.Topic(this, 'ExpensesDocumentText', {});

    const resultTopic = sns.Topic.fromTopicArn(
      this,
      'ExpensesResultsTopic',
      props.resultTopic.arn.importValue
    );

    const sourceBucket = s3.Bucket.fromBucketName(
      this,
      'SourceBucket',
      'clientanalysis'
    );

    const textractPublishingRole = new iam.Role(
      this,
      'TextractNotificationRole',
      {
        assumedBy: new iam.ServicePrincipal('textract.amazonaws.com', {
          conditions: {
            ArnLike: {
              'aws:SourceArn': `arn:aws:textract:*:${this.account}:*`,
            },
            StringEquals: {
              'aws:SourceAccount': this.account,
            },
          },
        }),
      }
    );

    expensesTopic.grantPublish(textractPublishingRole);
    expensesTopic.addSubscription(
      new subs.EmailSubscription('christian.angelone@caylent.com')
    );

    const expenseExtractor = new jsLambda.NodejsFunction(
      this,
      'ExpenseExtractor',
      {
        functionName: 'StartExpenseExtraction',
        environment: {
          NOTIFICATION_TOPIC_ARN: expensesTopic.topicArn,
          NOTIFICATION_ROLE_ARN: textractPublishingRole.roleArn,
          DOC_INFO_TABLE_NAME: props.docTable.name.importValue,
        },
      }
    );

    sourceBucket.grantRead(expenseExtractor);

    expenseExtractor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [props.docTable.arn.importValue],
      })
    );

    expenseExtractor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:StartExpenseAnalysis'],
        resources: ['*'],
      })
    );

    const expenseSaver = new jsLambda.NodejsFunction(this, 'ExpenseSaver', {
      timeout: cdk.Duration.seconds(15),
      memorySize: 512,
      environment: {
        RESULT_TOPIC_ARN: resultTopic.topicArn,
        DOC_INFO_TABLE_NAME: props.docTable.name.importValue,
      },
    });

    expensesTopic.addSubscription(new subs.LambdaSubscription(expenseSaver));

    expenseSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [resultTopic.topicArn],
      })
    );

    expenseSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [props.docTable.arn.importValue],
      })
    );

    expenseSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetExpenseAnalysis'],
        resources: ['*'],
      })
    );
  }
}
