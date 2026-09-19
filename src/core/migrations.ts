import type { Client as LibsqlClient } from '@libsql/client';
import type { IMigration } from './types.js';
import { logger } from './logger.js';

/**
 * Zentraler Migrations-Runner für alle registrierten Bots
 */
export async function runMigrations(
  db: LibsqlClient,
  namespace: string,
  migrations: IMigration[]
): Promise<void> {
  const log = logger.forContext(`Migration:${namespace}`);

  // 1. Initialisiere die zentrale Migrations-Tabelle, falls noch nicht vorhanden
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _system_migrations (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      migration_id TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  if (!migrations || migrations.length === 0) {
    log.debug('Keine Migrationen für diesen Namespace registriert.');
    return;
  }

  // 2. Lese bereits angewendete Migrationen aus
  const result = await db.execute({
    sql: 'SELECT migration_id FROM _system_migrations WHERE namespace = ?',
    args: [namespace]
  });

  const appliedIds = new Set(result.rows.map((row) => String(row.migration_id)));

  // 3. Führe ausstehende Migrationen der Reihe nach aus
  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    log.info(`Führe Migration '${migration.id}' für Namespace '${namespace}' aus...`);

    try {
      await migration.up(db);

      const uniqueId = `${namespace}:${migration.id}`;
      await db.execute({
        sql: "INSERT INTO _system_migrations (id, namespace, migration_id, applied_at) VALUES (?, ?, ?, datetime('now'))",
        args: [uniqueId, namespace, migration.id]
      });

      log.info(`Migration '${migration.id}' erfolgreich angewendet.`);
    } catch (error) {
      log.error(`Fehler bei Ausführung von Migration '${migration.id}':`, error);
      throw error;
    }
  }
}
