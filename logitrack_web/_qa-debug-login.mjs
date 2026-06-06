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

  // Record network
  const requests = [];
  page.on('request', req => {
    if (req.url().includes('/api/')) {
      requests.push({ url: req.url(), method: req.method() });
    }
  });
  page.on('response', async resp => {
    if (resp.url().includes('/api/')) {
      const req = requests.find(r => r.url === resp.url());
      if (req) req.status = resp.status();
    }
  });

  // Go to login
  await page.goto(BASE_URL + '/login');
  await page.waitForTimeout(1500);

  // Dump inputs
  const inputs = await page.locator('input').all();
  console.log('Inputs found:', inputs.length);
  for (const input of inputs) {
    const name = await input.getAttribute('name');
    const id = await input.getAttribute('id');
    const type = await input.getAttribute('type');
    const placeholder = await input.getAttribute('placeholder');
    console.log(`  Input: name="${name}" id="${id}" type="${type}" placeholder="${placeholder}"`);
  }

  // Fill
  const usernameF = page.locator('input').first();
  const passwordF = page.locator('input[type="password"]').first();
  await usernameF.fill('op_caba');
  await passwordF.fill('op_caba123');

  // Find and click submit
  const buttons = await page.locator('button').all();
  console.log('Buttons found:', buttons.length);
  for (const btn of buttons) {
    const text = await btn.innerText();
    const type = await btn.getAttribute('type');
    console.log(`  Button: text="${text}" type="${type}"`);
  }

  await page.locator('button:has-text("Ingresar")').click();
  await page.waitForTimeout(3000);

  console.log('After login URL:', page.url());
  console.log('Network API calls:');
  for (const req of requests) {
    console.log(`  ${req.method} ${req.url} → ${req.status}`);
  }

  // Try going to /
  await page.goto(BASE_URL + '/');
  await page.waitForTimeout(2000);
  console.log('After goto / URL:', page.url());
  const body = await page.locator('body').innerText();
  console.log('Body contains "Envíos":', body.includes('Envíos'));
  console.log('Body contains "Iniciar sesión":', body.includes('Iniciar sesión'));
  console.log('Body contains "Ingresá":', body.includes('Ingresá'));
  console.log('First 200 chars:', body.substring(0, 200));

  await page.screenshot({ path: '/tmp/login-debug.png', fullPage: false });

  await browser.close();
}
main();
