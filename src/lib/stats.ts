// Small numeric helpers used by the gene-set module score.

export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

export function sd(a: number[], m = mean(a)): number {
  if (a.length < 2) return 0
  return Math.sqrt(a.reduce((s, y) => s + (y - m) ** 2, 0) / (a.length - 1))
}

// Abramowitz–Stegun error-function approximation.
export function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}

// z-score a vector across its own entries (mean 0, sd 1). Constant vectors → zeros.
export function zscore(vals: number[]): number[] {
  const m = mean(vals)
  const s = sd(vals, m) || 1
  return vals.map(v => (v - m) / s)
}

// Combined score = −log10(p-value) × log2 fold change.
// A signed ranking metric: large positive = strongly up-regulated AND significant;
// large negative = strongly down-regulated AND significant.
export function combinedScore(log2fc: number | null, pvalue: number | null): number | null {
  if (log2fc == null || pvalue == null || Number.isNaN(log2fc) || Number.isNaN(pvalue)) return null
  const negLogP = pvalue <= 0 ? 300 : -Math.log10(pvalue)
  return negLogP * log2fc
}

// Welch two-sample test (normal-approximation p-value), b vs a.
export function welchP(a: number[], b: number[]): { t: number; p: number; diff: number } {
  const ma = mean(a), mb = mean(b)
  const va = sd(a, ma) ** 2, vb = sd(b, mb) ** 2
  const se = Math.sqrt(va / a.length + vb / b.length) || 1e-9
  const t = (mb - ma) / se
  const p = Math.min(1, Math.max(2 * (1 - 0.5 * (1 + erf(Math.abs(t) / Math.SQRT2))), 1e-300))
  return { t, p, diff: mb - ma }
}
