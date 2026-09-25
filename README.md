# MVHBS scoring app (v1)

A TypeScript port of the "2026 Live Scores" Google Sheet's scoring engine plus a read-only web
view. The sheet stays the system of record. This app reproduces its output and proves it with a
parity check (`npm run parity`). The full build spec (`SPEC.md`) is kept outside this public repository. Section numbers like §5 refer to it.

**Status:** Weeks 1 and 2 match the sheet on every check: 2,223 player-weeks, 64 D/ST games,
480 grid cells, all slot assignments, and week and season totals. Week 3 hasn't been played yet
(nflverse has no rows for it), so the app shows it as "Not settled" and doesn't assert parity.

## Setup

Node 20 or later. On Ryan's Mac, Node 22 is installed locally at `~/.local/node`, so put it on your PATH first:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
```

```bash
npm install
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run fetch` | Refresh the caches: sheet tabs → `.cache/sheet/`, nflverse stats/PBP/schedule → `.cache/nflverse/` |
| `npm test` | Unit tests (every §5 rule table, every §8 regression) + an end-to-end check on cached real data |
| `npm run parity -- --week 1 --week 2` | Diff the app against the sheet (`--all` = every published week); exits 1 on any mismatch in an asserted week |
| `npm run build:web` | Compute all weeks and write the static site to `dist/` (includes the latest parity reports) |
| `npm run serve` | Serve `dist/` at http://localhost:5173 (read-only; live scoring runs in the page) |
| `npm run typecheck` | `tsc --noEmit` |

### Refreshing nflverse data

nflverse usually publishes a week's stats on Tuesday morning after Monday Night Football. Run
`npm run fetch` (or `npm run fetch -- --nflverse-only`). It downloads:

- `stats_player_week_2026.csv` (nflverse-data `stats_player` release)
- `play_by_play_2026.csv` (streamed. Only REG touchdown plays are kept, for TD distances.)
- `nfldata/games.csv` (schedule and results. A game counts as played only when both scores are filled in.)

A week with **0** stat rows is shown as **Not settled** and scores nothing. A week with stats but
some games still unscored is **Provisional**. A week is **Final** only when every game has a score.

The sheet is read through public CSV exports: visible tabs by gid, hidden tabs through gviz. From
`Config` the app reads only `A1:B5` (season … live_week). The Discord webhook row is never
requested, and nothing is ever written to the sheet.

## Live scores and "My team"

The page scores the current week **live in each viewer's browser**. It calls ESPN's public API
directly and runs the same scoring code as the official build (`src/web/liveEngine.ts`, bundled to
`dist/engine.js`). It also re-reads the sheet's Doublers, Transactions and Rosters tabs, so a
doubler entered on Saturday counts on Sunday without a rebuild. There's no server loop. Any static
host works, and so does `npm run serve` locally.

- It refreshes every 60 s while a game is on and every 10 min otherwise. It re-reads `data.json`
  every 30 min, so Tuesday's official settle replaces the live week automatically.
- A week that nflverse has published is always official and is never overwritten by ESPN.
- Live D/ST win, margin and shutout points follow the *current* score of games in progress, like
  the sheet. Lineup colours appear once every game is final. Everything live is provisional until
  the nflverse settle.
- Games that are already final are cached in the page, so a Sunday refresh only fetches the games
  still being played.

**My team**: pick a team from the header menu (the choice is saved on that device). The page shows:
- the week total and this week's rank
- the season total and rank, with the gap to the next team up
- how many counting players are still to play or playing now
- every counting player, then the bench, each with a live game chip, a box-score line (e.g.
  "169 rush yds, 1 TD · 2 rec, 19 yds") and points. Tap a player for the rule-by-rule breakdown.

Links: `#team/Koo` opens a team directly; `#team/Koo/2` opens a past week.

## Putting it online (GitHub Pages)

`.github/workflows/pages.yml` builds the site and deploys it. It runs on every push to `main`,
Tuesday and Wednesday mornings for the nflverse settle, and on demand. It needs no secrets. One-time setup:

1. Create a GitHub repository and push this folder to its `main` branch.
2. In the repo, go to **Settings → Pages → Source: GitHub Actions**.
3. Go to **Actions → Build and deploy → Run workflow**. The site appears at
   `https://<user>.github.io/<repo>/`.

