import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';
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
import OntologyStateMachine from './ontologies/state-machine';

interface MedicalExtractorProps extends cdk.StackProps {
  docTable: TableAttributes;
  resultTopic: TopicAttributes;
  resultsBucket: BucketAttributes;
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
    const comprehendAccessRole = new iam.Role(
      this,
      'ComprehendSharedAccessRole',
      {
        assumedBy: new iam.CompositePrincipal(
          new iam.ServicePrincipal('comprehend.amazonaws.com', {
            conditions: {
              ArnLike: {
                'aws:SourceArn': `arn:aws:comprehend:*:${this.account}:*`,
              },
              StringEquals: {
                'aws:SourceAccount': this.account,
              },
            },
          }),
          new iam.ServicePrincipal('comprehendmedical.amazonaws.com', {
            conditions: {
              // ArnLike: {
              //   'aws:SourceArn': `arn:aws:comprehendmedical:*:${this.account}:*`,
              // },
              // StringEquals: {
              //   'aws:SourceAccount': this.account,
              // },
            },
          })
        ),
      }
    );
    comprehendAccessRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:ListBucket', 's3:PutObject'],
        resources: [resultBucket.arnForObjects('*'), resultBucket.bucketArn],
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

    const medExtractor = new jsLambda.NodejsFunction(this, 'MedicalExtractor', {
      functionName: 'StartMedicalExtraction',
      environment: {
        NOTIFICATION_TOPIC_ARN: medTopic.topicArn,
        NOTIFICATION_ROLE_ARN: textractPublishingRole.roleArn,
        DOC_INFO_TABLE_NAME: props.docTable.name.importValue,
      },
    });
    medExtractor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'textract:StartDocumentTextDetection',
          'textract:StartExpenseAnalysis',
        ],
        resources: ['*'],
      })
    );
    medExtractor.addToRolePolicy(writeItemPolicy);
    sourceBucket.grantRead(medExtractor);

    medTopic.grantPublish(textractPublishingRole);

    const billingCodeSaver = new jsLambda.NodejsFunction(
      this,
      'ICD10CodeSaver',
      {}
    );

    const ontologyMachine = new OntologyStateMachine(
      this,
      'OntologyExtraction',
      {
        functions: {
          ICD10Saver: billingCodeSaver,
        },
        roles: {
          dataAccess: comprehendAccessRole,
        },
        storageBucket: props.resultsBucket.name.importValue,
      }
    );

    const textSaver = new jsLambda.NodejsFunction(this, 'TextSaver', {
      timeout: cdk.Duration.seconds(30),
      environment: {
        DOC_INFO_TABLE_NAME: props.docTable.name.importValue,
        STORAGE_BUCKET: resultBucket.bucketName,
        STATE_MACHINE_ARN: ontologyMachine.getArn(),
      },
    });
    textSaver.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'textract:GetDocumentTextDetection',
          'comprehendmedical:StartICD10InferenceJob',
        ],
        resources: ['*'],
      })
    );
    textSaver.addToRolePolicy(writeItemPolicy);
    resultBucket.grantPut(textSaver);
    ontologyMachine.machine.grantStartExecution(textSaver);

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
      new subs.EmailSubscription('shem.sedrick@caylent.com')
    );
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
