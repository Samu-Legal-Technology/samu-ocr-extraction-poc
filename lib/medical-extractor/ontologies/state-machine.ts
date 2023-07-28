import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';

interface OntologyFunctions {
  icd10: lambda.Function;
  rxnorm: lambda.Function;
}

interface OntologyStateMachineProps {
  functions: OntologyFunctions;
  roles: {
    dataAccess: iam.Role;
  };
  notificationTopic: sns.ITopic;
  storageBucket: string;
}
type FunctionNames = keyof OntologyFunctions;

function generateWaiter(
  scope: Construct,
  id: string,
  props: {
    success: sfn.IChainable;
    fail?: sfn.IChainable;
  }
) {
  const chooser = new sfn.Choice(scope, `Is${id}Done`, {});
  const JOB_STATUS_PATH = `$.${id}.status.ComprehendMedicalAsyncJobProperties.JobStatus`;
  const waiter = new sfn.Wait(scope, `WaitFor${id}`, {
    time: sfn.WaitTime.duration(cdk.Duration.minutes(2)),
  })
    .next(
      new tasks.CallAwsService(scope, `${id}JobStatus`, {
        service: 'comprehendmedical',
        action: `describe${id}InferenceJob`,
        iamAction: `comprehendmedical:Describe${id}InferenceJob`,
        iamResources: ['*'],
        parameters: {
          JobId: sfn.JsonPath.stringAt(`$.${id}.JobId`),
        },
        resultPath: `$.${id}.status`,
      })
    )
    .next(chooser);
  chooser
    .when(
      sfn.Condition.stringEquals(JOB_STATUS_PATH, 'COMPLETED'),
      props.success
    )
    .when(
      sfn.Condition.or(
        ...['PARTIAL_SUCCESS', 'FAILED', 'STOP_REQUESTED', 'STOPPED'].map(
          (status) => sfn.Condition.stringEquals(JOB_STATUS_PATH, status)
        )
      ),
      props.fail ?? new sfn.Fail(scope, `${id}Failure`, {})
    )
    .otherwise(waiter);
  return waiter;
}

function generateComprehendMedicalJob(
  scope: Construct,
  id: FunctionNames,
  props: OntologyStateMachineProps & {
    actionName: string;
  }
) {
  return new tasks.CallAwsService(scope, `Infer${props.actionName}`, {
    service: 'comprehendmedical',
    action: `start${props.actionName}InferenceJob`,
    iamAction: `comprehendmedical:Start${props.actionName}InferenceJob`,
    iamResources: ['*'],
    parameters: {
      InputDataConfig: {
        S3Bucket: sfn.JsonPath.objectAt('$.location.bucket'),
        S3Key: sfn.JsonPath.objectAt('$.location.prefix'),
      },
      OutputDataConfig: {
        S3Bucket: props.storageBucket,
        S3Key: sfn.JsonPath.format(
          `{}/comprehendmedical/${id}`,
          sfn.JsonPath.stringAt('$.documentId')
        ),
      },
      DataAccessRoleArn: props.roles.dataAccess.roleArn,
      JobName: sfn.JsonPath.format(
        `${id.toUpperCase()}_{}`,
        sfn.JsonPath.stringAt('$.documentId')
      ),
      LanguageCode: 'en',
    },
    resultPath: `$.${props.actionName}`,
  }).next(
    generateWaiter(scope, props.actionName, {
      success: new tasks.LambdaInvoke(scope, `${props.actionName}Saver`, {
        lambdaFunction: props.functions[id],
      }),
    })
  );
}

const actionNameForKey: Record<FunctionNames, string> = {
  icd10: 'ICD10CM',
  rxnorm: 'RxNorm',
};

export default class OntologyStateMachine extends Construct {
  readonly machine: sfn.StateMachine;
  constructor(scope: cdk.Stack, id: string, props: OntologyStateMachineProps) {
    super(scope, id);
    const split = new sfn.Parallel(this, 'StartOntologies', {
      resultPath: sfn.JsonPath.DISCARD,
    });
    (Object.keys(props.functions) as FunctionNames[]).forEach((key) => {
      const job = generateComprehendMedicalJob(this, key, {
        ...props,
        actionName: actionNameForKey[key],
      });
      split.branch(job);
    });

    split.addCatch(
      new tasks.SnsPublish(this, 'ReportFailure', {
        topic: props.notificationTopic,
        subject: 'Ontology Analysis Failed',
        message: sfn.TaskInput.fromText(
          sfn.JsonPath.format(
            `Extraction of Ontology codes failed for {}. See execution {} for more details. https://us-east-1.console.aws.amazon.com/states/home?region=us-east-1#/v2/executions/details/{}`,
            sfn.JsonPath.stringAt('$.documentId'),
            sfn.JsonPath.executionId,
            sfn.JsonPath.executionId
          )
        ),
      })
    );
    split.next(
      new tasks.SnsPublish(this, 'ReportSuccess', {
        topic: props.notificationTopic,
        subject: 'Ontolgy Analysis Succeeded',
        message: sfn.TaskInput.fromText(
          sfn.JsonPath.format(
            `Extraction of Ontology codes suceeded for {}. See execution {} for more details. https://us-east-1.console.aws.amazon.com/states/home?region=us-east-1#/v2/executions/details/{}`,
            sfn.JsonPath.stringAt('$.documentId'),
            sfn.JsonPath.executionId,
            sfn.JsonPath.executionId
          )
        ),
      })
    );
    this.machine = new sfn.StateMachine(this, 'OntologyStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(split),
    });
    props.roles.dataAccess.grantPassRole(this.machine.role);
  }

  getArn(): string {
    return this.machine.stateMachineArn;
  }
}
