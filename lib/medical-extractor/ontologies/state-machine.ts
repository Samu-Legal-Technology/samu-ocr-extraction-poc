import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

interface OntologyStateMachineProps {
  functions: {
    ICD10Saver: lambda.Function;
  };
  roles: {
    dataAccess: iam.Role;
  };
  storageBucket: string;
}

export default class OntologyStateMachine extends Construct {
  readonly machine: sfn.StateMachine;
  constructor(scope: cdk.Stack, id: string, props: OntologyStateMachineProps) {
    super(scope, id);

    const icd10Chooser = new sfn.Choice(this, 'IsIcd10Done', {});
    const ICD10_JOB_STATUS_PATH =
      '$.icd10Job.status.ComprehendMedicalAsyncJobProperties.JobStatus';
    const icd10Waiter = new sfn.Wait(this, 'WaitForICD10', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(30)),
    })
      .next(
        new tasks.CallAwsService(this, 'ICD10JobStatus', {
          service: 'comprehendmedical',
          action: 'describeICD10CMInferenceJob',
          iamAction: 'comprehendmedical:DescribeICD10CMInferenceJob',
          iamResources: ['*'],
          parameters: {
            JobId: sfn.JsonPath.stringAt('$.icd10Job.JobId'),
          },
          resultPath: '$.icd10Job.status',
        })
      )
      .next(icd10Chooser);
    icd10Chooser
      .when(
        sfn.Condition.stringEquals(ICD10_JOB_STATUS_PATH, 'COMPLETED'),
        new tasks.LambdaInvoke(this, 'SaveICD10Codes', {
          lambdaFunction: props.functions.ICD10Saver,
        })
      )
      .when(
        sfn.Condition.or(
          ...['PARTIAL_SUCCESS', 'FAILED', 'STOP_REQUESTED', 'STOPPED'].map(
            (status) =>
              sfn.Condition.stringEquals(ICD10_JOB_STATUS_PATH, status)
          )
        ),
        new sfn.Fail(this, 'ICD10Failure', {})
      )
      .otherwise(icd10Waiter);

    const icd10 = new tasks.CallAwsService(this, 'InferICD10', {
      service: 'comprehendmedical',
      action: 'startICD10CMInferenceJob',
      iamAction: 'comprehendmedical:StartICD10CMInferenceJob',
      iamResources: ['*'],
      parameters: {
        InputDataConfig: {
          S3Bucket: sfn.JsonPath.objectAt('$.location.bucket'),
          S3Key: sfn.JsonPath.objectAt('$.location.prefix'),
        },
        OutputDataConfig: {
          S3Bucket: props.storageBucket,
          S3Key: sfn.JsonPath.format(
            '{}/comprehendmedical/icd10',
            sfn.JsonPath.stringAt('$.documentId')
          ),
        },
        DataAccessRoleArn: props.roles.dataAccess.roleArn,
        JobName: sfn.JsonPath.format(
          'ICD10_{}',
          sfn.JsonPath.stringAt('$.documentId')
        ),
        LanguageCode: 'en',
      },
      resultPath: '$.icd10Job',
    }).next(icd10Waiter);
    const split = new sfn.Parallel(this, 'StartOntologies', {}).branch(icd10);

    this.machine = new sfn.StateMachine(this, 'OntologyStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(split),
    });
    props.roles.dataAccess.grantPassRole(this.machine.role);
  }

  getArn(): string {
    return this.machine.stateMachineArn;
  }
}
