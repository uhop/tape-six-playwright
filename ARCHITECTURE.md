# Architecture

`tape-six-playwright` is the browser worker provider for [tape-six](https://github.com/uhop/tape-six): it runs each test file in its own browser context — a separate page and iframe with isolated cookies and storage — in a headless engine driven by Playwright (Chromium, Firefox, or WebKit, all through Playwright's uniform driver API), on Node, Deno, and Bun. Runtime dependencies are minimal by design: `tape-six` (the core test library) and `playwright` (browser automation).

## Project layout

```
tape-six-playwright/
├── package.json          # Package config; "tape6" section configures test discovery
├── tsconfig.check.json   # js-check config (TypeScript as linter for .js sources)
├── bin/
│   ├── tape6-playwright.js      # CLI entry point (--self flag or delegates to tape6-playwright-node.js)
│   └── tape6-playwright-node.js # Main CLI: config, reporter, server handshake, test execution
├── src/
│   ├── TestWorker.js     # TestWorker class: launches the browser, runs tests in per-context iframes
│   └── controlFetch.js   # Control-plane client: cert-tolerant https GETs for the runner's server requests
├── tests/                # Automated tests (test-*.js, test-*.mjs, test-*.html);
│                         # tests/manual/ holds hand-runnable control-channel fixtures
└── wiki/                 # GitHub wiki documentation (submodule)
```

## Control flow

- `bin/tape6-playwright.js` is the CLI entry point. It handles `--help`, `--version`, and `--self` (prints its own path for cross-runtime usage) directly; otherwise it delegates to `bin/tape6-playwright-node.js`.
- `bin/tape6-playwright-node.js` delegates argument parsing and reporter setup to `tape-six/utils/config.js` (`getOptions`, `initReporter`, `showInfo`). It resolves the server protocol the way `tape6-server` does (`--h2` > `TAPE6_PROTOCOL` > `tape6.server.protocol` config > `h1`), upgrading the server URL to `https:` in h2 mode. It ensures `tape6-server` is reachable (auto-spawning it under `--start-server`, with `--h2` passed through; the h2 server mode is Node-only, so under Bun/Deno the server child runs on `node` from `PATH`), fetches the test-file list (`/--tests` or `/--patterns`) and the importmap (`/--importmap`) from the server, then runs tests via `TestWorker`. Control requests go through `src/controlFetch.js`: `https:` uses `node:https` with request-scoped trust — `TAPE6_CERT` pinned as CA when set, else the server's cached self-signed certificate (`node_modules/.cache/tape6/cert.pem`), else relaxed verification — never process-wide.
- `TestWorker` (`src/TestWorker.js`) extends `EventServer` from `tape-six`. It launches one headless browser of the selected engine (`--browser chromium|firefox|webkit`, env `TAPE6_BROWSER`, default `chromium`; precedence CLI > env > default); each test file runs in its own `BrowserContext` → `Page` (created with `ignoreHTTPSErrors` when the server URL is `https:` — the h2 cert ladder ends in a self-signed certificate), with the test itself in an iframe inside that page. `supportedBrowsers` (exported from `src/TestWorker.js`) is the single source of truth the CLI validates against; `--no-sandbox` is applied to Chromium only. Only Chromium is fetched by `postinstall`; a missing or unrunnable engine fails the run with an `npx playwright install` / `install-deps` hint, so the run exits non-zero rather than reporting a false pass.

## Data plane

The page exposes two functions to the browser side: `__tape6_reporter` (the iframe's tape-six detects `window.parent.__tape6_reporter` and proxies test events through it) and `__tape6_error` (load failures). `.html` test files load as the iframe `src` with query parameters (`id`, `test-file-name`, `flags`); `.js`/`.mjs` files get an HTML document written into the iframe with the injected importmap and a dynamic module script. Console messages and page errors are forwarded to the Node console.

## Control plane (worker control channel)

The provider side of tape-six's worker control channel (spec: `dev-docs/worker-control-channel.md` in the tape-six repo). `EventServer` calls `destroyTask(id, reason)`: `done` closes the task's context (normal teardown); an abort reason (`failOnce` / `timeout`) first cooperatively drains the running test — posting `{type: 'tape6-terminate'}` into its iframe so it unwinds at the next assertion and runs cleanup hooks — then, after `graceTimeout` (`TAPE6_GRACE_TIMEOUT`, default 5000 ms), force-kills it by closing the context, the Node-side kill in-page JS can't perform on itself. Completion is keyed off the page **`close` event**, never a reported event: a normal end, a cooperative drain, and a force-kill all end in the context closing, so `close(id)` fires exactly once per task down every path — including the hung-test kill, which emits no test event at all.

## Cross-runtime notes

The CLI uses Node-API-shaped imports (`node:fs`, `node:path`, `node:process`, `node:url`, `node:child_process`) that Node, Bun, and Deno all implement — `npm run test:bun` / `test:deno` run the same `bin/` scripts via `--self`. `src/TestWorker.js` touches only Playwright and tape-six; Playwright's own `.d.ts` pulls in `lib.dom`, so standard DOM code inside `page.evaluate` callbacks type-checks under `js-check` without extra configuration.
