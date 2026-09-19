import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient, type Client as LibsqlClient } from '@libsql/client';
import { runMigrations } from '../../src/core/migrations.js';
import { systemBotMigrations } from '../../src/bots/system-bot/migrations.js';
import { verifyBotMigrations } from '../../src/bots/verify-bot/migrations.js';
import {
  addWarning,
  countActiveWarnings,
  listActiveWarnings,
  revokeWarning
} from '../../src/bots/system-bot/warnings.js';
import { SYSTEM_BOT_CONFIG } from '../../src/bots/system-bot/config.js';
import { GUILD_ID, MOD_ID, TARGET_ID } from './helpers.js';

describe('System-Bot: Migrationen', () => {
  let db: LibsqlClient;

  beforeEach(() => {
    db = createClient({ url: ':memory:' });
  });

  afterEach(() => {
    db.close();
  });

  it('legt die eigene Warnungs-Tabelle system_warnings im Namespace system-bot an', async () => {
    await runMigrations(db, 'system-bot', systemBotMigrations);

    const table = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='system_warnings';"
    );
    expect(table.rows.length).toBe(1);

    const columns = await db.execute('PRAGMA table_info(system_warnings);');
    const columnNames = columns.rows.map((row) => String(row.name));
    expect(columnNames).toEqual(
      expect.arrayContaining([
        'id',
        'guild_id',
        'user_id',
        'moderator_id',
        'reason',
        'created_at',
        'revoked_at',
        'revoked_by'
      ])
    );

    const applied = await db.execute(
      "SELECT migration_id FROM _system_migrations WHERE namespace = 'system-bot' ORDER BY migration_id;"
    );
    expect(applied.rows.map((row) => row.migration_id)).toEqual([
      '001_create_system_warnings',
      '002_import_legacy_admin_warnings'
    ]);
  });

  it('ist idempotent', async () => {
    await runMigrations(db, 'system-bot', systemBotMigrations);
    await runMigrations(db, 'system-bot', systemBotMigrations);

    const count = await db.execute(
      "SELECT COUNT(*) AS cnt FROM _system_migrations WHERE namespace = 'system-bot';"
    );
    expect(Number(count.rows[0].cnt)).toBe(systemBotMigrations.length);
  });

  it('läuft unabhängig neben den unveränderten Verify-Migrationen (getrennte Namespaces)', async () => {
    await runMigrations(db, 'verify-bot', verifyBotMigrations);
    await runMigrations(db, 'system-bot', systemBotMigrations);

    const rows = await db.execute(
      'SELECT namespace, migration_id FROM _system_migrations ORDER BY namespace, migration_id;'
    );
    expect(rows.rows.map((r) => `${r.namespace}:${r.migration_id}`)).toEqual([
      'system-bot:001_create_system_warnings',
      'system-bot:002_import_legacy_admin_warnings',
      'verify-bot:001_create_verify_tables'
    ]);

    // Die Verify-Tabellen bleiben exakt erhalten
    const verifyTables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'verify_%' ORDER BY name;"
    );
    expect(verifyTables.rows.map((r) => r.name)).toEqual(['verify_audit_log', 'verify_members']);

    // Der Verify-Bot besitzt KEINE Warnungs-Tabelle mehr
    const verifyMigrationSource = verifyBotMigrations.map((m) => m.up.toString()).join('\n');
    expect(verifyMigrationSource).not.toContain('warnings');
  });

  it('übernimmt Warnungen aus der alten admin_warnings-Tabelle einmalig, ohne sie zu löschen', async () => {
    // Alte Tabelle der fehlerhaften Vorgängerversion simulieren
    await db.execute(`CREATE TABLE admin_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL, reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute({
      sql: 'INSERT INTO admin_warnings (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [GUILD_ID, TARGET_ID, MOD_ID, 'Alte Warnung', '2026-09-19 20:00:00']
    });

    await runMigrations(db, 'system-bot', systemBotMigrations);

    const imported = await listActiveWarnings(db, GUILD_ID, TARGET_ID);
    expect(imported).toHaveLength(1);
    expect(imported[0].reason).toBe('Alte Warnung');
    expect(imported[0].createdAt).toBe('2026-09-19 20:00:00');

    const legacy = await db.execute('SELECT COUNT(*) AS cnt FROM admin_warnings;');
    expect(Number(legacy.rows[0].cnt)).toBe(1);

    // Zweiter Lauf importiert nicht erneut
    await runMigrations(db, 'system-bot', systemBotMigrations);
    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(1);
  });
});

describe('System-Bot: Warnungs-Datenbanklogik', () => {
  let db: LibsqlClient;

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    await runMigrations(db, 'system-bot', systemBotMigrations);
  });

  afterEach(() => {
    db.close();
  });

  it('speichert Warnungen und zählt nur aktive Warnungen pro Server und Benutzer', async () => {
    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(0);

    const first = await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: '  Spam  '
    });
    expect(first).toEqual({ added: true, activeCount: 1 });

    const second = await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'Beleidigung'
    });
    expect(second).toEqual({ added: true, activeCount: 2 });

    const list = await listActiveWarnings(db, GUILD_ID, TARGET_ID);
    expect(list.map((w) => w.reason)).toEqual(['Spam', 'Beleidigung']);
    expect(list[0].moderatorId).toBe(MOD_ID);

    // Andere Server / Benutzer sind unabhängig
    expect(await countActiveWarnings(db, '900000000000000002', TARGET_ID)).toBe(0);
    expect(await countActiveWarnings(db, GUILD_ID, MOD_ID)).toBe(0);
  });

  it('erlaubt niemals mehr als 5 aktive Warnungen', async () => {
    const max = SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS;
    expect(max).toBe(5);

    for (let i = 1; i <= max; i++) {
      const result = await addWarning(db, {
        guildId: GUILD_ID,
        userId: TARGET_ID,
        moderatorId: MOD_ID,
        reason: `Warnung ${i}`
      });
      expect(result).toEqual({ added: true, activeCount: i });
    }

    const sixth = await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'Warnung 6'
    });
    expect(sixth).toEqual({ added: false, activeCount: max });
    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(max);
  });

  it('hält das Maximum auch bei gleichzeitigen Warnungen ein (atomare Prüfung)', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        addWarning(db, {
          guildId: GUILD_ID,
          userId: TARGET_ID,
          moderatorId: MOD_ID,
          reason: `Parallel ${i}`
        })
      )
    );

    expect(results.filter((r) => r.added)).toHaveLength(SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS);
    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(
      SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS
    );
  });

  it('hebt Warnungen auf (Soft-Delete) – sie erscheinen danach nicht mehr in der Liste', async () => {
    await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'A'
    });
    await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'B'
    });
    const [warnA] = await listActiveWarnings(db, GUILD_ID, TARGET_ID);

    const result = await revokeWarning(db, {
      warningId: warnA.id,
      guildId: GUILD_ID,
      userId: TARGET_ID,
      revokedBy: MOD_ID
    });
    expect(result).toEqual({ revoked: true, activeCount: 1 });

    const remaining = await listActiveWarnings(db, GUILD_ID, TARGET_ID);
    expect(remaining.map((w) => w.reason)).toEqual(['B']);

    // Aufgehobene Warnung bleibt nachvollziehbar in der Tabelle
    const stored = await db.execute({
      sql: 'SELECT revoked_at, revoked_by FROM system_warnings WHERE id = ?',
      args: [warnA.id]
    });
    expect(stored.rows[0].revoked_by).toBe(MOD_ID);
    expect(stored.rows[0].revoked_at).not.toBeNull();

    // Nach dem Aufheben ist wieder Platz für eine neue Warnung
    const again = await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'C'
    });
    expect(again).toEqual({ added: true, activeCount: 2 });
  });

  it('meldet bereits aufgehobene oder fremde Warnungen als nicht aufgehoben', async () => {
    await addWarning(db, {
      guildId: GUILD_ID,
      userId: TARGET_ID,
      moderatorId: MOD_ID,
      reason: 'A'
    });
    const [warnA] = await listActiveWarnings(db, GUILD_ID, TARGET_ID);

    // Falscher Benutzer → keine Änderung
    const wrongUser = await revokeWarning(db, {
      warningId: warnA.id,
      guildId: GUILD_ID,
      userId: MOD_ID,
      revokedBy: MOD_ID
    });
    expect(wrongUser.revoked).toBe(false);
    expect(await countActiveWarnings(db, GUILD_ID, TARGET_ID)).toBe(1);

    // Erstes Aufheben klappt, zweites nicht mehr
    expect(
      (
        await revokeWarning(db, {
          warningId: warnA.id,
          guildId: GUILD_ID,
          userId: TARGET_ID,
          revokedBy: MOD_ID
        })
      ).revoked
    ).toBe(true);
    expect(
      (
        await revokeWarning(db, {
          warningId: warnA.id,
          guildId: GUILD_ID,
          userId: TARGET_ID,
          revokedBy: MOD_ID
        })
      ).revoked
    ).toBe(false);

    // Nicht existierende ID
    expect(
      (
        await revokeWarning(db, {
          warningId: 99999,
          guildId: GUILD_ID,
          userId: TARGET_ID,
          revokedBy: MOD_ID
        })
      ).revoked
    ).toBe(false);
  });
});
