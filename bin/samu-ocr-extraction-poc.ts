#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SamuOcrExtractionPocStack } from '../lib/samu-ocr-extraction-poc-stack';
import MedicalExtractor from '../lib/medical-extractor/stack';
import CorrespondenceExtractor from '../lib/correspondence-extractor/correspondence-extractor';

const app = new cdk.App();

const tags = cdk.Tags.of(app);
tags.add('application', 'ocr-poc');
tags.add('team', 'Caylent');

const sharedInfra = new SamuOcrExtractionPocStack(
  app,
  'SamuOcrExtractionPocStack',
  {
    /* If you don't specify 'env', this stack will be environment-agnostic.
     * Account/Region-dependent features and context lookups will not work,
     * but a single synthesized template can be deployed anywhere. */
    /* Uncomment the next line to specialize this stack for the AWS Account
     * and Region that are implied by the current CLI configuration. */
    // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    /* Uncomment the next line if you know exactly what Account and Region you
     * want to deploy the stack to. */
    // env: { account: '123456789012', region: 'us-east-1' },
    /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
  }
);

new MedicalExtractor(app, 'MedExtractorStack', {
  docTable: sharedInfra.docTable,
  resultTopic: sharedInfra.resultTopic,
  resultsBucket: sharedInfra.resultsBucket,
});

new CorrespondenceExtractor(app, 'CommsExtractorStack', {
  docTable: sharedInfra.docTable,
  resultsBucket: sharedInfra.resultsBucket,
});
