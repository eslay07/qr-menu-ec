import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

export function requireVerifiedCandidateIdentity(expectedId, checkedId, before, current) {
  if (checkedId !== expectedId) throw Error('Candidate verification identity mismatch.');
  if (!isDeepStrictEqual(before, current)) throw Error('Production changed during candidate verification.');
}

/** Only a just-created version's documented propagation miss is retryable. */
export async function readCreatedVersion(read, { attempts = 5, wait = milliseconds => delay(milliseconds) } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw Error('Invalid candidate verification attempt limit.');
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await read(); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'Cloudflare operation failed HTTP 404; codes 100146' || attempt === attempts - 1) throw error;
      await wait(1000 * (attempt + 1));
    }
  }
  throw Error('Invalid candidate verification attempt limit.');
}

export async function persistThenReadCandidate(pending, persist, read, options) {
  await persist(pending);
  return readCreatedVersion(read, options);
}
