import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import { BotRegistry, matchesConfiguredClientId } from '../src/core/bot-registry.js';
import type { IBotModule, BotLogger, BotContext } from '../src/core/types.js';
import {
  GatewayIntentBits,
  SlashCommandBuilder,
  type Client,
  type ClientApplication,
  type Interaction
} from 'discord.js';
import type { AppConfig } from '../src/core/config.js';

const baseConfig: AppConfig = {
  NODE_ENV: 'test',
  PORT: 8080,
  BOT_OWNER_ID: '123456789012345678',
  TURSO_DATABASE_URL: ':memory:',
  TURSO_AUTH_TOKEN: '',
  VERIFY_BOT_TOKEN: 'mock_test_token_string_for_unit_tests_1234567890',
  VERIFY_BOT_CLIENT_ID: '111111111111111111',
  SYSTEM_BOT_TOKEN: 'mock_test_token_string_for_unit_tests_0987654321',
  SYSTEM_BOT_CLIENT_ID: '222222222222222222'
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

  it('kann mehrere getrennte Bot-Module gleichzeitig verwalten', () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);

    registry.register({ ...dummyModule, id: 'bot-a', name: 'Bot A', tokenEnvVar: 'A_TOKEN' });
    registry.register({ ...dummyModule, id: 'bot-b', name: 'Bot B', tokenEnvVar: 'B_TOKEN' });

    const ids = registry.getRegisteredModules().map((m) => m.id);
    expect(ids).toEqual(['bot-a', 'bot-b']);

    const summary = registry.getStatusSummary();
    expect(summary.map((s) => s.tokenEnvVar)).toEqual(['A_TOKEN', 'B_TOKEN']);
    db.close();
  });
});

describe('Startverhalten & Login-Übersicht', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('überspringt einen Bot ohne Token isoliert und meldet den Grund in der Übersicht', async () => {
    delete process.env.MISSING_BOT_TOKEN;
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);
    registry.register({ ...dummyModule, id: 'missing', tokenEnvVar: 'MISSING_BOT_TOKEN' });

    await expect(registry.startAll()).resolves.not.toThrow();

    const [status] = registry.getStatusSummary();
    expect(status.status).toBe('failed');
    expect(status.failureReason).toContain('MISSING_BOT_TOKEN');
    db.close();
  });

  it('matchesConfiguredClientId: akzeptiert passende Application-ID oder User-ID', () => {
    expect(
      matchesConfiguredClientId('222222222222222222', {
        applicationId: '222222222222222222',
        userId: '999999999999999999'
      })
    ).toBe(true);
    expect(
      matchesConfiguredClientId('222222222222222222', {
        applicationId: '333333333333333333',
        userId: '222222222222222222'
      })
    ).toBe(true);
  });

  it('matchesConfiguredClientId: erkennt vertauschte Tokens/Client-IDs', () => {
    expect(
      matchesConfiguredClientId('222222222222222222', {
        applicationId: '111111111111111111',
        userId: '111111111111111111'
      })
    ).toBe(false);
  });

  it('matchesConfiguredClientId: ohne konfigurierte Client-ID wird nicht geprüft', () => {
    expect(
      matchesConfiguredClientId(undefined, {
        applicationId: '111111111111111111',
        userId: '111111111111111111'
      })
    ).toBe(true);
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

    await expect(registry.deployCommands(botModule, client, silentLogger)).resolves.not.toThrow();

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

    await registry.registerCommandsForGuild(botModule, client, '333333333333333333', silentLogger);

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

  it('registriert für jeden Bot AUSSCHLIESSLICH dessen eigene Commands', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);

    const botA: IBotModule = {
      ...dummyModule,
      id: 'bot-a',
      commands: [
        {
          data: new SlashCommandBuilder().setName('alpha').setDescription('A'),
          execute: async () => {}
        }
      ]
    };
    const botB: IBotModule = {
      ...dummyModule,
      id: 'bot-b',
      commands: [
        {
          data: new SlashCommandBuilder().setName('beta').setDescription('B'),
          execute: async () => {}
        }
      ]
    };

    const clientA = createFakeReadyClient([]);
    const clientB = createFakeReadyClient([]);

    await registry.deployCommands(botA, clientA, silentLogger);
    await registry.deployCommands(botB, clientB, silentLogger);

    const namesA = (getSetMock(clientA).mock.calls[0][0] as Array<{ name: string }>).map(
      (c) => c.name
    );
    const namesB = (getSetMock(clientB).mock.calls[0][0] as Array<{ name: string }>).map(
      (c) => c.name
    );

    expect(namesA).toEqual(['alpha']);
    expect(namesB).toEqual(['beta']);
    db.close();
  });
});

