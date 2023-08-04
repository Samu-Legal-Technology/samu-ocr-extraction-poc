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
- [StartPleadingExtraction](https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/functions/StartPleadingExtraction?tab=code)
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

#### Note: For email documents, attachments found during extraction are put on a S3 results bucket (`samuocrextractionpocstac-rawextractionresultsa677-1k5k05vbr18zk`) following the convention `documentId/attachments/filename` .

[Link to S3 results bucket ](https://s3.console.aws.amazon.com/s3/buckets/samuocrextractionpocstac-rawextractionresultsa677-1k5k05vbr18zk?region=us-east-1&tab=objects)

# Deploying the Infrastructure

This project uses CDK for Infrastructure as Code. The following will explain how to use
the infrastructure.
All necessary node modules are declared in package.json. Assuming you have nodejs already installed, a simple `npm i` will get all the tools you need.

## Useful commands

- `npx cdk deploy StackNameHere` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk destropy` will tear down the infrastructure

## Stacks

There is a shared stack that has the shared resources, namely the DynamoDB tables, an s3 bucket for intermediate files, and an SNS topic for notifying of the status
of an extractor

Each extractor has it's own CloudFormation Stack. This allows them to be deployed
independently and torn down independantly.

To see what stacks are available, run the following:

```sh
npx cdk ls

# Example Output
# SamuOcrExtractionPocStack
# MedExtractorStack
# CommsExtractorStack
# PleadingExtractorStack
```

From there you can select which of the stacks to deploy:

```sh
# Deploy only one stack
npx cdk deploy MedExtractorStack

# Deploy all extractor stacks
# '*' is a wildcard
npx cdk deploy "*ExtractorStack"

# deploy all stacks
npx cdk deploy --all
```
