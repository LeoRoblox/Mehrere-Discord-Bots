import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
  userMention
} from 'discord.js';
import { SYSTEM_BOT_CONFIG, buildUnwarnDmText, buildWarnDmText } from './config.js';
import type { WarningRecord } from './warnings.js';

/* -------------------------------------------------------------------------------------------------
 * Custom-IDs
 * ------------------------------------------------------------------------------------------------*/

/** Aktionen, die direkt als Button im Adminpanel angeboten werden. */
export const PANEL_ACTIONS = ['timeout', 'kick', 'ban', 'warn', 'unwarn', 'info'] as const;
export type PanelAction = (typeof PANEL_ACTIONS)[number];

/** Alle Komponenten-Aktionen des Adminpanels (Buttons, Select-Menüs, Modals). */
export type ComponentAction =
  | PanelAction
  | 'warn-form'
  | 'timeout-select'
  | 'unwarn-select'
  | 'warn-modal';

const PREFIX = SYSTEM_BOT_CONFIG.CUSTOM_ID_PREFIX;
const SNOWFLAKE = '\\d{17,20}';

/** Reguläre Ausdrücke, über die die Handler des System-Bots ihre Komponenten erkennen. */
export const CUSTOM_ID_PATTERNS = {
  panelButtons: new RegExp(`^${PREFIX}:(${PANEL_ACTIONS.join('|')}):${SNOWFLAKE}$`),
  warnFormButton: new RegExp(`^${PREFIX}:warn-form:${SNOWFLAKE}$`),
  timeoutSelect: new RegExp(`^${PREFIX}:timeout-select:${SNOWFLAKE}$`),
  unwarnSelect: new RegExp(`^${PREFIX}:unwarn-select:${SNOWFLAKE}$`),
  warnModal: new RegExp(`^${PREFIX}:warn-modal:${SNOWFLAKE}$`)
} as const;

export function buildCustomId(action: ComponentAction, targetUserId: string): string {
  return `${PREFIX}:${action}:${targetUserId}`;
}

export interface ParsedCustomId {
  action: string;
  targetUserId: string;
}

/** Zerlegt eine Custom-ID des Adminpanels. Liefert null bei fremden/ungültigen IDs. */
export function parseCustomId(customId: string): ParsedCustomId | null {
  const match = new RegExp(`^${PREFIX}:([a-z-]+):(${SNOWFLAKE})$`).exec(customId);
  if (!match) return null;
  return { action: match[1], targetUserId: match[2] };
}

/* -------------------------------------------------------------------------------------------------
 * Adminpanel (Components V2)
 * ------------------------------------------------------------------------------------------------*/

export interface PanelTarget {
  id: string;
  displayName: string;
}

/** Erste Button-Reihe: Bestrafungen */
export function buildPunishmentButtonRow(targetUserId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId('timeout', targetUserId))
      .setLabel('Timeout')
      .setEmoji('🕒')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildCustomId('kick', targetUserId))
      .setLabel('Kicken')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildCustomId('ban', targetUserId))
      .setLabel('Bannen')
      .setStyle(ButtonStyle.Danger)
  );
}

/** Zweite Button-Reihe: Warnungen & Informationen */
export function buildWarningButtonRow(targetUserId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId('warn', targetUserId))
      .setLabel('Warnen')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildCustomId('unwarn', targetUserId))
      .setLabel('Unwarn')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildCustomId('info', targetUserId))
      .setLabel('User Infos')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Erstellt den Components-V2-Container des Adminpanels:
 *   Titel: ADMIN PANEL <ausgewählter Benutzer>
 *   Text:  Willkommen im Admin Panel. ...
 *   Buttons: Timeout, Kicken, Bannen, Warnen, Unwarn, User Infos
 */
export function buildAdminPanelContainer(target: PanelTarget): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(SYSTEM_BOT_CONFIG.ACCENT_COLOR_PANEL)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${SYSTEM_BOT_CONFIG.PANEL_TITLE_PREFIX} ${escapeMarkdown(target.displayName)}`
      ),
      new TextDisplayBuilder().setContent(SYSTEM_BOT_CONFIG.PANEL_TEXT)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `👤 Ausgewählter Benutzer: ${userMention(target.id)} · ID: \`${target.id}\``
      )
    )
    .addActionRowComponents(buildPunishmentButtonRow(target.id), buildWarningButtonRow(target.id));
}

