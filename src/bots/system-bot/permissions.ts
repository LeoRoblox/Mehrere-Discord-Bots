import {
  MessageFlags,
  type APIInteractionGuildMember,
  type Guild,
  type GuildMember,
  type RepliableInteraction
} from 'discord.js';
import { SYSTEM_BOT_CONFIG } from './config.js';

/** Interaktions-Member kann je nach Cache-Zustand ein GuildMember oder ein API-Rohobjekt sein. */
export type InteractionMember = GuildMember | APIInteractionGuildMember | null | undefined;

/**
 * Extrahiert die Rollen-IDs eines Interaktions-Members – unabhängig davon, ob discord.js ein
 * vollständiges GuildMember (roles.cache) oder ein rohes API-Objekt (roles: string[]) liefert.
 */
export function extractMemberRoleIds(member: InteractionMember): string[] {
  if (!member) return [];

  const roles: unknown = (member as { roles?: unknown }).roles;
  if (Array.isArray(roles)) {
    return roles.map((role) => String(role));
  }

  const cache = (roles as { cache?: Map<string, unknown> } | undefined)?.cache;
  if (cache && typeof cache.keys === 'function') {
    return Array.from(cache.keys());
  }

  return [];
}

/**
 * Prüft ausschließlich anhand der Rollen-IDs, ob das Adminpanel verwendet werden darf.
 * Es gibt bewusst KEINE Ausnahme für Server-Owner oder BOT_OWNER_ID – Zugriff nur über die Rollen.
 */
export function hasAdminPanelAccess(roleIds: readonly string[]): boolean {
  return SYSTEM_BOT_CONFIG.ADMIN_PANEL_ROLE_IDS.some((allowedRole) =>
    roleIds.includes(allowedRole)
  );
}

/**
 * Ermittelt die höchste Rollenposition eines Members (für Hierarchie-Prüfungen).
 * Funktioniert auch für rohe API-Member über den Rollen-Cache des Servers.
 */
export function getHighestRolePosition(member: InteractionMember, guild: Guild): number {
  if (!member) return 0;

  const roles = (member as { roles?: unknown }).roles as
    | { highest?: { position?: number } }
    | undefined;
  if (roles && !Array.isArray(roles) && typeof roles.highest?.position === 'number') {
    return roles.highest.position;
  }

  return extractMemberRoleIds(member).reduce((max, roleId) => {
    const position = guild.roles.cache.get(roleId)?.position ?? 0;
    return Math.max(max, position);
  }, 0);
}

/**
 * Serverseitige Berechtigungsprüfung für JEDE Adminpanel-Interaktion
 * (Slash-Command, Button, Select-Menü, Modal).
 *
 * Antwortet bei fehlender Berechtigung selbst mit einer ephemeren Fehlermeldung.
 *
 * @returns true, wenn die Interaktion fortgesetzt werden darf
 */
export async function ensureAdminPanelAccess(interaction: RepliableInteraction): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: '❌ Das Admin Panel kann nur innerhalb eines Discord-Servers verwendet werden.',
      flags: MessageFlags.Ephemeral
    });
    return false;
  }

  const roleIds = extractMemberRoleIds(interaction.member as InteractionMember);
  if (!hasAdminPanelAccess(roleIds)) {
    await interaction.reply({
      content: '❌ Du hast keine Berechtigung, das Admin Panel zu verwenden.',
      flags: MessageFlags.Ephemeral
    });
    return false;
  }

  return true;
}