Free GitHub Pages needs a **public** repository. The site shows league rosters, team names and
scores. `.gitignore` keeps out `SPEC.md` (owner names and email), `.cache/`, `dist/`, `reports/`,
`.env` and local editor settings. The Google Sheet must stay link-viewable ("anyone with the link
can view"): both the build and the live page read it.

`npm run build:web -- --live` also bakes the current ESPN numbers into `data.json`, which is useful
for a snapshot. `npm run parity -- --week 3 --live` compares the live week with the sheet's live
`Week_3` grid. That comparison is informational only.

## Running parity and reading a mismatch

```bash
npm run parity -- --week 2
```

The report lists, in order:

1. **Rules**: checked-in snapshot (`src/engine/rules.snapshot.json`) vs the live `Rules_*` tabs.
2. **Per-player raw scores** vs `Scored_Player_Game`, keyed by nflverse `player_id`. A mismatch
   prints both component breakdowns, e.g. `app: yardage=4 td_distance=9 | sheet: yardage=4 td_distance=2`.
   That example means the sheet floored a TD distance (a PBP gap). Check the `pbp_*` warnings at the top.
3. **Team D/ST** vs `Scored_DST_Game` (score line and win/MOV/shutout/50-burger both sides).
4. **Slot assignment** vs the Points Log `Counted` column (Counted / Bonus / 6th man / Bench).
5. **Grid cells**: row by row (`Koo WR2: app X 12 ≠ sheet Y 12`). A name swap with equal
   points usually means a tie was broken differently, so check roster order and transactions.
6. **Team week totals** and **season totals** (Week_N `New Total` and the Standings week columns).
7. **Points Log per-player sums** (the sheet's own audit lines, re-added).

A week is only *asserted* (non-zero exit on mismatch) once the sheet has moved past it (Config
`live_week` > week, or the Week_N header says "Final"). Use `--force` to assert anyway, and
`--refresh` to fetch before comparing. Each run also writes `reports/parity-wN.{txt,json}`, which
the web UI's Parity page displays.

**Integer display.** The published tabs format points as whole numbers, so 157.5 shows as 158.
Parity accepts a match when the sheet's rounding (half away from zero) of the app value equals the
cell, and lists each such case under *Notes*. The exact values come from the unformatted
`Scored_*` tabs.

## Layout

```
src/engine/   pure scoring engine (no I/O): rules, per-player, D/ST, rosters, lineups, season, Points Log
src/data/     loaders: CSV, sheet tabs (read-only), nflverse downloads
src/parity/   sheet-output parsers + the diff
src/cli/      fetch / parity / buildWeb / serve entry points
src/web/      the UI (plain HTML + ES module) and the in-browser live engine
test/         Vitest (fixtures are in-memory; the real-data tests skip if .cache/ is empty)
```

## Where the spec, the sheet, and the data disagree

Following the spec, the **sheet's output is the truth for parity**. These were found and left as
the sheet has them (or handled without changing any score):

1. **Allens after Week 2 is 311.5, not 312.** Dalton Schultz's W2 is 17.5 (a 12-reception TE
   tier = +11.5). The sheet displays 158/312 because of its integer number format. Every other
   team total in §7 matches exactly.
2. **Josh Allen W1 is 2 passing + 2 rushing TDs in nflverse**, not "3 pass + 2 rush" as §5.1/§8.1
   say. It's still 4 total TDs → +5, and passing-only (the old bug) would give 0, so the fix
   and the test stand.
3. **The sheet's `Team_Games` tab holds unplayed games as 0–0.** `pullTeamGames` checks
   `isNaN(num_(score))`, but `num_('')` returns 0. If the sheet ever scored a week before its games
   were played, every D/ST would get a +5 shutout. It hasn't happened yet: Scored_DST_Game only
   covers W1–2. The app skips blank scores and won't settle the week.
4. **`Rules_Linear` still lists `DST_SACK`, `DST_HALF_SACK`, `DST_INT`, `DST_SPECIAL_TEAMS_TD` under
   position `DST`.** Both engines use those values for IDPs and returners only. Team D/ST scores
   outcomes only (§5.5). The rows are harmless but misleading.
5. **The sheet's Points Log uses the *roster* position** to decide which rules apply, while its
   engine (and this app) uses the *stats* position. They can diverge for a player whose roster
   position differs from nflverse's. The sheet's `Check` column would show `MISMATCH engine=…`.
   None did in W1–2.
6. **The Points Log "Counted" column can be wrong for a benched doubler** when it's rebuilt from the
   formatted grid (`buildPointsLogCurrent`): orange doubler cells are read as "Counted". The
   settle path reads the raw slot colours and is correct. No W1–2 doubler was benched.
7. **§7 describes a per-player summary row in the Points Log. The sheet has none** (the `Check`
   column plays that role). Parity compares per-player sums instead.
8. **§4 says to fail loudly when a DROP matches nobody.** The sheet silently turns the transaction
   into a pure ADD. The app does the same (for parity) and logs `tx_player_not_on_roster`
   prominently on the Audit page.
9. **Config layout differs from §2.1.** It's A1 season, A2 test_week, A3 season_type, A4 source,
   A5 live_week, with the webhook below that.
10. **Published doubler cells show only the doubled points** (e.g. `12`), not `6 × 2 = 12`. The
    formatter converts them. The parser accepts both forms.

11. **The sheet's live parser maps ATL's Brian Robinson Jr. onto rostered Bijan Robinson.** Its
    `rosterMatch_` falls back to "same team, same last name, same first initial". That creates two
    "Bijan Robinson" rows, and whichever comes last in the stats wins the grid lookup. The app
    requires one first name to be a prefix of the other (Cam/Camryn still matches; Brian/Bijan
    doesn't). This affects live scoring only, not nflverse settles.
12. **The ESPN parser accepts two-letter initials** in play text (`Bi.Robinson`, `Br.Robinson`). The
    sheet's regexes only accept one letter. That matters for FG misses and the fallback TD path.

Also surfaced, not bugs: Stefon Diggs (Woo) has no NFL team on the roster and Daniel Carlson
(Koo) is listed as LV but plays for NO. Both match by name only and are logged as `name_only_match`.

## Not in v1

Discord posting, the ESPN IR tab, Power Rankings, and doubler or transaction entry (spec §9).
