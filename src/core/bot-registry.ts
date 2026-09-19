import {
  Client,
  Events,
  Options,
  type Guild,
  type Interaction,
  type ChatInputCommandInteraction,
  type ButtonInteraction
} from 'discord.js';
import type { Client as LibsqlClient } from '@libsql/client';
import type {
  IBotModule,
  BotContext,
  ISlashCommand,
  IButtonHandler,
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

export class BotRegistry {
  private readonly modules: Map<string, IBotModule> = new Map();
  private readonly activeBots: Map<string, ActiveBotInstance> = new Map();
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
    logger.info(`Bot-Modul '${module.name}' (ID: ${module.id}) registriert.`);
    return this;
  }

  /**
   * Gibt alle registrierten Bot-Module zurück
   */
  public getRegisteredModules(): IBotModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * Startet alle registrierten Bot-Module isoliert
   */
  public async startAll(): Promise<void> {
    for (const botModule of this.modules.values()) {
      try {
        await this.startBot(botModule);
      } catch (error) {
        logger.error(`Fehler beim Starten von Bot '${botModule.name}' (${botModule.id}):`, error);
        // Isolierung: Ein Fehler bei einem Bot verhindert nicht den Start weiterer Bots
      }
    }
  }

  /**
   * Startet ein einzelnes Bot-Modul
   */
  public async startBot(botModule: IBotModule): Promise<void> {
    const log = logger.forContext(`Bot:${botModule.id}`);
    const token = process.env[botModule.tokenEnvVar];

    if (!token) {
      log.error(
        `Umgebungsvariable '${botModule.tokenEnvVar}' fehlt! Bot '${botModule.name}' wird übersprungen.`
      );
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

    client.once(Events.ClientReady, async (readyClient) => {
      log.info(
        `Erfolgreich als '${readyClient.user.tag}' (ID: ${readyClient.user.id}) angemeldet.`
      );

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
    });

    // Neuer Server: Slash-Commands SOFORT registrieren, ohne Neustart abwarten zu müssen
    client.on(Events.GuildCreate, (guild: Guild) => {
      this.registerCommandsForGuild(botModule, client, guild.id, log);
    });

    // 4. Interaktions-Dispatcher
    client.on('interactionCreate', async (interaction: Interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await this.handleSlashCommand(botModule, interaction, context);
        } else if (interaction.isButton()) {
          await this.handleButton(botModule, interaction, context);
        }
      } catch (unhandledErr) {
        log.error('Unerwarteter Fehler bei der Interaktionsverarbeitung:', unhandledErr);
      }
    });

    // 5. Bei Discord einloggen
    log.info(`Melde Bot '${botModule.name}' bei Discord an...`);
    await client.login(token);

    this.activeBots.set(botModule.id, {
      module: botModule,
      client,
      context
    });
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
      log.warn('Keine Slash-Commands definiert – Registrierung wird übersprungen.');
      return;
    }

    const commandList = commandsData.map((c) => `/${c.name}`).join(', ');

    // 1) Global für alle Server registrieren (persistent, auch für zukünftige Server)
    try {
      await readyClient.application.commands.set(commandsData);
      log.info(
        `✅ ${commandsData.length} globale(r) Slash-Command(s) registriert: ${commandList}`
      );
    } catch (error) {
      log.error('Fehler beim globalen Registrieren der Slash-Commands:', error);
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
        `Registriere Slash-Commands zusätzlich sofort auf ${targetGuildIds.size} Server(n)...`
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
        `✅ ${commandsData.length} Slash-Command(s) auf Server ${guildId} SOFORT aktiv: ${commandsData
          .map((c) => `/${c.name}`)
          .join(', ')}`
      );
    } catch (error) {
      log.error(
        `Fehler beim Registrieren der Slash-Commands auf Server ${guildId}:`,
        error
      );
    }
  }

  private async handleSlashCommand(
    botModule: IBotModule,
    interaction: ChatInputCommandInteraction,
    context: BotContext
  ): Promise<void> {
    const command = botModule.commands.find(
      (c: ISlashCommand) => c.data.name === interaction.commandName
    );
    if (!command) return;

    try {
      await command.execute(interaction, context);
    } catch (cmdError) {
      context.logger.error(
        `Fehler beim Ausführen von Command '/${interaction.commandName}':`,
        cmdError
      );

      const errorMessage = '❌ Bei der Ausführung dieses Befehls ist ein Fehler aufgetreten.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => null);
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => null);
      }
    }
  }

  private async handleButton(
    botModule: IBotModule,
    interaction: ButtonInteraction,
    context: BotContext
  ): Promise<void> {
    if (!botModule.buttons || botModule.buttons.length === 0) return;

    const handler = botModule.buttons.find((btn: IButtonHandler) => {
      if (typeof btn.customId === 'string') {
        return btn.customId === interaction.customId;
      }
      return btn.customId.test(interaction.customId);
    });

    if (!handler) return;

    try {
      await handler.execute(interaction, context);
    } catch (btnError) {
      context.logger.error(`Fehler bei Button '${interaction.customId}':`, btnError);

      const errorMessage = '❌ Bei der Verarbeitung dieser Aktion ist ein Fehler aufgetreten.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => null);
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => null);
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
