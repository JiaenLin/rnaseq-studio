// The in-browser DESeq2 path, run against real R.
//
// The R in lib/deseq.ts is a template string; nothing else in this suite
// executes it. What is pinned here is the property that made ashr unusable and
// the one that replaced it: with shrinkage off the exported fold change IS the
// maximum likelihood estimate, and with apeglm on it moves toward zero while
// the MLE is still exported beside it — because the cross-block view compares
// effect sizes BETWEEN fits and cannot use values each pulled toward their own
// fit's prior by a different amount.
//
// Skips itself when R, DESeq2 or apeglm are missing, so a machine without them
// does not fail the build.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const WORK = join(process.env.SHRINK_WORK || tmpdir(), 'rnaseq-studio-shrink')
let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const has = expr => {
  try {
    return execFileSync('Rscript', ['-e', `cat(${expr})`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'TRUE'
  } catch { return false }
}
console.log('\nIN-BROWSER DESeq2 — SHRINKAGE')
if (!has('"DESeq2" %in% rownames(installed.packages())')) {
  console.log('  --   R with DESeq2 not found; skipping\n')
  process.exit(0)
}
const HAVE_APEGLM = has('"apeglm" %in% rownames(installed.packages())')

const src = readFileSync(new URL('../src/lib/deseq.ts', import.meta.url), 'utf8')
const lift = n => {
  const m = src.match(new RegExp(`const ${n} = \\\`([\\s\\S]*?)\\\`\\n`))
  if (!m) throw new Error(`could not lift ${n} out of deseq.ts`)
  return m[1]
}
rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

// Three groups, so the cell-means design has a contrast that is not a
// coefficient — the situation apeglm has to be reached through.
let seed = 11
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())
const samples = ['a1','a2','a3','b1','b2','b3','c1','c2','c3']
const cond = Object.fromEntries(samples.map(s => [s, { a: 'A', b: 'B', c: 'C' }[s[0]]]))
const rows = ['gene_id,' + samples.map(s => `"${s}"`).join(',')]
for (let g = 0; g < 3000; g++) {
  const base = [5, 20, 200, 2000][g % 4]
  const de = g < 300
  const cells = samples.map(s => {
    const mu = base * (de && cond[s] === 'B' ? 3 : 1)
    return String(Math.max(0, Math.round(mu + gauss() * mu * 0.35)))
  })
  rows.push(`"G${String(g).padStart(4, '0')}",${cells.join(',')}`)
}
writeFileSync(join(WORK, 'counts.csv'), rows.join('\n') + '\n')
writeFileSync(join(WORK, 'coldata.csv'),
  'sample,cond\n' + samples.map(s => `"${s}","${cond[s]}"`).join('\n') + '\n')
writeFileSync(join(WORK, 'contrast.csv'), 'level,weight\nB,1\nA,-1\n')

const KEY = JSON.stringify(JSON.stringify(['k', samples, samples.map(s => cond[s])]))
const fitR = lift('FIT_R').replace('__KEY__', KEY).replaceAll('/work/', `${WORK}/`)
const runBoth = shrink => {
  const ex = lift('EXTRACT_R').replace('__SHRINK__', shrink).replaceAll('/work/', `${WORK}/`)
  // invisible(), because FIT_R's `local({...})` auto-prints its status line and
  // stdout must be the extract's return value alone — the same string
  // evalRString hands back in the browser.
  writeFileSync(join(WORK, 'run.R'), `invisible(${fitR})\ncat(${ex})\n`)
  const out = execFileSync('Rscript', ['--vanilla', join(WORK, 'run.R')],
    { encoding: 'utf8', maxBuffer: 1 << 28 }).trim().split('\n').pop()
  const t = readFileSync(join(WORK, 'deg.csv'), 'utf8').trim().split('\n')
  const h = t[0].replace(/"/g, '').split(',')
  const iL = h.indexOf('log2FoldChange'), iM = h.indexOf('log2FoldChange_MLE'), iP = h.indexOf('padj')
  const rowsOut = t.slice(1).map(l => l.split(',')).map(c => ({
    lfc: Number(c[iL]), mle: Number(c[iM]), padj: c[iP],
  })).filter(r => Number.isFinite(r.lfc) && Number.isFinite(r.mle))
  const [n, tag] = out.split('|')
  return { tag, nDeg: Number(n), rows: rowsOut }
}

const none = runBoth('none')
check('the MLE columns are exported', none.rows.length > 1000, true)
check('with shrinkage off the run reports "mle"', none.tag, 'mle')
check('and log2FoldChange IS the MLE, exactly',
  none.rows.every(r => Math.abs(r.lfc - r.mle) < 1e-9), true)

if (HAVE_APEGLM) {
  const ape = runBoth('apeglm')
  check('with apeglm the run reports "apeglm"', ape.tag, 'apeglm')
  check('apeglm actually moved the estimates',
    ape.rows.filter(r => Math.abs(r.lfc - r.mle) > 1e-6).length > ape.rows.length / 2, true)
  check('and it pulls toward zero',
    ape.rows.filter(r => Math.abs(r.lfc) <= Math.abs(r.mle) + 1e-6).length > ape.rows.length * 0.99, true)
  // The MLE must survive shrinkage, or the cross-block comparison has nothing
  // safe to use.
  const byMle = new Map(none.rows.map((r, i) => [i, r.mle]))
  check('the MLE column is unchanged by shrinking',
    ape.rows.every((r, i) => Math.abs(r.mle - byMle.get(i)) < 1e-9), true)
  // Shrinkage replaces the effect size only — the test is the same test.
  check('the DEG count does not depend on shrinkage', ape.nDeg, none.nDeg)
} else {
  console.log('  --   apeglm not installed; its path is skipped')
}

rmSync(WORK, { recursive: true, force: true })
console.log(failed ? `\n${failed} shrinkage test(s) failed\n` : '\nAll shrinkage tests passed\n')
process.exit(failed ? 1 : 0)
