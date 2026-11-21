# csv-reader-v1

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Brackenzig/csv-reader-v1/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Brackenzig/csv-reader-v1/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0: `solve.js` answers every case exactly as
csv-reader does (`{columns, rows, errors}` for `{text, header}`), but reads the
text with `indexOf` jumps and `slice()` instead of one character at a time.

How it stays exact while going fast:

- Unquoted fields are found with two `indexOf` calls (next comma, next line
  break) and cut out with one `slice`; a CR inside the cut span is a stray CR
  and is dropped with its error.
- Each record's first line break is found once and reused as the candidate
  record end, so later fields of the record need only the comma search; a
  quoted field that spans a line break drops the candidate and the fields after
  it go back to finding their own break.
- A record whose span holds no CR skips the per-field CR scan entirely.
- Quoted fields find their closing quote with `indexOf('"')`, doubling `""`
  to one quote; CRLF and lone CR inside become LF, and the line count follows.
  A quote that never closes is a literal character and the text after it is
  read again as unquoted; junk after a closing quote is appended as it stands.

Measured locally (Node, `--no-incremental-marking`, the practice set of 6 cases,
10.19 MB): **~66 ms median** against csv-reader 1.0.0's ~464 ms on the same
machine — about 5–7x faster, at 154 MB/s. Correctness is verified against the
reference on the practice set (6/6), on 6,061 hand-built and fuzzed edge cases,
and on 30 fresh cases drawn from the kit's own generator with new seeds.

## Run it

```sh
node --experimental-strip-types main.ts
```

(Or on Node 22.18+: `node main.ts`. The harness runs `node /bot/main.ts` with
`/input/cases.json` in and `/output/answers.json` out.)

---

<sub>Entered on [make.fun](https://make.fun/?ref=atc4awx9&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
