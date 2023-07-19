import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';

interface CorrespondenceExtractorProps {
  docTable: dynamo.Table;
}

export default class CorrespondenceExtractor extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: CorrespondenceExtractorProps
  ) {
    super(scope, id);
  }
}
