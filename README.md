# Samu OCR Extraction POC

## Overview

This proof-of-concept demonstrates an advanced document processing system built on AWS serverless architecture. It combines OCR capabilities with natural language processing to extract structured information from legal and medical documents. The system features three specialized extractors for medical records, correspondence, and legal pleadings, each optimized for domain-specific information extraction.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   S3 Events     │────▶│ Lambda Router   │────▶│   Extractors    │
│  (Documents)    │     │  (By Type)      │     ├─────────────────┤
└─────────────────┘     └─────────────────┘     │ Medical         │
                                                 │ Correspondence  │
                                                 │ Pleading        │
                                                 └────────┬────────┘
                                                          │
                    ┌─────────────────────────────────────┴───────────────────┐
                    │                                                         │
                    ▼                                                         ▼
            ┌──────────────┐     ┌──────────────┐                   ┌──────────────┐
            │   Textract   │────▶│     SNS      │                   │  Comprehend  │
            │ (Async OCR)  │     │(Notification)│                   │    (NLP)     │
            └──────────────┘     └──────┬───────┘                   └──────────────┘
                                         │
                                         ▼
                                ┌────────────────┐
                                │  Lambda        │
                                │ (Process)      │
                                └────────┬───────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    │                                         │
                    ▼                                         ▼
            ┌──────────────┐                         ┌──────────────┐
            │  DynamoDB    │                         │      S3      │
            │  (Metadata)  │                         │  (Results)   │
            └──────────────┘                         └──────────────┘
```

## Features

### Document Processing Capabilities

#### Medical Document Extractor
- **ICD-10 Code Extraction**: Billing codes for medical diagnoses
- **RXNORM Integration**: Prescription drug identification
- **SNOMED CT Codes**: Clinical terminology extraction
- **Medical Entity Recognition**: Conditions, medications, anatomy
- **Expense Analysis**: Medical billing and cost extraction

#### Correspondence Extractor
- **Email Processing**: Parse emails with attachments
- **Multi-format Support**: PDF, images, JSON, transcripts
- **Sentiment Analysis**: Determine tone and sentiment
- **Entity Extraction**: People, organizations, dates, locations
- **Key Phrase Detection**: Important terms and concepts

#### Legal Pleading Extractor
- **Structured Data Extraction**: Forms and tables
- **Legal Entity Recognition**: Case names, parties, citations
- **Document Classification**: Type of legal document
- **Metadata Extraction**: Filing dates, case numbers

### Technical Features
- **Serverless Architecture**: AWS Lambda functions
- **Asynchronous Processing**: Handle large documents efficiently
- **Event-Driven**: Automatic triggering via S3 events
- **Scalable**: Handles multiple documents concurrently
- **Cost-Effective**: Pay only for processing time

## Technology Stack

- **Infrastructure as Code**: AWS CDK 2.87.0
- **Runtime**: Node.js with TypeScript
- **OCR Service**: AWS Textract
- **NLP Service**: AWS Comprehend & Comprehend Medical
- **Storage**: S3 for documents, DynamoDB for metadata
- **Notifications**: SNS for processing status
- **Programming Language**: TypeScript (ES2022)

## Prerequisites

- Node.js 16.x or later
- AWS CLI configured with appropriate credentials
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- TypeScript knowledge for customization

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Samu-Legal-Technology/samu-ocr-extraction-poc.git
cd samu-ocr-extraction-poc
```

2. Install dependencies:
```bash
npm install
```

3. Configure AWS credentials:
```bash
aws configure
```

4. Bootstrap CDK (first time only):
```bash
cdk bootstrap
```

## Deployment

### Deploy All Stacks

```bash
npm run build
cdk deploy --all
```

### Deploy Individual Stacks

```bash
# Deploy shared infrastructure
cdk deploy SamuOcrExtractionPocStack

# Deploy specific extractors
cdk deploy MedExtractorStack
cdk deploy CommsExtractorStack
cdk deploy PleadingExtractorStack
```

## Usage

### Processing Documents

Documents are processed automatically when uploaded to the configured S3 bucket:

```bash
# Medical documents
aws s3 cp medical-record.pdf s3://clientanalysis/ClientName/Medical/

# Correspondence
aws s3 cp email.pdf s3://clientanalysis/ClientName/Correspondence/

# Legal pleadings
aws s3 cp complaint.pdf s3://clientanalysis/ClientName/Pleadings/
```

### Lambda Event Format

```json
{
  "bucket": "clientanalysis",
  "key": "ClientName/Medical/document.pdf"
}
```

### Monitoring Processing Status

Check CloudWatch Logs for processing status:
```bash
aws logs tail /aws/lambda/StartMedicalExtraction --follow
```

## Configuration

### Environment Variables

Configure in CDK stack or Lambda environment:

| Variable | Description | Default |
|----------|-------------|---------|
| `TABLE_NAME` | DynamoDB table for metadata | `DocumentInfo` |
| `BUCKET_NAME` | S3 bucket for documents | `clientanalysis` |
| `SNS_TOPIC_ARN` | Notification topic | Auto-generated |

