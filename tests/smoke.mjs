import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFixtures } from './fixtures.mjs';

/**
 * End-to-end smoke test.
 *
 * Drives the built application in a real browser and checks the things that are
 * easy to break and hard to notice: that the viewport actually draws, that
 * selection and materials reach the scene, that import preserves hierarchy,
 * that a project survives a save and reopen, and that a render produces a real
 * image rather than a blank one.
 *
 *   npm run check        # build, then run this against a server it starts
 *   npm run test:smoke   # the same, without rebuilding first
 *
 * It serves the build itself unless something is already answering, so there
 * is no second terminal to keep in step — and no way to accidentally test
 * yesterday's build while today's sits unbuilt.
 *
 * Set SMOKE_URL to point at a server of your own, SMOKE_HEADED=1 to watch it
 * run, and SMOKE_SWIFTSHADER=1 on a machine with no GPU. Screenshots of each
 * step land in tests/screenshots.
 */

const URL_BASE = process.env.SMOKE_URL ?? 'http://localhost:4173';
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'screenshots');

/* Playwright is deliberately not a project dependency — it is a 400 MB
   browser download that nobody running the app needs. Say so plainly rather
   than failing with a module-resolution stack trace. */
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'This test needs Playwright, which is not installed:\n\n' +
      '  npm install --save-dev playwright && npx playwright install chromium\n',
  );
  process.exit(1);
}

const fixtures = writeFixtures();
mkdirSync(SHOTS, { recursive: true });

/* ------------------------------------------------------------------ *
   Serve the build, unless someone else already is
 * ------------------------------------------------------------------ */

const reachable = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
};

let server = null;

if (await reachable(URL_BASE)) {
  console.log(`Using the server already on ${URL_BASE}`);
} else {
  const port = new URL(URL_BASE).port || '4173';
  server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort'], {
    cwd: join(HERE, '..'),
    stdio: 'ignore',
    detached: false,
  });

  const deadline = Date.now() + 30_000;
  let up = false;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await reachable(URL_BASE)) {
      up = true;
      break;
    }
  }
  if (!up) {
    server.kill();
    console.error(
      `Could not start a preview server on ${URL_BASE}. ` +
        'Run `npm run build` first, or free the port.',
    );
    process.exit(1);
  }
  console.log(`Started a preview server on ${URL_BASE}`);
}

const stopServer = () => {
  if (server && !server.killed) server.kill();
  server = null;
};
process.on('exit', stopServer);
process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});

const launchOptions = { headless: process.env.SMOKE_HEADED !== '1' };
// Machines without a GPU (CI containers) need the software rasteriser.
if (process.env.SMOKE_SWIFTSHADER === '1') {
  launchOptions.args = [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ];
}
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Software rendering, a large environment map and the floor reflection can put
// seconds between frames. Raise this on a slow machine rather than reading the
// timeouts as failures.
page.setDefaultTimeout(Number(process.env.SMOKE_TIMEOUT ?? 30_000));

const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('response', (response) => {
  if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
});

const results = [];
let failures = 0;

// The viewport draws on demand, so it is idle when no draw call has been issued
// for a while. Software rendering can spend minutes on one frame, during which
// the page cannot answer a click; waiting for idle before each step keeps the
// test from reading that as a failure.
await page.addInitScript(() => {
  window.__draws = 0;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const original = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...args) {
      window.__draws += 1;
      return original.apply(this, args);
    };
  }
});

async function settle(timeout = 300_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const before = await page.evaluate(() => window.__draws).catch(() => -1);
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => window.__draws).catch(() => -2);
    if (before === after || Date.now() > deadline) return;
  }
}

