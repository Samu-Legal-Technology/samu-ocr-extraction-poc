export function sanitizeExpenseValue(value: string) {
  return value.replaceAll(/[\$,]/g, '').trim();
}
