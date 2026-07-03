# AGENTS.md — tape-six-playwright

> `tape-six-playwright` is a helper for [tape-six](https://github.com/uhop/tape-six) that runs test files in a headless browser via Playwright. Each test file runs in its own browser context (page + iframe) in a headless engine — Chromium, Firefox, or WebKit, selectable via `--browser`. The npm package name is `tape-six-playwright` and the CLI command is `tape6-playwright`.

## Setup

This project uses a git submodule (wiki):

```bash
git clone --recursive https://github.com/uhop/tape-six-playwright.git
cd tape-six-playwright
npm install
```

There is no build step. `npm install` runs `postinstall` which installs Playwright's bundled Chromium. Firefox and WebKit are not installed by default — run `npm run browser:all` (or `npx playwright install firefox webkit`; on Linux add `npx playwright install-deps`) to add them.

On Linux, install each engine's system libraries with `sudo npx playwright install-deps` (or `install-deps <engine>`) — WebKit needs `libevent`, `libavif`, and `libmanette`. Playwright 1.61+ recognizes current distros (including Ubuntu 26.04) and ships native per-distro WebKit builds, so all three engines download and run locally — WebKit no longer needs Docker here.

If an older Playwright rejects the install on a too-new distro (`Playwright does not support chromium on <distro>` — and a failed install first deletes any existing browser builds), force a supported platform string to get past it:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npm ci          # or npm install / browser:all
```

## Commands

- **Install:** `npm install`
- **Test (Node):** `npm test` (runs `tape6-playwright --start-server --flags FO`)
- **Test (Firefox):** `npm run test:firefox` — runs the suite on Firefox (`--browser firefox`)
- **Test (WebKit):** `npm run test:webkit` — runs the suite on WebKit (`--browser webkit`)
- **Test (all engines):** `npm run test:all` — fans out over Chromium, Firefox, and WebKit in one invocation (`--browsers all`)
- **Test (Bun):** `npm run test:bun`
- **Test (Deno):** `npm run test:deno`
- **Install all engines:** `npm run browser:all` (Chromium + Firefox + WebKit)
- **Lint:** `npm run lint` (Prettier check)
- **Lint fix:** `npm run lint:fix` (Prettier write)
- **JS type-check:** `npm run js-check` (`tsc --project tsconfig.check.json` — unused-var / undeclared-ref lint via `checkJs`; available, not part of `npm test`)

## Project structure

```
tape-six-playwright/
├── package.json          # Package config; "tape6" section configures test discovery
├── bin/
│   ├── tape6-playwright.js     # CLI entry point (--self flag or delegates to -node.js)
│   └── tape6-playwright-node.js # Main CLI: config, reporter, server, test execution
├── src/
│   ├── TestWorker.js     # TestWorker class: launches the selected engine, runs each test in its own context
│   └── controlFetch.js   # Control-plane client: cert-tolerant https GETs for the runner's server requests
├── tests/                # Test files (test-*.js, test-*.mjs, test-*.html)
├── wiki/                 # GitHub wiki documentation (submodule)
├── README.md
└── LICENSE
```

## Code style

- **ES modules** throughout (`"type": "module"` in package.json).
- **Prettier** for formatting (see `.prettierrc`).
- Imports at the top of files, using `import` syntax.
- **No narrating comments.** Comments are short _why_-markers only — a non-trivial decision or constraint, or an algorithm reference. Never restate _what_ the code does; JSDoc only when explicitly requested.
- The package name is `tape-six-playwright` but the CLI command is `tape6-playwright`.

## Architecture

- `bin/tape6-playwright.js` is the CLI entry point. Handles `--help`/`-h`, `--version`/`-v`, and `--self` directly. Otherwise delegates to `bin/tape6-playwright-node.js`.
- `bin/tape6-playwright-node.js` uses `getOptions()` and `initReporter()` from `tape-six` for CLI parsing and reporter setup. Resolves the server protocol like `tape6-server` does (`--h2` > `TAPE6_PROTOCOL` > `tape6.server.protocol` config > `h1`; h2 upgrades the server URL to `https:`). Ensures `tape6-server` is running (with optional `--start-server`, passing `--h2` through; the h2 server mode is Node-only, so under Bun/Deno the server child runs on `node`), fetches test files from the server (via `/--patterns` or `/--tests`) and importmap, then runs tests via `TestWorker`. Control requests go through `src/controlFetch.js` — on `https:` it uses `node:https` with request-scoped trust (`TAPE6_CERT` as pinned CA, else the server's cached self-signed cert, else relaxed verification; never process-wide).
- `TestWorker` (in `src/TestWorker.js`) extends `EventServer` from `tape-six`. It launches one headless browser of the selected engine via Playwright; each test file runs in its own `BrowserContext` → `Page` (full origin/storage isolation; `ignoreHTTPSErrors` when the server URL is `https:`), with `__tape6_reporter` and `__tape6_error` exposed as page functions and the test itself in an iframe inside that page.
- **Browser selection:** `--browser <chromium|firefox|webkit>` / `-b` (env `TAPE6_BROWSER`, default `chromium`; precedence CLI > env > default) picks the engine. `TestWorker.#init()` dynamic-picks it via `playwright[name].launch(...)`; `--no-sandbox` is applied to Chromium only (Firefox/WebKit launch without it). `supportedBrowsers` (exported from `src/TestWorker.js`) is the single source of truth the CLI validates against. Only Chromium is fetched by `postinstall`; a missing/unrunnable engine fails the run with an `npx playwright install` / `install-deps` hint (a launch failure reports a failure, so the run exits non-zero rather than a false pass).
- **Multi-engine fan-out:** `--browsers <list|all>` (env `TAPE6_BROWSERS`; overrides `--browser`; duplicates deduped) runs the suite once per engine sequentially — one `TestWorker` and a fresh reporter per engine (`setReporter(null)` + `initReporter()` between runs, so counts and summaries are per-engine) — then prints `Browsers: <name> PASS|FAIL, ...` and exits non-zero if any engine failed. A failed-to-launch engine records FAIL; remaining engines still run.
- For `.html` files: loaded as iframe `src` with query parameters (`id`, `test-file-name`, `flags`).
- For `.js`/`.mjs` files: an HTML document is written into the iframe with an `importmap` and a dynamic module script.
- Unsupported extensions (`.cjs`, `.ts`, `.cts`, `.mts`) are skipped with a warning.
- Each iframe's `tape-six` auto-detects `window.parent.__tape6_reporter` and uses a `ProxyReporter` to send events back.
- **Worker control channel** (`destroyTask(id, reason)`): the provider side of tape-six's control plane (full spec: `dev-docs/worker-control-channel.md` in the tape-six repo). `done` closes the task's context. An abort reason (`failOnce` / `timeout`) first cooperatively drains the running test — posting `{type: 'tape6-terminate'}` into its iframe so it unwinds at the next assertion and runs cleanup hooks — then, after `graceTimeout` (`TAPE6_GRACE_TIMEOUT`, default 5000), force-kills it by closing the context (the Node-side kill in-page JS can't perform on itself). Per-task completion is driven by the page `close` event, never by a reported event, so a force-killed page — which emits nothing — still completes `close(id)` exactly once. The cooperative-drain half needs a `tape-six` that ships the hub control plane; the force-kill backstop is driver-side and version-independent.

## Dependencies

- **`tape-six`** — the core test library. Imports: `State.js`, `utils/EventServer.js`, `utils/config.js` (`getOptions`, `getConfig`, `initReporter`, `showInfo`, `printFlagOptions`, `runtime`), `test.js`, `utils/timer.js`.
- **`playwright`** — headless browser automation (Chromium, Firefox, WebKit). Bundled Chromium is installed via `postinstall`; Firefox and WebKit are fetched on demand (`npm run browser:all`).

## Server

`tape6-playwright` requires `tape6-server` (from `tape-six`) to serve test files to the browser.

- `--start-server` flag auto-starts the server.
- Without it, the server must be running. The runner prints instructions if it's unreachable.
- Server URL: `--server-url URL` (`-u`), `TAPE6_SERVER_URL` env var, `HOST`/`PORT`, or default `http://localhost:3000`.
- Server endpoints used: `GET /--tests` (test file list), `GET /--patterns?q=...` (filtered file list), `GET /--importmap` (import map).
- HTTP/2 (tape-six 1.12+): `--h2`, `TAPE6_PROTOCOL=h2`, or `tape6.server.protocol` config. Self-signed certs are handled automatically (browser contexts: `ignoreHTTPSErrors`; control requests: `TAPE6_CERT` > cached server cert > relaxed, scoped to those requests). HTTP/1.1 stays the default.

## Writing tests

Tests are standard `tape-six` tests that run in a real browser environment:

```js
import test from 'tape-six';

test('DOM example', t => {
  const el = document.createElement('div');
  el.textContent = 'hello';
  t.equal(el.textContent, 'hello', 'element works');
});
```

- `.js` and `.mjs` files run as ES modules in an iframe with an injected importmap.
- `.html` files are loaded directly as iframe src.
- Test file naming convention: `test-*.js`, `test-*.mjs`, `test-*.html`.
- Tests are configured in `package.json` under the `"tape6"` section (same as `tape-six`).

## Key conventions

- Do not add dependencies unless absolutely necessary.
- The `--self` flag prints the path to `tape6-playwright.js` for use in cross-runtime scripts (Bun, Deno).
- Wiki documentation lives in the `wiki/` submodule.
- Environment variables use the `TAPE6_` prefix (shared with `tape-six`).
- Configuration is read from `tape6.json` or the `"tape6"` section of `package.json` (same as `tape-six`).
