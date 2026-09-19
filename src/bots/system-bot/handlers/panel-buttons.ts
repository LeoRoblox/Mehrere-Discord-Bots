import { MessageFlags, type ButtonInteraction, type Guild } from 'discord.js';
import type { IButtonHandler, BotContext } from '../../../core/types.js';
import { SYSTEM_BOT_CONFIG } from '../config.js';
import { ensureAdminPanelAccess, type InteractionMember } from '../permissions.js';
import {
  buildAuditReason,
  checkTargetGuards,
  describeModerationError,
  fetchTargetMember
} from '../moderation.js';
import {
  CUSTOM_ID_PATTERNS,
  buildTimeoutSelectRow,
  buildUnwarnSelectRow,
  buildWarnFormButtonRow,
  buildWarnModal,
  parseCustomId,
  type PanelAction
} from '../ui.js';
import { countActiveWarnings, listActiveWarnings } from '../warnings.js';

/**
 * Behandelt die sechs Aktions-Buttons des Adminpanels:
 * Timeout, Kicken, Bannen, Warnen, Unwarn, User Infos.
 *
 * Jede Interaktion wird serverseitig auf die Adminpanel-Rollen geprüft.
 */
export const adminPanelButtonHandler: IButtonHandler = {
  customId: CUSTOM_ID_PATTERNS.panelButtons,

  async execute(interaction: ButtonInteraction, context: BotContext): Promise<void> {
    if (!(await ensureAdminPanelAccess(interaction))) return;

    const parsed = parseCustomId(interaction.customId);
    const guild = interaction.guild;
    if (!parsed || !guild) return;

    const action = parsed.action as PanelAction;
    const targetUserId = parsed.targetUserId;

    // 6. User Infos – Platzhalter
    if (action === 'info') {
      await interaction.reply({
        content: SYSTEM_BOT_CONFIG.USER_INFO_TEXT,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Alle weiteren Aktionen benötigen Discord-/Datenbankzugriffe → zuerst ephemer deferren
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 5. Unwarn – aktive Warnungen listen (Zielperson muss dafür kein Mitglied mehr sein)
    if (action === 'unwarn') {
      await handleUnwarnList(interaction, guild, targetUserId, context);
      return;
    }

    const target = await fetchTargetMember(guild, targetUserId);

    // 3. Bannen ist auch möglich, wenn die Person den Server bereits verlassen hat
    if (!target && action === 'ban') {
      await handleBanByUserId(interaction, guild, targetUserId, context);
      return;
    }

    if (!target) {
      await interaction.editReply({
        content: '❌ Diese Person ist nicht (mehr) Mitglied dieses Servers.'
      });
      return;
    }

    const guardError = checkTargetGuards({
      action,
      guild,
      executor: { id: interaction.user.id, member: interaction.member as InteractionMember },
      target,
      botUserId: interaction.client.user?.id
    });
    if (guardError) {
      await interaction.editReply({ content: guardError });
      return;
    }

    switch (action) {
      // 1. Timeout – Dauer per Select-Menü wählen
      case 'timeout': {
        await interaction.editReply({
          content: SYSTEM_BOT_CONFIG.TIMEOUT_PROMPT,
          components: [buildTimeoutSelectRow(target.id)]
        });
        return;
      }

      // 2. Kicken
      case 'kick': {
        try {
          await target.kick(buildAuditReason(interaction.user));
        } catch (error) {
          context.logger.error(
            `Kick von ${target.id} auf Server ${guild.id} fehlgeschlagen:`,
            error
          );
          await interaction.editReply({ content: describeModerationError(error, 'Kick') });
          return;
        }
        context.logger.info(
          `KICK: ${interaction.user.tag} (${interaction.user.id}) → ${target.user.tag} (${target.id}) auf Server ${guild.id}.`
        );
        await interaction.editReply({
          content: `✅ **${target.user.tag}** wurde vom Server gekickt.`
        });
        return;
      }

      // 3. Bannen
      case 'ban': {
        try {
          await target.ban({ reason: buildAuditReason(interaction.user) });
        } catch (error) {
          context.logger.error(
            `Bann von ${target.id} auf Server ${guild.id} fehlgeschlagen:`,
            error
          );
          await interaction.editReply({ content: describeModerationError(error, 'Bann') });
          return;
        }
        context.logger.info(
          `BAN: ${interaction.user.tag} (${interaction.user.id}) → ${target.user.tag} (${target.id}) auf Server ${guild.id}.`
        );
        await interaction.editReply({
          content: `✅ **${target.user.tag}** wurde vom Server gebannt.`
        });
        return;
      }

      // 4. Warnen – Formular-Button anbieten (ein Modal kann nur direkt auf eine Interaktion folgen)
      case 'warn': {
        const activeCount = await countActiveWarnings(context.db, guild.id, target.id);
        if (activeCount >= SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS) {
          await interaction.editReply({
            content: `❌ **${target.user.tag}** hat bereits das Maximum von ${SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS} aktiven Warns. Hebe zuerst einen Warn auf.`
          });
          return;
        }
        await interaction.editReply({
          content: SYSTEM_BOT_CONFIG.WARN_PROMPT,
          components: [buildWarnFormButtonRow(target.id)]
        });
        return;
      }

      default:
        await interaction.editReply({ content: '❌ Unbekannte Aktion.' });
    }
  }
};

/** 5. Unwarn – listet alle aktiven Warnungen der Zielperson in einem Select-Menü. */
async function handleUnwarnList(
  interaction: ButtonInteraction,
  guild: Guild,
  targetUserId: string,
  context: BotContext
): Promise<void> {
  if (targetUserId === interaction.user.id) {
    await interaction.editReply({
      content: '❌ Du kannst diese Aktion nicht auf dich selbst anwenden.'
    });
    return;
  }

  const warnings = await listActiveWarnings(context.db, guild.id, targetUserId);
  if (warnings.length === 0) {
    await interaction.editReply({
      content: `ℹ️ <@${targetUserId}> hat aktuell keine aktiven Warns (0 von ${SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS}).`,
      allowedMentions: { parse: [] }
    });
    return;
  }

  await interaction.editReply({
    content: `Aktive Warns von <@${targetUserId}>: **${warnings.length} von ${SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS}**. Wähle den Warn aus, der aufgehoben werden soll:`,
    components: [buildUnwarnSelectRow(targetUserId, warnings)],
    allowedMentions: { parse: [] }
  });
}

/** 3. Bannen einer Person, die den Server bereits verlassen hat (Bann per Benutzer-ID). */
async function handleBanByUserId(
  interaction: ButtonInteraction,
  guild: Guild,
  targetUserId: string,
  context: BotContext
): Promise<void> {
  if (targetUserId === interaction.user.id) {
    await interaction.editReply({
      content: '❌ Du kannst diese Aktion nicht auf dich selbst anwenden.'
    });
    return;
  }

  try {
    await guild.members.ban(targetUserId, { reason: buildAuditReason(interaction.user) });
  } catch (error) {
    context.logger.error(
      `Bann (per ID) von ${targetUserId} auf Server ${guild.id} fehlgeschlagen:`,
      error
    );
    await interaction.editReply({ content: describeModerationError(error, 'Bann') });
    return;
  }

  context.logger.info(
    `BAN (per ID, kein Mitglied mehr): ${interaction.user.tag} (${interaction.user.id}) → ${targetUserId} auf Server ${guild.id}.`
  );
  await interaction.editReply({
    content: `✅ <@${targetUserId}> war kein Mitglied mehr und wurde vorsorglich gebannt.`,
    allowedMentions: { parse: [] }
  });
}

/**
 * Behandelt den Button „Formular öffnen“ und zeigt das Warn-Modal an.
 */
export const adminPanelWarnFormButtonHandler: IButtonHandler = {
  customId: CUSTOM_ID_PATTERNS.warnFormButton,

  async execute(interaction: ButtonInteraction, context: BotContext): Promise<void> {
    if (!(await ensureAdminPanelAccess(interaction))) return;

    const parsed = parseCustomId(interaction.customId);
    const guild = interaction.guild;
    if (!parsed || !guild) return;

    // Limit erneut prüfen, damit niemand ein Formular für eine unmögliche Warnung ausfüllt
    const activeCount = await countActiveWarnings(context.db, guild.id, parsed.targetUserId);
    if (activeCount >= SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS) {
      await interaction.reply({
        content: `❌ Diese Person hat bereits das Maximum von ${SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS} aktiven Warns. Hebe zuerst einen Warn auf.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.showModal(buildWarnModal(parsed.targetUserId));
  }
};
