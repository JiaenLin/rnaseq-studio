/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Scientific slate + indigo accent, tuned for light and dark.
        ink: { DEFAULT: '#0f172a', soft: '#334155', mute: '#64748b' },
        line: '#e2e8f0',
        up: '#d6604d',   // higher in numerator
        down: '#4393c3', // higher in denominator (control)
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
