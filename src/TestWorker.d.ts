import DriverTestWorker from 'tape-six/driver/TestWorker.js';
import type {Browser, BrowserContext} from 'playwright';

/**
 * Engines this provider can drive: Chromium, Firefox, and WebKit — all three
 * through Playwright's uniform driver API.
 */
export const supportedBrowsers: string[];

/**
 * Playwright adapter for tape-six's browser-driver kit: the shared task
 * lifecycle (per-task BrowserContext + Page, completion driven by the page
 * `close` event, cooperative drain / force-kill) lives in the base class;
 * this subclass supplies the driver-specific members. See ARCHITECTURE.md.
 */
export class TestWorker extends DriverTestWorker {
  /**
   * Launch the named engine headless (`--no-sandbox` on Chromium); wraps a
   * launch failure with an `npx playwright install` remediation hint.
   */
  launchBrowser(name: string, options: {insecure: boolean}): Promise<Browser>;

  /** Isolated context per task; `insecure` maps to `ignoreHTTPSErrors` (the h2 self-signed cert). */
  newContext(browser: Browser, options: {insecure: boolean}): Promise<BrowserContext>;

  /** The launched browser; `null` until the first task and after `cleanup()`. */
  browser: Browser | null;
}

export default TestWorker;