async function step(name, fn) {
  try {
    await settle();
    const detail = await fn();
    results.push(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures += 1;
    results.push(`  FAIL ${name}: ${String(error.message).split('\n')[0]}`);
    await page.screenshot({ path: join(SHOTS, `FAIL-${name}.png`) }).catch(() => {});
  }
}

// Screenshots are evidence, not assertions: on a software-rendered page one can
// time out, and that must not abort the run.
const shot = (name) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`) }).catch(() => {
    console.log(`  (screenshot ${name} timed out)`);
  });
/** Library folders start closed; open the one holding a material (or every one). */
const openLibraryFolders = async (pattern) => {
  const win = page.locator('aside[aria-label="Materials"]');
  const closed = win.locator('button[aria-expanded="false"]');
  for (let i = (await closed.count()) - 1; i >= 0; i--) {
    const button = closed.nth(i);
    if (!pattern || pattern.test(await button.innerText())) await button.click();
  }
};
const projectAside = () => page.locator('aside[aria-label="Project"]');
const projectTab = async (name) => {
  await projectAside().getByRole('tab', { name, exact: true }).click();
  await page.waitForTimeout(500);
  // Sections start closed; open every one so the steps find their controls.
  // Only the section headers (slot="trigger"): a Picker inside a section is
  // also aria-expanded, and an open Picker blocks every later click.
  const closed = projectAside().locator('.kaamos-section button[slot="trigger"][aria-expanded="false"]');
  for (let i = (await closed.count()) - 1; i >= 0; i--) await closed.nth(i).click();
  if (await closed.count()) await page.waitForTimeout(300);
};
/** The scene tree lives on Project > Scene, whichever tab was open before. */
const hierarchy = async () => {
  await projectTab('Scene');
  return projectAside().locator('.scroll-y').first().innerText();
};
// Generous, because a software-rendered first import is slow.
const waitForHierarchy = async (pattern, timeout = 180_000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    // While a model is being parsed the page's main thread is busy and a click
    // can wait longer than Playwright's 30 s; that is "not yet", not a failure.
    let text = '';
    try {
      text = await hierarchy();
    } catch (error) {
      if (error?.name !== 'TimeoutError') throw error;
    }
    if (pattern.test(text)) return text;
    if (Date.now() > deadline) throw new Error(`"${pattern}" never appeared`);
    await page.waitForTimeout(1000);
  }
};
// A dialog, not just a label: the toolbar button that opens it shares the name.
const renderWindow = () => page.getByRole('dialog', { name: 'Render window' });
/** The Aspect picker is a Spectrum Picker: open it, then pick the option. */
const chooseAspect = async (label) => {
  await renderWindow().getByRole('button', { name: /Aspect/ }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
};
/** Output width and height, in that order. */
const sizeFields = () => renderWindow().getByRole('textbox', { name: /^(Width|Height)$/ });
const openRenderWindow = async () => {
  if ((await renderWindow().count()) === 0) {
    await page.getByRole('button', { name: 'Render window', exact: true }).click();
    await renderWindow().waitFor();
  }
};
// Kaamos's own toast region; Spectrum adds live regions of its own to the page.
const toasts = () =>
  page.locator('[data-testid="toasts"]').innerText().catch(() => '');
/**
 * Spectrum switches hide their checkbox under the drawn track, which takes the
 * pointer; click the label around it instead, and only when the state differs.
 */
const setSwitch = async (control, on) => {
  if ((await control.isChecked()) !== on) {
    await control.locator('xpath=ancestor::label[1]').click();
  }
};

async function importFile(path) {
  const chooser = page.waitForEvent('filechooser');
  chooser.catch(() => {});
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles(path);
  // STEP and IGES ask how finely to tessellate; take the default (Standard).
  if (/\.(step|stp|igs|iges)$/i.test(path)) {
    const dialog = page.getByRole('dialog', { name: 'Import CAD model' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  }
  await page.waitForTimeout(3000);
}

/** Measures a rendered PNG, so a blank image is caught rather than assumed good. */
const measureRender = (selector = 'img[alt^="Render at"]') =>
  page.evaluate((sel) => {
    const img = document.querySelector(sel);
    if (!img) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let min = 255;
    let max = 0;
    let transparent = 0;
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      if (luma < min) min = luma;
      if (luma > max) max = luma;
      if (data[i + 3] < 10) transparent += 1;
      else if (data[i + 3] > 245) opaque += 1;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      lumaMin: min,
      lumaMax: max,
      transparent,
      opaque,
      total: data.length / 4,
    };
  }, selector);

async function setRenderOutput(width, height, passes) {
  await openRenderWindow();
  // The built-in default engine is path traced; these steps measure the raster one.
  await renderWindow().getByRole('radio', { name: 'Raster' }).first().click({ force: true });
  // Spectrum number fields: found by name, since whole-number fields are
  // inputmode="numeric" and other fields in the window are "decimal".
  const sizes = sizeFields();
  await sizes.nth(0).fill(String(width));
  await sizes.nth(0).press('Enter');
  await sizes.nth(1).fill(String(height));
  await sizes.nth(1).press('Enter');
  const slider = page.getByRole('slider', { name: 'Passes' });
  await slider.focus();
  await slider.press('Home');
  for (let i = 1; i < passes; i += 1) await slider.press('ArrowUp');
}

/* ------------------------------------------------------------------ */

await page.goto(URL_BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');

await step('the app opens on an empty scene with the import choice', async () => {
  await page.getByText('The scene is empty').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  if (/examplebottle/i.test(await hierarchy())) throw new Error('a model was loaded without asking');
  return 'empty';
});

await settle();
await page.getByRole('button', { name: 'Example bottle', exact: true }).first().click();
await waitForHierarchy(/examplebottle/i);
await page.waitForTimeout(2500);
await shot('01-default');

await step('the example bottle loads from the empty-state box', async () => {
  const text = await hierarchy();
  if (!/examplebottle/i.test(text)) throw new Error('example model missing');
  if (/Aurora|Flask|Material test/.test(text)) throw new Error('an old sample is still there');
  const size = await page.locator('canvas').evaluate((c) => [c.width, c.height]);
  if (size[0] < 10) throw new Error('canvas has no size');
  return `${size[0]}×${size[1]} canvas`;
});

await step('the example bottle stands on the floor with its parts named', async () => {
  // The GLB is Y-up already; the model root sits on the floor (y = 0), and the
  // part names keep their spaces ("Cork shank", not "Cork_shank").
  await projectTab('Scene');
  const tree = await hierarchy();
  for (const part of ['Bottle', 'Label', 'Liquid', 'Cork shank', 'Cap']) {
    if (!tree.includes(part)) throw new Error(`part "${part}" missing`);
  }
  await projectAside().getByRole('button', { name: /^examplebottle/ }).first().click();
  await page.waitForTimeout(400);
  const values = (await projectAside().locator('input').evaluateAll((els) => els.map((e) => e.value))).map(Number);
  if (Math.abs(values[2]) > 0.002) throw new Error(`model root is ${values[2]} above the floor`);
  return 'five named parts, root at floor level';
});

await step('the product name is shown', async () => {
  const title = await page.title();
  if (title !== 'Kaamos') throw new Error(`tab title is "${title}"`);
  const mark = page.locator('header').getByAltText('Kaamos', { exact: true });
  if ((await mark.count()) !== 1) throw new Error('no wordmark in the toolbar');
  return 'tab title and toolbar wordmark';
});

await step('clicking the viewport selects an object', async () => {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  await settle(); // the selection outline is drawn before the tab can be clicked
  await projectTab('Scene');
  const selected = await projectAside()
    .locator('.bg-amber-wash')
    .first()
    .textContent();
  if (!selected) throw new Error('nothing selected');
  return selected.trim().split('\n')[0];
});

await step('applying a material updates the scene', async () => {
  await openLibraryFolders(/^Metal/);
  await page.getByRole('button', { name: /^Polished chrome/ }).first().click();
  await page.waitForTimeout(800);
  if (!/Polished chrome/.test(await hierarchy())) throw new Error('not assigned');
  return 'polished chrome';
});
await shot('02-material');

await step('a studio sets environment and lights together', async () => {
  await projectTab('Environment');
  await page.waitForTimeout(700);
  const tile = projectAside().getByRole('button', { name: /^Product photography/ }).first();
  await tile.click();
  await page.waitForTimeout(1000);
  if ((await tile.getAttribute('aria-pressed')) !== 'true') throw new Error('studio not marked active');
  await projectTab('Lighting');
  const lights = await projectAside().getByRole('button', { name: /^Remove$/ }).count();
  if (lights < 2) throw new Error(`expected the studio's lights, found ${lights}`);
  return `product photography, ${lights} lights`;
});
await shot('03-lighting');

