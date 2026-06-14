const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:5177';
const SCREENSHOT_DIR = path.resolve(__dirname, 'audit_screenshots');
const LOG_FILE = path.resolve(__dirname, 'audit_log.txt');
const WIDTH = 1366;
const HEIGHT = 900;

// Screens keyed as { key, label, navType } — navType 'top' or 'side'
const SCREENS = [
  { key: 'dashboard', label: 'Dashboard', navType: 'top' },
  { key: 'markets', label: 'Markets', navType: 'top' },
  { key: 'stock', label: 'Stock Detail', navType: 'top' },
  { key: 'history', label: 'History', navType: 'top' },
  { key: 'screener', label: 'Screener', navType: 'top' },
  { key: 'options', label: 'Options', navType: 'top' },
  { key: 'commodities', label: 'Commodities', navType: 'top' },
  { key: 'arbitrage', label: 'Arbitrage', navType: 'top' },
  { key: 'ai', label: 'AI Copilot', navType: 'top' },
  { key: 'insights', label: 'AI/ML', navType: 'top' },
  { key: 'alerts', label: 'Alerts', navType: 'side' },
  { key: 'portfolio', label: 'Portfolio', navType: 'side' },
  { key: 'journal', label: 'Journal', navType: 'side' },
  { key: 'opening', label: 'Opening Window', navType: 'side' },
  { key: 'flags', label: 'Flags & Warnings', navType: 'side' },
  { key: 'settings', label: 'Settings', navType: 'side' },
  { key: 'admin', label: 'Admin', navType: 'side' },
];

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function sanitize(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function screenshot(page, screenKey, theme, exchange, label) {
  const filename = `${sanitize(screenKey)}_${theme}_${exchange}_${WIDTH}${label ? '_' + sanitize(label) : ''}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  log(`  Screenshot saved: ${filename}`);
  return filepath;
}

async function setTheme(page, theme) {
  try {
    log(`  Switching to ${theme} theme...`);
    // Theme buttons are .th-btn with text "Dark" or "Light"
    const themeBtn = page.locator('.th-btn').filter({ hasText: new RegExp(`^${theme}$`, 'i') });
    await themeBtn.first().waitFor({ state: 'visible', timeout: 5000 });
    await themeBtn.first().click();
    await page.waitForTimeout(800);
    log(`  Theme switched to ${theme}`);
  } catch (err) {
    log(`  WARN: Could not switch to ${theme} theme: ${err.message}`);
  }
}

async function toggleExchange(page) {
  // There's no explicit NSE/BSE toggle visible in the UI.
  // Try to find any exchange-related toggle/button.
  try {
    const exchangeToggle = page.locator('[class*="exchange"], [id*="exchange"], [aria-label*="exchange"i], button:has-text("NSE"), button:has-text("BSE")');
    if (await exchangeToggle.first().isVisible({ timeout: 2000 })) {
      await exchangeToggle.first().click();
      await page.waitForTimeout(500);
      log('  Exchange toggled');
      return true;
    }
  } catch {
    // no-op
  }
  log('  INFO: No exchange toggle found — skipping exchange toggle');
  return false;
}

async function navigateToScreen(page, screen) {
  log(`\n=== Navigating to ${screen.label} (${screen.key}) ===`);
  try {
    if (screen.navType === 'top') {
      // TopNav buttons are .top-nav-tab with text matching label
      const tab = page.locator('.top-nav-tab').filter({ hasText: screen.label });
      await tab.first().waitFor({ state: 'visible', timeout: 8000 });
      await tab.first().click();
    } else {
      // LeftNav buttons are .rail-icon-btn with aria-label matching label
      const btn = page.locator(`.rail-icon-btn[aria-label="${screen.label}"]`);
      await btn.first().waitFor({ state: 'visible', timeout: 8000 });
      await btn.first().click();
    }
    // Wait for screen content to appear
    await page.waitForTimeout(2000);
    // Wait for main content area to update
    await page.waitForSelector('#screens', { state: 'visible', timeout: 10000 });
    // Wait additional time for data to load
    await page.waitForTimeout(5000);
    log(`  Navigated to ${screen.label} successfully`);
    return true;
  } catch (err) {
    log(`  ERROR navigating to ${screen.label}: ${err.message}`);
    return false;
  }
}

async function processScreen(page, screen) {
  const ok = await navigateToScreen(page, screen);
  if (!ok) {
    // Try one more time
    log(`  Retrying navigation to ${screen.label}...`);
    await page.waitForTimeout(2000);
    const ok2 = await navigateToScreen(page, screen);
    if (!ok2) {
      log(`  SKIPPING ${screen.label} due to navigation failure`);
      return;
    }
  }

  // Collect console errors
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(`[CONSOLE ERROR] ${msg.text()}`);
    }
  });

  try {
    // Screenshot 1: Dark theme (default)
    await setTheme(page, 'Dark');
    await screenshot(page, screen.key, 'dark', 'nse', '');

    // Screenshot 2: Light theme
    await setTheme(page, 'Light');
    await screenshot(page, screen.key, 'light', 'nse', '');

    // Screenshot 3: Warm theme (not available — skip gracefully)
    try {
      log('  Attempting warm theme...');
      await setTheme(page, 'Warm');
    } catch {
      log('  INFO: Warm theme not available');
    }
    await screenshot(page, screen.key, 'warm', 'nse', '');

    // Switch back to Dark for exchange screenshots
    await setTheme(page, 'Dark');

    // Screenshot 4: Try BSE toggle
    const toggled = await toggleExchange(page);
    if (toggled) {
      await screenshot(page, screen.key, 'dark', 'bse', '');
      // Toggle back to NSE
      await toggleExchange(page);
    } else {
      // Take a screenshot anyway with bse label to note it wasn't available
      await screenshot(page, screen.key, 'dark', 'bse', 'no_toggle');
    }
  } catch (err) {
    log(`  ERROR during screenshot capture for ${screen.label}: ${err.message}`);
  }

  if (errors.length) {
    log(`  Console errors for ${screen.label}:`);
    errors.forEach((e) => log(`    ${e}`));
  }

  // Check for visible error messages on the page
  try {
    const errorElements = await page.locator('[class*="error"], [class*="Error"], [class*="err"], [class*="toast"]').all();
    for (const el of errorElements) {
      if (await el.isVisible()) {
        const text = await el.textContent();
        if (text && text.trim()) {
          log(`  Visible error/warning on ${screen.label}: "${text.trim()}"`);
        }
      }
    }
  } catch {
    // ignore
  }
}

async function run() {
  // Ensure screenshot directory exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // Clear previous log
  fs.writeFileSync(LOG_FILE, '');

  log('=== Derton Finance Playwright Audit Script ===');
  log(`Base URL: ${BASE_URL}`);
  log(`Screenshots: ${SCREENSHOT_DIR}`);
  log(`Viewport: ${WIDTH}x${HEIGHT}`);
  log('');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Collect all console messages
  const allConsoleMessages = [];
  page.on('console', (msg) => {
    allConsoleMessages.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });

  page.on('pageerror', (err) => {
    log(`  PAGE ERROR: ${err.message}`);
  });

  try {
    // === 1. Open the app ===
    log('Step 1: Opening app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    log('  Page loaded');

    // === 2. Login ===
    log('Step 2: Logging in...');
    try {
      // Wait for login form
      await page.waitForSelector('#uid', { state: 'visible', timeout: 15000 });
      await page.fill('#uid', 'ADMIN01');
      log('  Username entered');

      await page.waitForSelector('#pwd', { state: 'visible', timeout: 5000 });
      await page.fill('#pwd', 'admin@2026');
      log('  Password entered');

      await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 5000 });
      await page.click('#loginBtn');
      log('  Login button clicked');

      // Wait for dashboard to appear
      await page.waitForSelector('#topbar', { state: 'visible', timeout: 20000 });
      await page.waitForSelector('#screens', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(3000);
      log('  Login successful, dashboard visible');
    } catch (err) {
      log(`  Login may have failed: ${err.message}`);
      // Screenshot the login page for debugging
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'login_failure.png') });
    }

    // === 3. Process all screens ===
    log('\nStep 3: Processing screens...');
    for (const screen of SCREENS) {
      await processScreen(page, screen);
    }

    // === 4. Additional tests on Dashboard ===
    log('\n=== Additional Tests ===');

    // Navigate back to Dashboard first
    await navigateToScreen(page, { key: 'dashboard', label: 'Dashboard', navType: 'top' });

    // Test search box
    log('\n--- Search Box Tests ---');
    try {
      // Open the watchlist search
      const addBtn = page.locator('.wl-add');
      if (await addBtn.isVisible({ timeout: 3000 })) {
        await addBtn.click();
        await page.waitForTimeout(500);

        // Initiate search with "zzz" junk
        const searchInput = page.locator('.wl-search-input');
        if (await searchInput.isVisible({ timeout: 3000 })) {
          // Test 1: Type "RELIANCE"
          log('  Search: RELIANCE');
          await searchInput.fill('RELIANCE');
          await page.waitForTimeout(3000);
          await screenshot(page, 'search', 'dark', 'nse', 'reliance');

          // Test 2: Type "ZZZZZ" (junk)
          log('  Search: ZZZZZ');
          await searchInput.fill('ZZZZZ');
          await page.waitForTimeout(3000);
          await screenshot(page, 'search', 'dark', 'nse', 'zzzzz');

          // Test 3: Empty search
          log('  Search: empty');
          await searchInput.fill('');
          await page.waitForTimeout(1000);
          await screenshot(page, 'search', 'dark', 'nse', 'empty');

          // Test 4: Type "HDFC"
          log('  Search: HDFC');
          await searchInput.fill('HDFC');
          await page.waitForTimeout(3000);
          await screenshot(page, 'search', 'dark', 'nse', 'hdfc');
        }

        // Close search
        const closeBtn = page.locator('.wl-search-close');
        if (await closeBtn.isVisible({ timeout: 2000 })) {
          await closeBtn.click();
          await page.waitForTimeout(500);
        }
      }
    } catch (err) {
      log(`  Search box tests failed: ${err.message}`);
    }

    // Test NSE/BSE toggle on dashboard
    log('\n--- NSE/BSE Toggle Test ---');
    await toggleExchange(page);

    // Test watchlist add/remove
    log('\n--- Watchlist Add/Remove Tests ---');
    try {
      const addBtn = page.locator('.wl-add');
      if (await addBtn.isVisible({ timeout: 3000 })) {
        await addBtn.click();
        await page.waitForTimeout(500);

        const searchInput = page.locator('.wl-search-input');
        if (await searchInput.isVisible({ timeout: 3000 })) {
          await searchInput.fill('TATAMOTORS');
          await page.waitForTimeout(3000);

          // Click first result to add
          const firstResult = page.locator('.wl-search-item').first();
          if (await firstResult.isVisible({ timeout: 5000 })) {
            await firstResult.click();
            await page.waitForTimeout(1000);
            log('  TATAMOTORS added to watchlist');
            await screenshot(page, 'watchlist', 'dark', 'nse', 'add');

            // Now remove it
            const removeBtn = page.locator('.wl-remove').first();
            if (await removeBtn.isVisible({ timeout: 3000 })) {
              await removeBtn.click();
              await page.waitForTimeout(1000);
              log('  Item removed from watchlist');
            }
          }
        }

        // Close search
        const closeBtn = page.locator('.wl-search-close');
        if (await closeBtn.isVisible({ timeout: 2000 })) {
          await closeBtn.click();
        }
      }
    } catch (err) {
      log(`  Watchlist add/remove tests failed: ${err.message}`);
    }

    // Test chart timeframe/type toggles on Stock Detail
    log('\n--- Chart Controls Tests on Stock Detail ---');
    await navigateToScreen(page, { key: 'stock', label: 'Stock Detail', navType: 'top' });
    try {
      // Click different timeframe buttons (tf-btn)
      const timeframes = page.locator('.chart-ctrl-group .tf-btn');
      const tfCount = await timeframes.count();
      log(`  Found ${tfCount} timeframe buttons`);
      if (tfCount > 1) {
        // Click the second timeframe
        await timeframes.nth(1).click();
        await page.waitForTimeout(2000);
        await screenshot(page, 'chart', 'dark', 'nse', 'timeframe_alt');
        log('  Timeframe toggled');
      }

      // Click different chart type buttons (ct-btn)
      const chartTypes = page.locator('.ct-btn');
      const ctCount = await chartTypes.count();
      log(`  Found ${ctCount} chart type buttons`);
      if (ctCount > 1) {
        // Click the second chart type (e.g., Candle instead of Area)
        await chartTypes.nth(1).click();
        await page.waitForTimeout(2000);
        await screenshot(page, 'chart', 'dark', 'nse', 'type_alt');
        log('  Chart type toggled');
      }

      // Toggle indicators
      const indBtn = page.locator('.ind-btn');
      if (await indBtn.isVisible({ timeout: 3000 })) {
        await indBtn.click();
        await page.waitForTimeout(1000);
        // Click an indicator toggle
        const indToggle = page.locator('.ind-toggle').first();
        if (await indToggle.isVisible({ timeout: 3000 })) {
          await indToggle.click();
          await page.waitForTimeout(1000);
          await screenshot(page, 'chart', 'dark', 'nse', 'indicator');
          log('  Indicator toggled');
        }
        // Close indicators
        await indBtn.click();
      }
    } catch (err) {
      log(`  Chart controls tests failed: ${err.message}`);
    }

    // === Summary ===
    log('\n=== Audit Complete ===');
    log(`Console messages collected: ${allConsoleMessages.length}`);
    const errorMessages = allConsoleMessages.filter((m) => m.startsWith('[ERROR]'));
    log(`Console errors: ${errorMessages.length}`);
    errorMessages.forEach((m) => log(`  ${m}`));

    // List all screenshots
    const files = fs.readdirSync(SCREENSHOT_DIR).filter((f) => f.endsWith('.png'));
    log(`\nScreenshots captured: ${files.length}`);
    files.forEach((f) => log(`  ${f}`));

  } catch (err) {
    log(`FATAL ERROR: ${err.message}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'fatal_error.png') });
  } finally {
    await browser.close();
    log('\nBrowser closed. Done.');
  }
}

run().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
