import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { BotRegistry } from '../src/core/bot-registry.js';
import type { IBotModule } from '../src/core/types.js';
import { GatewayIntentBits } from 'discord.js';

describe('Bot Registry Architecture', () => {
  const dummyConfig = {
    NODE_ENV: 'test' as const,
    PORT: 8080,
    BOT_OWNER_ID: '123456789012345678',
    TURSO_DATABASE_URL: ':memory:',
    TURSO_AUTH_TOKEN: '',
    VERIFY_BOT_TOKEN: 'mock_test_token_string_for_unit_tests_1234567890'
  };

  const dummyModule: IBotModule = {
    id: 'test-bot',
    name: 'Test Bot',
    tokenEnvVar: 'TEST_BOT_TOKEN',
    requiredIntents: [GatewayIntentBits.Guilds],
    commands: []
  };

  it('registers modules successfully', () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(dummyConfig, db);

    registry.register(dummyModule);
    const modules = registry.getRegisteredModules();

    expect(modules.length).toBe(1);
    expect(modules[0].id).toBe('test-bot');
    db.close();
  });

  it('throws an error if a module with the same ID is registered twice', () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(dummyConfig, db);

    registry.register(dummyModule);
    expect(() => registry.register(dummyModule)).toThrow(
      "Bot-Modul mit ID 'test-bot' ist bereits registriert."
    );
    db.close();
  });
});
