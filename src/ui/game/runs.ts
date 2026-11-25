/**
 * Lines of the Chronicle that say the same thing at the same hour, gathered into one.
 *
 * On a spring morning the engine logs "A root patch began to recover." once for every patch that
 * did, and a page of them pushes everything else out of sight. They are the same sentence about
 * different places, so they are shown as one line with a count, and can be opened out again:
 * nothing is dropped. A line with a recorded cause is never gathered — its "what led to this" is
 * its own.
 */
export interface Run<T> {
  first: T;
  /** The other lines of the run, in the order they were shown. */
  rest: T[];
}

export function runsOf<T extends { text: string; tick: number; parents: readonly number[] }>(entries: readonly T[]): Run<T>[] {
  const out: Run<T>[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && e.parents.length === 0 && last.first.parents.length === 0 && last.first.tick === e.tick && last.first.text === e.text) last.rest.push(e);
    else out.push({ first: e, rest: [] });
  }
  return out;
}
