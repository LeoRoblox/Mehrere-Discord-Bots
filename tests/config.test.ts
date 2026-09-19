import { describe, it, expect } from 'vitest';
import { validateConfig, REQUIRED_BOT_ENV_VARS, BOT_ENV_DEFINITIONS } from '../src/core/config.js';

describe('Config Validation', () => {
  const verifyToken = ['MTAyMzQ1Njc4OTA', 'abcdef', 'ghijklmnopqrstuvwxyz123456789'].join('.');
  const systemToken = ['OTg3NjU0MzIxMDk', 'uvwxyz', 'zyxwvutsrqponmlkjihgfedcba987'].join('.');

  const validEnv = {
    NODE_ENV: 'test',
    PORT: '8080',
    BOT_OWNER_ID: '123456789012345678',
    TURSO_DATABASE_URL: ':memory:',
    TURSO_AUTH_TOKEN: '',
    VERIFY_BOT_TOKEN: verifyToken,
    VERIFY_BOT_CLIENT_ID: '111111111111111111',
    SYSTEM_BOT_TOKEN: systemToken,
    SYSTEM_BOT_CLIENT_ID: '222222222222222222'
  };

  it('validates a correct configuration successfully', () => {
    const config = validateConfig(validEnv);
    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(8080);
    expect(config.BOT_OWNER_ID).toBe('123456789012345678');
    expect(config.TURSO_DATABASE_URL).toBe(':memory:');
    expect(config.VERIFY_BOT_TOKEN).toBe(verifyToken);
    expect(config.VERIFY_BOT_CLIENT_ID).toBe('111111111111111111');
    expect(config.SYSTEM_BOT_TOKEN).toBe(systemToken);
    expect(config.SYSTEM_BOT_CLIENT_ID).toBe('222222222222222222');
  });

  it('throws an error if BOT_OWNER_ID is missing or invalid', () => {
    const invalidEnv: Record<string, string> = { ...validEnv };
    delete invalidEnv.BOT_OWNER_ID;

    expect(() => validateConfig(invalidEnv)).toThrow();
  });

  it('throws an error if VERIFY_BOT_TOKEN is missing or too short', () => {
    expect(() => validateConfig({ ...validEnv, VERIFY_BOT_TOKEN: 'short' })).toThrow(
      /VERIFY_BOT_TOKEN/
    );

    const missing: Record<string, string> = { ...validEnv };
    delete missing.VERIFY_BOT_TOKEN;
    expect(() => validateConfig(missing)).toThrow(/VERIFY_BOT_TOKEN/);
  });

  it('requires TURSO_AUTH_TOKEN in production when using remote libsql URL', () => {
    const remoteEnv = {
      ...validEnv,
      NODE_ENV: 'production',
      TURSO_DATABASE_URL: 'libsql://my-db.turso.io',
      TURSO_AUTH_TOKEN: ''
    };

    expect(() => validateConfig(remoteEnv)).toThrow(/TURSO_AUTH_TOKEN/);
  });

  describe('Zwei getrennte Bots: Verify-Bot und System-Bot', () => {
    it('kennt genau die vier benötigten Bot-Umgebungsvariablen', () => {
      expect(REQUIRED_BOT_ENV_VARS).toEqual([
        'VERIFY_BOT_TOKEN',
        'VERIFY_BOT_CLIENT_ID',
        'SYSTEM_BOT_TOKEN',
        'SYSTEM_BOT_CLIENT_ID'
      ]);
      expect(BOT_ENV_DEFINITIONS.map((b) => b.id)).toEqual(['verify-bot', 'system-bot']);
    });

    it('bricht ab, wenn SYSTEM_BOT_TOKEN fehlt – mit verständlicher Fehlermeldung', () => {
      const env: Record<string, string> = { ...validEnv };
      delete env.SYSTEM_BOT_TOKEN;

      expect(() => validateConfig(env)).toThrow(/SYSTEM_BOT_TOKEN/);
    });

    it('bricht ab, wenn SYSTEM_BOT_TOKEN leer oder zu kurz ist', () => {
      expect(() => validateConfig({ ...validEnv, SYSTEM_BOT_TOKEN: '' })).toThrow(
        /SYSTEM_BOT_TOKEN/
      );
      expect(() => validateConfig({ ...validEnv, SYSTEM_BOT_TOKEN: 'kurz' })).toThrow(
        /SYSTEM_BOT_TOKEN/
      );
    });

    it('bricht ab, wenn SYSTEM_BOT_CLIENT_ID fehlt oder keine Snowflake ist', () => {
      const env: Record<string, string> = { ...validEnv };
      delete env.SYSTEM_BOT_CLIENT_ID;
      expect(() => validateConfig(env)).toThrow(/SYSTEM_BOT_CLIENT_ID/);

      expect(() => validateConfig({ ...validEnv, SYSTEM_BOT_CLIENT_ID: 'abc' })).toThrow(
        /SYSTEM_BOT_CLIENT_ID/
      );
    });

    it('bricht ab, wenn VERIFY_BOT_CLIENT_ID fehlt', () => {
      const env: Record<string, string> = { ...validEnv };
      delete env.VERIFY_BOT_CLIENT_ID;

      expect(() => validateConfig(env)).toThrow(/VERIFY_BOT_CLIENT_ID/);
    });

    it('bricht ab, wenn beide Bots dasselbe Token verwenden', () => {
      expect(() => validateConfig({ ...validEnv, SYSTEM_BOT_TOKEN: verifyToken })).toThrow(
        /SYSTEM_BOT_TOKEN/
      );
    });

    it('bricht ab, wenn beide Bots dieselbe Client-ID verwenden', () => {
      expect(() =>
        validateConfig({ ...validEnv, SYSTEM_BOT_CLIENT_ID: '111111111111111111' })
      ).toThrow(/SYSTEM_BOT_CLIENT_ID/);
    });

    it('nennt in der Fehlermeldung alle fehlenden Variablen beider Bots', () => {
      const env: Record<string, string> = { ...validEnv };
      delete env.VERIFY_BOT_TOKEN;
      delete env.SYSTEM_BOT_TOKEN;
      delete env.SYSTEM_BOT_CLIENT_ID;

      let message = '';
      try {
        validateConfig(env);
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).toContain('VERIFY_BOT_TOKEN');
      expect(message).toContain('SYSTEM_BOT_TOKEN');
      expect(message).toContain('SYSTEM_BOT_CLIENT_ID');
      expect(message).toContain('.env.example');
    });

    it('akzeptiert Whitespace um Tokens und IDs herum', () => {
      const config = validateConfig({
        ...validEnv,
        SYSTEM_BOT_TOKEN: `  ${systemToken}  `,
        SYSTEM_BOT_CLIENT_ID: ' 222222222222222222 '
      });
      expect(config.SYSTEM_BOT_TOKEN).toBe(systemToken);
      expect(config.SYSTEM_BOT_CLIENT_ID).toBe('222222222222222222');
    });
  });
});
