import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';
import * as jsLambda from 'aws-cdk-lib/aws-lambda-nodejs';

interface MedicalExtractorProps extends cdk.StackProps {
  docTable: dynamo.Table;
}

export default class MedicalExtractor extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MedicalExtractorProps) {
    super(scope, id);

    const textExtractor = new jsLambda.NodejsFunction(this, 'text-extract')
  }
}