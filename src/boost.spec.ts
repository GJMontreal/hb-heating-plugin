import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert = require('node:assert');

import { BoostTimer, resolveBoostMinutes, EXPIRY_MARGIN_SECONDS } from './boost';

const KEY = '/home/sensors/ABCD1234/boost';

function fakeLog() {
  const warnings: string[] = [];
  return { warn: (message: string) => warnings.push(message), warnings };
}

function fakeClient(stored: { value: string | null; ttl: number } = { value: null, ttl: -2 }) {
  const writes: unknown[][] = [];
  return {
    writes,
    set: (...args: unknown[]) => {
      writes.push(args.filter(arg => typeof arg !== 'function'));
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        callback(null);
      }
    },
    get: (key: string, callback: (error: Error | null, reply: string | null) => void) => callback(null, stored.value),
    pttl: (key: string, callback: (error: Error | null, reply: number) => void) => callback(null, stored.ttl),
  };
}

describe('resolveBoostMinutes', () => {
  const thermostat = { name: 'Den', path: '/den' };

  it('prefers the thermostat value', () => {
    const log = fakeLog();
    assert.strictEqual(resolveBoostMinutes({ ...thermostat, boostMinutes: 30 }, 90, log as never), 30);
    assert.deepStrictEqual(log.warnings, []);
  });

  it('uses the platform value without an override', () => {
    assert.strictEqual(resolveBoostMinutes(thermostat, 90, fakeLog() as never), 90);
  });

  it('uses the default without any value', () => {
    const log = fakeLog();
    assert.strictEqual(resolveBoostMinutes(thermostat, undefined, log as never), 60);
    assert.deepStrictEqual(log.warnings, []);
  });

  it('accepts the limits', () => {
    assert.strictEqual(resolveBoostMinutes(thermostat, 5, fakeLog() as never), 5);
    assert.strictEqual(resolveBoostMinutes(thermostat, 240, fakeLog() as never), 240);
  });

  for (const bad of [4, 241, 30.5, '30', NaN, 0, -10]) {
    it(`warns and falls back for platform value ${String(bad)}`, () => {
      const log = fakeLog();
      assert.strictEqual(resolveBoostMinutes(thermostat, bad, log as never), 60);
      assert.strictEqual(log.warnings.length, 1);
    });
  }

  it('falls back from an invalid thermostat value to the platform value', () => {
    const log = fakeLog();
    assert.strictEqual(resolveBoostMinutes({ ...thermostat, boostMinutes: 1 }, 90, log as never), 90);
    assert.strictEqual(log.warnings.length, 1);
  });

  it('falls back to the default when both values are invalid', () => {
    const log = fakeLog();
    assert.strictEqual(resolveBoostMinutes({ ...thermostat, boostMinutes: 1 }, 999, log as never), 60);
    assert.strictEqual(log.warnings.length, 2);
  });
});

describe('BoostTimer', () => {
  let expired: number;
  const onExpire = () => {
    expired += 1;
  };

  beforeEach(() => {
    expired = 0;
    mock.timers.enable({ apis: ['setTimeout'] });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it('writes true with an expiry and writes false when the timeout fires', () => {
    const client = fakeClient();
    const timer = new BoostTimer(client as never, KEY, 10, onExpire, fakeLog() as never);
    timer.start();
    assert.deepStrictEqual(client.writes, [[KEY, 'true', 'EX', 600 + EXPIRY_MARGIN_SECONDS]]);

    mock.timers.tick(599_999);
    assert.strictEqual(expired, 0);
    mock.timers.tick(1);
    assert.strictEqual(expired, 1);
    assert.deepStrictEqual(client.writes[1], [KEY, 'false']);
  });

  it('cancels the timeout and writes false on stop', () => {
    const client = fakeClient();
    const timer = new BoostTimer(client as never, KEY, 10, onExpire, fakeLog() as never);
    timer.start();
    timer.stop();
    assert.deepStrictEqual(client.writes[1], [KEY, 'false']);
    mock.timers.tick(700_000);
    assert.strictEqual(expired, 0);
    assert.strictEqual(client.writes.length, 2);
  });

  it('restarts the timeout and the expiry on a second start', () => {
    const client = fakeClient();
    const timer = new BoostTimer(client as never, KEY, 10, onExpire, fakeLog() as never);
    timer.start();
    mock.timers.tick(400_000);
    timer.start();
    assert.deepStrictEqual(client.writes[1], [KEY, 'true', 'EX', 660]);
    mock.timers.tick(599_999);
    assert.strictEqual(expired, 0);
    mock.timers.tick(1);
    assert.strictEqual(expired, 1);
  });

  it('re-arms from the remaining key time at startup', () => {
    const client = fakeClient({ value: 'true', ttl: 300_000 + EXPIRY_MARGIN_SECONDS * 1000 });
    const timer = new BoostTimer(client as never, KEY, 10, onExpire, fakeLog() as never);
    const shown: boolean[] = [];
    timer.restore(on => shown.push(on));
    assert.deepStrictEqual(shown, [true]);
    assert.deepStrictEqual(client.writes, []);

    mock.timers.tick(299_999);
    assert.strictEqual(expired, 0);
    mock.timers.tick(1);
    assert.strictEqual(expired, 1);
    assert.deepStrictEqual(client.writes, [[KEY, 'false']]);
  });

  it('expires at startup when only the margin is left', () => {
    const client = fakeClient({ value: 'true', ttl: 30_000 });
    const timer = new BoostTimer(client as never, KEY, 10, onExpire, fakeLog() as never);
    const shown: boolean[] = [];
    timer.restore(on => shown.push(on));
    assert.deepStrictEqual(shown, []);
    assert.strictEqual(expired, 1);
    assert.deepStrictEqual(client.writes, [[KEY, 'false']]);
  });

  it('adopts a true key that has no expiry with a full duration', () => {
    const client = fakeClient({ value: 'true', ttl: -1 });
    const timer = new BoostTimer(client as never, KEY, 10, onExpire, fakeLog() as never);
    const shown: boolean[] = [];
    timer.restore(on => shown.push(on));
    assert.deepStrictEqual(shown, [true]);
    assert.deepStrictEqual(client.writes, [[KEY, 'true', 'EX', 660]]);
    mock.timers.tick(600_000);
    assert.strictEqual(expired, 1);
  });

  for (const value of [null, 'false', 'yes']) {
    it(`shows off at startup when the key is ${String(value)}`, () => {
      const client = fakeClient({ value, ttl: value === null ? -2 : 100_000 });
      const timer = new BoostTimer(client as never, KEY, 10, onExpire, fakeLog() as never);
      const shown: boolean[] = [];
      timer.restore(on => shown.push(on));
      assert.deepStrictEqual(shown, [false]);
      assert.deepStrictEqual(client.writes, []);
      mock.timers.tick(700_000);
      assert.strictEqual(expired, 0);
    });
  }

  it('clears the timeout on dispose', () => {
    const client = fakeClient();
    const timer = new BoostTimer(client as never, KEY, 10, onExpire, fakeLog() as never);
    timer.start();
    timer.dispose();
    mock.timers.tick(700_000);
    assert.strictEqual(expired, 0);
    assert.strictEqual(client.writes.length, 1);
  });
});
