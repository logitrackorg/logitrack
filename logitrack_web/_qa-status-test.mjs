import { chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173';
const EVIDENCE_DIR = path.resolve('/home/thiago/proyectos/logitrack/.omo/evidence/final-qa');
const CHROME_PATH = '/tmp/chrome-extract/opt/google/chrome/chrome';

async function login(page) {
  await page.goto(BASE_URL + '/login');
  await page.waitForTimeout(1500);
  await page.locator('#username').fill('op_caba');
  await page.locator('#password').fill('op_caba123');
  await page.locator('button:has-text("Ingresar")').click();
  await page.waitForTimeout(2500);
}

async function getNonTerminalShipment(page) {
  await page.goto(BASE_URL + '/');
  await page.waitForTimeout(2500);

  // Navigate to first shipment
  const body = await page.locator('body').innerText();
  const matches = body.match(/LT-[A-Z0-9]{8}/g) || [];
  console.log('LT IDs on page:', matches);

  for (const id of matches) {
    await page.goto(BASE_URL + '/shipments/' + id);
    await page.waitForTimeout(2000);
    const detailBody = await page.locator('body').innerText();
    // Skip terminal states
    if (detailBody.includes('Entregado') || detailBody.includes('Devuelto') || detailBody.includes('Cancelado') || detailBody.includes('Perdido') || detailBody.includes('Destruido')) {
      console.log(`  ${id}: terminal state, skipping`);
      continue;
    }
    console.log(`  ${id}: NON-terminal, testing!`);
    return id;
  }
  return null;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Record specific network errors
  const netErrors = [];
  page.on('response', async resp => {
    const url = resp.url();
    if (resp.status() >= 400 && url.includes('/api/')) {
      netErrors.push(`${resp.status()} ${resp.request().method()} ${url}`);
    }
  });

  await login(page);
  const id = await getNonTerminalShipment(page);

  if (id) {
    // Try status update
    console.log('\nLooking for status controls on', id);
    
    // Take a snapshot of the full page
    const fullText = await page.locator('body').innerText();
    console.log('Page text (first 500):', fullText.substring(0, 500));
    
    // Look for actionable elements
    const buttons = await page.locator('button').all();
    console.log('Buttons:', buttons.length);
    for (const btn of buttons.slice(0, 15)) {
      const text = await btn.innerText();
      console.log('  BTN:', text.substring(0, 60));
    }

    // Try clicking any status-related button
    const updateBtn = page.locator('button:has-text("Actualizar estado"), button:has-text("Cambiar estado"), button:has-text("Editar")').first();
    if (await updateBtn.count() > 0 && await updateBtn.isVisible()) {
      console.log('Found update button, clicking...');
      await updateBtn.click();
      await page.waitForTimeout(1000);
      
      // Screenshot the modal
      await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-F3-status-modal.png'), fullPage: true });
      console.log('Modal screenshot saved');

      // Try to select a status
      const selects = await page.locator('select').all();
      console.log('Selects after click:', selects.length);
      for (const sel of selects.slice(0, 3)) {
        const name = await sel.getAttribute('name');
        const id = await sel.getAttribute('id');
        console.log(`  Select: name="${name}" id="${id}"`);
      }
    } else {
      console.log('No status update button visible');
      // Just screenshot the detail page for completeness
      await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-F3-ShipmentDetail-nonterminal.png'), fullPage: true });
    }
  }

  console.log('\nNetwork errors:');
  for (const e of netErrors) {
    console.log(' ', e);
  }

  await browser.close();
}
main();
