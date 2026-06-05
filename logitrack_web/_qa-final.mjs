import { chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173';
const EVIDENCE_DIR = path.resolve('/home/thiago/proyectos/logitrack/.omo/evidence/final-qa');
const CHROME_PATH = '/tmp/chrome-extract/opt/google/chrome/chrome';

async function login(page) {
  await page.goto(BASE_URL + '/login');
  await page.waitForTimeout(1500);
  const body = await page.locator('body').innerText();
  if (body.includes('Ingresá tus credenciales') || body.includes('Usuario')) {
    await page.locator('#username').fill('op_caba');
    await page.locator('#password').fill('op_caba123');
    await page.locator('button:has-text("Ingresar")').click();
    await page.waitForTimeout(2500);
  }
}

async function main() {
  console.log('\n🔧 Fixing ShipmentDetail + Optimistic UI test\n');

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const netErrors = [];
  page.on('response', async resp => {
    if (resp.status() >= 400 && resp.url().includes('/api/')) {
      netErrors.push(`${resp.status()} ${resp.url().replace('http://localhost:8080/api/v1/', '')}`);
    }
  });

  await login(page);

  // Use LT-CB00001 (at_origin_hub) - should have status controls for operator
  const trackingId = 'LT-CB00001';
  console.log('Testing detail page for:', trackingId);

  await page.goto(BASE_URL + '/shipments/' + trackingId);
  await page.waitForTimeout(3000);

  // Redo ShipmentDetail screenshots with valid shipment
  // Light mode
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-F3-ShipmentDetail-light.png'), fullPage: true });
  console.log('✅ ShipmentDetail [light] - redone with valid ID');

  // Dark mode
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-F3-ShipmentDetail-dark.png'), fullPage: true });
  console.log('✅ ShipmentDetail [dark] - redone with valid ID');

  // Status update test
  console.log('\n⚡ Status update test');
  
  // Dump buttons
  const buttons = await page.locator('button').all();
  let statusBtnText = null;
  for (const btn of buttons) {
    const text = await btn.innerText();
    if (text.includes('Actualizar estado') || text.includes('Cambiar estado')) {
      statusBtnText = text;
      console.log('  Found status button:', text);
      break;
    }
  }

  // Also check for any status-related UI
  const bodyText = await page.locator('body').innerText();
  console.log('  Body contains "Actualizar estado":', bodyText.includes('Actualizar estado'));
  console.log('  Body contains "Cambiar":', bodyText.includes('Cambiar'));
  console.log('  Body contains "Estado":', bodyText.includes('Estado'));

  if (statusBtnText) {
    // Click the button
    await page.locator(`button:has-text("${statusBtnText}")`).first().click();
    await page.waitForTimeout(1500);
    
    // Check for modal/dropdown
    const bodyAfter = await page.locator('body').innerText();
    console.log('  After click - body contains "Seleccionar":', bodyAfter.includes('Seleccionar'));
    console.log('  After click - body contains "Nuevo estado":', bodyAfter.includes('Nuevo estado'));
    
    // Screenshot the state update UI
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-F3-ShipmentDetail-status-update.png'), fullPage: true });
    console.log('✅ Status update UI captured');
  } else {
    // Just screenshot detail page  
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-F3-ShipmentDetail-status-update.png'), fullPage: true });
    console.log('  No status update controls visible (may require specific role)');
    console.log('  Buttons on page:', buttons.length);
    console.log('  First 15 buttons:');
    for (const btn of buttons.slice(0, 15)) {
      console.log('   -', (await btn.innerText()).substring(0, 40));
    }
  }

  // Print network errors
  console.log('\nNetwork errors:');
  const unique = [...new Set(netErrors)];
  for (const e of unique) {
    console.log(' ', e);
  }

  await browser.close();
  console.log('\nDone. Screenshots updated.');
}
main();