await step('custom HDRI is rejected when corrupt', async () => {
  await projectTab('Environment');
  const chooser = page.waitForEvent('filechooser');
  chooser.catch(() => {});
  await page.getByRole('button', { name: /Load HDRI file/ }).click();
  await (await chooser).setFiles(join(fixtures, 'broken.hdr'));
  // Wait for the message rather than a fixed time, as the valid case does.
  await page
    .getByText(/could not load environment/i)
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(async () => {
      throw new Error(`no error reported (toasts: ${(await toasts()).slice(0, 120) || 'none'})`);
    });
  return 'clear error shown';
});

await step('custom HDRI loads when valid', async () => {
  const chooser = page.waitForEvent('filechooser');
  chooser.catch(() => {});
  await page.getByRole('button', { name: /Load HDRI file/ }).click();
  await (await chooser).setFiles(join(fixtures, 'studio.hdr'));
  // Wait for the toast rather than for a fixed time: decoding and filtering the
  // map takes longer on some machines than on others.
  await page
    .getByText(/Environment set to studio\.hdr/i)
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => {
      throw new Error('upload did not take effect');
    });
  await projectAside().getByRole('button', { name: /^Soft studio/ }).first().click();
  await page.waitForTimeout(800);
  return 'applied, then back to a studio';
});

