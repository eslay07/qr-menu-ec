/** Preserve the task failure when safety cleanup also fails. */
export async function cleanupResult(primaryError, cleanup) {
  try { await cleanup(); } catch (cleanupError) {
    if (primaryError !== undefined) throw new AggregateError([primaryError, cleanupError], 'Task and cleanup failed.');
    throw cleanupError;
  }
}
