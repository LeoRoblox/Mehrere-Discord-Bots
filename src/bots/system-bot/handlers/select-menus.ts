import { time, TimestampStyles, type StringSelectMenuInteraction } from 'discord.js';
import type { ISelectMenuHandler, BotContext } from '../../../core/types.js';
import { SYSTEM_BOT_CONFIG, findTimeoutDuration } from '../config.js';
import { ensureAdminPanelAccess, type InteractionMember } from '../permissions.js';
import {
  buildAuditReason,
  checkTargetGuards,
  describeModerationError,
  fetchTargetMember,
  sendDirectMessage
} from '../moderation.js';
import {
  CUSTOM_ID_PATTERNS,
  buildUnwarnDmContainer,
  buildUnwarnSelectRow,
  parseCustomId
} from '../ui.js';
import { listActiveWarnings, revokeWarning } from '../warnings.js';

/**
 * 1. Timeout – wendet den ausgewählten Zeitraum als echten Discord-Timeout an.
 */
export const adminPanelTimeoutSelectHandler: ISelectMenuHandler = {
  customId: CUSTOM_ID_PATTERNS.timeoutSelect,

  async execute(interaction: StringSelectMenuInteraction, context: BotContext): Promise<void> {
    if (!(await ensureAdminPanelAccess(interaction))) return;

    const parsed = parseCustomId(interaction.customId);
    const guild = interaction.guild;
    if (!parsed || !guild) return;

    // Nur Werte aus der festen Liste akzeptieren (niemals freie Werte aus dem Client übernehmen)
    const duration = findTimeoutDuration(interaction.values[0] ?? '');
    if (!duration) {
      await interaction.update({ content: '❌ Ungültiger Zeitraum ausgewählt.', components: [] });
      return;
    }

    await interaction.deferUpdate();

    const target = await fetchTargetMember(guild, parsed.targetUserId);
    if (!target) {
      await interaction.editReply({
        content: '❌ Diese Person ist nicht (mehr) Mitglied dieses Servers.',
        components: []
      });
      return;
    }

    const guardError = checkTargetGuards({
      action: 'timeout',
      guild,
      executor: { id: interaction.user.id, member: interaction.member as InteractionMember },
      target,
      botUserId: interaction.client.user?.id
    });
    if (guardError) {
      await interaction.editReply({ content: guardError, components: [] });
      return;
    }

    try {
      await target.timeout(
        duration.durationMs,
        buildAuditReason(interaction.user, `Timeout ${duration.label}`)
      );
    } catch (error) {
      context.logger.error(
        `Timeout von ${target.id} auf Server ${guild.id} fehlgeschlagen:`,
        error
      );
      await interaction.editReply({
        content: describeModerationError(error, 'Timeout'),
        components: []
      });
      return;
    }

    const until = new Date(Date.now() + duration.durationMs);
    context.logger.info(
      `TIMEOUT: ${interaction.user.tag} (${interaction.user.id}) → ${target.user.tag} (${target.id}) für ${duration.label} auf Server ${guild.id}.`
    );

    await interaction.editReply({
      content: `✅ **${target.user.tag}** wurde für **${duration.label}** getimeoutet (bis ${time(until, TimestampStyles.LongDateTime)}).`,
      components: []
    });
  }
};

/**
 * 5. Unwarn – hebt die ausgewählte Warnung auf, benachrichtigt die Person per DM
 *    und aktualisiert das Menü, sodass die Warnung nicht mehr erscheint.
 */
export const adminPanelUnwarnSelectHandler: ISelectMenuHandler = {
  customId: CUSTOM_ID_PATTERNS.unwarnSelect,

  async execute(interaction: StringSelectMenuInteraction, context: BotContext): Promise<void> {
    if (!(await ensureAdminPanelAccess(interaction))) return;

    const parsed = parseCustomId(interaction.customId);
    const guild = interaction.guild;
    if (!parsed || !guild) return;

    const warningId = Number.parseInt(interaction.values[0] ?? '', 10);
    if (!Number.isInteger(warningId) || warningId <= 0) {
      await interaction.update({ content: '❌ Ungültige Warnung ausgewählt.', components: [] });
      return;
    }

    if (parsed.targetUserId === interaction.user.id) {
      await interaction.update({
        content: '❌ Du kannst diese Aktion nicht auf dich selbst anwenden.',
        components: []
      });
      return;
    }

    await interaction.deferUpdate();

    const result = await revokeWarning(context.db, {
      warningId,
      guildId: guild.id,
      userId: parsed.targetUserId,
      revokedBy: interaction.user.id
    });

    const remaining = await listActiveWarnings(context.db, guild.id, parsed.targetUserId);
    const max = SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS;

    if (!result.revoked) {
      await interaction.editReply({
        content:
          remaining.length > 0
            ? `⚠️ Diese Warnung wurde bereits aufgehoben. <@${parsed.targetUserId}> hat noch **${remaining.length} von ${max}** aktive Warns.`
            : `⚠️ Diese Warnung wurde bereits aufgehoben. <@${parsed.targetUserId}> hat keine aktiven Warns mehr.`,
        components:
          remaining.length > 0 ? [buildUnwarnSelectRow(parsed.targetUserId, remaining)] : [],
        allowedMentions: { parse: [] }
      });
      return;
    }

    const dmDelivered = await sendDirectMessage(
      interaction.client,
      parsed.targetUserId,
      buildUnwarnDmContainer(result.activeCount, guild.name)
    );

    context.logger.info(
      `UNWARN: ${interaction.user.tag} (${interaction.user.id}) hob Warnung #${warningId} von ${parsed.targetUserId} auf Server ${guild.id} auf (verbleibend: ${result.activeCount}/${max}, DM: ${dmDelivered ? 'zugestellt' : 'nicht zustellbar'}).`
    );

    const dmNote = dmDelivered
      ? ''
      : '\n⚠️ Die Person konnte nicht per Privatnachricht benachrichtigt werden (DMs deaktiviert).';

    await interaction.editReply({
      content:
        remaining.length > 0
          ? `✅ Warn aufgehoben. <@${parsed.targetUserId}> hat jetzt **${result.activeCount} von ${max}** Warns.${dmNote}\nWeiteren Warn aufheben?`
          : `✅ Warn aufgehoben. <@${parsed.targetUserId}> hat jetzt **${result.activeCount} von ${max}** Warns – keine aktiven Warns mehr.${dmNote}`,
      components:
        remaining.length > 0 ? [buildUnwarnSelectRow(parsed.targetUserId, remaining)] : [],
      allowedMentions: { parse: [] }
    });
  }
};
