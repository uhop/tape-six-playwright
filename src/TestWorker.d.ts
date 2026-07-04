import EventServer, {EventServerOptions, EventServerReporter} from 'tape-six/utils/EventServer.js';
import type {Browser, BrowserContext, Page} from 'playwright';

/**
 * The base options bag is deliberately open (`[key: string]: unknown` —
 * "runners pass their own keys through"); merging the keys `TestWorker`
 * reads gives them real types on `this.options` for `js-check` and
 * plain-JS consumers — cast-free (the tape-six-proc augmentation shape).
 */
declare module 'tape-six/utils/EventServer.js' {
  interface EventServerOptions {
    /** Engine to launch — one of `supportedBrowsers` (default: `'chromium'`). */
    browser?: string;
    /** Base URL of the tape6 server the tests are loaded from. */
    serverUrl?: string;
    /** Import map injected into generated test pages. */
    importmap?: object | null;
    /** Reporter flags forwarded to the in-page tape-six. */
    flags?: string;
  }
}

/**
 * Engines this provider can drive: Chromium, Firefox, and WebKit — all three
 * through Playwright's uniform driver API.
 */
export const supportedBrowsers: string[];

/**
 * Playwright-backed test worker: each task runs in its own BrowserContext +
 * Page (the test itself in an iframe inside that page); completion is driven
 * by the page `close` event. See ARCHITECTURE.md.
 */
export class TestWorker extends EventServer {
  constructor(reporter: EventServerReporter, numberOfTasks?: number, options?: EventServerOptions);

  /** The launched browser; `null` until the first task and after `cleanup()`. */
  browser: Browser | null;

  // Per-task bookkeeping — not a consumer surface.
  counter: number;
  tasks: Record<string, {context: BrowserContext; page: Page}>;
  graceTimers: Record<string, ReturnType<typeof setTimeout>>;

  /** Close the launched browser and drop all task tracking. */
  cleanup(): Promise<void>;
}

export default TestWorker;
