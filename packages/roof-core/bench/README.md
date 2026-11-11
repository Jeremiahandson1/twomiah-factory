# Roof engine scoreboard

Scores a roof measuring engine against roofs that were measured professionally (Hover models), so every change to the
engine is judged by numbers rather than by eye.

The test data is private (customer addresses, Hover models, cached Google downloads) and is **not in this repo**. It
lives in the folder `ROOF_TRUTH_DIR` names:

```
<ROOF_TRUTH_DIR>/hover/<job>/model.xml      the XML from inside a Hover .esx export
<ROOF_TRUTH_DIR>/hover/<job>/summary.json   Hover's own summary of the same job (optional; checks the reader)
<ROOF_TRUTH_DIR>/google/<job>/…             Google Solar downloads, written by fetchGoogle.ts
<ROOF_TRUTH_DIR>/results/…                  scoreboard output
```

| Script | What it does | Cost |
|---|---|---|
| `hoverTruth.ts` | Reads the Hover models into an answer key; run directly, it prints each beside Hover's summary | none |
| `fetchGoogle.ts` | Downloads Google Solar data for each answer-key house once (skips what is cached) | 3 Solar calls per new house |
| `score.ts [runs]` | Runs the engine on the cached data and prints its error against the answer key | none |

```
ROOF_TRUTH_DIR=… bun packages/roof-core/bench/hoverTruth.ts
ROOF_TRUTH_DIR=… GOOGLE_SOLAR_API_KEY=… bun packages/roof-core/bench/fetchGoogle.ts
ROOF_TRUTH_DIR=… bun packages/roof-core/bench/score.ts 3
```
