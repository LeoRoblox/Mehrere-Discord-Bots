/**
 * Konfiguration und Konstanten für den System-Bot (Adminpanel).
 *
 * Der System-Bot ist eine EIGENE Discord-Anwendung und vollständig vom Verify-Bot getrennt.
 */

/** Ein auswählbarer Timeout-Zeitraum für das Adminpanel. */
export interface TimeoutDurationOption {
  /** Technischer Wert im Select-Menü (max. 100 Zeichen) */
  value: string;
  /** Anzeigename im Select-Menü */
  label: string;
  /** Dauer in Millisekunden (Discord erlaubt maximal 28 Tage) */
  durationMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SYSTEM_BOT_CONFIG = {
  /** IDs der Rollen, die das Adminpanel ausschließlich verwenden dürfen */
  ADMIN_PANEL_ROLE_IDS: [
    '1548429120948670616',
    '1548458441566330970',
    '1548458919074988082',
    '1548459353504223274',
    '1548459569867526174'
  ] as const,

  /** Maximale Anzahl gleichzeitig aktiver Warnungen pro Benutzer und Server */
  MAX_ACTIVE_WARNINGS: 5,

  /** Präfix aller Custom-IDs des Adminpanels (Buttons, Select-Menüs, Modals) */
  CUSTOM_ID_PREFIX: 'sysadmin',

  /** Texte des Adminpanels */
  PANEL_TITLE_PREFIX: 'ADMIN PANEL',
  PANEL_TEXT:
    'Willkommen im Admin Panel. Wähle bei dem Button aus wie du diese Person bestrafen willst oder von dieser Person wissen willst.',

  TIMEOUT_PROMPT: 'Wie lange möchtest du die Person Timeouten?',
  TIMEOUT_PLACEHOLDER: 'Wähle die länge aus..',

  WARN_PROMPT: 'Warum möchtest du die Person warnen?',
  WARN_FORM_BUTTON_LABEL: 'Formular öffnen',
  WARN_MODAL_TITLE: 'Person warnen',
  WARN_REASON_INPUT_ID: 'reason',

  UNWARN_PLACEHOLDER: 'Wähle einen Warn aus..',

  USER_INFO_TEXT: 'Kommt bald.',

  /** Private Nachrichten (Components V2 Container) */
  WARN_DM_TITLE: 'WARNUNG',
  UNWARN_DM_TITLE: 'GLÜCKWUNSCH',

  /** Akzentfarben */
  ACCENT_COLOR_PANEL: 0x5865f2,
  ACCENT_COLOR_WARN: 0xe67e22,
  ACCENT_COLOR_SUCCESS: 0x2ecc71,

  /** Auswählbare Timeout-Zeiträume (Reihenfolge = Anzeige-Reihenfolge) */
  TIMEOUT_DURATIONS: [
    { value: '1m', label: '1 Minute', durationMs: 1 * MINUTE },
    { value: '2m30s', label: '2,5 Minuten', durationMs: 2.5 * MINUTE },
    { value: '10m', label: '10 Minuten', durationMs: 10 * MINUTE },
    { value: '1h', label: '1 Stunde', durationMs: 1 * HOUR },
    { value: '13h', label: '13 Stunden', durationMs: 13 * HOUR },
    { value: '4d', label: '4 Tage', durationMs: 4 * DAY },
    { value: '7d', label: '7 Tage', durationMs: 7 * DAY },
    { value: '20d', label: '20 Tage', durationMs: 20 * DAY }
  ] as readonly TimeoutDurationOption[]
} as const;

/** Text der Warn-DM mit aktueller Anzahl aktiver Warnungen. */
export function buildWarnDmText(activeCount: number): string {
  return `Du wurdest gewarnt. Bitte halte dich jetzt an die Regeln bevor du bestraft wirst. Du hast jetzt ${activeCount} von ${SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS} Warns.`;
}

/** Text der Unwarn-DM mit verbleibender Anzahl aktiver Warnungen. */
export function buildUnwarnDmText(activeCount: number): string {
  return `Dein Warn wurde aufgehoben. Du hast jetzt ${activeCount} von ${SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS} Warns.`;
}

/** Sucht einen Timeout-Zeitraum anhand des Select-Menü-Werts (Whitelist – niemals freie Werte). */
export function findTimeoutDuration(value: string): TimeoutDurationOption | undefined {
  return SYSTEM_BOT_CONFIG.TIMEOUT_DURATIONS.find((option) => option.value === value);
}
