import { describe, it, expect } from 'vitest';
import {
  extractMemberRoleIds,
  getHighestRolePosition,
  hasAdminPanelAccess,
  ensureAdminPanelAccess
} from '../../src/bots/system-bot/permissions.js';
import { SYSTEM_BOT_CONFIG } from '../../src/bots/system-bot/config.js';
import type { RepliableInteraction } from 'discord.js';
import {
  ADMIN_ROLE_1,
  ADMIN_ROLE_5,
  RANDOM_ROLE,
  createMockGuild,
  createMockInteraction,
  createMockMember,
  lastCallArg
} from './helpers.js';

describe('System-Bot: Adminpanel-Berechtigungen', () => {
  it('erlaubt genau die fünf konfigurierten Rollen', () => {
    expect([...SYSTEM_BOT_CONFIG.ADMIN_PANEL_ROLE_IDS]).toEqual([
      '1548429120948670616',
      '1548458441566330970',
      '1548458919074988082',
      '1548459353504223274',
      '1548459569867526174'
    ]);

    for (const roleId of SYSTEM_BOT_CONFIG.ADMIN_PANEL_ROLE_IDS) {
      expect(hasAdminPanelAccess([roleId])).toBe(true);
      expect(hasAdminPanelAccess([RANDOM_ROLE, roleId])).toBe(true);
    }
  });

  it('verweigert Benutzern ohne eine der Rollen den Zugriff', () => {
    expect(hasAdminPanelAccess([])).toBe(false);
    expect(hasAdminPanelAccess([RANDOM_ROLE])).toBe(false);
    expect(hasAdminPanelAccess(['1548429120948670617'])).toBe(false);
  });

  it('extrahiert Rollen-IDs aus GuildMember (roles.cache) und API-Member (roles: string[])', () => {
    const guildMember = createMockMember({ roleIds: [ADMIN_ROLE_1, RANDOM_ROLE] });
    expect(extractMemberRoleIds(guildMember as never)).toEqual([ADMIN_ROLE_1, RANDOM_ROLE]);

    const apiMember = { roles: [ADMIN_ROLE_5] };
    expect(extractMemberRoleIds(apiMember as never)).toEqual([ADMIN_ROLE_5]);

    expect(extractMemberRoleIds(null)).toEqual([]);
    expect(extractMemberRoleIds(undefined)).toEqual([]);
    expect(extractMemberRoleIds({} as never)).toEqual([]);
  });

  it('ermittelt die höchste Rollenposition auch für API-Member über den Rollen-Cache', () => {
    const guild = createMockGuild(null);
    const guildMember = createMockMember({ highestPosition: 7 });
    expect(getHighestRolePosition(guildMember as never, guild as never)).toBe(7);

    const apiMember = { roles: [RANDOM_ROLE, ADMIN_ROLE_5] };
    expect(getHighestRolePosition(apiMember as never, guild as never)).toBe(5);

    expect(getHighestRolePosition(null, guild as never)).toBe(0);
  });

  describe('ensureAdminPanelAccess (serverseitige Prüfung jeder Interaktion)', () => {
    it('lässt Mitglieder mit Adminpanel-Rolle passieren, ohne zu antworten', async () => {
      const interaction = createMockInteraction({ executorRoleIds: [ADMIN_ROLE_5] });
      await expect(
        ensureAdminPanelAccess(interaction as unknown as RepliableInteraction)
      ).resolves.toBe(true);
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('verweigert Mitglieder ohne Rolle mit ephemerer Fehlermeldung', async () => {
      const interaction = createMockInteraction({ executorRoleIds: [RANDOM_ROLE] });
      await expect(
        ensureAdminPanelAccess(interaction as unknown as RepliableInteraction)
      ).resolves.toBe(false);
      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const payload = lastCallArg(interaction.reply);
      expect(payload.flags).toBe(64); // MessageFlags.Ephemeral
      expect(String(payload.content)).toContain('keine Berechtigung');
    });

    it('verweigert die Nutzung außerhalb eines Servers (DM)', async () => {
      const interaction = createMockInteraction({ guild: null });
      await expect(
        ensureAdminPanelAccess(interaction as unknown as RepliableInteraction)
      ).resolves.toBe(false);
      expect(interaction.reply).toHaveBeenCalledTimes(1);
      expect(String(lastCallArg(interaction.reply).content)).toContain('Discord-Servers');
    });

    it('gewährt weder dem Server-Owner noch dem BOT_OWNER ohne Rolle Zugriff', async () => {
      const guild = createMockGuild(createMockMember());
      const interaction = createMockInteraction({
        guild,
        executorId: guild.ownerId,
        executorRoleIds: []
      });
      await expect(
        ensureAdminPanelAccess(interaction as unknown as RepliableInteraction)
      ).resolves.toBe(false);
    });
  });
});
