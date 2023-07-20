export interface TriggerEvent {
  bucket: string;
  key: string;
}

export interface TextractRecord {
  JobId: string;
  Status: string;
  API: string;
  JobTag: string;
  Timestamp: number;
  DocumentLocation: {
    S3ObjectName: string;
    S3Bucket: string;
  };
}
