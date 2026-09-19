import {
  ContainerBuilder,
  TextDisplayBuilder,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type GuildMember
} from 'discord.js';
import type { IButtonHandler, BotContext } from '../../../core/types.js';
import { VERIFY_BOT_CONFIG } from '../config.js';

/**
 * Erstellt die ephemere Container V2 Bestätigungsnachricht
 */
export function buildConfirmationContainer(): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(VERIFY_BOT_CONFIG.ACCENT_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(VERIFY_BOT_CONFIG.CONFIRMATION_TEXT)
    );
}

/**
 * Erstellt den Embed-Fallback für die ephemere Bestätigungsnachricht
 */
export function buildConfirmationEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(VERIFY_BOT_CONFIG.ACCENT_COLOR)
    .setDescription(VERIFY_BOT_CONFIG.CONFIRMATION_TEXT);
}

export const verifyButtonHandler: IButtonHandler = {
  customId: VERIFY_BOT_CONFIG.VERIFY_BUTTON_ID,

  async execute(interaction: ButtonInteraction, context: BotContext): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: '❌ Diese Interaktion kann nur innerhalb eines Servers genutzt werden.',
        ephemeral: true
      });
      return;
    }

    const member = interaction.member as GuildMember | null;
    if (!member) {
      await interaction.reply({
        content: '❌ Mitgliedsdaten konnten nicht geladen werden.',
        ephemeral: true
      });
      return;
    }

    try {
      // 1. Rolle vergeben (Rollen-ID: 1550951446961332495)
      const roleId = VERIFY_BOT_CONFIG.VERIFIED_ROLE_ID;

      try {
        await member.roles.add(roleId, 'Regeln akzeptiert / Verifizierung abgeschlossen');
      } catch (roleError: unknown) {
        context.logger.error(
          `Konnte Rolle ${roleId} an User ${member.id} nicht vergeben:`,
          roleError
        );

        const discordErr = roleError as { code?: number };
        let userFacingError = '❌ Die Verifizierungs-Rolle konnte nicht zugewiesen werden.';

        // Code 50013: Fehlende Berechtigungen (z. B. Rollenhierarchie falsch konfiguriert)
        if (discordErr.code === 50013) {
          userFacingError +=
            ' Bitte stelle sicher, dass die Bot-Rolle in den Server-Einstellungen ÜBER der Verifizierungs-Rolle steht und die Berechtigung "Rollen verwalten" besitzt.';
        }

        await interaction.reply({
          content: userFacingError,
          ephemeral: true
        });
        return;
      }

      // 2. In der Turso-Datenbank erfassen (eigener Namespace verify_members)
      await context.db
        .execute({
          sql: `
          INSERT INTO verify_members (user_id, guild_id, verified_at, updated_at)
          VALUES (?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(user_id, guild_id) DO UPDATE SET updated_at = datetime('now');
        `,
          args: [member.id, interaction.guildId]
        })
        .catch((dbErr) => {
          context.logger.error('Fehler beim Aktualisieren der Datenbank (verify_members):', dbErr);
        });

      // Audit-Log Eintrag
      await context.db
        .execute({
          sql: 'INSERT INTO verify_audit_log (user_id, guild_id, action, details) VALUES (?, ?, ?, ?)',
          args: [member.id, interaction.guildId, 'VERIFY_SUCCESS', 'Regeln per Button akzeptiert']
        })
        .catch(() => null);

      // 3. Ephemere Bestätigungsnachricht (Container V2 mit Fallback)
      // "Du hast bestätigt dass du die Regeln gelesen hast. **Unwissenheit schützt nicht vor Strafe!**"
      let replied = false;

      // Versuch mit modernem Components V2 Container
      try {
        const container = buildConfirmationContainer();
        await interaction.reply({
          components: [container],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
        replied = true;
      } catch (cv2Err) {
        context.logger.warn(
          'Components V2 Ephemeral Reply nicht möglich, wechsle auf Fallback:',
          cv2Err
        );
      }

      if (!replied) {
        const embed = buildConfirmationEmbed();
        await interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      }

      context.logger.info(
        `Benutzer ${member.id} (${interaction.user.tag}) auf Guild ${interaction.guildId} erfolgreich verifiziert.`
      );
    } catch (err) {
      context.logger.error('Unerwarteter Fehler bei Button-Verifizierung:', err);
      const errMsg = '❌ Beim Abschließen der Verifizierung ist ein Fehler aufgetreten.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errMsg, ephemeral: true });
      } else {
        await interaction.reply({ content: errMsg, ephemeral: true });
      }
    }
  }
};
