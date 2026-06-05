import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const CHROME_PATH = '/tmp/chrome-extract/opt/google/chrome/chrome';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Login
  await page.goto(BASE_URL + '/login');
  await page.waitForTimeout(1500);
  const u = page.locator('input[name="username"]');
  const p = page.locator('input[type="password"]');
  if (await u.count() > 0) {
    await u.fill('op_caba');
    await p.first().fill('op_caba123');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2000);
  }

  // Go to shipment list
  await page.goto(BASE_URL + '/');
  await page.waitForTimeout(2000);

  // Dump page info
  const url = page.url();
  const title = await page.title();
  const bodyText = await page.locator('body').innerText();
  console.log('URL:', url);
  console.log('Title:', title);
  console.log('Body preview (first 1000 chars):');
  console.log(bodyText.substring(0, 1000));
  console.log('---');
  console.log('Body length:', bodyText.length);

  // Find all links
  const links = await page.locator('a').all();
  console.log('Total <a> tags:', links.length);
  for (const link of links.slice(0, 10)) {
    const href = await link.getAttribute('href');
    const text = await link.innerText();
    console.log('  Link:', href, '| text:', text.substring(0, 50));
  }

  // Try other selectors
  const rows = await page.locator('tr, [role="row"], .shipment-row, table tr').all();
  console.log('Rows found:', rows.length);

  // Check for any element with text containing LT-
  const ltElements = await page.locator('text=/LT-[A-Z0-9]{8}/').all();
  console.log('Elements with LT- pattern:', ltElements.length);

  // Check raw HTML
  const html = await page.content();
  console.log('HTML contains "LT-":', html.includes('LT-'));
  console.log('HTML contains "DRAFT-":', html.includes('DRAFT-'));
  
  // Check if redirected to login
  console.log('Page contains "Iniciar sesión":', bodyText.includes('Iniciar sesión'));
  console.log('Page contains "Envíos":', bodyText.includes('Envíos'));

  await browser.close();
}
main();
