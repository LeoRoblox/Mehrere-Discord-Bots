import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Client as LibsqlClient } from '@libsql/client';
import {
  DiscordAPIError,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from 'discord.js';
import { adminpanelCommand } from '../../src/bots/system-bot/commands/adminpanel.js';
import {
  adminPanelButtonHandler,
  adminPanelWarnFormButtonHandler
} from '../../src/bots/system-bot/handlers/panel-buttons.js';
import {
  adminPanelTimeoutSelectHandler,
  adminPanelUnwarnSelectHandler
} from '../../src/bots/system-bot/handlers/select-menus.js';
import { adminPanelWarnModalHandler } from '../../src/bots/system-bot/handlers/warn-modal.js';
import {
  addWarning,
  countActiveWarnings,
  listActiveWarnings
} from '../../src/bots/system-bot/warnings.js';
import {
  ADMIN_ROLE_1,
  ADMIN_ROLE_5,
  BOT_USER_ID,
  GUILD_ID,
  MOD_ID,
  RANDOM_ROLE,
  TARGET_ID,
  createContext,
  createMigratedDb,
  createMockGuild,
  createMockInteraction,
  createMockMember,
  lastCallArg
} from './helpers.js';

const EPHEMERAL = MessageFlags.Ephemeral;

function discordError(code: number, message = 'Missing Permissions'): DiscordAPIError {
  return new DiscordAPIError({ code, message }, code, 403, 'PUT', 'https://discord.com/api', {});
}

function textOf(payload: Record<string, unknown>): string {
  return String(payload.content ?? '');
}

function findTextDisplays(payload: Record<string, unknown>): string[] {
  const components = payload.components as Array<{ toJSON: () => unknown }> | undefined;
  if (!components) return [];
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const obj = node as { type?: number; content?: string; components?: unknown[] };
    if (obj.type === 10 && typeof obj.content === 'string') texts.push(obj.content);
    if (Array.isArray(obj.components)) obj.components.forEach(walk);
  };
  components.forEach((c) => walk(c.toJSON()));
  return texts;
}

describe('System-Bot: /adminpanel Command', () => {
  let db: LibsqlClient;

  beforeEach(async () => {
    db = await createMigratedDb();
  });

  afterEach(() => {
    db.close();
  });

  it('verweigert Benutzern ohne Adminpanel-Rolle den Zugriff (ephemer)', async () => {
    const target = createMockMember();
    const interaction = createMockInteraction({
      executorRoleIds: [RANDOM_ROLE],
      targetUser: target.user,
      targetMember: target
    });

    await adminpanelCommand.execute(
      interaction as unknown as ChatInputCommandInteraction,
      createContext(db, interaction)
    );

    const payload = lastCallArg(interaction.reply);
    expect(payload.flags).toBe(EPHEMERAL);
    expect(textOf(payload)).toContain('keine Berechtigung');
    expect(payload.components).toBeUndefined();
  });

  it('antwortet mit einem Components-V2-Panel: Titel, Text und Buttons', async () => {
    const target = createMockMember({ displayName: 'Max' });
    const interaction = createMockInteraction({
      executorRoleIds: [ADMIN_ROLE_5],
      targetUser: target.user,
      targetMember: target
    });

    await adminpanelCommand.execute(
      interaction as unknown as ChatInputCommandInteraction,
      createContext(db, interaction)
    );

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const payload = lastCallArg(interaction.reply);
    expect(Number(payload.flags) & MessageFlags.IsComponentsV2).toBe(MessageFlags.IsComponentsV2);

    const texts = findTextDisplays(payload);
    expect(texts[0]).toBe('# ADMIN PANEL Max');
    expect(texts[1]).toBe(
      'Willkommen im Admin Panel. Wähle bei dem Button aus wie du diese Person bestrafen willst oder von dieser Person wissen willst.'
    );
  });

  it('lehnt Benutzer ab, die kein Mitglied des Servers sind', async () => {
    const interaction = createMockInteraction({
      targetUser: { id: TARGET_ID, tag: 'fremd', bot: false, displayName: 'Fremd' },
      targetMember: null
    });

    await adminpanelCommand.execute(
      interaction as unknown as ChatInputCommandInteraction,
      createContext(db, interaction)
    );

    const payload = lastCallArg(interaction.reply);
    expect(payload.flags).toBe(EPHEMERAL);
    expect(textOf(payload)).toContain('kein Mitglied dieses Servers');
  });

  it('lehnt Bots und den ausführenden Benutzer selbst als Ziel ab', async () => {
    const bot = createMockMember({ bot: true });
    const botInteraction = createMockInteraction({ targetUser: bot.user, targetMember: bot });
    await adminpanelCommand.execute(
      botInteraction as unknown as ChatInputCommandInteraction,
      createContext(db, botInteraction)
    );
    expect(textOf(lastCallArg(botInteraction.reply))).toContain('Bots');

    const self = createMockMember({ id: MOD_ID });
    const selfInteraction = createMockInteraction({ targetUser: self.user, targetMember: self });
    await adminpanelCommand.execute(
      selfInteraction as unknown as ChatInputCommandInteraction,
      createContext(db, selfInteraction)
    );
    expect(textOf(lastCallArg(selfInteraction.reply))).toContain('dich selbst');
  });
});

