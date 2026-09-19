import { describe, it, expect } from 'vitest';
import { ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import {
  buildAdminPanelContainer,
  buildCustomId,
  buildTimeoutSelectRow,
  buildUnwarnDmContainer,
  buildUnwarnSelectRow,
  buildWarnDmContainer,
  buildWarnFormButtonRow,
  buildWarnModal,
  CUSTOM_ID_PATTERNS,
  formatWarningDate,
  parseCustomId
} from '../../src/bots/system-bot/ui.js';
import {
  SYSTEM_BOT_CONFIG,
  buildUnwarnDmText,
  buildWarnDmText,
  findTimeoutDuration
} from '../../src/bots/system-bot/config.js';
import { TARGET_ID } from './helpers.js';

interface TextDisplayJson {
  type: number;
  content?: string;
}

interface ButtonJson {
  type: number;
  custom_id?: string;
  label?: string;
  style?: number;
  emoji?: { name?: string };
}

interface ActionRowJson {
  type: number;
  components: ButtonJson[];
}

describe('System-Bot: Adminpanel-Oberfläche (Components V2)', () => {
  it('erstellt einen Container mit Titel "ADMIN PANEL <user>" und dem vorgegebenen Text', () => {
    const json = buildAdminPanelContainer({ id: TARGET_ID, displayName: 'Max' }).toJSON();

    expect(json.type).toBe(ComponentType.Container);

    const texts = json.components.filter(
      (c): c is TextDisplayJson => c.type === ComponentType.TextDisplay
    );
    expect(texts[0].content).toBe('# ADMIN PANEL Max');
    expect(texts[1].content).toBe(
      'Willkommen im Admin Panel. Wähle bei dem Button aus wie du diese Person bestrafen willst oder von dieser Person wissen willst.'
    );
    expect(texts.some((t) => t.content?.includes(`<@${TARGET_ID}>`))).toBe(true);
  });

  it('maskiert Markdown im Anzeigenamen des ausgewählten Benutzers', () => {
    const json = buildAdminPanelContainer({ id: TARGET_ID, displayName: '*Max_' }).toJSON();
    const title = (json.components[0] as TextDisplayJson).content;
    expect(title).toBe('# ADMIN PANEL \\*Max\\_');
  });

  it('enthält alle sechs Aktions-Buttons mit korrekten Labels, Custom-IDs und Uhr-Emoji für Timeout', () => {
    const json = buildAdminPanelContainer({ id: TARGET_ID, displayName: 'Max' }).toJSON();
    const rows = json.components.filter(
      (c): c is ActionRowJson => c.type === ComponentType.ActionRow
    );
    const buttons = rows.flatMap((row) => row.components);

    expect(buttons.map((b) => b.label)).toEqual([
      'Timeout',
      'Kicken',
      'Bannen',
      'Warnen',
      'Unwarn',
      'User Infos'
    ]);
    expect(buttons.map((b) => b.custom_id)).toEqual([
      `sysadmin:timeout:${TARGET_ID}`,
      `sysadmin:kick:${TARGET_ID}`,
      `sysadmin:ban:${TARGET_ID}`,
      `sysadmin:warn:${TARGET_ID}`,
      `sysadmin:unwarn:${TARGET_ID}`,
      `sysadmin:info:${TARGET_ID}`
    ]);

    const timeout = buttons[0];
    expect(timeout.emoji?.name).toBe('🕒');
    expect(timeout.style).toBe(ButtonStyle.Primary);
    expect(buttons[1].style).toBe(ButtonStyle.Danger);
    expect(buttons[2].style).toBe(ButtonStyle.Danger);

    // Jede Button-Custom-ID wird vom Panel-Button-Handler erkannt
    for (const button of buttons) {
      expect(CUSTOM_ID_PATTERNS.panelButtons.test(button.custom_id!)).toBe(true);
    }
  });

  it('Timeout-Select enthält exakt die geforderten Zeiträume mit Placeholder', () => {
    const row = buildTimeoutSelectRow(TARGET_ID).toJSON();
    const menu = row.components[0] as {
      custom_id: string;
      placeholder?: string;
      options: Array<{ label: string; value: string }>;
    };

    expect(menu.custom_id).toBe(`sysadmin:timeout-select:${TARGET_ID}`);
    expect(CUSTOM_ID_PATTERNS.timeoutSelect.test(menu.custom_id)).toBe(true);
    expect(menu.placeholder).toBe('Wähle die länge aus..');
    expect(menu.options.map((o) => o.label)).toEqual([
      '1 Minute',
      '2,5 Minuten',
      '10 Minuten',
      '1 Stunde',
      '13 Stunden',
      '4 Tage',
      '7 Tage',
      '20 Tage'
    ]);
  });

  it('Timeout-Zeiträume entsprechen den korrekten Millisekunden (max. 28 Tage)', () => {
    const expected: Record<string, number> = {
      '1m': 60_000,
      '2m30s': 150_000,
      '10m': 600_000,
      '1h': 3_600_000,
      '13h': 46_800_000,
      '4d': 345_600_000,
      '7d': 604_800_000,
      '20d': 1_728_000_000
    };
    for (const [value, ms] of Object.entries(expected)) {
      expect(findTimeoutDuration(value)?.durationMs).toBe(ms);
      expect(ms).toBeLessThanOrEqual(28 * 24 * 60 * 60 * 1000);
    }
    expect(findTimeoutDuration('99d')).toBeUndefined();
    expect(findTimeoutDuration('')).toBeUndefined();
  });

  it('Warn-Flow: "Formular öffnen"-Button und Modal mit Pflichtfeld für den Grund', () => {
    const row = buildWarnFormButtonRow(TARGET_ID).toJSON();
    const button = row.components[0] as ButtonJson;
    expect(button.label).toBe('Formular öffnen');
    expect(button.custom_id).toBe(`sysadmin:warn-form:${TARGET_ID}`);
    expect(CUSTOM_ID_PATTERNS.warnFormButton.test(button.custom_id!)).toBe(true);

    const modal = buildWarnModal(TARGET_ID).toJSON();
    expect(modal.custom_id).toBe(`sysadmin:warn-modal:${TARGET_ID}`);
    expect(CUSTOM_ID_PATTERNS.warnModal.test(modal.custom_id)).toBe(true);

    const label = modal.components[0] as {
      type: number;
      component: { type: number; custom_id: string; required?: boolean };
    };
    expect(label.type).toBe(ComponentType.Label);
    expect(label.component.type).toBe(ComponentType.TextInput);
    expect(label.component.custom_id).toBe(SYSTEM_BOT_CONFIG.WARN_REASON_INPUT_ID);
    expect(label.component.required).toBe(true);
  });

  it('Unwarn-Select listet aktive Warnungen mit Placeholder und Warn-IDs als Werte', () => {
    const row = buildUnwarnSelectRow(TARGET_ID, [
      {
        id: 41,
        guildId: 'g',
        userId: TARGET_ID,
        moderatorId: 'm',
        reason: 'Spam im Chat',
        createdAt: '2026-09-19 20:15:00'
      },
      {
        id: 42,
        guildId: 'g',
        userId: TARGET_ID,
        moderatorId: 'm',
        reason: 'x'.repeat(300),
        createdAt: '2026-09-20T10:00:00.000Z'
      }
    ]).toJSON();
    const menu = row.components[0] as {
      custom_id: string;
      placeholder?: string;
      options: Array<{ label: string; value: string; description?: string }>;
    };

    expect(menu.custom_id).toBe(`sysadmin:unwarn-select:${TARGET_ID}`);
    expect(CUSTOM_ID_PATTERNS.unwarnSelect.test(menu.custom_id)).toBe(true);
    expect(menu.placeholder).toBe('Wähle einen Warn aus..');
    expect(menu.options.map((o) => o.value)).toEqual(['41', '42']);
    expect(menu.options[0].label).toBe('Warn #1 · 19.09.2026');
    expect(menu.options[0].description).toBe('Spam im Chat');
    expect(menu.options[1].description!.length).toBeLessThanOrEqual(100);
  });

  it('formatiert SQLite-Zeitstempel als deutsches Datum', () => {
    expect(formatWarningDate('2026-09-19 20:15:00')).toBe('19.09.2026');
    expect(formatWarningDate('2026-12-31 23:30:00')).toBe('01.01.2027'); // UTC → Europe/Berlin
    expect(formatWarningDate('kein datum')).toBe('kein datum');
  });

  it('Warn-DM: Container mit Titel "WARNUNG" und Text mit X von 5 Warns', () => {
    const json = buildWarnDmContainer(3, { guildName: 'Test Server', reason: 'Spam' }).toJSON();
    const texts = json.components.filter(
      (c): c is TextDisplayJson => c.type === ComponentType.TextDisplay
    );

    expect(json.type).toBe(ComponentType.Container);
    expect(texts[0].content).toBe('# WARNUNG');
    expect(texts[1].content).toBe(
      'Du wurdest gewarnt. Bitte halte dich jetzt an die Regeln bevor du bestraft wirst. Du hast jetzt 3 von 5 Warns.'
    );
    expect(texts[2].content).toContain('Test Server');
    expect(texts[2].content).toContain('Spam');
    expect(buildWarnDmText(5)).toContain('5 von 5 Warns');
  });

  it('Unwarn-DM: Container mit Titel "GLÜCKWUNSCH" und verbleibender Anzahl', () => {
    const json = buildUnwarnDmContainer(2, 'Test Server').toJSON();
    const texts = json.components.filter(
      (c): c is TextDisplayJson => c.type === ComponentType.TextDisplay
    );

    expect(texts[0].content).toBe('# GLÜCKWUNSCH');
    expect(texts[1].content).toBe('Dein Warn wurde aufgehoben. Du hast jetzt 2 von 5 Warns.');
    expect(buildUnwarnDmText(0)).toBe('Dein Warn wurde aufgehoben. Du hast jetzt 0 von 5 Warns.');
  });

  it('Custom-IDs werden korrekt erzeugt und geparst; fremde IDs werden abgelehnt', () => {
    expect(buildCustomId('kick', TARGET_ID)).toBe(`sysadmin:kick:${TARGET_ID}`);
    expect(parseCustomId(`sysadmin:unwarn-select:${TARGET_ID}`)).toEqual({
      action: 'unwarn-select',
      targetUserId: TARGET_ID
    });
    expect(parseCustomId('verify_rules_accept_button')).toBeNull();
    expect(parseCustomId('sysadmin:kick:not-a-snowflake')).toBeNull();
    expect(parseCustomId('admin:kick:123456789012345678')).toBeNull();
  });

  it('IsComponentsV2-Flag ist für Panel und DMs vorgesehen', () => {
    expect(MessageFlags.IsComponentsV2).toBe(1 << 15);
  });
});
