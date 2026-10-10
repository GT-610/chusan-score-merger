# CHUNITHM Score Merger

Merge scores exported from Lxns into a RinNET save file. Everything runs in your browser; no file ever leaves your device.

[简体中文](README.md)

## Highlights

- **Monotonic merge.** Score, clear lamp, FC, AJ and FULL CHAIN each independently keep whichever value is higher. No record can ever be downgraded.
- **Clear state is independent of score.** A failed run with a higher score is still merged, because these are two separate dimensions.
- **Rank is derived from the score.** `scoreRank` is computed from `scoreMax`; the CSV `rank` column is only a cross-check, and a disagreement raises a warning.
- **Play counts are never invented.** This tool has no way to know how many times a chart was really played, so `playCount` is left untouched.
- **Entirely local.** The merge runs in a Web Worker inside your tab. There is no backend.

## Architecture

```text
┌──────────────────────────────────────────────────────────┐
│  Browser tab                                              │
│                                                          │
│  ┌──────────────────┐    postMessage    ┌──────────────┐  │
│  │  Main thread     │──────────────────▶│  Web Worker  │  │
│  │                  │                   │              │  │
│  │  File pickers    │◀──────────────────│  csv.ts      │  │
│  │  Report tables   │   MergeSummary    │  merge.ts    │  │
│  │  Download button │                   │  JSON.parse  │  │
│  └──────────────────┘                   │  JSON.str…   │  │
│         │                              └──────────────┘  │
│         │ Blob + createObjectURL                         │
│         ▼                                                │
│  ┌──────────────────┐                                    │
│  │ *_merged.json    │                                    │
│  └──────────────────┘                                    │
└──────────────────────────────────────────────────────────┘
                          │ static assets only
                          ▼
                ┌───────────────────┐
                │  Cloudflare edge  │
                │ (no Worker code)  │
                └───────────────────┘
```

## Usage

1. Export your save from RinNET as JSON.
2. Export your score list from Lxns as CSV.
3. Open the page, select both files and merge.
4. Review the report, then download the result.
5. Import the new file back into RinNET.

The report shows added records, updated records with a field-by-field before/after diff, enum and rank warnings, and the charts skipped for playlog injection. **Your original save is never modified**; the output is written to a new `{name}_merged.json`.

## Merge Rules

| Field | Rule |
|---|---|
| `scoreMax` | Highest score wins |
| `scoreRank` | Derived from `scoreMax`, never read from the CSV |
| `isSuccess` (lamp) | Higher lamp wins |
| `isFullCombo` | True if any source recorded an FC |
| `isAllJustice` | True if any source recorded an AJ (which implies FC) |
| `fullChain` | Higher grade wins |
| `playCount` | Never modified |

`missCount` is always written, using `0` when there is no FC. The server models these fields as non-null integers in a fixed position, so an omitted field is worse than a zero.

New records are written with a complete field set. `maxComboCount` and `maxChain` stay at `0` — the export carries no combo data, and a plausible-looking number would be a fabrication.

## Score Rank Thresholds

The rank is a strict function of the score. All fourteen grades are non-overlapping:

| Rank | Score range | | Rank | Score range |
|---|---|---|---|---|
| D | 0 – 499,999 | | SS | 1,000,000 – 1,004,999 |
| C | 500,000 – 599,999 | | SS+ | 1,005,000 – 1,007,499 |
| B | 600,000 – 699,999 | | SSS | 1,007,500 – 1,008,999 |
| BB | 700,000 – 799,999 | | SSS+ | 1,009,000 – 1,010,000 |
| BBB | 800,000 – 899,999 | | | |
| A | 900,000 – 924,999 | | | |
| AA | 925,000 – 949,999 | | | |
| AAA | 950,000 – 974,999 | | | |
| S | 975,000 – 989,999 | | | |
| S+ | 990,000 – 999,999 | | | |

The CSV `rank` column is only a cross-check. A row whose rank disagrees with its score is listed under the Warnings tab.

## Playlog Injection

Filling in recent-play entries is on by default and can be switched off in the interface. Two rules apply:

- **Only rows that carry a `play_time` are written.** `upload_time` is not used as a fallback — one upload covers many songs, so it does not mark a moment. Charts without a play time are skipped and listed.
- **ULTIMA is skipped.** The server's recent-play query excludes that difficulty, so such an entry would never be displayed.

`sortNumber` is a session id rather than a timestamp: the three songs of one credit share a value. Injected entries are allocated above the highest existing value. `playDate` is midnight of the play date and `userPlayDate` is the actual moment, both stored without a timezone offset.

## Unknown Values

Unknown enum values fall back to `0` and the merge continues. Every fallback is recorded and listed under the Warnings tab together with the song and the offending value, so a silent downgrade cannot go unnoticed.

## Development

```bash
bun run dev         # dev server
bun test            # 63 tests
bun run typecheck   # tsc --noEmit
bun run build       # static output in dist/
bun run preview     # serve the build
```

### Project layout

```text
src/
  core/          merge kernel: pure functions, no IO
    types.ts       save-data type definitions
    constants.ts   thresholds, lamp and full-chain tables
    csv.ts         RFC 4180 parser
    merge.ts       merge and playlog injection
  worker/        Web Worker entry and its message contract
  ui/            page controller and styles
test/
  core.test.ts       parser and threshold tables
  merge.test.ts      merge rules
  output.test.ts     byte-level checks on the downloaded file
```

The merge kernel is a set of pure functions that touch no IO, clock or randomness, which is what makes it directly unit testable.

## Deployment

`wrangler.jsonc` configures static assets with no Worker script, so the edge serves the bundle without invoking an isolate and Cloudflare counts those requests as free and unmetered. Parsing and re-serialising a multi-megabyte save costs tens of milliseconds, against a 10 ms per-request CPU allowance on the free plan, which a Worker cannot meet reliably. Running on the client also keeps player data off the server.

```bash
bun run build
npx wrangler deploy   # requires a Cloudflare login
```

Do not enable `run_worker_first`: on the free tier it returns a 429 instead of falling back to the static asset, which would take the page down.

## License

[MIT](LICENSE)