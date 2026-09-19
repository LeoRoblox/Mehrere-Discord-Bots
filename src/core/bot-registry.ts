import {
  Client,
  Events,
  Options,
  type Guild,
  type Interaction,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction
} from 'discord.js';
import type { Client as LibsqlClient } from '@libsql/client';
import type {
  IBotModule,
  BotContext,
  ISlashCommand,
  IButtonHandler,
  ISelectMenuHandler,
  IModalHandler,
  BotLogger
} from './types.js';
import type { AppConfig } from './config.js';
import { runMigrations } from './migrations.js';
import { logger } from './logger.js';

interface ActiveBotInstance {
  module: IBotModule;
  client: Client;
  context: BotContext;
}

/** Zusammenfassung des Login-Zustands eines Bot-Moduls (für eindeutige Start-Logs). */
export interface BotStatusSummary {
  id: string;
  name: string;
  tokenEnvVar: string;
  clientIdEnvVar?: string;
  /** Slash-Commands, die dieses Modul registriert */
  commands: string[];
  status: 'online' | 'connecting' | 'failed';
  userTag?: string;
  userId?: string;
  applicationId?: string;
  failureReason?: string;
}

/** Wie lange nach dem Login maximal auf das ClientReady-Event gewartet wird. */
const READY_TIMEOUT_MS = 30_000;

/**
 * Prüft, ob der angemeldete Discord-Account zur konfigurierten Client-ID passt.
 * Ältere Bot-Accounts können eine von der Application-ID abweichende User-ID besitzen,
 * daher gilt die Prüfung als bestanden, wenn eine der beiden IDs übereinstimmt.
 */
export function matchesConfiguredClientId(
  expectedClientId: string | undefined,
  actual: { applicationId?: string | null; userId: string }
): boolean {
  if (!expectedClientId) return true;
  return expectedClientId === actual.applicationId || expectedClientId === actual.userId;
}

export class BotRegistry {
  private readonly modules: Map<string, IBotModule> = new Map();
  private readonly activeBots: Map<string, ActiveBotInstance> = new Map();
  private readonly statuses: Map<string, BotStatusSummary> = new Map();
  private readonly config: AppConfig;
  private readonly db: LibsqlClient;

  constructor(config: AppConfig, db: LibsqlClient) {
    this.config = config;
    this.db = db;
  }

  /**
   * Registriert ein Bot-Modul im System
   */
  public register(module: IBotModule): this {
    if (this.modules.has(module.id)) {
      throw new Error(`Bot-Modul mit ID '${module.id}' ist bereits registriert.`);
    }
    this.modules.set(module.id, module);
    logger.info(
      `Bot-Modul '${module.name}' (ID: ${module.id}) registriert. Token-Variable: ${module.tokenEnvVar}${
        module.clientIdEnvVar ? `, Client-ID-Variable: ${module.clientIdEnvVar}` : ''
      }, Commands: ${this.describeCommands(module)}`
    );
    return this;
  }

  /**
   * Gibt alle registrierten Bot-Module zurück
   */
  public getRegisteredModules(): IBotModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * Liefert den aktuellen Login-/Startzustand aller registrierten Bot-Module.
   */
  public getStatusSummary(): BotStatusSummary[] {
    return Array.from(this.modules.values()).map(
      (module) =>
        this.statuses.get(module.id) ?? {
          id: module.id,
          name: module.name,
          tokenEnvVar: module.tokenEnvVar,
          clientIdEnvVar: module.clientIdEnvVar,
          commands: module.commands.map((cmd) => `/${cmd.data.name}`),
          status: 'failed',
          failureReason: 'Bot wurde nicht gestartet.'
        }
    );
  }

