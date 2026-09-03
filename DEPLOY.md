# Deploying to Vercel, with a data space

The studio is a static build. On Vercel it gains one thing GitHub Pages cannot give it:
a **catalogue of published datasets**. Everything else is identical, from the same commit.

## 1 · The deployment

Import the repository into Vercel. `vercel.json` already sets the build, the SPA rewrite and
the two headers that matter:

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Those give `SharedArrayBuffer`, which webR needs to run DESeq2.

**Why `credentialless` and not `require-corp`.** The studio installs R packages from three
hosts. Two of them cooperate; one does not:

| host | header | under `require-corp` |
| --- | --- | --- |
| `webr.r-wasm.org` | `Cross-Origin-Resource-Policy: cross-origin` | loads |
| `bioc.r-universe.dev` | `Access-Control-Allow-Origin: *` | loads |
| `repo.r-wasm.org` | *neither* | **blocked** |

`credentialless` permits the third. Safari does not support it, which is why
`public/coi-serviceworker.min.js` stays in the build: it supplies the headers client-side and
does nothing when `crossOriginIsolated` is already true.

If DESeq2 fails to install after a deploy, check `crossOriginIsolated` in the console before
anything else. Nothing else looks like that failure.

## 2 · Where the data lives

**A dataset is one `.zip`** — the same bundle the studio opens from your disk, and the same
one RNA-seq Lab exports. **A catalogue is one JSON file** listing them.

That is the entire storage design, and it is deliberately not a database: a catalogue of
datasets needs a list, not queries. One file cannot get out of step with itself, cannot be
half-migrated, and can be fixed by hand.

The zips can live anywhere that serves HTTPS — Vercel Blob, S3, Cloudflare R2, a GitHub
release, or `public/` beside the app. Nothing in the code knows which.

The studio looks for the catalogue at **`/catalogue.json`**, so pick whichever of these suits:

| Where the data is | What to do |
| --- | --- |
| Small and fixed | Put the zips and `catalogue.json` in `public/` — and drop the two `.gitignore` lines below, which exist to keep the *demo* space out of the repository |
| A bucket | Add a rewrite in `vercel.json`: `/catalogue.json` → the bucket's URL |
| Listed dynamically | Rewrite `/catalogue.json` → `/api/datasets`, a function that lists the bucket |
| Somewhere else entirely | Set `VITE_CATALOGUE_URL` at build time |

Serving the catalogue and the zips **same-origin through a rewrite** is recommended: the studio
has to *read* those responses, so a cross-origin host must send `Access-Control-Allow-Origin`,
and a rewrite means never thinking about it.

There is no catalogue on GitHub Pages, so `/catalogue.json` 404s there, so the panel does not
render. One build, two deployments, no fork and no build flag.

That property is what `.gitignore` protects. `public/catalogue.json` and `public/datasets/` are
ignored, so nothing you generate locally can reach the public build by accident — and five
invented cohorts can never appear on a public site looking like data.

### Seeing the panel locally

```bash
npm run demo:space   # five simulated bundles + a catalogue, into public/, both ignored
npm run dev
```

The genes in them are real, drawn with their accessions from `public/symbols/*.sym`, so the
mouse sets read `Ucp1` and the human sets `UCP1`; `pbmc-vaccine-d7` carries accessions and no
symbol column, which is how to exercise the conversion by hand. Every row is labelled
**Simulated demo** in the panel. `catalogue.example.json` is the same shape with one real-looking
row, for writing your own against.

### The catalogue format

```json
{
  "name": "Manifold Atlas",
  "updated": "2026-09-03",
  "datasets": [
    {
      "slug": "brown-fat-cold-2026",
      "title": "Brown adipose, cold exposure, Ucp1 knockout",
      "description": "Two genotypes at two temperatures; the interaction is the question.",
      "url": "datasets/brown-fat-cold-2026.zip",
      "species": "mouse",
      "bytes": 1563282,
      "samples": 16,
      "genes": 20134,
      "conditions": ["WT_Thermo", "WT_Cold", "KO_Thermo", "KO_Cold"],
      "contrasts": ["KO vs WT (cold)", "KO vs WT (thermoneutral)", "Interaction"],
      "source": "Lin lab",
      "published": "2026-08-14"
    }
  ]
}
```

`slug`, `title` and `url` are required — an entry without them is dropped and counted, so one
bad row never costs the reader the other twenty. `url` may be relative to the catalogue.
Everything else is there so a person can **choose** without opening three datasets to find one.

## 3 · Publishing a dataset

Today, by hand, which is enough for a lab and has no moving parts:

```bash
# 1. export a bundle from RNA-seq Lab, or zip one you already have
zip -r brown-fat-cold-2026.zip meta.json samples.csv *_counts.csv deg_*.csv

# 2. check it opens BEFORE publishing it — drop it on the studio and click through
#    every tab. A dataset that reaches the catalogue and then opens to an empty
#    plot is the worst outcome available, and this is the step that prevents it.

# 3. put it where the catalogue points, and add the entry
vercel blob put brown-fat-cold-2026.zip     # or: aws s3 cp … / wrangler r2 object put …
```

When that becomes tedious, add `POST /api/upload`: it checks an admin password and returns a
short-lived upload token, and **the browser uploads straight to the bucket**. Do not send the
file through the function — a Vercel serverless request body is capped around 4.5 MB, and while
a 16-sample bundle zips to about 1.5 MB, a 96-sample one is nearer 9 MB and would be refused.

## 4 · Accounts

There are none, and for open data there need not be. If some datasets are not open, the
smallest honest step is a shared access code checked by a function that returns short-lived
URLs — not an account system.
