import { chromium } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';

export async function openPlayer(config, account, report) {
  // Separate browser process, profile, cookies and socket for every participant.
  const browser = await chromium.launch({
    headless: config.headless ?? false,
    executablePath: config.browserExecutable,
  });
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  page.on('pageerror', error =>
    report('browser-error', { username: account.username, message: error.message }),
  );
  page.on('dialog', dialog => (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()));
  return { account, browser, context, page };
}

export async function register(player, config, report) {
  const { page, account } = player;
  await page.goto(new URL('/signup', config.baseUrl).href, { waitUntil: 'domcontentloaded' });
  // The current site first offers external providers and an explicit email signup link.
  const emailSignup = page.getByRole('link', { name: 'Create an account with email', exact: true });
  if (await emailSignup.isVisible()) await emailSignup.click();
  await page.locator('#signup-form input[name="username"]').fill(account.username);
  await page.locator('#signup-form input[name="password"]').fill(account.password);
  await page.locator('#signup-form input[name="email"]').fill(account.email);
  for (const checkbox of await page.locator('#signup-form input[type="checkbox"]').all()) {
    if (!(await checkbox.isChecked()))
      await page
        .locator(`label[for="${await checkbox.getAttribute('id')}"]`)
        .first()
        .click();
  }
  await page.locator('#signup-form button[type="submit"]').click();
  const deadline = Date.now() + (config.registrationTimeoutSeconds ?? 600) * 1000;
  let prompted = false;
  while (Date.now() < deadline) {
    if (await page.locator('#user_tag').count()) {
      const name = (await page.locator('#user_tag').innerText()).trim();
      if (name.toLowerCase() !== account.username.toLowerCase())
        throw new Error('Unexpected registered identity');
      report('registered', { username: account.username });
      return;
    }
    const errors = await page.locator('#signup-form .error:visible').allTextContents();
    if (errors.length) throw new Error(`Signup ${account.username}: ${errors.join('; ')}`);
    if (!prompted && Date.now() > deadline - (config.registrationTimeoutSeconds ?? 600) * 1000 + 5000) {
      report('registration-action', {
        username: account.username,
        message:
          'Complete any email verification or CAPTCHA in this player browser. The script does not bypass these checks.',
      });
      prompted = true;
    }
    await delay(500);
  }
  throw new Error(`Registration not completed for ${account.username}`);
}

async function expandDetails(page) {
  const collapsed = page.locator('form.form3 fieldset.toggle-box--toggle-off > legend');
  while (await collapsed.count()) await collapsed.first().click();
}

async function selectNumber(page, name, number) {
  const select = page.locator(`select[name="${name}"]`);
  const value = await select.evaluate(
    (element, target) => [...element.options].find(option => Number(option.value) === target)?.value,
    number,
  );
  if (value === undefined) throw new Error(`Tournament form does not offer ${name}=${number}`);
  await select.selectOption(value);
}

export async function createTournament(player, config, manifest) {
  const page = player.page;
  await page.goto(new URL('/tournament/new', config.baseUrl).href, { waitUntil: 'domcontentloaded' });
  await expandDetails(page);
  await page.locator('[name="name"]').fill(manifest.tournamentName);
  await selectNumber(page, 'clockTime', 2);
  await selectNumber(page, 'clockIncrement', 1);
  await selectNumber(page, 'minutes', 20);
  await selectNumber(page, 'waitMinutes', 2);
  await page.locator('[name="gameVariant"]').selectOption('xiangqi');
  await page.locator('[name="ruleset"]').selectOption('tiantian-v1');
  await page.locator('[name="password"]').fill(manifest.entryCode);
  await page.locator('[name="conditions.allowList"]').fill(manifest.accounts.map(a => a.username).join('\n'));
  await page
    .locator('textarea[name="description"]')
    .fill(
      `Private browser rehearsal ${manifest.runId}. Ten temporary test accounts; engine-assisted play authorized by the site operator.`,
    );
  const chat = page.locator('input[type="checkbox"][name="hasChat"]');
  if (await chat.isChecked())
    await page
      .locator(`label[for="${await chat.getAttribute('id')}"]`)
      .first()
      .click();
  await page.locator('form.form3 button[type="submit"]').click();
  await page.waitForURL(/\/tournament\/[a-zA-Z0-9]{8}$/);
  return new URL(page.url()).pathname.split('/').at(-1);
}

export async function joinTournament(player, config, manifest, report) {
  const page = player.page;
  await page.goto(new URL(`/tournament/${manifest.tournamentId}`, config.baseUrl).href, {
    waitUntil: 'domcontentloaded',
  });
  const withdraw = page.getByRole('button', { name: /Withdraw/i });
  const join = page.getByRole('button', { name: /Join/i });
  await withdraw.or(join).first().waitFor();
  if (await withdraw.isVisible()) return; // Creator was joined by the normal create form.
  await join.click();
  const prompt = page.locator('dialog input');
  await prompt.waitFor();
  await prompt.fill(manifest.entryCode);
  await prompt.press('Enter');
  await withdraw.waitFor();
  report('joined', { username: player.account.username });
}
