/** Database/document scalar conversion; objects must not become [object Object]. */
export function scalarText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  throw new TypeError('Expected scalar text.');
}
