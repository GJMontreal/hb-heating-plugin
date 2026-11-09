export interface ThermostatConfig {
  name: string;
  path: string;
  boostMinutes?: number;
}

export interface RedisConfig {
  host: string;
  port: number;
}