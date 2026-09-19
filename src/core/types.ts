import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder
} from 'discord.js';
import type { Client as LibsqlClient } from '@libsql/client';

/**
 * Gemeinsamer Kontext, der jedem Bot-Modul zur Verfügung gestellt wird.
 */
export interface BotContext {
  /** Der discord.js Client dieser spezifischen Bot-Instanz */
  client: Client;
  /** Die gemeinsame Turso libSQL-Datenbankverbindung */
  db: LibsqlClient;
  /** Globale Discord-Benutzer-ID des Besitzers (für administrative Berechtigungsprüfungen) */
  ownerId: string;
  /** Kontextbezogener Logger */
  logger: BotLogger;
}

/**
 * Interface für Slash-Commands
 */
export interface ISlashCommand {
  /** Slash-Command-Definition für die Discord-API */
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  /** Ausführungslogik */
  execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void>;
}

/**
 * Interface für Button-Interaktionen
 */
export interface IButtonHandler {
  /** Eindeutige customId oder Präfix */
  customId: string | RegExp;
  /** Ausführungslogik */
  execute(interaction: ButtonInteraction, context: BotContext): Promise<void>;
}

export interface ISelectMenuHandler {
  customId: string | RegExp;
  execute(interaction: StringSelectMenuInteraction, context: BotContext): Promise<void>;
}

export interface IModalHandler {
  customId: string | RegExp;
  execute(interaction: ModalSubmitInteraction, context: BotContext): Promise<void>;
}

/**
 * Interface für Datenbankmigrationen
 */
export interface IMigration {
  /** Eindeutige ID / Versionsnummer (z. B. '001_initial') */
  id: string;
  /** SQL-Befehle oder Migrationsfunktion */
  up: (db: LibsqlClient) => Promise<void>;
}

/**
 * Modul-Interface für eigenständige Bots in der Bot-Registry
 */
export interface IBotModule {
  /** Eindeutiger technischer Bezeichner des Bots (z. B. 'verify-bot') */
  readonly id: string;
  /** Menschenlesbarer Name */
  readonly name: string;
  /** Name der Umgebungsvariable, die das Bot-Token enthält */
  readonly tokenEnvVar: string;
  /** Exakt die für dieses Modul benötigten Gateway-Intents */
  readonly requiredIntents: GatewayIntentBits[];
  /** Datenbankmigrationen für diesen Bot (eigener Namespace) */
  readonly migrations?: IMigration[];
  /** Registrierte Slash-Commands */
  readonly commands: ISlashCommand[];
  /** Registrierte Button-Handler */
  readonly buttons?: IButtonHandler[];
  readonly selectMenus?: ISelectMenuHandler[];
  readonly modals?: IModalHandler[];
  /** Initialisierungs-Hook nach erfolgreichem Login */
  onInit?(context: BotContext): Promise<void>;
  /** Cleanup-Hook vor dem Herunterfahren */
  onDestroy?(): Promise<void>;
}

/**
 * Kontextueller Logger
 */
export interface BotLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: unknown): void;
  debug(message: string, ...args: unknown[]): void;
}
