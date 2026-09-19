import { validateConfig } from '../core/config.js';
import { getDatabase, closeDatabase } from '../core/database.js';
import { logger } from '../core/logger.js';

async function testConnection(): Promise<void> {
  logger.info('=== Diagnosetest für Mehrere-Discord-Bots gestartet ===');

  try {
    // 1. Konfiguration prüfen
    logger.info('1. Überprüfe Umgebungsvariablen...');
    const config = validateConfig();
    logger.info('✅ Umgebungsvariablen sind syntaktisch gültig.');
    logger.info(`   - Modus: ${config.NODE_ENV}`);
    logger.info(`   - Bot-Owner-ID: ${config.BOT_OWNER_ID}`);
    logger.info(`   - HTTP-Port: ${config.PORT}`);
    logger.info(`   - Turso-URL: ${config.TURSO_DATABASE_URL.split('@').pop()?.split('?')[0]}`);

    // 2. Datenbankverbindung prüfen
    logger.info('2. Teste Verbindung zur Turso libSQL Datenbank...');
    const db = getDatabase(config);
    const start = Date.now();
    const result = await db.execute("SELECT 1 AS ping, datetime('now') AS current_time;");
    const duration = Date.now() - start;
    logger.info(`✅ Datenbankverbindung erfolgreich in ${duration}ms!`, result.rows[0]);

    // 3. Bot Token Check (Länge und Format) – für BEIDE getrennten Bots
    logger.info('3. Überprüfe Format der Bot-Tokens (Verify-Bot + System-Bot)...');
    const tokens: Array<[string, string, string]> = [
      ['VERIFY_BOT_TOKEN', config.VERIFY_BOT_TOKEN, config.VERIFY_BOT_CLIENT_ID],
      ['SYSTEM_BOT_TOKEN', config.SYSTEM_BOT_TOKEN, config.SYSTEM_BOT_CLIENT_ID]
    ];
    for (const [name, token, clientId] of tokens) {
      if (token.includes('.') && token.length > 50) {
        logger.info(
          `✅ ${name} Format entspricht einem gültigen Discord-Bot-Token (Client-ID: ${clientId}).`
        );
      } else {
        logger.warn(`⚠️ ${name} scheint ein ungewöhnliches Format zu haben.`);
      }
    }

    logger.info('=== Alle Diagnosetests erfolgreich abgeschlossen ===');
  } catch (error) {
    logger.error('❌ Diagnosetest fehlgeschlagen:', error);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

testConnection().catch((err) => {
  logger.error('Fataler Fehler:', err);
  process.exit(1);
});
