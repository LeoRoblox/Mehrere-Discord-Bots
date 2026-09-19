import { vi } from 'vitest';
import { createClient, type Client as LibsqlClient } from '@libsql/client';
import { DiscordAPIError, RESTJSONErrorCodes, type Client } from 'discord.js';
import type { BotContext, BotLogger } from '../../src/core/types.js';
import { runMigrations } from '../../src/core/migrations.js';
import { systemBotMigrations } from '../../src/bots/system-bot/migrations.js';

/* -------------------------------------------------------------------------------------------------
 * Konstanten
 * ------------------------------------------------------------------------------------------------*/

export const ADMIN_ROLE_1 = '1548429120948670616';
export const ADMIN_ROLE_5 = '1548459569867526174';
export const RANDOM_ROLE = '700000000000000001';

export const GUILD_ID = '900000000000000001';
export const OWNER_ID = '800000000000000001';
export const BOT_USER_ID = '850000000000000001';
export const MOD_ID = '810000000000000001';
export const TARGET_ID = '820000000000000001';

export const silentLogger: BotLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

/* -------------------------------------------------------------------------------------------------
 * Datenbank
 * ------------------------------------------------------------------------------------------------*/

export async function createMigratedDb(): Promise<LibsqlClient> {
  const db = createClient({ url: ':memory:' });
  await runMigrations(db, 'system-bot', systemBotMigrations);
  return db;
}

/* -------------------------------------------------------------------------------------------------
 * Discord-Mocks
 * ------------------------------------------------------------------------------------------------*/

export interface MockMemberOptions {
  id?: string;
  roleIds?: string[];
  highestPosition?: number;
  moderatable?: boolean;
  kickable?: boolean;
  bannable?: boolean;
  bot?: boolean;
  tag?: string;
  displayName?: string;
}

export function createMockMember(options: MockMemberOptions = {}) {
  const id = options.id ?? TARGET_ID;
  const roleIds = options.roleIds ?? [RANDOM_ROLE];
  return {
    id,
    displayName: options.displayName ?? 'Zielperson',
    user: {
      id,
      tag: options.tag ?? 'zielperson',
      bot: options.bot ?? false,
      displayName: options.displayName ?? 'Zielperson'
    },
    roles: {
      cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])),
      highest: { position: options.highestPosition ?? 1 }
    },
    moderatable: options.moderatable ?? true,
    kickable: options.kickable ?? true,
    bannable: options.bannable ?? true,
    timeout: vi.fn(async () => undefined),
    kick: vi.fn(async () => undefined),
    ban: vi.fn(async () => undefined)
  };
}

export type MockMember = ReturnType<typeof createMockMember>;

export function createMockGuild(target: MockMember | null) {
  return {
    id: GUILD_ID,
    name: 'Test Server',
    ownerId: OWNER_ID,
    roles: {
      cache: new Map([
        [ADMIN_ROLE_1, { id: ADMIN_ROLE_1, position: 10 }],
        [ADMIN_ROLE_5, { id: ADMIN_ROLE_5, position: 5 }],
        [RANDOM_ROLE, { id: RANDOM_ROLE, position: 1 }]
      ])
    },
    members: {
      fetch: vi.fn(async () => {
        if (!target) {
          // Echte discord.js-Fehlerklasse, wie sie die REST-API bei unbekannten Mitgliedern liefert
          throw new DiscordAPIError(
            { code: RESTJSONErrorCodes.UnknownMember, message: 'Unknown Member' },
            RESTJSONErrorCodes.UnknownMember,
            404,
            'GET',
            'https://discord.com/api/v10/guilds/x/members/y',
            {}
          );
        }
        return target;
      }),
      ban: vi.fn(async () => undefined)
    }
  };
}

export type MockGuild = ReturnType<typeof createMockGuild>;

export interface MockInteractionOptions {
  guild?: MockGuild | null;
  /** Rollen des ausführenden Moderators (Standard: Admin-Rolle 1) */
  executorRoleIds?: string[];
  executorHighestPosition?: number;
  executorId?: string;
  customId?: string;
  values?: string[];
  fields?: Record<string, string>;
  /** Für Slash-Commands: Ziel-User und Ziel-Member */
  targetUser?: { id: string; tag: string; bot: boolean; displayName: string } | null;
  targetMember?: MockMember | null;
}

export function createMockInteraction(options: MockInteractionOptions = {}) {
  const guild = options.guild === undefined ? createMockGuild(createMockMember()) : options.guild;
  const executorRoleIds = options.executorRoleIds ?? [ADMIN_ROLE_1];
  const executorId = options.executorId ?? MOD_ID;

  const dmSend = vi.fn(async () => undefined);

  const interaction = {
    customId: options.customId ?? '',
    values: options.values ?? [],
    guild,
    guildId: guild?.id ?? null,
    user: { id: executorId, tag: 'moderator', bot: false, displayName: 'Moderator' },
    member: guild
      ? {
          id: executorId,
          roles: {
            cache: new Map(executorRoleIds.map((roleId) => [roleId, { id: roleId }])),
            highest: { position: options.executorHighestPosition ?? 10 }
          }
        }
      : null,
    client: {
      user: { id: BOT_USER_ID },
      users: { send: dmSend }
    },
    replied: false,
    deferred: false,
    inGuild: () => Boolean(guild),
    reply: vi.fn(async () => {
      interaction.replied = true;
    }),
    deferReply: vi.fn(async () => {
      interaction.deferred = true;
    }),
    deferUpdate: vi.fn(async () => {
      interaction.deferred = true;
    }),
    editReply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    update: vi.fn(async () => {
      interaction.replied = true;
    }),
    showModal: vi.fn(async () => {
      interaction.replied = true;
    }),
    fields: {
      getTextInputValue: (id: string) => options.fields?.[id] ?? ''
    },
    options: {
      getUser: () => options.targetUser ?? null,
      getMember: () => options.targetMember ?? null
    },
    dmSend
  };

  return interaction;
}

export type MockInteraction = ReturnType<typeof createMockInteraction>;

export function createContext(db: LibsqlClient, interaction: MockInteraction): BotContext {
  return {
    client: interaction.client as unknown as Client,
    db,
    ownerId: OWNER_ID,
    logger: silentLogger
  };
}

/** Liefert das erste Argument des letzten Aufrufs eines Mocks (z. B. Reply-Payload). */
export function lastCallArg<T = Record<string, unknown>>(mock: {
  mock: { calls: unknown[][] };
}): T {
  const calls = mock.mock.calls;
  if (calls.length === 0) throw new Error('Mock wurde nicht aufgerufen');
  return calls[calls.length - 1][0] as T;
}
