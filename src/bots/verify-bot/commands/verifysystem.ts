import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember
} from 'discord.js';
import type { ISlashCommand, BotContext } from '../../../core/types.js';
import { VERIFY_BOT_CONFIG } from '../config.js';

/**
 * Überprüft, ob ein Benutzer zur Ausführung von /verifysystem autorisiert ist.
 * Autorisierung erfolgt über BOT_OWNER_ID ODER über eine der beiden definierten Rollen-IDs.
 */
export function canExecuteVerifySystem(
  userId: string,
  userRoleIds: string[],
  ownerId: string
): boolean {
  if (userId === ownerId) {
    return true;
  }
  return VERIFY_BOT_CONFIG.ALLOWED_ROLE_IDS.some((roleId) => userRoleIds.includes(roleId));
}

/**
 * Erstellt die Components V2 Container-Struktur
 */
export function buildRulesContainer(): ContainerBuilder {
  const verifyButton = new ButtonBuilder()
    .setCustomId(VERIFY_BOT_CONFIG.VERIFY_BUTTON_ID)
    .setLabel(VERIFY_BOT_CONFIG.BUTTON_LABEL)
    .setEmoji(VERIFY_BOT_CONFIG.BUTTON_EMOJI)
    .setStyle(ButtonStyle.Success);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(verifyButton);

  return new ContainerBuilder()
    .setAccentColor(VERIFY_BOT_CONFIG.ACCENT_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${VERIFY_BOT_CONFIG.RULES_TITLE}\n\n${VERIFY_BOT_CONFIG.RULES_CONTENT}`
      )
    )
    .addActionRowComponents(actionRow);
}

/**
 * Erstellt den universellen Embed-Fallback für Discord-Clients und Server,
 * falls Components V2 API-seitig noch nicht freigeschaltet sind
 */
export function buildRulesFallback() {
  const verifyButton = new ButtonBuilder()
    .setCustomId(VERIFY_BOT_CONFIG.VERIFY_BUTTON_ID)
    .setLabel(VERIFY_BOT_CONFIG.BUTTON_LABEL)
    .setEmoji(VERIFY_BOT_CONFIG.BUTTON_EMOJI)
    .setStyle(ButtonStyle.Success);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(verifyButton);

  const embed = new EmbedBuilder()
    .setTitle(VERIFY_BOT_CONFIG.RULES_TITLE)
    .setDescription(VERIFY_BOT_CONFIG.RULES_CONTENT)
    .setColor(VERIFY_BOT_CONFIG.ACCENT_COLOR)
    .setFooter({ text: 'Klicke auf den Button unten, um dich zu verifizieren.' });

  return { embed, actionRow };
}

export const verifysystemCommand: ISlashCommand = {
  data: new SlashCommandBuilder()
    .setName('verifysystem')
    .setDescription('Richtet das offizielle Regelwerk und Verifizierungs-System im Kanal ein')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: '❌ Dieser Befehl kann nur innerhalb eines Discord-Servers verwendet werden.',
        ephemeral: true
      });
      return;
    }

    // 1. Berechtigungsprüfung (Owner-ID oder vorgegebene Rollen)
    const member = interaction.member as GuildMember | null;
    const memberRoleIds: string[] =
      member && 'roles' in member
        ? Array.isArray(member.roles)
          ? (member.roles as string[])
          : Array.from(member.roles.cache.keys())
        : [];

    const isAuthorized = canExecuteVerifySystem(
      interaction.user.id,
      memberRoleIds,
      context.ownerId
    );

    if (!isAuthorized) {
      await interaction.reply({
        content: '❌ Du hast keine Berechtigung, diesen Befehl auszuführen.',
        ephemeral: true
      });
      return;
    }

    const channel = interaction.channel;
    if (!channel || !('send' in channel)) {
      await interaction.reply({
        content: '❌ Der aktuelle Kanal unterstützt das Senden von Nachrichten nicht.',
        ephemeral: true
      });
      return;
    }

    // 2. Sende die Regelwerk-Nachricht mit Verifizierungs-Button
    try {
      let sent = false;

      // Versuch 1: Moderner Discord Components V2 Container
      try {
        const container = buildRulesContainer();
        await channel.send({
          components: [container],
          flags: MessageFlags.IsComponentsV2
        });
        sent = true;
      } catch (cv2Error) {
        context.logger.warn(
          'Components V2 Senden nicht möglich, wechsle auf Embed-Fallback:',
          cv2Error
        );
      }

      // Versuch 2: Zuverlässiger Embed-Fallback, falls V2 im Guild/API-Kontext fehlschlägt
      if (!sent) {
        const { embed, actionRow } = buildRulesFallback();
        await channel.send({
          embeds: [embed],
          components: [actionRow]
        });
      }

      // 3. Im Audit-Log protokollieren
      await context.db
        .execute({
          sql: 'INSERT INTO verify_audit_log (user_id, guild_id, action, details) VALUES (?, ?, ?, ?)',
          args: [
            interaction.user.id,
            interaction.guildId ?? 'unknown',
            'SETUP_VERIFYSYSTEM',
            `Regelwerk im Kanal ${interaction.channelId} gepostet`
          ]
        })
        .catch((dbErr) => {
          context.logger.error('Fehler beim Schreiben des Audit-Logs:', dbErr);
        });

      // 4. Bestätigung an den Moderator
      await interaction.reply({
        content: '✅ Das Verifizierungs-System wurde erfolgreich in diesem Kanal eingerichtet!',
        ephemeral: true
      });
    } catch (error) {
      context.logger.error('Fehler beim Einrichten des Verifizierungs-Systems:', error);
      const msg =
        '❌ Fehler beim Senden des Regelwerks. Bitte prüfe die Bot-Berechtigungen im Kanal.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    }
  }
};