### DynamoDB Tables

#### DocumentInfo Table
- **Partition Key**: `documentId` (String)
- **Attributes**: 
  - `clientName`: Client identifier
  - `documentType`: Medical/Correspondence/Pleading
  - `extractedData`: JSON extraction results
  - `processedAt`: Timestamp
  - `status`: Processing status

#### CaseInfo Table
- **Partition Key**: `caseId` (String)
- **Attributes**:
  - `clientName`: Associated client
  - `documents`: Related document IDs
  - `metadata`: Case information

## API Reference

### Medical Extractor

```typescript
interface MedicalExtractionResult {
  icd10Codes: Array<{
    code: string;
    description: string;
    confidence: number;
  }>;
  prescriptions: Array<{
    rxnormCode: string;
    drugName: string;
    dosage: string;
  }>;
  diagnoses: Array<{
    snomedCode: string;
    condition: string;
  }>;
}
```

### Correspondence Extractor

```typescript
interface CorrespondenceExtractionResult {
  emailMetadata?: {
    from: string;
    to: string[];
    subject: string;
    date: string;
  };
  sentiment: {
    score: number;
    sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  };
  entities: Array<{
    type: string;
    text: string;
    confidence: number;
  }>;
  keyPhrases: string[];
}
```

### Pleading Extractor

```typescript
interface PleadingExtractionResult {
  documentType: string;
  caseNumber?: string;
  parties: {
    plaintiff: string[];
    defendant: string[];
  };
  filingDate?: string;
  extractedText: string;
}
```

## Development

### Project Structure
```
samu-ocr-extraction-poc/
├── bin/
│   └── samu-ocr-extraction-poc.ts    # CDK app entry
├── lib/
│   ├── samu-ocr-extraction-poc-stack.ts  # Main stack
│   ├── med-extractor-stack.ts            # Medical extractor
│   ├── comms-extractor-stack.ts          # Correspondence
│   ├── pleading-extractor-stack.ts       # Pleadings
│   └── lambda/
│       ├── medical/                      # Medical Lambda code
│       ├── correspondence/               # Correspondence Lambda
│       └── pleading/                     # Pleading Lambda
├── test/                                 # Test files
├── cdk.json                             # CDK configuration
├── package.json                         # Dependencies
└── tsconfig.json                        # TypeScript config
```

### Local Development

1. Run tests:
```bash
npm test
```

2. Watch mode for development:
```bash
npm run watch
```

3. Synthesize CloudFormation:
```bash
cdk synth
```

### Adding New Extractors

1. Create new stack in `lib/`:
```typescript
export class NewExtractorStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    
    // Define Lambda function
    const extractorLambda = new NodejsFunction(this, 'Extractor', {
      entry: 'lib/lambda/new-extractor/index.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
    });
  }
}
```

2. Add Lambda handler in `lib/lambda/new-extractor/index.ts`

3. Deploy the new stack:
```bash
cdk deploy NewExtractorStack
```

## Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
Upload test documents and verify processing:
```bash
# Upload test document
aws s3 cp test-document.pdf s3://clientanalysis/test/

# Check DynamoDB for results
aws dynamodb get-item \
  --table-name DocumentInfo \
  --key '{"documentId": {"S": "test-document-id"}}'
```

## Monitoring & Debugging

### CloudWatch Logs
- Lambda execution logs: `/aws/lambda/{function-name}`
- Textract job status: Check SNS notifications
- Error tracking: CloudWatch Insights queries

### Metrics to Monitor
- Lambda invocation count and duration
- Textract API throttling
- DynamoDB read/write capacity
- S3 storage usage

### Common Issues
1. **Textract Limits**: Large documents may timeout
2. **Comprehend Throttling**: Implement exponential backoff
3. **Lambda Memory**: Increase for large documents
4. **S3 Permissions**: Ensure Lambda has read access

## Security

### IAM Permissions
- Least privilege access for each Lambda
- S3 bucket policies restrict access
- DynamoDB encryption at rest
- SNS topic access controls

### Data Protection
- Enable S3 bucket encryption
- Use VPC endpoints for AWS services
- Implement API Gateway for external access
- Regular security audits

## Cost Optimization

1. **Lambda Configuration**: Right-size memory allocation
2. **S3 Lifecycle**: Archive processed documents
3. **DynamoDB**: Use on-demand pricing for variable load
4. **Textract**: Batch process documents when possible

## Future Enhancements

- [ ] Add Step Functions for complex workflows
- [ ] Implement real-time processing dashboard
- [ ] Support for additional document types
- [ ] Machine learning model training on extracted data
- [ ] API Gateway for external integrations
- [ ] Multi-language support
- [ ] Custom entity recognition models
- [ ] Automated document classification

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/Enhancement`)
3. Write tests for new functionality
4. Commit changes (`git commit -m 'Add Enhancement'`)
5. Push to branch (`git push origin feature/Enhancement`)
6. Open Pull Request

## License

Copyright © 2024 Samu Legal Technology. All rights reserved.

---

*Maintained by Samu Legal Technology Development Team*