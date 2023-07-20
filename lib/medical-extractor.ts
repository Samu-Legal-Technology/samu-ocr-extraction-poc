import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as jsLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  TableAttributes,
  TopicAttributes,
} from './samu-ocr-extraction-poc-stack';

interface MedicalExtractorProps extends cdk.StackProps {
  docTable: TableAttributes;
  resultTopic: TopicAttributes;
}

export default class MedicalExtractor extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MedicalExtractorProps) {
    super(scope, id);

    const medTopic = new sns.Topic(this, 'MedicalDocumentText', {});

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
    const textExtractor = new jsLambda.NodejsFunction(
      this,
      'MedicalExtractor',
      {
        functionName: 'StartMedicalExtraction',
        environment: {
          NOTIFICATION_TOPIC_ARN: medTopic.topicArn,
          NOTIFICATION_ROLE_ARN: textractPublishingRole.roleArn,
        },
      }
    );
    textExtractor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'textract:StartDocumentTextDetection',
          'textract:StartExpenseAnalysis',
        ],
        resources: ['*'],
      })
    );
    sourceBucket.grantRead(textExtractor);

    medTopic.grantPublish(textractPublishingRole);
    medTopic.addSubscription(
      new subs.EmailSubscription('shem.sedrick@caylent.com')
    );

    const textSaver = new jsLambda.NodejsFunction(this, 'TextSaver', {
      timeout: cdk.Duration.seconds(30),
      environment: {
        DOC_INFO_TABLE_NAME: props.docTable.name.importValue,
      },
    });
    textSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentTextDetection'],
        resources: ['*'],
      })
    );
    const writeItemPolicy = new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [props.docTable.arn.importValue],
    });
    const writeResultMessagePolicy = new iam.PolicyStatement({
      actions: ['sns:Publish'],
      resources: [props.resultTopic.arn.importValue],
    });
    textSaver.addToRolePolicy(writeItemPolicy);

    const expenseSaver = new jsLambda.NodejsFunction(this, 'ExpenseSaver', {
      timeout: cdk.Duration.seconds(15),
      environment: {
        DOC_INFO_TABLE_NAME: props.docTable.name.importValue,
        RESULT_TOPIC_ARN: props.resultTopic.arn.importValue,
      },
    });
    expenseSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetExpenseAnalysis'],
        resources: ['*'],
      })
    );
    expenseSaver.addToRolePolicy(writeItemPolicy);
    expenseSaver.addToRolePolicy(writeResultMessagePolicy);

    medTopic.addSubscription(
      new subs.LambdaSubscription(textSaver, {
        filterPolicyWithMessageBody: {
          API: sns.FilterOrPolicy.filter(
            sns.SubscriptionFilter.stringFilter({
              allowlist: ['StartDocumentTextDetection'],
            })
          ),
        },
      })
    );
    medTopic.addSubscription(
      new subs.LambdaSubscription(expenseSaver, {
        filterPolicyWithMessageBody: {
          API: sns.FilterOrPolicy.filter(
            sns.SubscriptionFilter.stringFilter({
              allowlist: ['StartExpenseAnalysis'],
            })
          ),
        },
      })
    );
  }
}
