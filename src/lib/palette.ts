// Deterministic condition → colour mapping, shared by every plot so a condition
// keeps the same colour across the expression plot, PCA, and legends.
const PALETTE = [
  '#4393c3', '#d6604d', '#74c476', '#f4a582', '#9970ab',
  '#35978f', '#bf812d', '#c51b7d', '#4d9221', '#2166ac',
]

/**
 * Beyond the hand-picked palette, generate more hues rather than wrapping — a
 * combinatorial design can easily have 20+ arms, and repeating a colour makes two
 * different treatment groups look like the same one. Uses the golden-angle
 * sequence so successive hues stay far apart, alternating lightness/saturation
 * so neighbours differ on a second axis too.
 */
function extendedColor(i: number): string {
  const k = i - PALETTE.length
  const hue = ((k * 137.508) % 360) / 360
  const sat = (52 + (k % 3) * 12) / 100
  const light = (42 + (k % 2) * 14) / 100
  return hslToHex(hue, sat, light)
}

// Hex, not hsl(): call sites build translucent fills by appending an alpha pair
// (`colors[c] + '22'`), which only works on a hex string.
function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function conditionColors(conditions: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  conditions.forEach((c, i) => { out[c] = i < PALETTE.length ? PALETTE[i] : extendedColor(i) })
  return out
}

export const SIG_COLORS = {
  up: '#d6604d',
  down: '#4393c3',
  ns: '#cbd5e1',
}
