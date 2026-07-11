// @ts-self-types="./TestWorker.d.ts"

import * as playwright from 'playwright';

import DriverTestWorker from 'tape-six/driver/TestWorker.js';

// Single source of truth for the `--browser` choice: the CLI validates against
// this and the kit resolves the engine from it. Playwright drives all three;
// the sibling tape-six-puppeteer exposes the same contract minus `webkit`.
export const supportedBrowsers = ['chromium', 'firefox', 'webkit'];

// The four-member adapter for tape-six's browser-driver kit — the shared task
// lifecycle (contexts, iframes, control plane) lives in the base class.
export class TestWorker extends DriverTestWorker {
  supportedBrowsers = supportedBrowsers;
  pageErrorEvent = 'pageerror';
  async launchBrowser(name) {
    // `--no-sandbox` is a Chromium switch; Firefox and WebKit launch without it.
    const launchOptions = {headless: true};
    if (name === 'chromium') launchOptions.args = ['--no-sandbox'];
    try {
      return await playwright[name].launch(launchOptions);
    } catch (error) {
      // The postinstall only fetches Chromium, so the usual causes are a
      // missing engine binary or (on Linux) missing system libraries. Point at
      // both fixes; the wrapped error carries Playwright's own diagnostics.
      throw new Error(
        `Failed to launch ${name} — run \`npx playwright install ${name}\` if it is not ` +
          `installed, or \`npx playwright install-deps ${name}\` if system libraries are missing.\n` +
          (error && error.message ? error.message : String(error))
      );
    }
  }
  async newContext(browser, {insecure}) {
    // h2 mode: the tape6 cert ladder ends in a self-signed cert
    return browser.newContext(insecure ? {ignoreHTTPSErrors: true} : {});
  }
}

export default TestWorker;