describe('System-Bot: Adminpanel-Buttons', () => {
  let db: LibsqlClient;

  beforeEach(async () => {
    db = await createMigratedDb();
  });

  afterEach(() => {
    db.close();
  });

  it('prüft die Rollen bei JEDER Button-Interaktion serverseitig', async () => {
    for (const action of ['timeout', 'kick', 'ban', 'warn', 'unwarn', 'info']) {
      const target = createMockMember();
      const interaction = createMockInteraction({
        guild: createMockGuild(target),
        executorRoleIds: [RANDOM_ROLE],
        customId: `sysadmin:${action}:${TARGET_ID}`
      });

      await adminPanelButtonHandler.execute(
        interaction as unknown as ButtonInteraction,
        createContext(db, interaction)
      );

      expect(lastCallArg(interaction.reply).flags).toBe(EPHEMERAL);
      expect(textOf(lastCallArg(interaction.reply))).toContain('keine Berechtigung');
      expect(target.kick).not.toHaveBeenCalled();
      expect(target.ban).not.toHaveBeenCalled();
      expect(target.timeout).not.toHaveBeenCalled();
    }
  });

  it('User Infos → ephemer "Kommt bald."', async () => {
    const interaction = createMockInteraction({ customId: `sysadmin:info:${TARGET_ID}` });

    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );

    expect(lastCallArg(interaction.reply)).toEqual({ content: 'Kommt bald.', flags: EPHEMERAL });
  });

  it('Timeout → ephemere Frage mit String-Select-Menü und Placeholder', async () => {
    const interaction = createMockInteraction({ customId: `sysadmin:timeout:${TARGET_ID}` });

    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: EPHEMERAL });
    const payload = lastCallArg(interaction.editReply);
    expect(textOf(payload)).toBe('Wie lange möchtest du die Person Timeouten?');

    const row = (payload.components as Array<{ toJSON: () => unknown }>)[0].toJSON() as {
      components: Array<{ type: number; placeholder: string; options: unknown[] }>;
    };
    expect(row.components[0].type).toBe(3); // StringSelect
    expect(row.components[0].placeholder).toBe('Wähle die länge aus..');
    expect(row.components[0].options).toHaveLength(8);
  });

  it('Kicken → kickt das Mitglied und bestätigt ephemer', async () => {
    const target = createMockMember();
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:kick:${TARGET_ID}`
    });

    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );

    expect(target.kick).toHaveBeenCalledTimes(1);
    expect(String(target.kick.mock.calls[0][0])).toContain('Admin Panel');
    expect(textOf(lastCallArg(interaction.editReply))).toContain('gekickt');
  });

  it('Kicken → meldet fehlende Bot-Rechte (Discord 50013) sauber und ephemer', async () => {
    const target = createMockMember();
    target.kick.mockRejectedValueOnce(discordError(50013));
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:kick:${TARGET_ID}`
    });

    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: EPHEMERAL });
    const text = textOf(lastCallArg(interaction.editReply));
    expect(text).toContain('❌');
    expect(text).toContain('Berechtigungen');
  });

  it('Kicken → verweigert, wenn der Bot das Mitglied laut Hierarchie nicht kicken kann', async () => {
    const target = createMockMember({ kickable: false });
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:kick:${TARGET_ID}`
    });

    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );

    expect(target.kick).not.toHaveBeenCalled();
    expect(textOf(lastCallArg(interaction.editReply))).toContain('nicht kicken');
  });

  it('Bannen → bannt das Mitglied; bei fehlenden Rechten (50013) klare Fehlermeldung', async () => {
    const target = createMockMember();
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:ban:${TARGET_ID}`
    });
    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );
    expect(target.ban).toHaveBeenCalledTimes(1);
    expect(textOf(lastCallArg(interaction.editReply))).toContain('gebannt');

    const failing = createMockMember();
    failing.ban.mockRejectedValueOnce(discordError(50013));
    const failingInteraction = createMockInteraction({
      guild: createMockGuild(failing),
      customId: `sysadmin:ban:${TARGET_ID}`
    });
    await adminPanelButtonHandler.execute(
      failingInteraction as unknown as ButtonInteraction,
      createContext(db, failingInteraction)
    );
    expect(textOf(lastCallArg(failingInteraction.editReply))).toContain('Berechtigungen');
  });

  it('Bannen → bannt per ID, wenn die Person den Server bereits verlassen hat', async () => {
    const guild = createMockGuild(null);
    const interaction = createMockInteraction({ guild, customId: `sysadmin:ban:${TARGET_ID}` });

    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );

    expect(guild.members.ban).toHaveBeenCalledWith(TARGET_ID, expect.any(Object));
    expect(textOf(lastCallArg(interaction.editReply))).toContain('gebannt');
  });

  it('Kicken → meldet, wenn die Person kein Mitglied mehr ist', async () => {
    const interaction = createMockInteraction({
      guild: createMockGuild(null),
      customId: `sysadmin:kick:${TARGET_ID}`
    });

    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );

    expect(textOf(lastCallArg(interaction.editReply))).toContain('nicht (mehr) Mitglied');
  });

  it('schützt vor Bestrafung von Personen mit gleicher/höherer Rolle, Server-Owner, Bot und sich selbst', async () => {
    // Gleich hohe Rolle
    const peer = createMockMember({ highestPosition: 10 });
    const peerInteraction = createMockInteraction({
      guild: createMockGuild(peer),
      executorHighestPosition: 10,
      customId: `sysadmin:ban:${TARGET_ID}`
    });
    await adminPanelButtonHandler.execute(
      peerInteraction as unknown as ButtonInteraction,
      createContext(db, peerInteraction)
    );
    expect(peer.ban).not.toHaveBeenCalled();
    expect(textOf(lastCallArg(peerInteraction.editReply))).toContain('höchste Rolle');

    // Server-Owner als Ziel
    const owner = createMockMember({ id: createMockGuild(null).ownerId });
    const ownerInteraction = createMockInteraction({
      guild: createMockGuild(owner),
      customId: `sysadmin:kick:${owner.id}`
    });
    await adminPanelButtonHandler.execute(
      ownerInteraction as unknown as ButtonInteraction,
      createContext(db, ownerInteraction)
    );
    expect(owner.kick).not.toHaveBeenCalled();
    expect(textOf(lastCallArg(ownerInteraction.editReply))).toContain('Server-Inhaber');

    // Der System-Bot selbst
    const bot = createMockMember({ id: BOT_USER_ID, bot: true });
    const botInteraction = createMockInteraction({
      guild: createMockGuild(bot),
      customId: `sysadmin:kick:${BOT_USER_ID}`
    });
    await adminPanelButtonHandler.execute(
      botInteraction as unknown as ButtonInteraction,
      createContext(db, botInteraction)
    );
    expect(bot.kick).not.toHaveBeenCalled();

    // Sich selbst
    const self = createMockMember({ id: MOD_ID });
    const selfInteraction = createMockInteraction({
      guild: createMockGuild(self),
      customId: `sysadmin:timeout:${MOD_ID}`
    });
    await adminPanelButtonHandler.execute(
      selfInteraction as unknown as ButtonInteraction,
      createContext(db, selfInteraction)
    );
    expect(textOf(lastCallArg(selfInteraction.editReply))).toContain('dich selbst');
  });

  it('Warnen → ephemere Frage mit Button "Formular öffnen"', async () => {
    const interaction = createMockInteraction({ customId: `sysadmin:warn:${TARGET_ID}` });

    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );

    const payload = lastCallArg(interaction.editReply);
    expect(textOf(payload)).toBe('Warum möchtest du die Person warnen?');
    const row = (payload.components as Array<{ toJSON: () => unknown }>)[0].toJSON() as {
      components: Array<{ label: string; custom_id: string }>;
    };
    expect(row.components[0].label).toBe('Formular öffnen');
    expect(row.components[0].custom_id).toBe(`sysadmin:warn-form:${TARGET_ID}`);
  });

  it('Warnen → blockiert bereits bei 5 aktiven Warnungen', async () => {
    for (let i = 0; i < 5; i++) {
      await addWarning(db, {
        guildId: GUILD_ID,
        userId: TARGET_ID,
        moderatorId: MOD_ID,
        reason: `W${i}`
      });
    }
    const interaction = createMockInteraction({ customId: `sysadmin:warn:${TARGET_ID}` });

    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );

    const payload = lastCallArg(interaction.editReply);
    expect(textOf(payload)).toContain('Maximum von 5');
    expect(payload.components).toBeUndefined();
  });

  it('Unwarn → ohne aktive Warnungen ephemerer Hinweis, sonst Select-Menü mit allen aktiven Warnungen', async () => {
    const empty = createMockInteraction({ customId: `sysadmin:unwarn:${TARGET_ID}` });
    await adminPanelButtonHandler.execute(
      empty as unknown as ButtonInteraction,
      createContext(db, empty)
    );
    expect(textOf(lastCallArg(empty.editReply))).toContain('keine aktiven Warns');

    await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'A'
    });
    await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'B'
    });

    const interaction = createMockInteraction({ customId: `sysadmin:unwarn:${TARGET_ID}` });
    await adminPanelButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );

    const payload = lastCallArg(interaction.editReply);
    const row = (payload.components as Array<{ toJSON: () => unknown }>)[0].toJSON() as {
      components: Array<{ placeholder: string; options: Array<{ description: string }> }>;
    };
    expect(row.components[0].placeholder).toBe('Wähle einen Warn aus..');
    expect(row.components[0].options.map((o) => o.description)).toEqual(['A', 'B']);
  });

  it('"Formular öffnen" → öffnet das Modal (nur mit Rolle, nicht bei 5 Warnungen)', async () => {
    const interaction = createMockInteraction({ customId: `sysadmin:warn-form:${TARGET_ID}` });
    await adminPanelWarnFormButtonHandler.execute(
      interaction as unknown as ButtonInteraction,
      createContext(db, interaction)
    );
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = (interaction.showModal.mock.calls[0] as unknown[])[0] as {
      toJSON: () => { custom_id: string };
    };
    expect(modal.toJSON().custom_id).toBe(`sysadmin:warn-modal:${TARGET_ID}`);

    const denied = createMockInteraction({
      executorRoleIds: [RANDOM_ROLE],
      customId: `sysadmin:warn-form:${TARGET_ID}`
    });
    await adminPanelWarnFormButtonHandler.execute(
      denied as unknown as ButtonInteraction,
      createContext(db, denied)
    );
    expect(denied.showModal).not.toHaveBeenCalled();
    expect(lastCallArg(denied.reply).flags).toBe(EPHEMERAL);

    for (let i = 0; i < 5; i++) {
      await addWarning(db, {
        guildId: GUILD_ID,
        userId: TARGET_ID,
        moderatorId: MOD_ID,
        reason: `W${i}`
      });
    }
    const full = createMockInteraction({ customId: `sysadmin:warn-form:${TARGET_ID}` });
    await adminPanelWarnFormButtonHandler.execute(
      full as unknown as ButtonInteraction,
      createContext(db, full)
    );
    expect(full.showModal).not.toHaveBeenCalled();
    expect(textOf(lastCallArg(full.reply))).toContain('Maximum von 5');
  });
});

