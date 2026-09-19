import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { verifyBotModule } from '../bots/verify-bot/index.js';
import { logger } from '../core/logger.js';

dotenv.config();

/**
 * Ermittelt die Client-ID entweder aus der Umgebungsvariable oder
 * extrahiert sie direkt aus dem ersten Base64-Teil des Discord-Tokens.
 */
function resolveClientId(token: string, explicitClientId?: string): string {
  if (explicitClientId && /^\d{17,20}$/.test(explicitClientId)) {
    return explicitClientId;
  }
  try {
    const firstPart = token.split('.')[0];
    const decoded = Buffer.from(firstPart, 'base64').toString('utf-8');
    if (/^\d{17,20}$/.test(decoded)) {
      return decoded;
    }
  } catch {
    // Ignorieren und Fehler werfen
  }
  throw new Error(
    'Client-ID konnte nicht ermittelt werden. Bitte setze VERIFY_BOT_CLIENT_ID in deiner .env Datei.'
  );
}

async function deploy(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');

  logger.info(
    `Starte Registrierung der Discord Slash-Commands${isDryRun ? ' (DRY-RUN MODUS)' : ''}...`
  );

  // Alle Commands des Verifizierungs-Bots sammeln
  const commandsData = verifyBotModule.commands.map((cmd) => cmd.data.toJSON());

  if (isDryRun) {
    logger.info(`Gefundene Befehle (${commandsData.length}):`);
    for (const cmd of commandsData) {
      logger.info(` - /${cmd.name}: ${cmd.description}`);
    }
    logger.info('Vollständiger JSON-Payload für Discord REST API:');
    logger.info(JSON.stringify(commandsData, null, 2));
    logger.info('✅ Dry-Run erfolgreich beendet. Keine Änderungen an Discord übermittelt.');
    return;
  }

  const token = process.env.VERIFY_BOT_TOKEN;
  if (!token) {
    logger.error('VERIFY_BOT_TOKEN ist nicht gesetzt! Abbruch.');
    process.exit(1);
  }

  const clientId = resolveClientId(token, process.env.VERIFY_BOT_CLIENT_ID);
  const guildId = process.env.DISCORD_DEV_GUILD_ID;

  logger.info(`Verwende Client-ID: ${clientId}`);

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    if (guildId) {
      logger.info(
        `Registriere ${commandsData.length} Befehl(e) spezifisch für Test-Server (Guild-ID: ${guildId})...`
      );
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commandsData
      });
      logger.info('✅ Guild-Befehle erfolgreich registriert (sofort aktiv).');
    } else {
      logger.info(`Registriere ${commandsData.length} Befehl(e) global für Discord...`);
      await rest.put(Routes.applicationCommands(clientId), {
        body: commandsData
      });
      logger.info(
        '✅ Globale Befehle erfolgreich registriert (kann bis zu eine Stunde dauern, bis Discord sie global gecacht hat).'
      );
    }
  } catch (error) {
    logger.error('Fehler beim Registrieren der Slash-Commands:', error);
    process.exit(1);
  }
}

deploy().catch((err) => {
  logger.error('Unerwarteter Fehler im Deployment-Skript:', err);
  process.exit(1);
});
