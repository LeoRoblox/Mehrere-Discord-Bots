import {
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
  type Client,
  type ContainerBuilder,
  type Guild,
  type GuildMember,
  type User
} from 'discord.js';
import { getHighestRolePosition, type InteractionMember } from './permissions.js';

/**
 * Gemeinsame Moderations-Hilfsfunktionen des Adminpanels (System-Bot).
 */

/** Prüft, ob ein Fehler ein Discord-API-Fehler (optional mit bestimmtem Code) ist. */
export function isDiscordAPIError(error: unknown, code?: number): error is DiscordAPIError {
  if (!(error instanceof DiscordAPIError)) return false;
  return code === undefined || Number(error.code) === code;
}

/**
 * Übersetzt Discord-API-Fehler in verständliche, deutsche Fehlermeldungen für Moderatoren.
 */
export function describeModerationError(error: unknown, actionLabel: string): string {
  if (isDiscordAPIError(error, RESTJSONErrorCodes.MissingPermissions)) {
    return (
      `❌ ${actionLabel} fehlgeschlagen: Mir fehlen die nötigen Berechtigungen. ` +
      'Bitte prüfe, ob der System-Bot die Berechtigung besitzt (Mitglieder moderieren / kicken / bannen) ' +
      'und ob seine Rolle in der Rollenliste ÜBER der Rolle der Zielperson steht.'
    );
  }
  if (isDiscordAPIError(error, RESTJSONErrorCodes.UnknownMember)) {
    return `❌ ${actionLabel} fehlgeschlagen: Diese Person ist nicht (mehr) Mitglied dieses Servers.`;
  }
  if (isDiscordAPIError(error, RESTJSONErrorCodes.UnknownUser)) {
    return `❌ ${actionLabel} fehlgeschlagen: Dieser Discord-Benutzer existiert nicht (mehr).`;
  }
  if (isDiscordAPIError(error)) {
    return `❌ ${actionLabel} fehlgeschlagen: Discord hat die Aktion abgelehnt (Fehlercode ${error.code}).`;
  }
  return `❌ ${actionLabel} fehlgeschlagen: Unerwarteter Fehler.`;
}

/**
 * Lädt das Ziel-Mitglied stets frisch von Discord (Rollen/Timeout-Status können sich geändert haben).
 * Liefert null, wenn die Person kein Mitglied (mehr) ist.
 */
export async function fetchTargetMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch({ user: userId, force: true });
  } catch (error) {
    if (
      isDiscordAPIError(error, RESTJSONErrorCodes.UnknownMember) ||
      isDiscordAPIError(error, RESTJSONErrorCodes.UnknownUser)
    ) {
      return null;
    }
    throw error;
  }
}

export type GuardedAction = 'timeout' | 'kick' | 'ban' | 'warn' | 'unwarn' | 'info';

export interface TargetGuardInput {
  action: GuardedAction;
  guild: Guild;
  /** Der Moderator, der die Aktion ausführt */
  executor: { id: string; member: InteractionMember };
  /** Die Zielperson (bereits als Mitglied geladen) */
  target: GuildMember;
  /** Die Bot-User-ID des System-Bots */
  botUserId: string | undefined;
}

/**
 * Serverseitige Schutzprüfungen, bevor eine Aktion auf eine Zielperson angewendet wird.
 *
 * @returns Fehlermeldung für den Moderator oder null, wenn die Aktion erlaubt ist
 */
export function checkTargetGuards(input: TargetGuardInput): string | null {
  const { action, guild, executor, target, botUserId } = input;

  if (target.id === executor.id) {
    return '❌ Du kannst diese Aktion nicht auf dich selbst anwenden.';
  }
  if (botUserId && target.id === botUserId) {
    return '❌ Ich kann diese Aktion nicht auf mich selbst anwenden.';
  }
  if (target.user.bot) {
    return '❌ Bots können nicht über das Admin Panel verwaltet werden.';
  }

  const isPunishment =
    action === 'timeout' || action === 'kick' || action === 'ban' || action === 'warn';

  if (isPunishment) {
    if (target.id === guild.ownerId) {
      return '❌ Der Server-Inhaber kann nicht bestraft werden.';
    }

    const executorIsOwner = executor.id === guild.ownerId;
    if (!executorIsOwner) {
      const executorPosition = getHighestRolePosition(executor.member, guild);
      const targetPosition = getHighestRolePosition(target, guild);
      if (targetPosition >= executorPosition) {
        return '❌ Du kannst keine Person bestrafen, deren höchste Rolle gleich hoch oder höher als deine ist.';
      }
    }
  }

  const hierarchyHint =
    'Bitte prüfe die Bot-Berechtigungen und ob die Rolle des System-Bots ÜBER der Rolle der Zielperson steht.';

  if (action === 'timeout' && !target.moderatable) {
    return `❌ Ich kann diese Person nicht timeouten (fehlende Berechtigung „Mitglieder moderieren“ oder Rollenhierarchie). ${hierarchyHint}`;
  }
  if (action === 'kick' && !target.kickable) {
    return `❌ Ich kann diese Person nicht kicken (fehlende Berechtigung „Mitglieder kicken“ oder Rollenhierarchie). ${hierarchyHint}`;
  }
  if (action === 'ban' && !target.bannable) {
    return `❌ Ich kann diese Person nicht bannen (fehlende Berechtigung „Mitglieder bannen“ oder Rollenhierarchie). ${hierarchyHint}`;
  }

  return null;
}

/**
 * Sendet einer Person eine private Components-V2-Nachricht.
 *
 * @returns true bei Erfolg, false wenn die DM nicht zugestellt werden konnte (z. B. DMs deaktiviert)
 */
export async function sendDirectMessage(
  client: Client,
  userId: string,
  container: ContainerBuilder
): Promise<boolean> {
  try {
    await client.users.send(userId, {
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return true;
  } catch {
    // Typisch: RESTJSONErrorCodes.CannotSendMessagesToThisUser (DMs deaktiviert / Bot blockiert).
    // Eine nicht zustellbare DM darf die eigentliche Moderationsaktion niemals abbrechen.
    return false;
  }
}

/** Erstellt einen Audit-Log-Grund (max. 512 Zeichen) für Discord. */
export function buildAuditReason(executor: User, detail?: string): string {
  const base = `Admin Panel · ${executor.tag} (${executor.id})`;
  const full = detail ? `${base} · ${detail}` : base;
  return full.length > 512 ? `${full.slice(0, 509)}...` : full;
}
