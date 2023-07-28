import { marshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'crypto';

export function sanitizeExpenseValue(value: string) {
  return value.replaceAll(/[\$,]/g, '').trim();
}

export function generateId(key: string) {
  const hash = crypto.createHash('sha256');
  hash.update(key);
  return hash.digest('hex');
}

export function toDynamo(obj: any) {
  return marshall(obj, {
    convertClassInstanceToMap: true,
    convertEmptyValues: true,
  });
}

export function dedup<T>(items: T[], hasher: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const hash = hasher(item);
    return seen.has(hash) ? false : seen.add(hash);
  });
}
