import type { IMigration } from '../../core/types.js';

export const verifyBotMigrations: IMigration[] = [
  {
    id: '001_create_verify_tables',
    up: async (db) => {
      // Tabelle für verifizierte Mitglieder
      await db.execute(`
        CREATE TABLE IF NOT EXISTS verify_members (
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          verified_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, guild_id)
        );
      `);

      // Audit-Log für Verifizierungen und administrative Aktionen
      await db.execute(`
        CREATE TABLE IF NOT EXISTS verify_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          action TEXT NOT NULL,
          details TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Indizes für effiziente Abfragen
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_verify_members_guild
        ON verify_members(guild_id);
      `);

      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_verify_audit_guild_user
        ON verify_audit_log(guild_id, user_id);
      `);
    }
  }
];
