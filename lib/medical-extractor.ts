import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';

interface MedicalExtractorProps {
  docTable: dynamo.Table;
}

export default class MedicalExtractor extends Construct {
  constructor(scope: cdk.Stack, id: string, props: MedicalExtractorProps) {
    super(scope, id);
  }
}