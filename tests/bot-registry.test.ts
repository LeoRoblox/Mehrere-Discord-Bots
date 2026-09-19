import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { BotRegistry } from '../src/core/bot-registry.js';
import type { IBotModule, BotLogger } from '../src/core/types.js';
import {
  GatewayIntentBits,
  SlashCommandBuilder,
  type Client,
  type ClientApplication
} from 'discord.js';
import type { AppConfig } from '../src/core/config.js';

const baseConfig: AppConfig = {
  NODE_ENV: 'test',
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

const silentLogger: BotLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

function createCommandModule(): IBotModule {
  return {
    ...dummyModule,
    commands: [
      {
        data: new SlashCommandBuilder().setName('testcmd').setDescription('Test-Beschreibung'),
        execute: async () => {}
      }
    ]
  };
}

/** Erstellt einen gemockten Client<true> und merkt sich das set-Mock zum Prüfen. */
const setMocks = new WeakMap<object, ReturnType<typeof vi.fn>>();

function createFakeReadyClient(guildIds: string[]): Client<true> {
  const setMock = vi.fn().mockResolvedValue(undefined);
  const fake = {
    application: {
      commands: {
        set: setMock
      }
    } as unknown as ClientApplication,
    guilds: {
      cache: new Map(guildIds.map((id) => [id, { id }]))
    }
  } as unknown as Client<true>;
  setMocks.set(fake, setMock);
  return fake;
}

function getSetMock(client: object): ReturnType<typeof vi.fn> {
  const mock = setMocks.get(client);
  if (!mock) throw new Error('Kein Set-Mock für diesen Client registriert');
  return mock;
}

describe('Bot Registry Architecture', () => {
  it('registers modules successfully', () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);

    registry.register(dummyModule);
    const modules = registry.getRegisteredModules();

    expect(modules.length).toBe(1);
    expect(modules[0].id).toBe('test-bot');
    db.close();
  });

  it('throws an error if a module with the same ID is registered twice', () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);

    registry.register(dummyModule);
    expect(() => registry.register(dummyModule)).toThrow(
      "Bot-Modul mit ID 'test-bot' ist bereits registriert."
    );
    db.close();
  });
});

describe('Slash-Command Auto-Deployment (bei jedem Start)', () => {
  it('registriert Commands global UND auf jedem Server, auf dem der Bot ist', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);
    const botModule = createCommandModule();
    const client = createFakeReadyClient(['111111111111111111', '222222222222222222']);

    await registry.deployCommands(botModule, client, silentLogger);

    const setMock = getSetMock(client);

    // 1x global + 2x pro Server
    expect(setMock).toHaveBeenCalledTimes(3);
    expect(setMock).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Object)]));
    expect(setMock).toHaveBeenCalledWith(expect.anything(), '111111111111111111');
    expect(setMock).toHaveBeenCalledWith(expect.anything(), '222222222222222222');
    db.close();
  });

  it('registriert Commands auch auf dem DEV-Server, ohne andere Server auszuschließen', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(
      { ...baseConfig, DISCORD_DEV_GUILD_ID: '999999999999999999' },
      db
    );
    const botModule = createCommandModule();
    const client = createFakeReadyClient(['111111111111111111']);

    await registry.deployCommands(botModule, client, silentLogger);

    const setMock = getSetMock(client);

    // 1x global + 1x aktueller Server + 1x DEV-Server
    expect(setMock).toHaveBeenCalledTimes(3);
    expect(setMock).toHaveBeenCalledWith(expect.anything(), '999999999999999999');
    expect(setMock).toHaveBeenCalledWith(expect.anything(), '111111111111111111');
    db.close();
  });

  it('überspringt die Registrierung, wenn der Bot keine Commands definiert hat', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);
    const client = createFakeReadyClient(['111111111111111111']);

    await registry.deployCommands(dummyModule, client, silentLogger);

    expect(getSetMock(client)).not.toHaveBeenCalled();
    db.close();
  });

  it('isoliert Fehler: Ein fehlgeschlagener Server blockiert andere Server nicht', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);
    const botModule = createCommandModule();

    const setMock = vi
      .fn()
      // Global-Registrierung erfolgreich
      .mockResolvedValueOnce(undefined)
      // Erster Server schlägt fehl
      .mockRejectedValueOnce(new Error('DiscordAPIError'))
      // Zweiter Server erfolgreich
      .mockResolvedValueOnce(undefined);

    const client = {
      application: { commands: { set: setMock } } as unknown as ClientApplication,
      guilds: {
        cache: new Map([
          ['111111111111111111', { id: '111111111111111111' }],
          ['222222222222222222', { id: '222222222222222222' }]
        ])
      }
    } as unknown as Client<true>;

    await expect(
      registry.deployCommands(botModule, client, silentLogger)
    ).resolves.not.toThrow();

    expect(setMock).toHaveBeenCalledWith(expect.anything(), '222222222222222222');
    db.close();
  });

  it('registriert Commands für einen einzelnen Server sofort (Guild-Registrierung)', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);
    const botModule = createCommandModule();

    const setMock = vi.fn().mockResolvedValue(undefined);
    const client = {
      application: { commands: { set: setMock } } as unknown as ClientApplication,
      guilds: { cache: new Map() }
    } as unknown as Client;

    await registry.registerCommandsForGuild(
      botModule,
      client,
      '333333333333333333',
      silentLogger
    );

    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(expect.anything(), '333333333333333333');
    db.close();
  });

  it('überspringt die Guild-Registrierung für Module ohne Commands', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);

    const setMock = vi.fn().mockResolvedValue(undefined);
    const client = {
      application: { commands: { set: setMock } } as unknown as ClientApplication,
      guilds: { cache: new Map() }
    } as unknown as Client;

    await registry.registerCommandsForGuild(
      dummyModule,
      client,
      '333333333333333333',
      silentLogger
    );

    expect(setMock).not.toHaveBeenCalled();
    db.close();
  });
});