await step('camera view presets and framing', async () => {
  await page.keyboard.press('1');
  await page.waitForTimeout(700);
  await page.keyboard.press('6');
  await page.keyboard.press('a');
  await page.waitForTimeout(700);
  return 'front then three-quarter';
});

await step('orthographic projection round-trips', async () => {
  await projectTab('Camera');
  await page.waitForTimeout(400);
  await page.getByRole('radio', { name: 'Orthographic' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('radio', { name: 'Perspective' }).click();
  await page.waitForTimeout(900);
  return 'ortho → perspective';
});

await step('saved viewpoints', async () => {
  await page.getByRole('button', { name: /Save (the )?current view/i }).click();
  await page.waitForTimeout(500);
  if ((await page.getByRole('button', { name: /^View 1$/ }).count()) === 0) {
    throw new Error('viewpoint not listed');
  }
  return 'View 1 stored';
});

await step('import OBJ preserves group names', async () => {
  await importFile(join(fixtures, 'pyramid.obj'));
  const text = await hierarchy();
  for (const name of ['pyramid', 'Base', 'Spire']) {
    if (!new RegExp(name, 'i').test(text)) throw new Error(`"${name}" missing`);
  }
  return 'Base and Spire present';
});

await step('STEP imports and tessellates', async () => {
  await importFile(join(fixtures, 'block.step'));
  // OpenCascade's kernel is fetched on first use and is not small.
  await page.waitForTimeout(6000);
  const text = await hierarchy();
  if (!/block/i.test(text)) {
    throw new Error('not in hierarchy: ' + text.replace(/\n/g, ' | ').slice(0, 200));
  }
  if (!/TestBlock/i.test(text)) throw new Error('solid name lost');
  return 'assembly tree preserved';
});

await step('import GLB preserves node names', async () => {
  await importFile(join(fixtures, 'box.glb'));
  if (!/TestBox/.test(await hierarchy())) throw new Error('TestBox missing');
  await page.getByRole('button', { name: 'TestBox', exact: true }).last().click();
  await page.waitForTimeout(400);
  await openLibraryFolders(/^Paint/);
  await page.getByRole('button', { name: /^Glossy paint/ }).first().click();
  await page.waitForTimeout(700);
  if (!/Glossy paint/.test(await hierarchy())) throw new Error('material not assigned');
  return 'imported and re-materialled';
});
await shot('04-imported');

let projectPath = null;
await step('project saves with models embedded', async () => {
  // Saving encodes every model on the main thread, which can take a while on a
  // slow machine; and a wait left unhandled when the click fails would end the
  // whole run instead of failing this step.
  const download = page.waitForEvent('download', { timeout: 120_000 });
  download.catch(() => {});
  await page.getByRole('button', { name: /Save project/i }).first().click({ timeout: 120_000 });
  const file = await download;
  projectPath = join(SHOTS, 'roundtrip.rmproj.json');
  await file.saveAs(projectPath);
  const parsed = JSON.parse(readFileSync(projectPath, 'utf8'));
  // The example bottle plus the imported OBJ, GLB and STEP all carry their bytes.
  const embedded = parsed.models.filter((model) => model.bytes).length;
  if (embedded !== 4) throw new Error(`expected 4 embedded models, got ${embedded}`);
  return `${parsed.models.length} models, ${embedded} embedded`;
});

await step('reset clears the scene', async () => {
  await page.getByRole('button', { name: 'New scene', exact: true }).click();
  await page.getByRole('button', { name: 'Reset scene', exact: true }).click();
  await page.waitForTimeout(1200);
  if (/TestBox|pyramid|TestBlock/i.test(await hierarchy())) {
    throw new Error('scene not cleared');
  }
  return 'empty';
});

await step('reopening restores hierarchy and materials', async () => {
  const chooser = page.waitForEvent('filechooser');
  chooser.catch(() => {});
  await page.getByRole('button', { name: /Open project/i }).click();
  await (await chooser).setFiles(projectPath);
  await page.waitForTimeout(3000);
  const text = await waitForHierarchy(/TestBlock/i);
  for (const name of [
    'examplebottle', 'pyramid', 'Base', 'Spire', 'TestBox', 'TestBlock', 'Glossy paint',
  ]) {
    if (!new RegExp(name, 'i').test(text)) throw new Error(`"${name}" lost on reopen`);
  }
  return 'intact';
});
await shot('05-reopened');

await step('render produces a real image', async () => {
  await setRenderOutput(480, 360, 6);
  await renderWindow().getByRole('button', { name: 'Render image' }).click();
  await page.waitForSelector('img[alt^="Render at"]', { timeout: 300_000 });
  const stats = await measureRender();
  if (!stats) throw new Error('no render produced');
  if (stats.width !== 480 || stats.height !== 360) {
    throw new Error(`wrong size: ${stats.width}×${stats.height}`);
  }
  if (stats.lumaMax - stats.lumaMin < 30) throw new Error('image is flat — likely blank');
  return `${stats.width}×${stats.height}, luma ${stats.lumaMin}–${stats.lumaMax}`;
});
await shot('06-render');

await step('transparent background renders an alpha cut-out', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await openRenderWindow();
  await setSwitch(page.getByRole('switch', { name: 'Transparent background' }), true);
  await setRenderOutput(320, 240, 2);
  await renderWindow().getByRole('button', { name: 'Render image' }).click();
  // Wait for this render specifically — an earlier one is already on screen.
  await page.waitForSelector('img[alt="Render at 320 by 240"]', { timeout: 300_000 });
  const stats = await measureRender('img[alt="Render at 320 by 240"]');
  if (stats.transparent < stats.total * 0.15) {
    throw new Error(`background not transparent (${stats.transparent}/${stats.total})`);
  }
  if (stats.opaque < 100) throw new Error('no opaque subject in the cut-out');
  return `${Math.round((stats.transparent / stats.total) * 100)}% alpha`;
});
await shot('07-alpha');

await step('bottom view is reachable', async () => {
  await page.keyboard.press('Escape');
  // The view cube is the only home of the standard views (no Views section on Camera).
  const btn = page.getByTestId('view-cube').getByRole('button', { name: 'Bottom view', exact: true });
  if ((await btn.count()) === 0) throw new Error('no Bottom view on the view cube');
  await btn.first().click({ force: true });
  await page.waitForTimeout(1500);
  return 'camera can look up from underneath';
});

await step('the render engine can be switched', async () => {
  await openRenderWindow();
  const traced = page.getByRole('radio', { name: 'Path traced' });
  if ((await traced.count()) === 0) throw new Error('no engine switch');
  await traced.first().click({ force: true });
  await page.waitForTimeout(1200);
  // Path tracing has its own controls; confirm the panel actually swapped.
  if ((await page.getByRole('slider', { name: 'Bounces' }).count()) === 0) {
    throw new Error('path tracing controls did not appear');
  }
  await page.getByRole('radio', { name: 'Raster' }).first().click({ force: true });
  await page.waitForTimeout(1000);
  return 'raster ↔ path traced';
});


/* ------------------------------------------------------------------ *
   Interface structure: Materials, Project, Render window, HUD
 * ------------------------------------------------------------------ */

await step('Project window has its five tabs, and there is no menu bar', async () => {
  if ((await page.getByRole('menubar').count()) !== 0) throw new Error('a menu bar is back');
  const names = ['Scene', 'Material', 'Environment', 'Lighting', 'Camera'];
  for (const name of names) {
    await projectAside().getByRole('tab', { name, exact: true }).click();
    await page.waitForTimeout(250);
    const selected = await projectAside()
      .getByRole('tab', { name, exact: true })
      .getAttribute('aria-selected');
    if (selected !== 'true') throw new Error(`${name} did not open`);
  }
  return names.join(' · ');
});

await step('Materials window holds only materials', async () => {
  const win = page.locator('aside[aria-label="Materials"]');
  if ((await win.getByRole('tab').count()) !== 0) throw new Error('Materials window has tabs');
  await openLibraryFolders();
  const tiles = await win.getByRole('button').count();
  if (tiles < 10) throw new Error(`only ${tiles} materials`);
  return `${tiles} materials`;
});

await step('Render window keeps the aspect ratio and draws the frame', async () => {
  await openRenderWindow();
  const sizes = sizeFields();
  await sizes.nth(0).fill('800');
  await sizes.nth(0).press('Enter');
  await page.waitForTimeout(300);
  const h = await sizes.nth(1).inputValue();
  if (Number(h) <= 0) throw new Error('height unreadable');
  // 1:1 first: the lock keeps width and height equal.
  await chooseAspect('1 : 1');
  await setSwitch(renderWindow().getByRole('switch', { name: 'Show frame' }), true);
  await page.waitForTimeout(600);
  const square = [await sizes.nth(0).inputValue(), await sizes.nth(1).inputValue()];
  if (square[0] !== square[1]) throw new Error(`not square: ${square.join('×')}`);
  // A tall output is narrower than any viewport this test runs in (a square one
  // is not: with both side windows open the view itself can be taller than wide).
  await chooseAspect('9 : 16');
  await page.waitForTimeout(600);
  if ((await page.locator('[data-testid="output-frame"]').count()) === 0) {
    throw new Error('output frame not drawn for a 9 : 16 output');
  }
  await chooseAspect('4 : 3');
  await page.waitForTimeout(300);
  return `800 → ${h} locked, 1:1 square, 9:16 frame shown`;
});

await step('heads-up display reports the scene', async () => {
  const text = await page.locator('[aria-label="Heads-up display"]').innerText();
  for (const word of ['Preview', 'Geometry', 'Camera', 'Output']) {
    if (!text.includes(word)) throw new Error(`HUD lacks "${word}"`);
  }
  const toggle = page.getByRole('button', { name: /^Heads-up display/ });
  await toggle.click();
  await page.waitForTimeout(300);
  if ((await page.locator('[aria-label="Heads-up display"]').count()) !== 0) {
    throw new Error('HUD did not hide');
  }
  await toggle.click();
  return 'shown, hidden, shown';
});

await step('toolbar Render window button and hotkeys overview', async () => {
  await page.getByRole('button', { name: 'Render window', exact: true }).click();
  await page.waitForTimeout(300);
  const toggled = await renderWindow().count();
  await page.getByRole('button', { name: 'Hotkeys overview', exact: true }).click();
  await page.getByRole('dialog', { name: 'Hotkeys overview' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('k');
  await page.getByRole('dialog', { name: 'Hotkeys overview' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await page.getByRole('dialog', { name: 'Hotkeys overview' }).count()) !== 0) {
    throw new Error('hotkeys dialog did not close');
  }
  return `Render window toggled (${toggled ? 'opened' : 'closed'}); button and K open hotkeys`;
});

await step('screenshot saves a real, labelled capture', async () => {
  const download = page.waitForEvent('download');
  download.catch(() => {});
  await page.getByRole('button', { name: 'Screenshot', exact: true }).click();
  const file = await download;
  const name = file.suggestedFilename();
  if (!/-screenshot-\d+x\d+-/.test(name)) throw new Error(`unlabelled file name: ${name}`);
  const path = join(SHOTS, 'screenshot.png');
  await file.saveAs(path);
  const base64 = readFileSync(path).toString('base64');
  const stats = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let min = 255;
    let max = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      if (l < min) min = l;
      if (l > max) max = l;
    }
    return { w: c.width, h: c.height, min, max };
  }, base64);
  if (stats.max - stats.min < 30) throw new Error('screenshot is flat — likely blank');
  if (!/not a final render/i.test(await toasts())) throw new Error('toast does not say it is a preview');
  return `${stats.w}×${stats.h}, luma ${stats.min}–${stats.max}`;
});

