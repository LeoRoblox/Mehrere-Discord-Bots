import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import type { IBotModule } from '../core/types.js';
import { verifyBotModule } from '../bots/verify-bot/index.js';
import { systemBotModule } from '../bots/system-bot/index.js';
import { logger } from '../core/logger.js';

dotenv.config();

/**
 * Alle Bot-Module, deren Slash-Commands GETRENNT registriert werden.
 * Jeder Bot verwendet ausschließlich sein eigenes Token und seine eigene Client-ID.
 */
const ALL_BOT_MODULES: IBotModule[] = [verifyBotModule, systemBotModule];

/**
 * Ermittelt die Client-ID entweder aus der Umgebungsvariable oder
 * extrahiert sie direkt aus dem ersten Base64-Teil des Discord-Tokens.
 */
export function resolveClientId(
  token: string,
  explicitClientId: string | undefined,
  clientIdEnvVar: string
): string {
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
    `Client-ID konnte nicht ermittelt werden. Bitte setze ${clientIdEnvVar} in deiner .env Datei.`
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

/** Wählt anhand von `--bot=<id>` optional nur ein einzelnes Bot-Modul aus. */
export function selectBotModules(argv: readonly string[], modules: IBotModule[]): IBotModule[] {
  const botArg = argv.find((arg) => arg.startsWith('--bot='));
  if (!botArg) return modules;

  const wantedId = botArg.slice('--bot='.length);
  const selected = modules.filter((m) => m.id === wantedId);
  if (selected.length === 0) {
    throw new Error(
      `Unbekannte Bot-ID '${wantedId}'. Verfügbar: ${modules.map((m) => m.id).join(', ')}`
    );
  }
  return selected;
}

/**
 * Registriert die Slash-Commands EINES Bot-Moduls mit dessen eigenem Token/Client-ID.
 *
 * @returns true bei Erfolg, false bei Fehlern (der nächste Bot wird trotzdem verarbeitet)
 */
async function deployForModule(botModule: IBotModule, isDryRun: boolean): Promise<boolean> {
  const log = logger.forContext(`Deploy:${botModule.id}`);
  const commandsData = botModule.commands.map((cmd) => cmd.data.toJSON());
  const commandList = commandsData.map((c) => `/${c.name}`).join(', ') || '(keine)';

  log.info(
    `=== Bot '${botModule.name}' (${botModule.id}) – ${commandsData.length} Befehl(e): ${commandList} ===`
  );

  if (isDryRun) {
    for (const cmd of commandsData) {
      log.info(` - /${cmd.name}: ${cmd.description}`);
    }
    log.info('Vollständiger JSON-Payload für Discord REST API:');
    log.info(JSON.stringify(commandsData, null, 2));
    log.info('✅ Dry-Run für diesen Bot beendet. Keine Änderungen an Discord übermittelt.');
    return true;
  }

  const token = process.env[botModule.tokenEnvVar];
  if (!token) {
    log.error(`${botModule.tokenEnvVar} ist nicht gesetzt! Bot '${botModule.name}' übersprungen.`);
    return false;
  }

  const clientIdEnvVar = botModule.clientIdEnvVar ?? `${botModule.tokenEnvVar}_CLIENT_ID`;
  const clientId = resolveClientId(token, process.env[clientIdEnvVar], clientIdEnvVar);
  const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

  log.info(`Verwende Token aus ${botModule.tokenEnvVar} und Client-ID ${clientId}.`);

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    // 1) Global registrieren: gilt für alle aktuellen und zukünftigen Server
    log.info(`Registriere ${commandsData.length} Befehl(e) global für Discord...`);
    await rest.put(Routes.applicationCommands(clientId), {
      body: commandsData
    });
    log.info(
      `✅ Globale Befehle für Bot '${botModule.name}' registriert: ${commandList} (Discord kann globale Änderungen bis zu einer Stunde cachen).`
    );

    // 2) Zusätzlich pro Server registrieren: Guild-Commands sind SOFORT aktiv,
    //    auch auf allen Servern, auf denen der Bot bereits ist.
    const targetGuildIds = new Set<string>(await fetchBotGuildIds(rest));
    if (devGuildId) {
      targetGuildIds.add(devGuildId);
    }

    if (targetGuildIds.size > 0) {
      log.info(
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
        log.info(`✅ Guild-Befehle für Server ${guildId} sofort aktiv registriert.`);
      } catch (guildError) {
        // Fehlerisolierung: Ein einzelner Server blockiert die übrigen nicht
        log.error(`Fehler beim Registrieren auf Server ${guildId}:`, guildError);
      }
    }

    log.info(
      `🎉 Bot '${botModule.name}': ${successCount}/${targetGuildIds.size} Server sofort versorgt, globale Registrierung abgeschlossen.`
    );
    return true;
  } catch (error) {
    log.error(`Fehler beim Registrieren der Slash-Commands für Bot '${botModule.name}':`, error);
    return false;
  }
}

async function deploy(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');
  const modules = selectBotModules(process.argv, ALL_BOT_MODULES);

  logger.info(
    `Starte getrennte Registrierung der Slash-Commands für ${modules.length} Bot(s)${isDryRun ? ' (DRY-RUN MODUS)' : ''}: ${modules
      .map((m) => m.id)
      .join(', ')}`
  );

  let hadError = false;
  for (const botModule of modules) {
    const ok = await deployForModule(botModule, isDryRun);
    if (!ok) hadError = true;
  }

  if (hadError) {
    logger.error('Mindestens ein Bot konnte nicht registriert werden.');
    process.exit(1);
  }
}

deploy().catch((err) => {
  logger.error('Unerwarteter Fehler im Deployment-Skript:', err);
  process.exit(1);
});
