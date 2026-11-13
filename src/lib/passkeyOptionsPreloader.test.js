import assert from 'node:assert/strict';
import test from 'node:test';
import { createPasskeyOptionsPreloader } from './passkeyOptionsPreloader.js';

test('preloads passkey options once and consumes the prepared request', async () => {
  const options = { challenge: 'prepared-challenge' };
  let loadCount = 0;
  const preloader = createPasskeyOptionsPreloader(async () => {
    loadCount += 1;
    return options;
  });

  const firstPreload = preloader.preload();
  const secondPreload = preloader.preload();
  assert.equal(firstPreload, secondPreload);
  assert.equal(await preloader.consume(), options);
  assert.equal(loadCount, 1);
});

test('fetches fresh passkey options when the prepared request is stale', async () => {
  let loadCount = 0;
  const preloader = createPasskeyOptionsPreloader(async () => ({ request: ++loadCount }), 0);

  await preloader.preload();
  assert.deepEqual(await preloader.consume(), { request: 2 });
  assert.equal(loadCount, 2);
});

test('refreshes an expired background passkey challenge before sign-in', async () => {
  const originalNow = Date.now;
  let now = 1000;
  let loadCount = 0;
  Date.now = () => now;
  try {
    const preloader = createPasskeyOptionsPreloader(async () => ({ request: ++loadCount }), 1000);

    assert.deepEqual(await preloader.preload(), { request: 1 });
    now += 1001;
    assert.deepEqual(await preloader.preload(), { request: 2 });
    assert.deepEqual(await preloader.consume(), { request: 2 });
    assert.equal(loadCount, 2);
  } finally {
    Date.now = originalNow;
  }
});

test('retries a failed prefetch when sign-in is requested', async () => {
  let loadCount = 0;
  const preloader = createPasskeyOptionsPreloader(async () => {
    loadCount += 1;
    if (loadCount === 1) throw new Error('Local service unavailable');
    return { challenge: 'fresh-challenge' };
  });

  await assert.rejects(preloader.preload(), /Local service unavailable/);
  assert.deepEqual(await preloader.consume(), { challenge: 'fresh-challenge' });
  assert.equal(loadCount, 2);
});
