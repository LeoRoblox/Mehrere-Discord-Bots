import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from 'discord.js';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type {
  BotContext,
  ISlashCommand,
  IButtonHandler,
  ISelectMenuHandler,
  IModalHandler
} from '../../../core/types.js';

const ADMIN_ROLES = new Set([
  '1548429120948670616',
  '1548458441566330970',
  '1548458919074988082',
  '1548459353504223274',
  '1548459569867526174'
]);

const durations = [
  ['1 Minute', 60_000],
  ['2,5 Minuten', 150_000],
  ['10 Minuten', 600_000],
  ['1 Stunde', 3_600_000],
  ['13 Stunden', 46_800_000],
  ['4 Tage', 345_600_000],
  ['7 Tage', 604_800_000],
  ['20 Tage', 1_728_000_000]
] as const;

const componentsV2 = (title: string, text: string, rows: unknown[] = []) => ({
  flags: MessageFlags.IsComponentsV2 as number,
  components: [{ type: 17, components: [{ type: 10, content: `## ${title}\n\n${text}` }, ...rows] }]
});

const buttonRow = (targetId: string) => ({
  type: 1,
  components: [
    { type: 2, style: 1, custom_id: `admin:timeout:${targetId}`, label: '🕒 Timeout' },
    { type: 2, style: 4, custom_id: `admin:kick:${targetId}`, label: 'Kicken' },
    { type: 2, style: 4, custom_id: `admin:ban:${targetId}`, label: 'Bannen' },
    { type: 2, style: 2, custom_id: `admin:warn:${targetId}`, label: 'Warnen' },
    { type: 2, style: 2, custom_id: `admin:unwarn:${targetId}`, label: 'Unwarn' },
    { type: 2, style: 2, custom_id: `admin:info:${targetId}`, label: 'User Infos' }
  ]
});

function hasAdminRole(member: GuildMember | null): boolean {
  if (!member) return false;
  // Bei uncached Interaktionen kann Discord die Rollen auch als ID-Array liefern.
  const roles = Array.isArray((member as unknown as { roles: unknown }).roles)
    ? (member as unknown as { roles: string[] }).roles
    : [...member.roles.cache.keys()];
  return roles.some((role) => ADMIN_ROLES.has(role));
}

function targetIdFrom(customId: string): string {
  return customId.split(':')[2] ?? '';
}

