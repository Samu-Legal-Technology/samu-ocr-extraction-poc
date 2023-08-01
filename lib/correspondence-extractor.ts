import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as jsLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import {
  BucketAttributes,
  TableAttributes,
} from './samu-ocr-extraction-poc-stack';

interface CorrespondenceExtractorProps {
  docTable: TableAttributes;
  resultsBucket: BucketAttributes;
}

export default class CorrespondenceExtractor extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: CorrespondenceExtractorProps
  ) {
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

    const resultBucket = s3.Bucket.fromBucketName(
      this,
      'ResultsBucket',
      props.resultsBucket.name.importValue
    );

    // Text extractor lambda
    const textExtractor = new jsLambda.NodejsFunction(this, 'text-extract', {
      functionName: 'StartCorrespondenceExtraction',
      environment: {
        NOTIFICATION_TOPIC_ARN: topic.topicArn,
        NOTIFICATION_ROLE_ARN: textractPublishingRole.roleArn,
        DOC_INFO_TABLE_NAME: props.docTable.name.importValue,
        STORAGE_BUCKET: resultBucket.bucketName,
      },
    });

    textExtractor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'textract:StartDocumentTextDetection',
          'comprehend:DetectEntities',
          'comprehend:DetectSentiment',
          'comprehend:DetectKeyPhrases',
        ],
        resources: ['*'],
      })
    );

    textExtractor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [props.docTable.arn.importValue],
      })
    );

    resultBucket.grantPut(textExtractor);

    // Text saver lambda
    const textSaver = new jsLambda.NodejsFunction(this, 'text-saver', {
      environment: {
        DOC_INFO_TABLE_NAME: props.docTable.name.importValue,
        STORAGE_BUCKET: resultBucket.bucketName,
      },
    });

    topic.addSubscription(new subs.LambdaSubscription(textSaver));

    textSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'textract:GetDocumentTextDetection',
          'comprehend:DetectEntities',
          'comprehend:DetectSentiment',
          'comprehend:DetectKeyPhrases',
        ],
        resources: ['*'],
      })
    );

    textSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [props.docTable.arn.importValue],
      })
    );

    textSaver.addEnvironment('COMPREHEND_ACCESS_ROLE', textSaver.role?.roleArn ?? '')
    resultBucket.grantPut(textSaver);

    // source S3 bucket permissions
    const sourceBucket = s3.Bucket.fromBucketName(
      this,
      'SourceBucket',
      'clientanalysis'
    );
    sourceBucket.grantRead(textExtractor);
  }
}
