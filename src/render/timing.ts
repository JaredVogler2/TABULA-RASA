/**
 * How long a frame is taken to have lasted, in seconds.
 *
 * What is animated — a walk, a wave, a flame — takes steps of a tenth of a second at most, so that
 * nothing leaps after a stall. The camera is different: it eases toward where it should be, an easing
 * that cannot overshoot however long the step, and it is given the time that has really passed. With
 * its step capped as well it fell behind whoever it was following whenever frames were slow (a
 * software renderer, an old phone): at four frames a second a walker it was "following" drifted a
 * tile or more from the middle of the picture.
 *
 * The camera's step still has a ceiling, so that a tab left for an hour comes back to a camera that
 * is where it should be and nothing else is asked to believe in an hour-long frame.
 */
export function frameSteps(intervalMs: number): { animation: number; camera: number } {
  const seconds = Math.max(0, intervalMs) / 1000;
  return { animation: Math.min(0.1, seconds), camera: Math.min(1, seconds) };
}
