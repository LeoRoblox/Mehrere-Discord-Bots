import { validateConfig } from './core/config.js';
import { getDatabase, closeDatabase } from './core/database.js';
import { startHttpServer, stopHttpServer } from './core/http-server.js';
import { BotRegistry } from './core/bot-registry.js';
import { logger } from './core/logger.js';
import { verifyBotModule } from './bots/verify-bot/index.js';
import { systemBotModule } from './bots/system-bot/index.js';

let isShuttingDown = false;

async function bootstrap(): Promise<void> {
  logger.info('=== Initialisiere Mehrere-Discord-Bots Runner ===');

  // 1. Globale Fehler-Traps zur Vermeidung unkontrollierter Prozessabstürze
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception aufgetreten:', error);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection abgefangen:', reason);
  });

  // 2. Konfiguration validieren (bricht bei fehlender Verify- ODER System-Bot-Konfiguration ab)
  const config = validateConfig();

  // 3. Minimalen HTTP-Health-Server starten (0.0.0.0:PORT mit /health)
  await startHttpServer(config.PORT);

  // 4. Turso libSQL-Datenbank initialisieren
  const db = getDatabase(config);

  // 5. Bot-Registry aufbauen und die getrennten Bot-Module registrieren
  const registry = new BotRegistry(config, db);

  // Bot 1: Verifizierungs-Bot (VERIFY_BOT_TOKEN / VERIFY_BOT_CLIENT_ID) – /verifysystem
  registry.register(verifyBotModule);

  // Bot 2: System-Bot (SYSTEM_BOT_TOKEN / SYSTEM_BOT_CLIENT_ID) – /adminpanel
  registry.register(systemBotModule);

  // Hier können in Zukunft weitere Bot-Module registriert werden:
  // registry.register(ticketBotModule);

  // 6. Alle Bots getrennt starten (eigener Discord-Login + eigene Command-Registrierung je Bot)
  await registry.startAll();

  // 7. Ressourcenverbrauch protokollieren (Render Free-Tier Überwachung: ~400 MB RAM)
  const memUsage = process.memoryUsage();
  const rssMb = (memUsage.rss / 1024 / 1024).toFixed(2);
  const heapUsedMb = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
  logger.info(`System bereit. RAM-Verbrauch: RSS=${rssMb}MB, Heap=${heapUsedMb}MB`);

  // 8. Graceful Shutdown Signalbehandlung (SIGTERM von Render / SIGINT)
  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(
      `Empfange Signal '${signal}'. Leite ordnungsgemäßes Herunterfahren (Graceful Shutdown) ein...`
    );

    const shutdownTimeout = setTimeout(() => {
      logger.error('Graceful Shutdown Timeout erreicht (10s). Erzwinge Beendigung.');
      process.exit(1);
    }, 10000);

    try {
      // 1. Bots disconnecten
      await registry.stopAll();

      // 2. DB-Verbindung trennen
      await closeDatabase();

      // 3. HTTP-Server stoppen
      await stopHttpServer();

      clearTimeout(shutdownTimeout);
      logger.info('Graceful Shutdown erfolgreich abgeschlossen. Auf Wiedersehen.');
      process.exit(0);
    } catch (err) {
      clearTimeout(shutdownTimeout);
      logger.error('Fehler während des Herunterfahrens:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Fataler Bootstrap-Fehler beim Anwendungsstart:', err);
  process.exit(1);
});
