// DESeq2 in the browser, via webR — for comparisons the pipeline did not export.
//
// A 23-arm design has hundreds of possible pairs and no pipeline exports them
// all. Rather than approximate the missing ones with a lighter test, we run the
// real thing: R 4.6.0 compiled to WebAssembly, with the same DESeq2 the upstream
// analysis used. Results are therefore directly comparable with the contrasts
// already in the bundle.
//
// DESeq2 models raw counts and derives its own size factors, so this needs
// `raw_counts.csv`. Feeding it the normalized matrix would silently violate the
// negative-binomial assumptions, so a bundle without raw counts simply cannot
// compute new pairs — the UI says so rather than substituting something weaker.

import type { CountsMatrix, DEGRow, SampleRow } from '../types'

const WEBR_URL = 'https://webr.r-wasm.org/v0.6.0/webr.mjs'
// Our own WASM repo (hosts the locfit stub DESeq2 imports), served with the app.
// Resolved lazily: this module's pure helpers are unit-tested outside a browser,
// where `document` does not exist.
const locfitRepo = () => new URL('wasm/', document.baseURI).href.replace(/\/$/, '')

let webRPromise: Promise<any> | null = null
let installed = false

async function getWebR(log: (m: string) => void): Promise<any> {
  if (!webRPromise) {
    webRPromise = (async () => {
      log('Loading R 4.6.0 (WebAssembly)…')
      const mod: any = await import(/* @vite-ignore */ WEBR_URL)
      const webR = new mod.WebR()
      await webR.init()
      log('R ready.')
      return webR
    })()
  }
  return webRPromise
}

async function ensureDESeq2(webR: any, log: (m: string) => void) {
  if (installed) return
  log('Installing DESeq2 + apeglm… (first run downloads ~tens of MB, then cached)')
  await webR.installPackages(['DESeq2', 'apeglm'], {
    repos: [locfitRepo(), 'https://bioc.r-universe.dev', 'https://repo.r-wasm.org'],
  })
  installed = true
}

// Default parametric dispersion fitting never calls locfit; the rare fallback
// path does, and locfit is a stub in this build, so retry with the "mean" fit.
const DESEQ_R = `local({
  suppressMessages(library(DESeq2))
  REF <- __REF__
  counts <- round(as.matrix(read.csv("/work/counts.csv", row.names = 1, check.names = FALSE)))
  storage.mode(counts) <- "integer"
  cd <- read.csv("/work/coldata.csv", stringsAsFactors = FALSE, check.names = FALSE)
  rownames(cd) <- cd$sample
  counts <- counts[, cd$sample, drop = FALSE]
  keep <- rowSums(counts) > 0
  counts <- counts[keep, , drop = FALSE]
  cd$condition <- relevel(factor(cd$condition), ref = REF)
  dds <- DESeqDataSetFromMatrix(counts, cd, ~condition)
  dds <- tryCatch(DESeq(dds, quiet = TRUE),
                  error = function(e) suppressWarnings(DESeq(dds, fitType = "mean", quiet = TRUE)))
  res <- as.data.frame(results(dds))
  write.csv(data.frame(gene_id = rownames(res), gene_name = rownames(res),
            baseMean = round(res$baseMean, 3), log2FoldChange = round(res$log2FoldChange, 5),
            lfcSE = round(res$lfcSE, 5), pvalue = res$pvalue, padj = res$padj),
            "/work/deg.csv", row.names = FALSE)
  sprintf("%d", sum(res$padj < 0.05, na.rm = TRUE))
})`

export interface DeseqRequest {
  raw: CountsMatrix
  samples: SampleRow[]
  numerator: string
  denominator: string
}

/** Run DESeq2 for one pair. Only the two groups' samples are sent to R. */
export async function runDESeq2(
  { raw, samples, numerator, denominator }: DeseqRequest,
  log: (m: string) => void,
): Promise<DEGRow[]> {
  const cond: Record<string, string> = {}
  for (const s of samples) cond[s.sample] = s.condition
  const cols = raw.samples
    .map((s, j) => ({ s, j, c: cond[s] ?? '' }))
    .filter(x => x.c === numerator || x.c === denominator)

  const nNum = cols.filter(x => x.c === numerator).length
  const nDen = cols.filter(x => x.c === denominator).length
  if (nNum < 2 || nDen < 2)
    throw new Error(`DESeq2 needs at least 2 replicates per group (${numerator}: ${nNum}, ${denominator}: ${nDen}).`)

  const webR = await getWebR(log)
  await ensureDESeq2(webR, log)

  // Raw counts for just these samples, as CSV for R.
  const S = raw.samples.length
  const header = ['gene_id', ...cols.map(c => JSON.stringify(c.s))].join(',')
  const lines = new Array<string>(raw.geneIds.length + 1)
  lines[0] = header
  for (let i = 0; i < raw.geneIds.length; i++) {
    const base = i * S
    const cells = new Array<string>(cols.length + 1)
    cells[0] = JSON.stringify(raw.geneIds[i])
    for (let k = 0; k < cols.length; k++) cells[k + 1] = String(Math.round(raw.values[base + cols[k].j]))
    lines[i + 1] = cells.join(',')
  }
  const coldata = 'sample,condition\n' +
    cols.map(c => `${JSON.stringify(c.s)},${JSON.stringify(c.c)}`).join('\n') + '\n'

  try { await webR.FS.mkdir('/work') } catch { /* exists */ }
  const enc = new TextEncoder()
  await webR.FS.writeFile('/work/counts.csv', enc.encode(lines.join('\n') + '\n'))
  await webR.FS.writeFile('/work/coldata.csv', enc.encode(coldata))

  log(`Running DESeq2 — ${numerator} (n=${nNum}) vs ${denominator} (n=${nDen})…`)
  const nDeg = await webR.evalRString(DESEQ_R.replace('__REF__', JSON.stringify(denominator)))
  const csv = new TextDecoder().decode(await webR.FS.readFile('/work/deg.csv'))
  log(`Done — ${nDeg} genes at padj < 0.05.`)
  return parseDegCsv(csv)
}

const num = (v: string): number | null => {
  const t = v.trim().replace(/^"|"$/g, '')
  if (!t || t === 'NA') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parseDegCsv(text: string): DEGRow[] {
  const lines = text.trim().split(/\r?\n/)
  const out: DEGRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    const id = c[0].replace(/^"|"$/g, '')
    out.push({
      gene_id: id,
      gene_name: c[1].replace(/^"|"$/g, '') || id,
      baseMean: num(c[2]) ?? 0,
      log2FoldChange: num(c[3]) as number,
      lfcSE: num(c[4]),
      pvalue: num(c[5]),
      padj: num(c[6]),
    })
  }
  return out
}

export const computedContrastId = (numerator: string, denominator: string) =>
  `~deseq2:${numerator}_vs_${denominator}`

export const isComputedContrast = (id: string) => id.startsWith('~deseq2:')

export const countSignificant = (rows: DEGRow[], padjMax = 0.05, lfcMin = 1) =>
  rows.reduce((a, r) =>
    a + (r.padj != null && r.padj < padjMax && Math.abs(r.log2FoldChange) >= lfcMin ? 1 : 0), 0)
