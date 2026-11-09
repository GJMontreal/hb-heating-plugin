# hb-heating-plugin

Homebridge platform plugin in TypeScript. It exposes each thermostat as a HomeKit accessory and talks to redis. It is a submodule of `heating-system` and tracks `develop`.

## Layout

- `src/index.ts`: registers the platform.
- `src/platform.ts`: reads the config, creates or restores one `ThermostatAccessory` per `thermostats[]` item.
- `src/thermostatAccessory.ts`: Thermostat, Battery and Boost Switch services. Subscribes and writes redis keys under `<path>/`.
- `src/boost.ts`: `boostMinutes` lookup and `BoostTimer`, which owns the `<path>/boost` key and its timeout.
- `src/versionKey.ts`: writes the plugin version to redis at startup.
- `config.schema.json` and `src/config.ts`: config for the Homebridge UI and the code. Change both together.

## Commands

- `npm run lint`
- `npm run build`
- `npm test`: node:test through ts-node. Tests are `src/*.spec.ts`, which `tsconfig.json` excludes from the build.

Run lint, build and test before every commit.

## Versions

One semantic version for this plugin, in `package.json`. `src/versionKey.ts` publishes it to `heating/versions/hb-heating-plugin`. To release, bump it, commit, push, then tag the pushed commit `vX.Y.Z` with an annotated tag and push the tag. A new feature bumps the minor number.

## Rules

- Redis is the contract with `boiler-relay`, `mqtt-bridge` and `heating-web`. The parent repo lists every key in `docs/redis-contract.md`. Do not rename a key or change a payload here without the matching change in the others.
- The plugin is the only writer of `<path>/boost`. It sets the key with an expiry and a timeout, because an expiry alone never tells HomeKit.
- Write no code comments.
- Commit and push on `develop`. The parent repo takes the new pointer. Do not tag without asking.
- The plugin has no deploy step. Do not touch the device.