  /**
   * Startet alle registrierten Bot-Module isoliert
   */
  public async startAll(): Promise<void> {
    logger.info(
      `Starte ${this.modules.size} getrennte(n) Discord-Bot(s): ${Array.from(this.modules.values())
        .map((m) => `'${m.name}' (${m.id})`)
        .join(', ')}`
    );

    for (const botModule of this.modules.values()) {
      try {
        await this.startBot(botModule);
      } catch (error) {
        logger.error(`Fehler beim Starten von Bot '${botModule.name}' (${botModule.id}):`, error);
        this.setStatus(botModule, {
          status: 'failed',
          failureReason: error instanceof Error ? error.message : String(error)
        });
        // Isolierung: Ein Fehler bei einem Bot verhindert nicht den Start weiterer Bots
      }
    }

    this.logStartupSummary();
  }

  /**
   * Startet ein einzelnes Bot-Modul
   */
  public async startBot(botModule: IBotModule): Promise<void> {
    const log = logger.forContext(`Bot:${botModule.id}`);
    const token = process.env[botModule.tokenEnvVar]?.trim();
    const expectedClientId = botModule.clientIdEnvVar
      ? process.env[botModule.clientIdEnvVar]?.trim() || undefined
      : undefined;

    log.info(
      `▶️  Starte Bot '${botModule.name}' (ID: ${botModule.id}) | Token aus ${botModule.tokenEnvVar} | ${
        botModule.clientIdEnvVar
          ? `Client-ID aus ${botModule.clientIdEnvVar}=${expectedClientId ?? '(nicht gesetzt)'}`
          : 'keine Client-ID-Variable konfiguriert'
      } | Commands: ${this.describeCommands(botModule)}`
    );
    this.setStatus(botModule, { status: 'connecting' });

    if (!token) {
      const reason = `Umgebungsvariable '${botModule.tokenEnvVar}' fehlt! Bot '${botModule.name}' kann nicht gestartet werden und wird übersprungen.`;
      log.error(reason);
      this.setStatus(botModule, { status: 'failed', failureReason: reason });
      return;
    }

    // 1. Führe eventuelle Datenbankmigrationen für diesen Bot aus
    if (botModule.migrations && botModule.migrations.length > 0) {
      log.info(`Prüfe Datenbankmigrationen für Namespace '${botModule.id}'...`);
      await runMigrations(this.db, botModule.id, botModule.migrations);
    }

    // 2. Erstelle optimierten discord.js Client (extrem sparsam im RAM-Verbrauch)
    const client = new Client({
      intents: botModule.requiredIntents,
      // Aggressive Deaktivierung und Begrenzung ungenutzter Caches für minimalen RAM-Verbrauch (~400MB Render Free Tier)
      makeCache: Options.cacheWithLimits({
        MessageManager: 0,
        BaseGuildEmojiManager: 0,
        GuildBanManager: 0,
        GuildInviteManager: 0,
        GuildScheduledEventManager: 0,
        PresenceManager: 0,
        ReactionManager: 0,
        ReactionUserManager: 0,
        StageInstanceManager: 0,
        ThreadManager: 0,
        ThreadMemberManager: 0,
        GuildStickerManager: 0,
        ApplicationCommandManager: 0,
        UserManager: 100,
        GuildMemberManager: 100
      })
    });

    const context: BotContext = {
      client,
      db: this.db,
      ownerId: this.config.BOT_OWNER_ID,
      logger: log
    };

    // 3. Fehlerbehandlung und Event-Handler
    client.on('error', (err) => {
      log.error('Discord-Clientfehler:', err);
    });

    client.on('warn', (warning) => {
      log.warn('Discord-Clientwarnung:', warning);
    });

    // Promise, das erst erfüllt wird, wenn der Bot eingeloggt und identitätsgeprüft ist.
    let resolveReady!: () => void;
    let rejectReady!: (reason: Error) => void;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // Ablehnung wird weiter unten per Promise.race ausgewertet – hier nur als "behandelt" markieren,
    // falls ClientReady noch vor dem Aufsetzen des Race-Awaits feuert.
    readyPromise.catch(() => null);

    client.once(Events.ClientReady, async (readyClient) => {
      try {
        const applicationId = readyClient.application?.id ?? null;

        log.info(
          `✅ Bot '${botModule.name}' (${botModule.id}) ist eingeloggt als '${readyClient.user.tag}' (User-ID: ${readyClient.user.id}, Application-ID: ${applicationId ?? 'unbekannt'}).`
        );

        // Sicherheitsprüfung: Token und Client-ID müssen zur selben Discord-Anwendung gehören.
        // Verhindert, dass z. B. vertauschte Tokens die Commands des falschen Bots registrieren.
        if (
          !matchesConfiguredClientId(expectedClientId, {
            applicationId,
            userId: readyClient.user.id
          })
        ) {
          const reason =
            `Konfigurationskonflikt: ${botModule.clientIdEnvVar}=${expectedClientId} stimmt NICHT mit der Application-ID ` +
            `des per ${botModule.tokenEnvVar} eingeloggten Accounts '${readyClient.user.tag}' (${applicationId ?? readyClient.user.id}) überein. ` +
            `Token und Client-ID gehören zu unterschiedlichen Discord-Anwendungen (Tokens vertauscht?). ` +
            `Bot '${botModule.name}' wird aus Sicherheitsgründen gestoppt und registriert KEINE Commands.`;
          log.error(reason);
          this.setStatus(botModule, {
            status: 'failed',
            failureReason: reason,
            userTag: readyClient.user.tag,
            userId: readyClient.user.id,
            applicationId: applicationId ?? undefined
          });
          await client.destroy().catch(() => null);
          rejectReady(new Error(reason));
          return;
        }

        this.setStatus(botModule, {
          status: 'online',
          userTag: readyClient.user.tag,
          userId: readyClient.user.id,
          applicationId: applicationId ?? undefined
        });

        // Slash-Commands automatisch bei Discord registrieren (Auto-Deploy bei JEDEM Start),
        // damit die Befehle immer aktuell und ohne manuelles Ausführen von
        // 'npm run deploy-commands' auf allen Servern verfügbar sind.
        await this.deployCommands(botModule, readyClient, log);

        if (botModule.onInit) {
          try {
            await botModule.onInit(context);
          } catch (initErr) {
            log.error(`Fehler bei onInit für Bot '${botModule.name}':`, initErr);
          }
        }

        resolveReady();
      } catch (readyErr) {
        log.error(`Fehler bei der Initialisierung von Bot '${botModule.name}':`, readyErr);
        rejectReady(readyErr instanceof Error ? readyErr : new Error(String(readyErr)));
      }
    });

    // Neuer Server: Slash-Commands SOFORT registrieren, ohne Neustart abwarten zu müssen
    client.on(Events.GuildCreate, (guild: Guild) => {
      this.registerCommandsForGuild(botModule, client, guild.id, log);
    });

    // 4. Interaktions-Dispatcher – jeder Bot verarbeitet AUSSCHLIESSLICH seine eigenen
    //    Commands, Buttons, Select-Menüs und Modals (eigener Client, eigene Handler-Listen).
    client.on('interactionCreate', async (interaction: Interaction) => {
      try {
        await this.dispatchInteraction(botModule, interaction, context);
      } catch (unhandledErr) {
        log.error('Unerwarteter Fehler bei der Interaktionsverarbeitung:', unhandledErr);
      }
    });

    // 5. Bei Discord einloggen
    log.info(
      `Melde Bot '${botModule.name}' mit Token aus ${botModule.tokenEnvVar} bei Discord an...`
    );
    await client.login(token);

    this.activeBots.set(botModule.id, {
      module: botModule,
      client,
      context
    });

    // 6. Auf erfolgreichen Login + Identitätsprüfung warten (mit Zeitlimit, um den Start
    //    weiterer Bots nicht unbegrenzt zu blockieren).
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        log.warn(
          `Bot '${botModule.name}' hat nach ${READY_TIMEOUT_MS / 1000}s noch kein ClientReady-Event gemeldet. Der Start wird fortgesetzt; der Login läuft im Hintergrund weiter.`
        );
        resolve();
      }, READY_TIMEOUT_MS);
    });

    try {
      await Promise.race([readyPromise, timeoutPromise]);
    } catch (readyError) {
      // Identitätsprüfung fehlgeschlagen o. ä.: Client wurde bereits gestoppt, nicht als aktiv führen.
      this.activeBots.delete(botModule.id);
      throw readyError;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  /**
   * Registriert die Slash-Commands eines Bot-Moduls automatisch bei Discord.
   * Wird bei JEDEM Bot-Start ausgeführt, damit die Befehle immer aktuell sind.
   *
   * Strategie:
   *  1. Globale Registrierung: Gilt für alle aktuellen und zukünftigen Server.
   *     Discord kann globale Änderungen bis zu 1 Stunde cachen.
   *  2. Zusätzliche Guild-Registrierung für JEDEN Server, auf dem der Bot
   *     aktuell Mitglied ist (sowie optional DISCORD_DEV_GUILD_ID):
   *     Guild-Commands sind SOFORT aktiv. Ein Guild-Command mit demselben Namen
   *     wie ein globaler Command überschreibt diesen lokal – es entstehen keine
   *     Duplikate (siehe Discord-Dokumentation).
   */
  public async deployCommands(
    botModule: IBotModule,
    readyClient: Client<true>,
    log: BotLogger
  ): Promise<void> {
    const commandsData = botModule.commands.map((cmd) => cmd.data.toJSON());

    if (commandsData.length === 0) {
      log.warn(
        `Keine Slash-Commands für Bot '${botModule.name}' definiert – Registrierung wird übersprungen.`
      );
      return;
    }

    const commandList = commandsData.map((c) => `/${c.name}`).join(', ');

    // 1) Global für alle Server registrieren (persistent, auch für zukünftige Server)
    try {
      await readyClient.application.commands.set(commandsData);
      log.info(
        `✅ ${commandsData.length} globale(r) Slash-Command(s) für Bot '${botModule.name}' (${botModule.id}) registriert: ${commandList}`
      );
    } catch (error) {
      log.error(
        `Fehler beim globalen Registrieren der Slash-Commands für Bot '${botModule.name}':`,
        error
      );
    }

    // 2) Guild-Commands für jeden aktuellen Server: sofortige Verfügbarkeit
    const targetGuildIds = new Set<string>(readyClient.guilds.cache.keys());

    const devGuildId = this.config.DISCORD_DEV_GUILD_ID;
    if (devGuildId) {
      // Test-/Entwicklungsserver immer explizit einschließen (nicht mehr exklusiv!)
      targetGuildIds.add(devGuildId);
    }

    if (targetGuildIds.size > 0) {
      log.info(
        `Registriere Slash-Commands von Bot '${botModule.name}' zusätzlich sofort auf ${targetGuildIds.size} Server(n)...`
      );
    }

    for (const guildId of targetGuildIds) {
      await this.registerCommandsForGuild(botModule, readyClient, guildId, log);
    }
  }

  /**
   * Registriert die Slash-Commands eines Bot-Moduls für einen einzelnen Server.
   * Guild-Registrierungen sind bei Discord sofort aktiv (kein Cache-Delay).
   * Fehler werden isoliert, damit ein einzelner Server die übrigen nicht blockiert.
   */
  public async registerCommandsForGuild(
    botModule: IBotModule,
    client: Client,
    guildId: string,
    log: BotLogger
  ): Promise<void> {
    if (!botModule.commands || botModule.commands.length === 0) return;

    try {
      const commandsData = botModule.commands.map((cmd) => cmd.data.toJSON());
      await client.application?.commands.set(commandsData, guildId);
      log.info(
        `✅ ${commandsData.length} Slash-Command(s) von Bot '${botModule.name}' auf Server ${guildId} SOFORT aktiv: ${commandsData
          .map((c) => `/${c.name}`)
          .join(', ')}`
      );
    } catch (error) {
      log.error(
        `Fehler beim Registrieren der Slash-Commands von Bot '${botModule.name}' auf Server ${guildId}:`,
        error
      );
    }
  }

  /**
   * Leitet eine Interaktion an den passenden Handler des angegebenen Bot-Moduls weiter.
   * Es werden AUSSCHLIESSLICH die Handler dieses Moduls berücksichtigt – Commands, Buttons,
   * Select-Menüs und Modals anderer Bots sind für dieses Modul unsichtbar.
   *
   * @returns true, wenn ein Handler die Interaktion verarbeitet hat
   */
  public async dispatchInteraction(
    botModule: IBotModule,
    interaction: Interaction,
    context: BotContext
  ): Promise<boolean> {
    if (interaction.isChatInputCommand()) {
      return this.handleSlashCommand(botModule, interaction, context);
    }
    if (interaction.isButton()) {
      return this.handleButton(botModule, interaction, context);
    }
    if (interaction.isStringSelectMenu()) {
      return this.handleSelectMenu(botModule, interaction, context);
    }
    if (interaction.isModalSubmit()) {
      return this.handleModal(botModule, interaction, context);
    }
    return false;
  }

  private async handleSlashCommand(
    botModule: IBotModule,
    interaction: ChatInputCommandInteraction,
    context: BotContext
  ): Promise<boolean> {
    const command = botModule.commands.find(
      (c: ISlashCommand) => c.data.name === interaction.commandName
    );
    if (!command) {
      context.logger.warn(
        `Unbekannter Slash-Command '/${interaction.commandName}' für Bot '${botModule.name}' erhalten – wird ignoriert (gehört zu keinem Command dieses Bots).`
      );
      return false;
    }

    try {
      await command.execute(interaction, context);
    } catch (cmdError) {
      context.logger.error(
        `Fehler beim Ausführen von Command '/${interaction.commandName}':`,
        cmdError
      );
      await this.replyWithError(
        interaction,
        '❌ Bei der Ausführung dieses Befehls ist ein Fehler aufgetreten.'
      );
    }
    return true;
  }

  private async handleButton(
    botModule: IBotModule,
    interaction: ButtonInteraction,
    context: BotContext
  ): Promise<boolean> {
    if (!botModule.buttons || botModule.buttons.length === 0) return false;

    const handler = botModule.buttons.find((btn: IButtonHandler) =>
      this.matchesCustomId(btn.customId, interaction.customId)
    );

    if (!handler) return false;

    try {
      await handler.execute(interaction, context);
    } catch (btnError) {
      context.logger.error(`Fehler bei Button '${interaction.customId}':`, btnError);
      await this.replyWithError(
        interaction,
        '❌ Bei der Verarbeitung dieser Aktion ist ein Fehler aufgetreten.'
      );
    }
    return true;
  }

  private async handleSelectMenu(
    botModule: IBotModule,
    interaction: StringSelectMenuInteraction,
    context: BotContext
  ): Promise<boolean> {
    const handler = botModule.selectMenus?.find((entry: ISelectMenuHandler) =>
      this.matchesCustomId(entry.customId, interaction.customId)
    );
    if (!handler) return false;

    try {
      await handler.execute(interaction, context);
    } catch (selectError) {
      context.logger.error(`Fehler bei Select-Menü '${interaction.customId}':`, selectError);
      await this.replyWithError(
        interaction,
        '❌ Bei der Verarbeitung dieser Auswahl ist ein Fehler aufgetreten.'
      );
    }
    return true;
  }

  private async handleModal(
    botModule: IBotModule,
    interaction: ModalSubmitInteraction,
    context: BotContext
  ): Promise<boolean> {
    const handler = botModule.modals?.find((entry: IModalHandler) =>
      this.matchesCustomId(entry.customId, interaction.customId)
    );
    if (!handler) return false;

    try {
      await handler.execute(interaction, context);
    } catch (modalError) {
      context.logger.error(`Fehler bei Modal '${interaction.customId}':`, modalError);
      await this.replyWithError(
        interaction,
        '❌ Bei der Verarbeitung dieses Formulars ist ein Fehler aufgetreten.'
      );
    }
    return true;
  }

  private matchesCustomId(pattern: string | RegExp, customId: string): boolean {
    return typeof pattern === 'string' ? pattern === customId : pattern.test(customId);
  }

  /**
   * Sendet dem Benutzer eine ephemere Fehlermeldung – unabhängig davon, ob die Interaktion
   * bereits beantwortet/deferred wurde. Fehler beim Senden werden bewusst verschluckt.
   */
  private async replyWithError(
    interaction:
      | ChatInputCommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    errorMessage: string
  ): Promise<void> {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => null);
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => null);
    }
  }

  private describeCommands(botModule: IBotModule): string {
    if (!botModule.commands || botModule.commands.length === 0) return '(keine)';
    return botModule.commands.map((cmd) => `/${cmd.data.name}`).join(', ');
  }

  private setStatus(botModule: IBotModule, patch: Partial<BotStatusSummary>): void {
    const previous = this.statuses.get(botModule.id);
    this.statuses.set(botModule.id, {
      id: botModule.id,
      name: botModule.name,
      tokenEnvVar: botModule.tokenEnvVar,
      clientIdEnvVar: botModule.clientIdEnvVar,
      commands: botModule.commands.map((cmd) => `/${cmd.data.name}`),
      status: 'connecting',
      ...previous,
      ...patch
    });
  }

  /**
   * Gibt eine eindeutige Übersicht aus, welcher Bot unter welchem Discord-Account
   * eingeloggt ist und welche Commands er registriert.
   */
  public logStartupSummary(): void {
    const summaries = this.getStatusSummary();
    logger.info('=== Übersicht der getrennten Discord-Bots ===');
    for (const s of summaries) {
      if (s.status === 'online') {
        logger.info(
          `  ✅ ${s.name} [${s.id}] → eingeloggt als '${s.userTag}' (User-ID: ${s.userId}, Application-ID: ${s.applicationId ?? 'unbekannt'}) | Token: ${s.tokenEnvVar} | Commands: ${s.commands.join(', ') || '(keine)'}`
        );
      } else if (s.status === 'connecting') {
        logger.warn(
          `  ⏳ ${s.name} [${s.id}] → Login läuft noch (Token: ${s.tokenEnvVar}) | Commands: ${s.commands.join(', ') || '(keine)'}`
        );
      } else {
        logger.error(
          `  ❌ ${s.name} [${s.id}] → NICHT gestartet (Token: ${s.tokenEnvVar}) | Grund: ${s.failureReason ?? 'unbekannt'}`
        );
      }
    }

    // Zusätzliche Sicherheitsprüfung: Zwei Module dürfen niemals denselben Discord-Account nutzen.
    const online = summaries.filter((s) => s.status === 'online' && s.userId);
    const seen = new Map<string, BotStatusSummary>();
    for (const s of online) {
      const other = seen.get(s.userId!);
      if (other) {
        logger.error(
          `  ⚠️  KONFLIKT: '${s.name}' und '${other.name}' sind mit DEMSELBEN Discord-Account (${s.userTag}) eingeloggt! Bitte für jeden Bot ein eigenes Token verwenden – sonst überschreiben sich die Slash-Commands gegenseitig.`
        );
      } else {
        seen.set(s.userId!, s);
      }
    }
  }

  /**
   * Beendet alle aktiven Bots ordnungsgemäß (Graceful Shutdown)
   */
  public async stopAll(): Promise<void> {
    logger.info(`Fahre ${this.activeBots.size} aktive(n) Bot(s) herunter...`);

    for (const [id, active] of this.activeBots.entries()) {
      try {
        if (active.module.onDestroy) {
          await active.module.onDestroy();
        }
        active.client.destroy();
        logger.info(`Bot '${active.module.name}' (${id}) sauber beendet.`);
      } catch (err) {
        logger.error(`Fehler beim Beenden von Bot '${id}':`, err);
      }
    }

    this.activeBots.clear();
  }
}
