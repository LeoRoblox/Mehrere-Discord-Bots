import { GatewayIntentBits } from 'discord.js';
import type { IBotModule, BotContext } from '../../core/types.js';
import { verifysystemCommand } from './commands/verifysystem.js';
import { verifyButtonHandler } from './handlers/button-handler.js';
import { verifyBotMigrations } from './migrations.js';

export const verifyBotModule: IBotModule = {
  id: 'verify-bot',
  name: 'Verifizierungs-Bot (Christlichernico)',
  tokenEnvVar: 'VERIFY_BOT_TOKEN',
  clientIdEnvVar: 'VERIFY_BOT_CLIENT_ID',

  // Minimale Gateway-Intents: Nur Guilds wird zwingend benötigt.
  // Interaktionen enthalten das Member-Objekt direkt. Keine speicherintensiven Member-Caches nötig!
  requiredIntents: [GatewayIntentBits.Guilds],

  migrations: verifyBotMigrations,
  commands: [verifysystemCommand],
  buttons: [verifyButtonHandler],

  async onInit(context: BotContext): Promise<void> {
    context.logger.info('Verifizierungs-Bot erfolgreich initialisiert und einsatzbereit.');
  },

  async onDestroy(): Promise<void> {
    // Eventuelle Cleanup-Aktionen
  }
};