describe('Interaktions-Dispatch: strikte Trennung pro Bot-Modul', () => {
  interface MockInteractionOptions {
    kind: 'command' | 'button' | 'select' | 'modal' | 'other';
    commandName?: string;
    customId?: string;
  }

  function createMockInteraction(options: MockInteractionOptions) {
    const interaction = {
      commandName: options.commandName,
      customId: options.customId,
      replied: false,
      deferred: false,
      isChatInputCommand: () => options.kind === 'command',
      isButton: () => options.kind === 'button',
      isStringSelectMenu: () => options.kind === 'select',
      isModalSubmit: () => options.kind === 'modal',
      reply: vi.fn(async () => {
        interaction.replied = true;
      }),
      followUp: vi.fn(async () => undefined)
    };
    return interaction;
  }

  function createContext(): BotContext {
    return {
      client: {} as Client,
      db: createClient({ url: ':memory:' }),
      ownerId: baseConfig.BOT_OWNER_ID,
      logger: silentLogger
    };
  }

  function createTwoModules() {
    const verifyExecute = vi.fn(async () => {});
    const adminExecute = vi.fn(async () => {});
    const verifyButton = vi.fn(async () => {});
    const adminButton = vi.fn(async () => {});
    const adminSelect = vi.fn(async () => {});
    const adminModal = vi.fn(async () => {});

    const verifyLike: IBotModule = {
      ...dummyModule,
      id: 'verify-like',
      name: 'Verify-Like',
      commands: [
        {
          data: new SlashCommandBuilder().setName('verifysystem').setDescription('v'),
          execute: verifyExecute
        }
      ],
      buttons: [{ customId: 'verify_rules_accept_button', execute: verifyButton }]
    };

    const systemLike: IBotModule = {
      ...dummyModule,
      id: 'system-like',
      name: 'System-Like',
      commands: [
        {
          data: new SlashCommandBuilder().setName('adminpanel').setDescription('a'),
          execute: adminExecute
        }
      ],
      buttons: [{ customId: /^sysadmin:(timeout|kick):\d+$/, execute: adminButton }],
      selectMenus: [{ customId: /^sysadmin:timeout-select:\d+$/, execute: adminSelect }],
      modals: [{ customId: /^sysadmin:warn-modal:\d+$/, execute: adminModal }]
    };

    return {
      verifyLike,
      systemLike,
      mocks: { verifyExecute, adminExecute, verifyButton, adminButton, adminSelect, adminModal }
    };
  }

  it('leitet Slash-Commands nur an das Modul weiter, dem der Command gehört', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);
    const { verifyLike, systemLike, mocks } = createTwoModules();
    const ctx = createContext();

    const adminInteraction = createMockInteraction({ kind: 'command', commandName: 'adminpanel' });

    // Der Verify-Bot kennt /adminpanel NICHT
    const handledByVerify = await registry.dispatchInteraction(
      verifyLike,
      adminInteraction as unknown as Interaction,
      ctx
    );
    expect(handledByVerify).toBe(false);
    expect(mocks.verifyExecute).not.toHaveBeenCalled();
    expect(mocks.adminExecute).not.toHaveBeenCalled();

    // Der System-Bot verarbeitet /adminpanel
    const handledBySystem = await registry.dispatchInteraction(
      systemLike,
      adminInteraction as unknown as Interaction,
      ctx
    );
    expect(handledBySystem).toBe(true);
    expect(mocks.adminExecute).toHaveBeenCalledTimes(1);

    // Und umgekehrt: /verifysystem gehört nur dem Verify-Bot
    const verifyInteraction = createMockInteraction({
      kind: 'command',
      commandName: 'verifysystem'
    });
    expect(
      await registry.dispatchInteraction(
        systemLike,
        verifyInteraction as unknown as Interaction,
        ctx
      )
    ).toBe(false);
    expect(
      await registry.dispatchInteraction(
        verifyLike,
        verifyInteraction as unknown as Interaction,
        ctx
      )
    ).toBe(true);
    expect(mocks.verifyExecute).toHaveBeenCalledTimes(1);

    ctx.db.close();
    db.close();
  });

  it('leitet Buttons nur an Handler des eigenen Moduls weiter (String- und RegExp-IDs)', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);
    const { verifyLike, systemLike, mocks } = createTwoModules();
    const ctx = createContext();

    const adminButton = createMockInteraction({
      kind: 'button',
      customId: 'sysadmin:kick:123456789012345678'
    });
    const verifyButton = createMockInteraction({
      kind: 'button',
      customId: 'verify_rules_accept_button'
    });

    expect(
      await registry.dispatchInteraction(verifyLike, adminButton as unknown as Interaction, ctx)
    ).toBe(false);
    expect(
      await registry.dispatchInteraction(systemLike, adminButton as unknown as Interaction, ctx)
    ).toBe(true);
    expect(
      await registry.dispatchInteraction(systemLike, verifyButton as unknown as Interaction, ctx)
    ).toBe(false);
    expect(
      await registry.dispatchInteraction(verifyLike, verifyButton as unknown as Interaction, ctx)
    ).toBe(true);

    expect(mocks.adminButton).toHaveBeenCalledTimes(1);
    expect(mocks.verifyButton).toHaveBeenCalledTimes(1);

    ctx.db.close();
    db.close();
  });

  it('leitet Select-Menüs und Modals an die Handler des passenden Moduls weiter', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);
    const { verifyLike, systemLike, mocks } = createTwoModules();
    const ctx = createContext();

    const select = createMockInteraction({
      kind: 'select',
      customId: 'sysadmin:timeout-select:123456789012345678'
    });
    const modal = createMockInteraction({
      kind: 'modal',
      customId: 'sysadmin:warn-modal:123456789012345678'
    });

    // Verify-Modul besitzt weder Select-Menüs noch Modals
    expect(
      await registry.dispatchInteraction(verifyLike, select as unknown as Interaction, ctx)
    ).toBe(false);
    expect(
      await registry.dispatchInteraction(verifyLike, modal as unknown as Interaction, ctx)
    ).toBe(false);

    expect(
      await registry.dispatchInteraction(systemLike, select as unknown as Interaction, ctx)
    ).toBe(true);
    expect(
      await registry.dispatchInteraction(systemLike, modal as unknown as Interaction, ctx)
    ).toBe(true);

    expect(mocks.adminSelect).toHaveBeenCalledTimes(1);
    expect(mocks.adminModal).toHaveBeenCalledTimes(1);

    ctx.db.close();
    db.close();
  });

  it('ignoriert unbekannte Interaktionstypen', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);
    const { systemLike } = createTwoModules();
    const ctx = createContext();

    const other = createMockInteraction({ kind: 'other' });
    expect(
      await registry.dispatchInteraction(systemLike, other as unknown as Interaction, ctx)
    ).toBe(false);

    ctx.db.close();
    db.close();
  });

  it('fängt Handler-Fehler ab und antwortet dem Benutzer ephemer', async () => {
    const db = createClient({ url: ':memory:' });
    const registry = new BotRegistry(baseConfig, db);
    const ctx = createContext();

    const failingModule: IBotModule = {
      ...dummyModule,
      buttons: [
        {
          customId: 'boom',
          execute: async () => {
            throw new Error('Kaputt');
          }
        }
      ],
      selectMenus: [
        {
          customId: 'boom-select',
          execute: async () => {
            throw new Error('Kaputt');
          }
        }
      ],
      modals: [
        {
          customId: 'boom-modal',
          execute: async () => {
            throw new Error('Kaputt');
          }
        }
      ]
    };

    for (const [kind, customId] of [
      ['button', 'boom'],
      ['select', 'boom-select'],
      ['modal', 'boom-modal']
    ] as const) {
      const interaction = createMockInteraction({ kind, customId });
      await expect(
        registry.dispatchInteraction(failingModule, interaction as unknown as Interaction, ctx)
      ).resolves.toBe(true);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true, content: expect.stringContaining('❌') })
      );
    }

    ctx.db.close();
    db.close();
  });
});
