import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/core/config.js';

describe('Config Validation', () => {
  const dummyToken = ['MTAyMzQ1Njc4OTA', 'abcdef', 'ghijklmnopqrstuvwxyz123456789'].join('.');

  it('validates a correct configuration successfully', () => {
    const validEnv = {
      NODE_ENV: 'test',
      PORT: '8080',
      BOT_OWNER_ID: '123456789012345678',
      TURSO_DATABASE_URL: ':memory:',
      TURSO_AUTH_TOKEN: '',
      VERIFY_BOT_TOKEN: dummyToken
    };

    const config = validateConfig(validEnv);
    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(8080);
    expect(config.BOT_OWNER_ID).toBe('123456789012345678');
    expect(config.TURSO_DATABASE_URL).toBe(':memory:');
  });

  it('throws an error if BOT_OWNER_ID is missing or invalid', () => {
    const invalidEnv = {
      NODE_ENV: 'test',
      TURSO_DATABASE_URL: ':memory:',
      VERIFY_BOT_TOKEN: dummyToken
    };

    expect(() => validateConfig(invalidEnv)).toThrow();
  });

  it('throws an error if VERIFY_BOT_TOKEN is missing or too short', () => {
    const invalidEnv = {
      NODE_ENV: 'test',
      BOT_OWNER_ID: '123456789012345678',
      TURSO_DATABASE_URL: ':memory:',
      VERIFY_BOT_TOKEN: 'short'
    };

    expect(() => validateConfig(invalidEnv)).toThrow();
  });

  it('requires TURSO_AUTH_TOKEN in production when using remote libsql URL', () => {
    const remoteEnv = {
      NODE_ENV: 'production',
      BOT_OWNER_ID: '123456789012345678',
      TURSO_DATABASE_URL: 'libsql://my-db.turso.io',
      TURSO_AUTH_TOKEN: '',
      VERIFY_BOT_TOKEN: dummyToken
    };

    expect(() => validateConfig(remoteEnv)).toThrow();
  });
});
