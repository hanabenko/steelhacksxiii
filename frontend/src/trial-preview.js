/** Presentation only: sampling never reduces the number of calculated trials. */
export function trialPreviewPlan(runs) {
  if (!Number.isInteger(runs) || runs < 1) throw new Error('Expected a positive trial count.');
  const sampled = runs >= 150;
  const count = sampled ? 30 : runs;
  const durationMs = sampled ? 1500 : 3000;
  return {
    sampled, count, durationMs,
    delayMs: durationMs / count,
    checkpoints: Array.from({length: count}, (_, i) => Math.ceil((i + 1) * runs / count)),
    label: sampled ? `Illustrating ${count} sampled rounds · calculating all ${runs}` : `Fast preview · ${runs} rounds`,
  };
}
