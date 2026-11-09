import { Logger } from 'homebridge';
import { RedisClient } from 'redis';

import { ThermostatConfig } from './config';

export const DEFAULT_BOOST_MINUTES = 60;
export const MIN_BOOST_MINUTES = 5;
export const MAX_BOOST_MINUTES = 240;
export const EXPIRY_MARGIN_SECONDS = 60;

function isValidMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_BOOST_MINUTES && value <= MAX_BOOST_MINUTES;
}

function checkedMinutes(value: unknown, label: string, log: Logger): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (isValidMinutes(value)) {
    return value;
  }
  log.warn(`${label} boostMinutes ${JSON.stringify(value)} must be an integer from `
    + `${MIN_BOOST_MINUTES} to ${MAX_BOOST_MINUTES}`);
  return undefined;
}

export function resolveBoostMinutes(thermostat: ThermostatConfig, platformMinutes: unknown, log: Logger): number {
  return checkedMinutes(thermostat.boostMinutes, `thermostat ${thermostat.name}`, log)
    ?? checkedMinutes(platformMinutes, 'platform', log)
    ?? DEFAULT_BOOST_MINUTES;
}

export class BoostTimer {
  private timeout?: NodeJS.Timeout;

  constructor(
    private readonly client: Pick<RedisClient, 'set' | 'get' | 'pttl'>,
    private readonly key: string,
    private readonly minutes: number,
    private readonly onExpire: () => void,
    private readonly log: Logger,
  ) {}

  start() {
    const seconds = this.minutes * 60;
    this.client.set(this.key, 'true', 'EX', seconds + EXPIRY_MARGIN_SECONDS, this.logFailure);
    this.arm(seconds * 1000);
  }

  stop() {
    this.disarm();
    this.client.set(this.key, 'false', this.logFailure);
  }

  restore(onRestored: (on: boolean) => void) {
    this.client.get(this.key, (error, reply) => {
      if (error || reply !== 'true') {
        onRestored(false);
        return;
      }
      this.client.pttl(this.key, (ttlError, ttl) => {
        if (ttlError) {
          onRestored(false);
          return;
        }
        if (ttl < 0) {
          this.start();
          onRestored(true);
          return;
        }
        const remaining = ttl - EXPIRY_MARGIN_SECONDS * 1000;
        if (remaining <= 0) {
          this.expire();
          return;
        }
        this.arm(remaining);
        onRestored(true);
      });
    });
  }

  dispose() {
    this.disarm();
  }

  private arm(milliseconds: number) {
    this.disarm();
    this.timeout = setTimeout(() => this.expire(), milliseconds);
  }

  private disarm() {
    if (this.timeout !== undefined) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }

  private expire() {
    this.timeout = undefined;
    this.client.set(this.key, 'false', this.logFailure);
    this.onExpire();
  }

  private readonly logFailure = (error: Error | null) => {
    if (error) {
      this.log.warn(`boost key ${this.key} not written: ${error}`);
    }
  };
}