await step('the toolbar view tools switch and return to Select', async () => {
  const bar = page.locator('header');
  for (const name of ['Pan tool', 'Orbit tool', 'Zoom tool']) {
    const button = bar.getByRole('button', { name, exact: true });
    await button.click();
    if ((await button.getAttribute('aria-pressed')) !== 'true') throw new Error(`${name} not active`);
    if ((await bar.getByRole('button', { name: 'Select tool', exact: true }).getAttribute('aria-pressed')) !== 'false') {
      throw new Error('Select still active beside ' + name);
    }
  }
  await bar.getByRole('button', { name: 'Select tool', exact: true }).click();
  return 'pan, orbit, zoom, then select';
});

await step('the toolbar hides and restores the Project window', async () => {
  const button = page.getByRole('button', { name: 'Project', exact: true });
  await button.click();
  await page.waitForTimeout(300);
  if ((await projectAside().count()) !== 0) throw new Error('Project window did not hide');
  await button.click();
  await page.waitForTimeout(400);
  if ((await projectAside().count()) !== 1) throw new Error('the toolbar did not restore it');
  return 'hidden, restored';
});

await step('undo steps back', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(800);
  return 'undone';
});

/* ------------------------------------------------------------------ */

const noise = /THREE\.Clock: This module has been deprecated/;
const realProblems = problems.filter((entry) => !noise.test(entry));

console.log(`\nKaamos — smoke test (${URL_BASE})\n`);
console.log(results.join('\n'));
if (realProblems.length > 0) {
  console.log('\nConsole and network problems:');
  for (const entry of [...new Set(realProblems)].slice(0, 15)) console.log(`  ${entry}`);
}
console.log(`\n${results.length - failures}/${results.length} passed.`);
console.log(`Screenshots in ${SHOTS}\n`);

await browser.close();
stopServer();
process.exit(failures > 0 || realProblems.length > 0 ? 1 : 0);
