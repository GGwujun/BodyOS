export function observedWeightChange(weights: number[]): number | null {
  return weights.length < 2 ? null : weights[weights.length - 1] - weights[0];
}
