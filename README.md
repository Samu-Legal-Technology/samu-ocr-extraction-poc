# Testing an Extractor

To test an extractor, you will need to find the entry point lambda and execute it with an event like below:

```json
{
  "bucket": "clientanalysis",
  "key": "Client Name/Path/To/File.pdf"
}
```

Entry point lambdas:

- [StartMedicalExtraction](https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/functions/StartMedicalExtraction?tab=code)
- [StartCorrespondenceExtraction](https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/functions/StartCorrespondenceExtraction?tab=code)
  - For demoing a pdf extraction, click on the lambda dropdown select `TestCorrespondencePDF` and click `Test`
  - For demoing a email extraction, click on the lambda dropdown select `TestCorrespondenceEmail` and click `Test`
  - For demoing a transcript extraction, click on the lambda dropdown select `TestCorrespondenceTrans` and click `Test`

After running a test, you will get a response that has the generated `documentId` used througout the extraction process. Take not of the `documentId` for later.

## Reviewing the results

The extractors will take a while to run as they wait for asyncronous responses from
the Textract and Comprehend apis.
After the extraction process is finished, there will be a message sent to the result topic ([ExtractionResultNotification](https://us-east-1.console.aws.amazon.com/sns/v3/home?region=us-east-1#/topic/arn:aws:sns:us-east-1:371292405073:ExtractionResultNotification)).
You can [subscribe](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html) to that topic to get notified when it is done.

Once it is done, take the `documentId` from either the notification or the result of starting the extraction and search for it in the DynamoDB table
[DocumentInfo](https://us-east-1.console.aws.amazon.com/dynamodbv2/home?region=us-east-1#item-explorer?maximize=true&table=DocumentInfo).

# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template
