# Acceptance tests (SPEC §15, A1–A27)

Automated Playwright checks for the static game one directory up. Every checklist item is an
independent function in `test/acceptance.cjs`; each opens its own fresh page/browser, so items can be
run alone and in any subset.

## Requirements

- Node 20+ (`node --version`).
- Playwright with a headless Chromium: `require('playwright')` must resolve from `NODE_PATH` or from the
  global install at `/opt/node22/lib/node_modules/playwright` (the harness tries both). Chromium runs
  headless with SwiftShader (`--use-gl=swiftshader`), so GPU fps is never asserted — simulation facts are
  read through `window.__game` and sim time is advanced with `fastForward` / `game.step`.
- No other dependencies: the static server, touch input (CDP `Input.dispatchTouchEvent`) and the PNG
  decoder used for A26 are built in (`pngjs` is used only if it happens to be resolvable).

## Run

```sh
cd games/nba2k-threejs
node test/acceptance.cjs            # all items, A1 → A27, sequential
node test/acceptance.cjs A6 A7      # only these items
node test/acceptance.cjs --keep-shots   # keep A26 screenshots under test/results/shots/
npm test                            # same as the first line
```

Output: one `✅`/`❌` line per item with timing, `⚠` warnings (soft observations such as slow HUD
updates under SwiftShader), and the failure message (expected vs actual). A JSON summary is written to
`test/results/acceptance.json` (`{passed, failed, total, items:[{id, title, ok, ms, error, warnings}]}`).
The process exits non-zero if any item failed.

`A2`/`A3` are static (fs + regex over `src/*.js`, `index.html`, `README.md`, `vendor/`) and need no
browser. All other items require `index.html` and `src/main.js` to exist and fail fast otherwise.

`test/harness.cjs` can also be run on its own for a quick load screenshot + fps sample:
`node test/harness.cjs --device phoneLandscape --out test/shots`.