/* -------------------------------------------------------------------------------------------------
 * Timeout
 * ------------------------------------------------------------------------------------------------*/

export function buildTimeoutSelectRow(
  targetUserId: string
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId('timeout-select', targetUserId))
    .setPlaceholder(SYSTEM_BOT_CONFIG.TIMEOUT_PLACEHOLDER)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      SYSTEM_BOT_CONFIG.TIMEOUT_DURATIONS.map((option) =>
        new StringSelectMenuOptionBuilder().setLabel(option.label).setValue(option.value)
      )
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/* -------------------------------------------------------------------------------------------------
 * Warnen
 * ------------------------------------------------------------------------------------------------*/

export function buildWarnFormButtonRow(targetUserId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId('warn-form', targetUserId))
      .setLabel(SYSTEM_BOT_CONFIG.WARN_FORM_BUTTON_LABEL)
      .setStyle(ButtonStyle.Primary)
  );
}

export function buildWarnModal(targetUserId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildCustomId('warn-modal', targetUserId))
    .setTitle(SYSTEM_BOT_CONFIG.WARN_MODAL_TITLE)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Grund der Warnung')
        .setDescription('Der Grund wird der Person per Privatnachricht mitgeteilt.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(SYSTEM_BOT_CONFIG.WARN_REASON_INPUT_ID)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('z. B. Beleidigung im Chat trotz Ermahnung')
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(500)
        )
    );
}

/* -------------------------------------------------------------------------------------------------
 * Unwarn
 * ------------------------------------------------------------------------------------------------*/

/** Formatiert einen SQLite-UTC-Zeitstempel (YYYY-MM-DD HH:MM:SS) als deutsches Datum. */
export function formatWarningDate(createdAt: string): string {
  const parsed = new Date(createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return createdAt;
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Berlin'
  }).format(parsed);
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export function buildUnwarnSelectRow(
  targetUserId: string,
  warnings: readonly WarningRecord[]
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId('unwarn-select', targetUserId))
    .setPlaceholder(SYSTEM_BOT_CONFIG.UNWARN_PLACEHOLDER)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      warnings.slice(0, 25).map((warning, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(truncate(`Warn #${index + 1} · ${formatWarningDate(warning.createdAt)}`, 100))
          .setDescription(truncate(warning.reason || 'Kein Grund angegeben', 100))
          .setValue(String(warning.id))
      )
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/* -------------------------------------------------------------------------------------------------
 * Private Nachrichten (Components V2)
 * ------------------------------------------------------------------------------------------------*/

export interface WarnDmDetails {
  guildName: string;
  reason: string;
}

/**
 * DM nach einer Warnung:
 *   Titel: WARNUNG
 *   Text:  Du wurdest gewarnt. ... Du hast jetzt X von 5 Warns.
 */
export function buildWarnDmContainer(
  activeCount: number,
  details: WarnDmDetails
): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(SYSTEM_BOT_CONFIG.ACCENT_COLOR_WARN)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${SYSTEM_BOT_CONFIG.WARN_DM_TITLE}`),
      new TextDisplayBuilder().setContent(buildWarnDmText(activeCount))
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Server:** ${escapeMarkdown(details.guildName)}\n**Grund:** ${escapeMarkdown(truncate(details.reason, 1000))}`
      )
    );
}

/**
 * DM nach dem Aufheben einer Warnung:
 *   Titel: GLÜCKWUNSCH
 *   Text:  Dein Warn wurde aufgehoben. Du hast jetzt X von 5 Warns.
 */
export function buildUnwarnDmContainer(activeCount: number, guildName: string): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(SYSTEM_BOT_CONFIG.ACCENT_COLOR_SUCCESS)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${SYSTEM_BOT_CONFIG.UNWARN_DM_TITLE}`),
      new TextDisplayBuilder().setContent(buildUnwarnDmText(activeCount))
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Server:** ${escapeMarkdown(guildName)}`)
    );
}
