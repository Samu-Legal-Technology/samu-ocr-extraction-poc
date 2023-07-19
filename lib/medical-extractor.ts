import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as dynamo from "aws-cdk-lib/aws-dynamodb";
import * as sns from "aws-cdk-lib/aws-sns";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as jsLambda from "aws-cdk-lib/aws-lambda-nodejs";

interface MedicalExtractorProps extends cdk.StackProps {
  docTable: dynamo.Table;
}

export default class MedicalExtractor extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MedicalExtractorProps) {
    super(scope, id);

    const topic = new sns.Topic(this, "MedicalDocumentText", {});

    const sourceBucket = s3.Bucket.fromBucketName(this, 'SourceBucket', 'clientanalysis');

    const textractPublishingRole = new iam.Role(
      this,
      "TextractNotificationRole",
      {
        assumedBy: new iam.ServicePrincipal("textract.amazonaws.com", {
          conditions: {
            ArnLike: {
              "aws:SourceArn": `arn:aws:textract:*:${this.account}:*`,
            },
            StringEquals: {
              "aws:SourceAccount": this.account,
            },
          },
        }),
      },
    );
    const textExtractor = new jsLambda.NodejsFunction(this, "TextExtract", {
      bundling: {
        nodeModules: ["uuid"],
      },
      environment: {
        NOTIFICATION_TOPIC_ARN: topic.topicArn,
        NOTIFICATION_ROLE_ARN: textractPublishingRole.roleArn,
      },
    });
    textExtractor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["textract:StartDocumentTextDetection"],
        resources: ["*"],
      }),
    );
    sourceBucket.grantRead(textExtractor);

    topic.grantPublish(textractPublishingRole);
    topic.addSubscription(
      new subs.EmailSubscription("shem.sedrick@caylent.com"),
    );

    const textSaver = new jsLambda.NodejsFunction(this, "TextSaver", {
      timeout: cdk.Duration.seconds(30),
      environment: {
        DOC_INFO_TABLE_NAME: props.docTable.tableName,
      }
    })
    textSaver.addToRolePolicy(new iam.PolicyStatement({
      actions: ['textract:GetDocumentTextDetection'],
      resources: ['*']
    }))
    textSaver.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [props.docTable.tableArn],
    }))
    topic.addSubscription(new subs.LambdaSubscription(textSaver))
  }
}
