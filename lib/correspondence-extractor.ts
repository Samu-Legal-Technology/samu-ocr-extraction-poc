import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';
import * as jsLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
interface CorrespondenceExtractorProps {
  docTable: dynamo.Table;
}

export default class CorrespondenceExtractor extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CorrespondenceExtractorProps) {
    super(scope, id);
    
    const topic = new sns.Topic(this, 'CorrespondenceDocumentText', {});
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

    // SNS topic permissions & sub
    topic.grantPublish(textractPublishingRole);
    topic.addSubscription(
      new subs.EmailSubscription('christian.angelone@caylent.com')
    );

    // Text extractor lambda
    const textExtractor = new jsLambda.NodejsFunction(this, 'text-extract', {
      environment: {
        NOTIFICATION_TOPIC_ARN: topic.topicArn,
        NOTIFICATION_ROLE_ARN: textractPublishingRole.roleArn,
      },
    })

    textExtractor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:StartDocumentTextDetection'],
        resources: ['*'],
      })
    );

    // Text saver lambda
    const textSaver = new jsLambda.NodejsFunction(this, 'text-saver', {
      environment: {
        DOC_INFO_TABLE_NAME: props.docTable.tableName,
      }
    })

    topic.addSubscription(new subs.LambdaSubscription(textSaver));

    textSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentTextDetection'],
        resources: ['*'],
      })
    );

    textSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [props.docTable.tableArn],
      })
    );

    // source S3 bucket permissions
    const sourceBucket = s3.Bucket.fromBucketName(
      this,
      'SourceBucket',
      'clientanalysis'
    );
    sourceBucket.grantRead(textExtractor);
  }
}
