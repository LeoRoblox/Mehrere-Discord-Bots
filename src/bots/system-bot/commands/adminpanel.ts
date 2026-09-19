import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember
} from 'discord.js';
import type { ISlashCommand, BotContext } from '../../../core/types.js';
import { ensureAdminPanelAccess } from '../permissions.js';
import { buildAdminPanelContainer } from '../ui.js';

/**
 * /adminpanel user:<Discord-Benutzer>
 *
 * Öffnet das Admin Panel (Components V2) für einen Benutzer des Servers.
 * Zugriff ausschließlich für die konfigurierten Adminpanel-Rollen (serverseitig geprüft).
 */
export const adminpanelCommand: ISlashCommand = {
  data: new SlashCommandBuilder()
    .setName('adminpanel')
    .setDescription('Öffnet das Admin Panel für einen Benutzer dieses Servers')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Der Benutzer des Servers, für den das Admin Panel geöffnet werden soll')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void> {
    // 1. Serverseitige Berechtigungsprüfung (nur die konfigurierten Rollen)
    if (!(await ensureAdminPanelAccess(interaction))) return;

    // 2. Zielbenutzer auflösen – muss Mitglied dieses Servers sein
    const targetUser = interaction.options.getUser('user', true);
    const targetMember = interaction.options.getMember('user') as GuildMember | null;

    if (!targetMember) {
      await interaction.reply({
        content: `❌ ${targetUser.tag} ist kein Mitglied dieses Servers. Bitte wähle einen Benutzer dieses Servers aus.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (targetUser.bot) {
      await interaction.reply({
        content: '❌ Bots können nicht über das Admin Panel verwaltet werden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (targetUser.id === interaction.user.id) {
      await interaction.reply({
        content: '❌ Du kannst das Admin Panel nicht auf dich selbst anwenden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const displayName =
      'displayName' in targetMember && typeof targetMember.displayName === 'string'
        ? targetMember.displayName
        : targetUser.displayName;

    // 3. Admin Panel als Components-V2-Nachricht senden
    const container = buildAdminPanelContainer({ id: targetUser.id, displayName });

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] }
    });

    context.logger.info(
      `Admin Panel geöffnet von ${interaction.user.tag} (${interaction.user.id}) für ${targetUser.tag} (${targetUser.id}) auf Server ${interaction.guildId}.`
    );
  }
};
