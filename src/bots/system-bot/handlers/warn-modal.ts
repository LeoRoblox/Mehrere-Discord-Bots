import { MessageFlags, type ModalSubmitInteraction } from 'discord.js';
import type { IModalHandler, BotContext } from '../../../core/types.js';
import { SYSTEM_BOT_CONFIG } from '../config.js';
import { ensureAdminPanelAccess, type InteractionMember } from '../permissions.js';
import { checkTargetGuards, fetchTargetMember, sendDirectMessage } from '../moderation.js';
import { CUSTOM_ID_PATTERNS, buildWarnDmContainer, parseCustomId } from '../ui.js';
import { addWarning } from '../warnings.js';

/**
 * 4. Warnen – verarbeitet das abgesendete Warn-Formular:
 *    - prüft das Maximum von 5 aktiven Warnungen (atomar in der Datenbank),
 *    - speichert die Warnung in `system_warnings`,
 *    - sendet der Person eine private Components-V2-Nachricht („WARNUNG“).
 */
export const adminPanelWarnModalHandler: IModalHandler = {
  customId: CUSTOM_ID_PATTERNS.warnModal,

  async execute(interaction: ModalSubmitInteraction, context: BotContext): Promise<void> {
    if (!(await ensureAdminPanelAccess(interaction))) return;

    const parsed = parseCustomId(interaction.customId);
    const guild = interaction.guild;
    if (!parsed || !guild) return;

    const reason = interaction.fields
      .getTextInputValue(SYSTEM_BOT_CONFIG.WARN_REASON_INPUT_ID)
      .trim();

    if (reason.length === 0) {
      await interaction.reply({
        content: '❌ Bitte gib einen Grund für die Warnung an.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = await fetchTargetMember(guild, parsed.targetUserId);
    if (!target) {
      await interaction.editReply({
        content: '❌ Diese Person ist nicht (mehr) Mitglied dieses Servers.'
      });
      return;
    }

    const guardError = checkTargetGuards({
      action: 'warn',
      guild,
      executor: { id: interaction.user.id, member: interaction.member as InteractionMember },
      target,
      botUserId: interaction.client.user?.id
    });
    if (guardError) {
      await interaction.editReply({ content: guardError });
      return;
    }

    const max = SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS;
    const result = await addWarning(context.db, {
      guildId: guild.id,
      userId: target.id,
      moderatorId: interaction.user.id,
      reason
    });

    if (!result.added) {
      await interaction.editReply({
        content: `❌ **${target.user.tag}** hat bereits das Maximum von ${max} aktiven Warns (${result.activeCount} von ${max}). Es wurde keine weitere Warnung gespeichert.`
      });
      return;
    }

    const dmDelivered = await sendDirectMessage(
      interaction.client,
      target.id,
      buildWarnDmContainer(result.activeCount, { guildName: guild.name, reason })
    );

    context.logger.info(
      `WARN: ${interaction.user.tag} (${interaction.user.id}) → ${target.user.tag} (${target.id}) auf Server ${guild.id} (jetzt ${result.activeCount}/${max}, DM: ${dmDelivered ? 'zugestellt' : 'nicht zustellbar'}).`
    );

    const dmNote = dmDelivered
      ? '📩 Die Person wurde per Privatnachricht informiert.'
      : '⚠️ Die Person konnte nicht per Privatnachricht informiert werden (DMs deaktiviert).';

    await interaction.editReply({
      content: `✅ **${target.user.tag}** wurde gewarnt und hat jetzt **${result.activeCount} von ${max}** Warns.\n${dmNote}`
    });
  }
};
