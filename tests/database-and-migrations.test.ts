import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient, type Client as LibsqlClient } from '@libsql/client';
import { runMigrations } from '../src/core/migrations.js';
import { verifyBotMigrations } from '../src/bots/verify-bot/migrations.js';

describe('Database Migrations and Persistence', () => {
  let db: LibsqlClient;

  beforeEach(() => {
    db = createClient({
      url: ':memory:'
    });
  });

  afterEach(() => {
    db.close();
  });

  it('runs migrations for verify-bot namespace successfully', async () => {
    await runMigrations(db, 'verify-bot', verifyBotMigrations);

    // Prüfe ob System-Migrationstabelle existiert
    const migResult = await db.execute('SELECT * FROM _system_migrations;');
    expect(migResult.rows.length).toBe(1);
    expect(migResult.rows[0].namespace).toBe('verify-bot');
    expect(migResult.rows[0].migration_id).toBe('001_create_verify_tables');

    // Prüfe ob verify_members Tabelle existiert
    const tableCheck = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='verify_members';"
    );
    expect(tableCheck.rows.length).toBe(1);

    // Prüfe ob verify_audit_log Tabelle existiert
    const auditCheck = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='verify_audit_log';"
    );
    expect(auditCheck.rows.length).toBe(1);
  });

  it('is idempotent and skips already applied migrations on subsequent runs', async () => {
    // Erste Ausführung
    await runMigrations(db, 'verify-bot', verifyBotMigrations);
    const firstRunCount = await db.execute('SELECT COUNT(*) as cnt FROM _system_migrations;');
    expect(firstRunCount.rows[0].cnt).toBe(1);

    // Zweite Ausführung darf keinen Fehler werfen und keine Duplikate einfügen
    await runMigrations(db, 'verify-bot', verifyBotMigrations);
    const secondRunCount = await db.execute('SELECT COUNT(*) as cnt FROM _system_migrations;');
    expect(secondRunCount.rows[0].cnt).toBe(1);
  });

  it('persists member verification records with conflict handling', async () => {
    await runMigrations(db, 'verify-bot', verifyBotMigrations);

    const userId = '112233445566778899';
    const guildId = '998877665544332211';

    // Erstes Einfügen
    await db.execute({
      sql: `
        INSERT INTO verify_members (user_id, guild_id, verified_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(user_id, guild_id) DO UPDATE SET updated_at = datetime('now');
      `,
      args: [userId, guildId]
    });

    const query1 = await db.execute({
      sql: 'SELECT * FROM verify_members WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId]
    });

    expect(query1.rows.length).toBe(1);
    expect(query1.rows[0].user_id).toBe(userId);
    expect(query1.rows[0].guild_id).toBe(guildId);

    // Zweites Einfügen (Update durch ON CONFLICT)
    await db.execute({
      sql: `
        INSERT INTO verify_members (user_id, guild_id, verified_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(user_id, guild_id) DO UPDATE SET updated_at = datetime('now');
      `,
      args: [userId, guildId]
    });

    const query2 = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM verify_members WHERE user_id = ? AND guild_id = ?',
      args: [userId, guildId]
    });

    expect(query2.rows[0].count).toBe(1);
  });
});
