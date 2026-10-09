import assert from 'node:assert/strict';

export function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
export function jsonRequestBody<T>(body: BodyInit | null | undefined): T {
  assert.equal(typeof body, 'string', 'fixture expects a JSON text request body');
  if (typeof body !== 'string') throw Error('Expected JSON text request body');
  return JSON.parse(body) as T;
}
