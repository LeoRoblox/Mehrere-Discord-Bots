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

/**
 * Lädt über die Discord REST API alle Server (Guilds), in denen sich der Bot
 * aktuell befindet (paginiert, bis zu 200 pro Seite).
 */
async function fetchBotGuildIds(rest: REST): Promise<string[]> {
  const guildIds: string[] = [];
  let after: string | null = null;

  // Schleife: solange eine volle Seite (200) zurückkommt, gibt es weitere Server
  while (true) {
    const query = new URLSearchParams({ limit: '200' });
    if (after) {
      query.set('after', after);
    }

    const guilds = (await rest.get(`${Routes.userGuilds()}?${query.toString()}`)) as Array<{
      id: string;
    }>;

    for (const guild of guilds) {
      guildIds.push(guild.id);
    }

    if (guilds.length < 200) break;
    after = guilds[guilds.length - 1].id;
  }

  return guildIds;
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
  const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

  logger.info(`Verwende Client-ID: ${clientId}`);

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    // 1) Global registrieren: gilt für alle aktuellen und zukünftigen Server
    logger.info(`Registriere ${commandsData.length} Befehl(e) global für Discord...`);
    await rest.put(Routes.applicationCommands(clientId), {
      body: commandsData
    });
    logger.info(
      '✅ Globale Befehle erfolgreich registriert (Discord kann globale Änderungen bis zu einer Stunde cachen).'
    );

    // 2) Zusätzlich pro Server registrieren: Guild-Commands sind SOFORT aktiv,
    //    auch auf allen Servern, auf denen der Bot bereits ist.
    const targetGuildIds = new Set<string>(await fetchBotGuildIds(rest));
    if (devGuildId) {
      targetGuildIds.add(devGuildId);
    }

    if (targetGuildIds.size > 0) {
      logger.info(
        `Registriere Befehle zusätzlich SOFORT auf ${targetGuildIds.size} Server(n) (Guild-Commands sind ohne Cache-Delay aktiv)...`
      );
    }

    let successCount = 0;
    for (const guildId of targetGuildIds) {
      try {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
          body: commandsData
        });
        successCount++;
        logger.info(`✅ Guild-Befehle für Server ${guildId} sofort aktiv registriert.`);
      } catch (guildError) {
        // Fehlerisolierung: Ein einzelner Server blockiert die übrigen nicht
        logger.error(`Fehler beim Registrieren auf Server ${guildId}:`, guildError);
      }
    }

    logger.info(
      `🎉 Fertig! ${successCount}/${targetGuildIds.size} Server sofort versorgt, globale Registrierung abgeschlossen.`
    );
  } catch (error) {
    logger.error('Fehler beim Registrieren der Slash-Commands:', error);
    process.exit(1);
  }
}

deploy().catch((err) => {
  logger.error('Unerwarteter Fehler im Deployment-Skript:', err);
  process.exit(1);
});
