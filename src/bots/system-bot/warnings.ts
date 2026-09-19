import type { Client as LibsqlClient } from '@libsql/client';
import { SYSTEM_BOT_CONFIG } from './config.js';

/**
 * Datenbanklogik für Warnungen des Adminpanels.
 * Diese Logik gehört AUSSCHLIESSLICH dem System-Bot (Tabelle `system_warnings`).
 */

export interface WarningRecord {
  id: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  createdAt: string;
}

export interface AddWarningInput {
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
}

export interface AddWarningResult {
  /** false, wenn das Maximum aktiver Warnungen bereits erreicht war */
  added: boolean;
  /** Anzahl aktiver Warnungen NACH dem Vorgang */
  activeCount: number;
}

export interface RevokeWarningInput {
  warningId: number;
  guildId: string;
  userId: string;
  revokedBy: string;
}

export interface RevokeWarningResult {
  /** false, wenn die Warnung nicht existiert(e) oder bereits aufgehoben war */
  revoked: boolean;
  /** Anzahl aktiver Warnungen NACH dem Vorgang */
  activeCount: number;
}

/** Zählt die aktiven (nicht aufgehobenen) Warnungen eines Benutzers auf einem Server. */
export async function countActiveWarnings(
  db: LibsqlClient,
  guildId: string,
  userId: string
): Promise<number> {
  const result = await db.execute({
    sql: 'SELECT COUNT(*) AS count FROM system_warnings WHERE guild_id = ? AND user_id = ? AND revoked_at IS NULL',
    args: [guildId, userId]
  });
  return Number(result.rows[0]?.count ?? 0);
}

/** Listet alle aktiven Warnungen eines Benutzers (älteste zuerst). */
export async function listActiveWarnings(
  db: LibsqlClient,
  guildId: string,
  userId: string
): Promise<WarningRecord[]> {
  const result = await db.execute({
    sql: `SELECT id, guild_id, user_id, moderator_id, reason, created_at
          FROM system_warnings
          WHERE guild_id = ? AND user_id = ? AND revoked_at IS NULL
          ORDER BY created_at ASC, id ASC`,
    args: [guildId, userId]
  });

  return result.rows.map((row) => ({
    id: Number(row.id),
    guildId: String(row.guild_id),
    userId: String(row.user_id),
    moderatorId: String(row.moderator_id),
    reason: String(row.reason),
    createdAt: String(row.created_at)
  }));
}

/**
 * Fügt eine Warnung hinzu – aber nur, wenn der Benutzer weniger als MAX_ACTIVE_WARNINGS
 * aktive Warnungen besitzt. Die Prüfung erfolgt atomar in derselben SQL-Anweisung,
 * damit auch bei gleichzeitigen Aktionen mehrerer Moderatoren niemals mehr als das
 * Maximum entstehen kann.
 */
export async function addWarning(
  db: LibsqlClient,
  input: AddWarningInput
): Promise<AddWarningResult> {
  const max = SYSTEM_BOT_CONFIG.MAX_ACTIVE_WARNINGS;
  const reason = input.reason.trim();

  const result = await db.execute({
    sql: `INSERT INTO system_warnings (guild_id, user_id, moderator_id, reason)
          SELECT ?, ?, ?, ?
          WHERE (
            SELECT COUNT(*) FROM system_warnings
            WHERE guild_id = ? AND user_id = ? AND revoked_at IS NULL
          ) < ?`,
    args: [input.guildId, input.userId, input.moderatorId, reason, input.guildId, input.userId, max]
  });

  const activeCount = await countActiveWarnings(db, input.guildId, input.userId);
  return { added: result.rowsAffected > 0, activeCount };
}

/**
 * Hebt eine aktive Warnung auf (Soft-Delete: revoked_at wird gesetzt).
 * Die Warnung erscheint danach nicht mehr in der Liste aktiver Warnungen.
 */
export async function revokeWarning(
  db: LibsqlClient,
  input: RevokeWarningInput
): Promise<RevokeWarningResult> {
  const result = await db.execute({
    sql: `UPDATE system_warnings
          SET revoked_at = datetime('now'), revoked_by = ?
          WHERE id = ? AND guild_id = ? AND user_id = ? AND revoked_at IS NULL`,
    args: [input.revokedBy, input.warningId, input.guildId, input.userId]
  });

  const activeCount = await countActiveWarnings(db, input.guildId, input.userId);
  return { revoked: result.rowsAffected > 0, activeCount };
}
