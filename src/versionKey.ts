import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from 'homebridge';
import redis = require('redis');

import { RedisConfig } from './config';

export const VERSION_KEY = 'heating/versions/hb-heating-plugin';

function readJson(name: string) {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', name), 'utf8'));
  } catch (error) {
    return {};
  }
}

export function versionPayload(now: Date = new Date()): string {
  const version = readJson('package.json').version;
  const commit = readJson('build_info.json').commit;
  return JSON.stringify({
    version: typeof version === 'string' ? version : 'unknown',
    commit: typeof commit === 'string' ? commit : 'unknown',
    time: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
}

export function publishVersion(redisConfig: RedisConfig, log: Logger) {
  const client = redis.createClient(redisConfig.port, redisConfig.host);
  let done = false;
  const finish = (error?: Error | null) => {
    if (done) {
      return;
    }
    done = true;
    if (error) {
      log.warn(`version key not written: ${error}`);
    }
    client.end(true);
  };
  client.on('error', finish);
  client.set(VERSION_KEY, versionPayload(), (error) => finish(error));
}