describe('System-Bot: Timeout-Select', () => {
  let db: LibsqlClient;

  beforeEach(async () => {
    db = await createMigratedDb();
  });

  afterEach(() => {
    db.close();
  });

  it('setzt den ausgewählten Zeitraum als echten Discord-Timeout', async () => {
    const target = createMockMember();
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:timeout-select:${TARGET_ID}`,
      values: ['10m']
    });

    await adminPanelTimeoutSelectHandler.execute(
      interaction as unknown as StringSelectMenuInteraction,
      createContext(db, interaction)
    );

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(target.timeout).toHaveBeenCalledTimes(1);
    expect(target.timeout.mock.calls[0][0]).toBe(600_000);
    expect(String(target.timeout.mock.calls[0][1])).toContain('10 Minuten');

    const payload = lastCallArg(interaction.editReply);
    expect(textOf(payload)).toContain('10 Minuten');
    expect(payload.components).toEqual([]);
  });

  it('akzeptiert alle acht Zeiträume mit korrekter Dauer', async () => {
    const expected: Array<[string, number]> = [
      ['1m', 60_000],
      ['2m30s', 150_000],
      ['10m', 600_000],
      ['1h', 3_600_000],
      ['13h', 46_800_000],
      ['4d', 345_600_000],
      ['7d', 604_800_000],
      ['20d', 1_728_000_000]
    ];

    for (const [value, ms] of expected) {
      const target = createMockMember();
      const interaction = createMockInteraction({
        guild: createMockGuild(target),
        customId: `sysadmin:timeout-select:${TARGET_ID}`,
        values: [value]
      });
      await adminPanelTimeoutSelectHandler.execute(
        interaction as unknown as StringSelectMenuInteraction,
        createContext(db, interaction)
      );
      expect(target.timeout.mock.calls[0][0]).toBe(ms);
    }
  });

  it('lehnt unbekannte Werte ab und setzt keinen Timeout', async () => {
    const target = createMockMember();
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:timeout-select:${TARGET_ID}`,
      values: ['999d']
    });

    await adminPanelTimeoutSelectHandler.execute(
      interaction as unknown as StringSelectMenuInteraction,
      createContext(db, interaction)
    );

    expect(target.timeout).not.toHaveBeenCalled();
    expect(textOf(lastCallArg(interaction.update))).toContain('Ungültiger Zeitraum');
  });

  it('prüft Rollen und Bot-Rechte (moderatable) vor dem Timeout', async () => {
    const target = createMockMember();
    const denied = createMockInteraction({
      guild: createMockGuild(target),
      executorRoleIds: [RANDOM_ROLE],
      customId: `sysadmin:timeout-select:${TARGET_ID}`,
      values: ['1h']
    });
    await adminPanelTimeoutSelectHandler.execute(
      denied as unknown as StringSelectMenuInteraction,
      createContext(db, denied)
    );
    expect(target.timeout).not.toHaveBeenCalled();
    expect(lastCallArg(denied.reply).flags).toBe(EPHEMERAL);

    const notModeratable = createMockMember({ moderatable: false });
    const interaction = createMockInteraction({
      guild: createMockGuild(notModeratable),
      customId: `sysadmin:timeout-select:${TARGET_ID}`,
      values: ['1h']
    });
    await adminPanelTimeoutSelectHandler.execute(
      interaction as unknown as StringSelectMenuInteraction,
      createContext(db, interaction)
    );
    expect(notModeratable.timeout).not.toHaveBeenCalled();
    expect(textOf(lastCallArg(interaction.editReply))).toContain('nicht timeouten');
  });

  it('meldet Discord-Fehler beim Timeout (50013) verständlich', async () => {
    const target = createMockMember();
    target.timeout.mockRejectedValueOnce(discordError(50013));
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:timeout-select:${TARGET_ID}`,
      values: ['1m']
    });

    await adminPanelTimeoutSelectHandler.execute(
      interaction as unknown as StringSelectMenuInteraction,
      createContext(db, interaction)
    );

    expect(textOf(lastCallArg(interaction.editReply))).toContain('Berechtigungen');
  });
});

describe('System-Bot: Warn-Modal', () => {
  let db: LibsqlClient;

  beforeEach(async () => {
    db = await createMigratedDb();
  });

  afterEach(() => {
    db.close();
  });

  it('speichert die Warnung und schickt eine Components-V2-DM mit "WARNUNG" und X von 5', async () => {
    const target = createMockMember();
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:warn-modal:${TARGET_ID}`,
      fields: { reason: 'Spam im Chat' }
    });

    await adminPanelWarnModalHandler.execute(
      interaction as unknown as ModalSubmitInteraction,
      createContext(db, interaction)
    );

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: EPHEMERAL });
    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(1);
    const [stored] = await listActiveWarnings(db, GUILD_ID, TARGET_ID);
    expect(stored.reason).toBe('Spam im Chat');
    expect(stored.moderatorId).toBe(MOD_ID);

    expect(interaction.dmSend).toHaveBeenCalledTimes(1);
    const [dmUserId, dmPayload] = interaction.dmSend.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>
    ];
    expect(dmUserId).toBe(TARGET_ID);
    expect(dmPayload.flags).toBe(MessageFlags.IsComponentsV2);
    const dmTexts = findTextDisplays(dmPayload);
    expect(dmTexts[0]).toBe('# WARNUNG');
    expect(dmTexts[1]).toBe(
      'Du wurdest gewarnt. Bitte halte dich jetzt an die Regeln bevor du bestraft wirst. Du hast jetzt 1 von 5 Warns.'
    );

    expect(textOf(lastCallArg(interaction.editReply))).toContain('1 von 5');
  });

  it('zählt korrekt hoch und verweigert die sechste Warnung', async () => {
    for (let i = 1; i <= 5; i++) {
      const target = createMockMember();
      const interaction = createMockInteraction({
        guild: createMockGuild(target),
        customId: `sysadmin:warn-modal:${TARGET_ID}`,
        fields: { reason: `Grund ${i}` }
      });
      await adminPanelWarnModalHandler.execute(
        interaction as unknown as ModalSubmitInteraction,
        createContext(db, interaction)
      );
      const dmPayload = (
        interaction.dmSend.mock.calls[0] as unknown as [string, Record<string, unknown>]
      )[1];
      expect(findTextDisplays(dmPayload)[1]).toContain(`${i} von 5 Warns`);
    }

    const target = createMockMember();
    const sixth = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:warn-modal:${TARGET_ID}`,
      fields: { reason: 'Grund 6' }
    });
    await adminPanelWarnModalHandler.execute(
      sixth as unknown as ModalSubmitInteraction,
      createContext(db, sixth)
    );

    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(5);
    expect(sixth.dmSend).not.toHaveBeenCalled();
    expect(textOf(lastCallArg(sixth.editReply))).toContain('Maximum von 5');
  });

  it('weist den Moderator darauf hin, wenn die DM nicht zugestellt werden konnte', async () => {
    const target = createMockMember();
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:warn-modal:${TARGET_ID}`,
      fields: { reason: 'Grund' }
    });
    interaction.dmSend.mockRejectedValueOnce(
      discordError(50007, 'Cannot send messages to this user')
    );

    await adminPanelWarnModalHandler.execute(
      interaction as unknown as ModalSubmitInteraction,
      createContext(db, interaction)
    );

    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(1);
    expect(textOf(lastCallArg(interaction.editReply))).toContain('nicht per Privatnachricht');
  });

  it('prüft Rollen serverseitig und speichert ohne Berechtigung nichts', async () => {
    const target = createMockMember();
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      executorRoleIds: [RANDOM_ROLE],
      customId: `sysadmin:warn-modal:${TARGET_ID}`,
      fields: { reason: 'Grund' }
    });

    await adminPanelWarnModalHandler.execute(
      interaction as unknown as ModalSubmitInteraction,
      createContext(db, interaction)
    );

    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(0);
    expect(interaction.dmSend).not.toHaveBeenCalled();
    expect(lastCallArg(interaction.reply).flags).toBe(EPHEMERAL);
  });

  it('lehnt leere Gründe ab', async () => {
    const target = createMockMember();
    const interaction = createMockInteraction({
      guild: createMockGuild(target),
      customId: `sysadmin:warn-modal:${TARGET_ID}`,
      fields: { reason: '   ' }
    });

    await adminPanelWarnModalHandler.execute(
      interaction as unknown as ModalSubmitInteraction,
      createContext(db, interaction)
    );

    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(0);
    expect(textOf(lastCallArg(interaction.reply))).toContain('Grund');
  });
});

