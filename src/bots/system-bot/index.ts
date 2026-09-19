import { GatewayIntentBits } from 'discord.js';
import type { IBotModule, BotContext } from '../../core/types.js';
import { adminpanelCommand } from './commands/adminpanel.js';
import {
  adminPanelButtonHandler,
  adminPanelWarnFormButtonHandler
} from './handlers/panel-buttons.js';
import {
  adminPanelTimeoutSelectHandler,
  adminPanelUnwarnSelectHandler
} from './handlers/select-menus.js';
import { adminPanelWarnModalHandler } from './handlers/warn-modal.js';
import { systemBotMigrations } from './migrations.js';

/**
 * System-Bot (Adminpanel)
 *
 * Eigenständiger Discord-Bot mit eigenem Login (SYSTEM_BOT_TOKEN / SYSTEM_BOT_CLIENT_ID),
 * eigener Command-Registrierung, eigenen Handlern und eigenen Datenbanktabellen (`system_*`).
 * Er ist vollständig vom Verify-Bot getrennt und registriert AUSSCHLIESSLICH `/adminpanel`.
 */
export const systemBotModule: IBotModule = {
  id: 'system-bot',
  name: 'System-Bot (Adminpanel)',
  tokenEnvVar: 'SYSTEM_BOT_TOKEN',
  clientIdEnvVar: 'SYSTEM_BOT_CLIENT_ID',

  // Guilds-Intent: Server-, Rollen- und Member-Objekte in Interaktionen; keine privilegierten Intents nötig.
  requiredIntents: [GatewayIntentBits.Guilds],

  migrations: systemBotMigrations,
  commands: [adminpanelCommand],
  buttons: [adminPanelButtonHandler, adminPanelWarnFormButtonHandler],
  selectMenus: [adminPanelTimeoutSelectHandler, adminPanelUnwarnSelectHandler],
  modals: [adminPanelWarnModalHandler],

  async onInit(context: BotContext): Promise<void> {
    context.logger.info('System-Bot (Adminpanel) erfolgreich initialisiert und einsatzbereit.');
  },

  async onDestroy(): Promise<void> {
    // Eventuelle Cleanup-Aktionen
  }
};
