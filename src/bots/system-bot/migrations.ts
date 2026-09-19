import type { IMigration } from '../../core/types.js';

/**
 * Datenbankmigrationen des System-Bots (Namespace 'system-bot').
 *
 * Alle Tabellen tragen das Präfix `system_` und gehören ausschließlich dem System-Bot.
 * Der Verify-Bot besitzt weiterhin seine eigenen, unveränderten Tabellen (`verify_*`).
 */
export const systemBotMigrations: IMigration[] = [
  {
    id: '001_create_system_warnings',
    up: async (db) => {
      // Warnungen des Adminpanels. Eine Warnung gilt als "aktiv", solange revoked_at NULL ist.
      // Aufgehobene Warnungen bleiben zur Nachvollziehbarkeit erhalten (Soft-Delete).
      await db.execute(`
        CREATE TABLE IF NOT EXISTS system_warnings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          revoked_at TEXT,
          revoked_by TEXT
        );
      `);

      // Index für die häufigste Abfrage: aktive Warnungen eines Benutzers auf einem Server
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_system_warnings_guild_user_active
        ON system_warnings(guild_id, user_id, revoked_at);
      `);
    }
  },
  {
    id: '002_import_legacy_admin_warnings',
    up: async (db) => {
      // Eine frühere (fehlerhafte) Version hatte Warnungen in der Tabelle `admin_warnings`
      // innerhalb des Verify-Bots gespeichert. Falls diese Tabelle existiert, werden vorhandene
      // Warnungen einmalig in die System-Bot-Tabelle übernommen. Die alte Tabelle wird
      // bewusst NICHT gelöscht (kein Datenverlust) – sie wird ab jetzt nur nicht mehr verwendet.
      const legacy = await db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_warnings';"
      );
      if (legacy.rows.length === 0) return;

      await db.execute(`
        INSERT INTO system_warnings (guild_id, user_id, moderator_id, reason, created_at)
        SELECT guild_id, user_id, moderator_id, reason, created_at
        FROM admin_warnings
        ORDER BY id ASC;
      `);
    }
  }
];
