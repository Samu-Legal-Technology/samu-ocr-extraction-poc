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

## Reviewing the results

The extractors will take a while to run as they wait for asyncronous responses from
the Textract and Comprehend apis.
After the extraction process is finished, there will be a message sent to the result topic (ExtractionResultNotification).
You can subscribe to that topic to get notified when it is done.

Once it is done, take the document id and search for it in the DynamoDB table
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
