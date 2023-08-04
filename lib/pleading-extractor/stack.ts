import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as jsLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import {
  BucketAttributes,
  TableAttributes,
} from '../samu-ocr-extraction-poc-stack';

interface PleadingExtractorProps extends cdk.StackProps {
  docTable: TableAttributes;
  resultsBucket: BucketAttributes;
}

export default class PleadingExtractor extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PleadingExtractorProps) {
    super(scope, id, props);

    const pleadingTopic = new sns.Topic(this, 'PleadingDocumentText', {});
    const sourceBucket = s3.Bucket.fromBucketName(
      this,
      'SourceBucket',
      'clientanalysis'
    );
    const resultBucket = s3.Bucket.fromBucketName(
      this,
      'ResultsBucket',
      props.resultsBucket.name.importValue
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
    pleadingTopic.grantPublish(textractPublishingRole);

    const writeItemPolicy = new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [props.docTable.arn.importValue],
    });

    const pleadingExtractor = new jsLambda.NodejsFunction(
      this,
      'PleadingExtractor',
      {
        functionName: 'StartPleadingExtraction',
        environment: {
          NOTIFICATION_TOPIC_ARN: pleadingTopic.topicArn,
          NOTIFICATION_ROLE_ARN: textractPublishingRole.roleArn,
          DOC_INFO_TABLE_NAME: props.docTable.name.importValue,
        },
      }
    );
    sourceBucket.grantRead(pleadingExtractor);
    pleadingExtractor.addToRolePolicy(writeItemPolicy);
    pleadingExtractor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:StartDocumentAnalysis'],
        resources: ['*'],
      })
    );

    const textSaver = new jsLambda.NodejsFunction(this, 'TextSaver', {
      timeout: cdk.Duration.seconds(10),
      environment: {
        DOC_INFO_TABLE_NAME: props.docTable.name.importValue,
        STORAGE_BUCKET: resultBucket.bucketName,
      },
    });
    resultBucket.grantPut(textSaver);
    textSaver.addToRolePolicy(writeItemPolicy);
    textSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentAnalysis', 'comprehend:DetectEntities'],
        resources: ['*'],
      })
    );

    pleadingTopic.addSubscription(
      new subs.EmailSubscription('shem.sedrick@caylent.com')
    );
    pleadingTopic.addSubscription(
      new subs.LambdaSubscription(textSaver, {
        filterPolicyWithMessageBody: {
          API: sns.FilterOrPolicy.filter(
            sns.SubscriptionFilter.stringFilter({
              allowlist: ['StartDocumentAnalysis'],
            })
          ),
        },
      })
    );
  }
}
