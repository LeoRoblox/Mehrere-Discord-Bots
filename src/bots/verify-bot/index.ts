import { GatewayIntentBits } from 'discord.js';
import type { IBotModule, BotContext } from '../../core/types.js';
import { verifysystemCommand } from './commands/verifysystem.js';
import { verifyButtonHandler } from './handlers/button-handler.js';
import { verifyBotMigrations } from './migrations.js';
import {
  adminpanelCommand,
  adminButtonHandler,
  adminWarnFormHandler,
  adminSelectHandler,
  adminModalHandler
} from './handlers/adminpanel.js';

export const verifyBotModule: IBotModule = {
  id: 'verify-bot',
  name: 'Verifizierungs-Bot (Christlichernico)',
  tokenEnvVar: 'VERIFY_BOT_TOKEN',

  // Minimale Gateway-Intents: Nur Guilds wird zwingend benötigt.
  // Interaktionen enthalten das Member-Objekt direkt. Keine speicherintensiven Member-Caches nötig!
  requiredIntents: [GatewayIntentBits.Guilds],

  migrations: verifyBotMigrations,
  commands: [verifysystemCommand, adminpanelCommand],
  buttons: [verifyButtonHandler, adminButtonHandler, adminWarnFormHandler],
  selectMenus: [adminSelectHandler],
  modals: [adminModalHandler],

  async onInit(context: BotContext): Promise<void> {
    // Separat idempotent anlegen, damit bestehende Installationen ohne neue
    // Registry-Migration ebenfalls sofort Warnungen verwenden können.
    await context.db.execute(`CREATE TABLE IF NOT EXISTS admin_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL, reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await context.db.execute(
      'CREATE INDEX IF NOT EXISTS idx_admin_warnings_user ON admin_warnings (guild_id, user_id)'
    );
    context.logger.info('Verifizierungs-Bot erfolgreich initialisiert und einsatzbereit.');
  },

  async onDestroy(): Promise<void> {
    // Eventuelle Cleanup-Aktionen
  }
};