describe('System-Bot: Unwarn-Select', () => {
  let db: LibsqlClient;

  beforeEach(async () => {
    db = await createMigratedDb();
  });

  afterEach(() => {
    db.close();
  });

  it('hebt die gewählte Warnung auf, schickt "GLÜCKWUNSCH"-DM und entfernt sie aus dem Menü', async () => {
    await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'A'
    });
    await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'B'
    });
    const [warnA] = await listActiveWarnings(db, GUILD_ID, TARGET_ID);

    const interaction = createMockInteraction({
      customId: `sysadmin:unwarn-select:${TARGET_ID}`,
      values: [String(warnA.id)]
    });

    await adminPanelUnwarnSelectHandler.execute(
      interaction as unknown as StringSelectMenuInteraction,
      createContext(db, interaction)
    );

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    const remaining = await listActiveWarnings(db, GUILD_ID, TARGET_ID);
    expect(remaining.map((w) => w.reason)).toEqual(['B']);

    // DM
    expect(interaction.dmSend).toHaveBeenCalledTimes(1);
    const [dmUserId, dmPayload] = interaction.dmSend.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>
    ];
    expect(dmUserId).toBe(TARGET_ID);
    expect(dmPayload.flags).toBe(MessageFlags.IsComponentsV2);
    const dmTexts = findTextDisplays(dmPayload);
    expect(dmTexts[0]).toBe('# GLÜCKWUNSCH');
    expect(dmTexts[1]).toBe('Dein Warn wurde aufgehoben. Du hast jetzt 1 von 5 Warns.');

    // Aktualisiertes Menü enthält die aufgehobene Warnung nicht mehr
    const payload = lastCallArg(interaction.editReply);
    expect(textOf(payload)).toContain('1 von 5');
    const row = (payload.components as Array<{ toJSON: () => unknown }>)[0].toJSON() as {
      components: Array<{ options: Array<{ value: string; description: string }> }>;
    };
    expect(row.components[0].options.map((o) => o.value)).not.toContain(String(warnA.id));
    expect(row.components[0].options.map((o) => o.description)).toEqual(['B']);
  });

  it('entfernt das Menü, wenn keine aktiven Warnungen mehr übrig sind', async () => {
    await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'A'
    });
    const [warnA] = await listActiveWarnings(db, GUILD_ID, TARGET_ID);

    const interaction = createMockInteraction({
      customId: `sysadmin:unwarn-select:${TARGET_ID}`,
      values: [String(warnA.id)]
    });
    await adminPanelUnwarnSelectHandler.execute(
      interaction as unknown as StringSelectMenuInteraction,
      createContext(db, interaction)
    );

    const payload = lastCallArg(interaction.editReply);
    expect(textOf(payload)).toContain('0 von 5');
    expect(payload.components).toEqual([]);
    expect(
      findTextDisplays(
        (interaction.dmSend.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
      )[1]
    ).toBe('Dein Warn wurde aufgehoben. Du hast jetzt 0 von 5 Warns.');
  });

  it('meldet bereits aufgehobene Warnungen ohne erneute DM', async () => {
    await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'A'
    });
    const [warnA] = await listActiveWarnings(db, GUILD_ID, TARGET_ID);

    const first = createMockInteraction({
      customId: `sysadmin:unwarn-select:${TARGET_ID}`,
      values: [String(warnA.id)]
    });
    await adminPanelUnwarnSelectHandler.execute(
      first as unknown as StringSelectMenuInteraction,
      createContext(db, first)
    );

    const second = createMockInteraction({
      customId: `sysadmin:unwarn-select:${TARGET_ID}`,
      values: [String(warnA.id)]
    });
    await adminPanelUnwarnSelectHandler.execute(
      second as unknown as StringSelectMenuInteraction,
      createContext(db, second)
    );

    expect(second.dmSend).not.toHaveBeenCalled();
    expect(textOf(lastCallArg(second.editReply))).toContain('bereits aufgehoben');
  });

  it('prüft Rollen serverseitig und lehnt ungültige Werte ab', async () => {
    await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'A'
    });
    const [warnA] = await listActiveWarnings(db, GUILD_ID, TARGET_ID);

    const denied = createMockInteraction({
      executorRoleIds: [RANDOM_ROLE],
      customId: `sysadmin:unwarn-select:${TARGET_ID}`,
      values: [String(warnA.id)]
    });
    await adminPanelUnwarnSelectHandler.execute(
      denied as unknown as StringSelectMenuInteraction,
      createContext(db, denied)
    );
    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(1);
    expect(lastCallArg(denied.reply).flags).toBe(EPHEMERAL);

    const invalid = createMockInteraction({
      executorRoleIds: [ADMIN_ROLE_1],
      customId: `sysadmin:unwarn-select:${TARGET_ID}`,
      values: ['abc']
    });
    await adminPanelUnwarnSelectHandler.execute(
      invalid as unknown as StringSelectMenuInteraction,
      createContext(db, invalid)
    );
    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(1);
    expect(textOf(lastCallArg(invalid.update))).toContain('Ungültige Warnung');
  });
});
