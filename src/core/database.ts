import { createClient, type Client as LibsqlClient } from '@libsql/client';
import type { AppConfig } from './config.js';
import { logger } from './logger.js';

let dbInstance: LibsqlClient | null = null;

/**
 * Erstellt oder liefert die geteilte Turso libSQL-Verbindung
 */
export function getDatabase(config: AppConfig): LibsqlClient {
  if (dbInstance) {
    return dbInstance;
  }

  logger.info('Verbinde mit Turso libSQL Datenbank...');

  dbInstance = createClient({
    url: config.TURSO_DATABASE_URL,
    authToken: config.TURSO_AUTH_TOKEN || undefined
  });

  return dbInstance;
}

/**
 * Schließt die Datenbankverbindung beim Graceful Shutdown
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    logger.info('Schließe Turso libSQL Datenbankverbindung...');
    try {
      dbInstance.close();
    } catch (err) {
      logger.error('Fehler beim Schließen der Datenbankverbindung:', err);
    } finally {
      dbInstance = null;
    }
  }
}
