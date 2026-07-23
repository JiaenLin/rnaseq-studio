// Deterministic condition → colour mapping, shared by every plot so a condition
// keeps the same colour across the expression plot, PCA, and legends.
const PALETTE = [
  '#4393c3', '#d6604d', '#74c476', '#f4a582', '#9970ab',
  '#35978f', '#bf812d', '#c51b7d', '#4d9221', '#2166ac',
]

export function conditionColors(conditions: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  conditions.forEach((c, i) => { out[c] = PALETTE[i % PALETTE.length] })
  return out
}

export const SIG_COLORS = {
  up: '#d6604d',
  down: '#4393c3',
  ns: '#cbd5e1',
}