export const adminpanelCommand: ISlashCommand = {
  data: new SlashCommandBuilder()
    .setName('adminpanel')
    .setDescription('Öffnet das Admin Panel für einen Server-Benutzer.')
    .addUserOption((option) =>
      option.setName('user').setDescription('Der zu verwaltende Benutzer.').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild || !hasAdminRole(interaction.member as GuildMember)) {
      await interaction.reply({
        content: '❌ Du hast keine Berechtigung für dieses Admin Panel.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const user = interaction.options.getUser('user', true);
    const target = await interaction.guild.members.fetch(user.id);
    await interaction.reply({
      ...componentsV2(
        `ADMIN PANEL ${target.displayName}`,
        'Willkommen im Admin Panel. Wähle bei dem Button aus wie du diese Person bestrafen willst oder von dieser Person wissen willst.',
        [buttonRow(target.id)]
      )
    });
  }
};

export const adminButtonHandler: IButtonHandler = {
  customId: /^admin:(timeout|kick|ban|warn|unwarn|info):\d+$/,
  async execute(interaction: ButtonInteraction, context: BotContext): Promise<void> {
    const targetId = targetIdFrom(interaction.customId);
    if (!interaction.guild || !hasAdminRole(interaction.member as GuildMember)) {
      await interaction.reply({ content: '❌ Keine Berechtigung.', flags: MessageFlags.Ephemeral });
      return;
    }
    const target = await interaction.guild.members.fetch(targetId);
    const action = interaction.customId.split(':')[1];
    if (action === 'info') {
      await interaction.reply({ content: 'Kommt bald.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === 'timeout') {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`admin:timeout-select:${targetId}`)
        .setPlaceholder('Wähle die länge aus..')
        .addOptions(
          durations.map(([label, ms]) =>
            new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(ms))
          )
        );
      await interaction.reply({
        content: 'Wie lange möchtest du die Person Timeouten?',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (action === 'warn') {
      const open = new ButtonBuilder()
        .setCustomId(`admin:warn-form:${targetId}`)
        .setLabel('Formular öffnen')
        .setStyle(ButtonStyle.Primary);
      await interaction.reply({
        content: 'Warum möchtest du die Person warnen?',
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(open)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (action === 'unwarn') {
      const rows = await context.db.execute({
        sql: 'SELECT id, reason FROM admin_warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at ASC',
        args: [interaction.guild.id, targetId]
      });
      if (!rows.rows.length) {
        await interaction.reply({
          content: 'Diese Person hat keine aktiven Warns.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`admin:unwarn-select:${targetId}`)
        .setPlaceholder('Wähle einen Warn aus..')
        .addOptions(
          rows.rows.map((row, index) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`Warn ${index + 1}: ${String(row.reason).slice(0, 90)}`)
              .setValue(String(row.id))
          )
        );
      await interaction.reply({
        content: 'Wähle die Warnung aus, die aufgehoben werden soll:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (action === 'kick' || action === 'ban') {
      if (!target.moderatable) {
        await interaction.reply({
          content: '❌ Ich kann diesen Benutzer nicht moderieren.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (action === 'kick') await target.kick(`Admin Panel von ${interaction.user.tag}`);
      else await target.ban({ reason: `Admin Panel von ${interaction.user.tag}` });
      await interaction.reply({
        content: `✅ ${action === 'kick' ? 'Benutzer gekickt.' : 'Benutzer gebannt.'}`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};

export const adminSelectHandler: ISelectMenuHandler = {
  customId: /^admin:(timeout-select|unwarn-select):\d+$/,
  async execute(interaction: StringSelectMenuInteraction, context: BotContext): Promise<void> {
    const [, , targetId] = interaction.customId.split(':');
    if (!interaction.guild || !hasAdminRole(interaction.member as GuildMember)) {
      await interaction.reply({ content: '❌ Keine Berechtigung.', flags: MessageFlags.Ephemeral });
      return;
    }
    const target = await interaction.guild.members.fetch(targetId);
    if (interaction.customId.startsWith('admin:timeout-select')) {
      await target.timeout(
        Number(interaction.values[0]),
        `Admin Panel von ${interaction.user.tag}`
      );
      await interaction.update({ content: '✅ Timeout wurde gesetzt.', components: [] });
      return;
    }
    await context.db.execute({
      sql: 'DELETE FROM admin_warnings WHERE id = ? AND guild_id = ? AND user_id = ?',
      args: [Number(interaction.values[0]), interaction.guild.id, targetId]
    });
    const count = await warningCount(context, interaction.guild.id, targetId);
    await target.user
      .send(
        componentsV2(
          'GLÜCKWUNSCH',
          `Dein Warn wurde aufgehoben. Du hast jetzt ${count} von 5 Warns.`
        ) as never
      )
      .catch(() => null);
    await interaction.update({
      content: `✅ Warn aufgehoben. Der Benutzer hat jetzt ${count} von 5 Warns.`,
      components: []
    });
  }
};

export const adminModalHandler: IModalHandler = {
  customId: /^admin:warn-modal:\d+$/,
  async execute(interaction: ModalSubmitInteraction, context: BotContext): Promise<void> {
    const targetId = targetIdFrom(interaction.customId);
    if (!interaction.guild || !hasAdminRole(interaction.member as GuildMember)) {
      await interaction.reply({ content: '❌ Keine Berechtigung.', flags: MessageFlags.Ephemeral });
      return;
    }
    const count = await warningCount(context, interaction.guild.id, targetId);
    if (count >= 5) {
      await interaction.reply({
        content: 'Diese Person hat bereits das Maximum von 5 Warns.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const reason = interaction.fields.getTextInputValue('reason');
    await context.db.execute({
      sql: 'INSERT INTO admin_warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)',
      args: [interaction.guild.id, targetId, interaction.user.id, reason]
    });
    const newCount = count + 1;
    const target = await interaction.guild.members.fetch(targetId);
    await target.user
      .send(
        componentsV2(
          'WARNUNG',
          `Du wurdest gewarnt. Bitte halte dich jetzt an die Regeln bevor du bestraft wirst. Du hast jetzt ${newCount} von 5 Warns.`
        ) as never
      )
      .catch(() => null);
    await interaction.reply({
      content: `✅ Warnung hinzugefügt. Der Benutzer hat jetzt ${newCount} von 5 Warns.`,
      flags: MessageFlags.Ephemeral
    });
  }
};

export const adminWarnFormHandler: IButtonHandler = {
  customId: /^admin:warn-form:\d+$/,
  async execute(interaction: ButtonInteraction): Promise<void> {
    if (!hasAdminRole(interaction.member as GuildMember)) {
      await interaction.reply({ content: '❌ Keine Berechtigung.', flags: MessageFlags.Ephemeral });
      return;
    }
    const targetId = targetIdFrom(interaction.customId);
    const modal = new ModalBuilder()
      .setCustomId(`admin:warn-modal:${targetId}`)
      .setTitle('Warnung erstellen')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Grund')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
        )
      );
    await interaction.showModal(modal);
  }
};

async function warningCount(context: BotContext, guildId: string, userId: string): Promise<number> {
  const result = await context.db.execute({
    sql: 'SELECT COUNT(*) AS count FROM admin_warnings WHERE guild_id = ? AND user_id = ?',
    args: [guildId, userId]
  });
  return Number(result.rows[0]?.count ?? 0);
}

// Kept as a named export to make the interaction contract easy to test.
export const adminUserSelectBuilder = () =>
  new UserSelectMenuBuilder()
    .setPlaceholder('Server-Benutzer auswählen')
    .setCustomId('admin-user-select-unused');
