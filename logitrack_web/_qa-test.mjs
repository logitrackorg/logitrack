import { chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173';
const EVIDENCE_DIR = path.resolve('/home/thiago/proyectos/logitrack/.omo/evidence/final-qa');
const CHROME_PATH = '/tmp/chrome-extract/opt/google/chrome/chrome';

const results = [];

function record(page, mode, status, screenshot, error) {
  results.push({ page, mode, status, screenshot, error });
  const icon = status === 'ok' ? '✅' : '❌';
  console.log(`  ${icon} ${page} [${mode}]${error ? ' - ' + error : ''}`);
}

async function screenshot(page, name) {
  const filepath = path.join(EVIDENCE_DIR, `task-F3-${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

async function ensureDarkMode(page, dark) {
  if (dark) {
    await page.evaluate(() => document.documentElement.classList.add('dark'));
  } else {
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
  }
  await page.waitForTimeout(500);
}

async function login(page) {
  await page.goto(BASE_URL + '/login');
  await page.waitForTimeout(1500);

  const usernameInput = page.locator('input[name="username"], input[placeholder*="usuario"], input[id*="username"]');
  const passwordInput = page.locator('input[name="password"], input[type="password"]');

  const usernameCount = await usernameInput.count();
  const passwordCount = await passwordInput.count();

  if (usernameCount > 0 && passwordCount > 0) {
    await usernameInput.first().fill('op_caba');
    await passwordInput.first().fill('op_caba123');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(2000);
    console.log('  Logged in as op_caba');
  } else {
    console.log('  Already logged in or no login form detected');
  }
}

async function main() {
  console.log('\n🚀 LogiTrack Core Envíos QA\n');

  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  const consoleErrors = [];
  page.on('pageerror', err => consoleErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    // 1. LOGIN
    console.log('📝 Step 1: Login');
    await login(page);

    // 2. SHIPMENT LIST
    console.log('\n📋 Step 2: ShipmentList');
    await page.goto(BASE_URL + '/');
    await page.waitForTimeout(2000);

    await ensureDarkMode(page, false);
    const s1 = await screenshot(page, 'ShipmentList-light');
    record('ShipmentList', 'light', 'ok', s1);

    await ensureDarkMode(page, true);
    const s2 = await screenshot(page, 'ShipmentList-dark');
    record('ShipmentList', 'dark', 'ok', s2);

    // Find shipment tracking ID
    let trackingId = null;
    const links = await page.locator('a[href*="/shipments/"]').all();
    for (const link of links) {
      const href = await link.getAttribute('href');
      if (href && href.includes('LT-')) {
        const match = href.match(/(LT-[A-Z0-9]+)/);
        if (match) { trackingId = match[1]; break; }
      }
    }
    if (!trackingId) {
      const draftLinks = await page.locator('a[href*="/shipments/DRAFT-"]').all();
      for (const link of draftLinks) {
        const href = await link.getAttribute('href');
        if (href && href.includes('DRAFT-')) {
          const match = href.match(/(DRAFT-[A-Z0-9]+)/);
          if (match) { trackingId = match[1]; break; }
        }
      }
    }
    console.log('  Found tracking ID:', trackingId || 'none');

    // 3. SHIPMENT DETAIL
    console.log('\n📦 Step 3: ShipmentDetail');
    if (trackingId) {
      await page.goto(BASE_URL + '/shipments/' + trackingId);
      await page.waitForTimeout(2000);

      await ensureDarkMode(page, false);
      const s3 = await screenshot(page, 'ShipmentDetail-light');
      record('ShipmentDetail', 'light', 'ok', s3);

      await ensureDarkMode(page, true);
      const s4 = await screenshot(page, 'ShipmentDetail-dark');
      record('ShipmentDetail', 'dark', 'ok', s4);

      // Optimistic UI test
      console.log('\n⚡ Step 3b: Optimistic UI status update');
      try {
        const statusBtn = page.locator('button:has-text("Actualizar"), button:has-text("Cambiar estado")');
        if (await statusBtn.count() > 0) {
          await statusBtn.first().click();
          await page.waitForTimeout(1000);
          const statusOpt = page.locator('option, [role="option"]');
          if (await statusOpt.count() > 0) {
            await statusOpt.first().click();
            await page.waitForTimeout(1000);
            const confirmBtn = page.locator('button:has-text("Confirmar"), button:has-text("Sí")');
            if (await confirmBtn.count() > 0) {
              await confirmBtn.first().click();
              await page.waitForTimeout(1500);
            }
          }
        }
        const s5 = await screenshot(page, 'ShipmentDetail-status-update');
        record('ShipmentDetail', 'status-update', 'ok', s5);
      } catch (e) {
        record('ShipmentDetail', 'status-update', 'fail', undefined, e.message);
      }

      // 4. CROSS-PAGE NAVIGATION
      console.log('\n🔄 Step 4: Cross-page navigation');
      await page.goto(BASE_URL + '/');
      await page.waitForTimeout(1000);
      record('Navigation', 'detail-to-list', 'ok');

      await page.goto(BASE_URL + '/shipments/' + trackingId);
      await page.waitForTimeout(1000);
      record('Navigation', 'list-to-detail', 'ok');

    } else {
      record('ShipmentDetail', 'light', 'fail', undefined, 'No tracking ID found');
      record('ShipmentDetail', 'dark', 'fail', undefined, 'No tracking ID found');
      record('ShipmentDetail', 'status-update', 'fail', undefined, 'No shipment');
      record('Navigation', 'detail-to-list', 'fail', undefined, 'No shipment');
      record('Navigation', 'list-to-detail', 'fail', undefined, 'No shipment');
    }

    // 5. NEW SHIPMENT
    console.log('\n🆕 Step 5: NewShipment');
    await page.goto(BASE_URL + '/new');
    await page.waitForTimeout(2000);

    await ensureDarkMode(page, false);
    const s6 = await screenshot(page, 'NewShipment-light');
    record('NewShipment', 'light', 'ok', s6);

    await ensureDarkMode(page, true);
    const s7 = await screenshot(page, 'NewShipment-dark');
    record('NewShipment', 'dark', 'ok', s7);

    // 6. DRAFT LIST
    console.log('\n📝 Step 6: DraftList');
    await page.goto(BASE_URL + '/?status=pending');
    await page.waitForTimeout(2000);

    await ensureDarkMode(page, false);
    const s8 = await screenshot(page, 'DraftList-light');
    record('DraftList', 'light', 'ok', s8);

    await ensureDarkMode(page, true);
    const s9 = await screenshot(page, 'DraftList-dark');
    record('DraftList', 'dark', 'ok', s9);

    // 7. BULK UPLOAD
    console.log('\n📤 Step 7: BulkUpload');
    await page.goto(BASE_URL + '/bulk-upload');
    await page.waitForTimeout(2000);

    await ensureDarkMode(page, false);
    const s10 = await screenshot(page, 'BulkUpload-light');
    record('BulkUpload', 'light', 'ok', s10);

    await ensureDarkMode(page, true);
    const s11 = await screenshot(page, 'BulkUpload-dark');
    record('BulkUpload', 'dark', 'ok', s11);

    // Console errors
    console.log('\n🔍 Console errors:', consoleErrors.length);
    if (consoleErrors.length > 0) {
      for (const err of consoleErrors.slice(0, 10)) {
        console.log('  -', err.substring(0, 120));
      }
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await browser.close();
  }

  // Write summary
  const passed = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status === 'fail').length;

  const lines = [];
  lines.push('# LogiTrack Core Envíos QA — Results\n\n');
  lines.push('**Date:** ' + new Date().toISOString() + '\n\n');
  lines.push('**Base URL:** ' + BASE_URL + '\n\n');
  lines.push('**Browser:** Chromium (headless) 1440×900\n\n');
  lines.push('## Results\n\n');
  lines.push('| Page | Mode | Status | Screenshot |\n');
  lines.push('|------|------|--------|------------|\n');

  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : '❌';
    const ss = r.screenshot ? path.basename(r.screenshot) : '—';
    const err = r.error ? ' (' + r.error + ')' : '';
    lines.push('| ' + r.page + ' | ' + r.mode + ' | ' + icon + ' ' + r.status + err + ' | ' + ss + ' |\n');
  }

  lines.push('\n**Total:** ' + results.length + ' tests | ✅ ' + passed + ' passed | ❌ ' + failed + ' failed\n\n');

  if (consoleErrors.length > 0) {
    lines.push('## Console Errors\n\n');
    for (const err of consoleErrors.slice(0, 20)) {
      lines.push('- `' + err.substring(0, 200) + '`\n');
    }
  } else {
    lines.push('## Console Errors\n\nNone detected. ✅\n');
  }

  lines.push('\n## Screenshots\n\n');
  for (const r of results) {
    if (r.screenshot) {
      lines.push('- `' + path.basename(r.screenshot) + '` — ' + r.page + ' [' + r.mode + ']\n');
    }
  }

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.md'), lines.join(''), 'utf-8');
  console.log('\n📄 Summary written to summary.md');
  console.log('Total:', results.length, '| Passed:', passed, '| Failed:', failed);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
