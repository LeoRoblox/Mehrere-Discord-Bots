import {
  Client,
  Options,
  type Interaction,
  type ChatInputCommandInteraction,
  type ButtonInteraction
} from 'discord.js';
import type { Client as LibsqlClient } from '@libsql/client';
import type { IBotModule, BotContext, ISlashCommand, IButtonHandler } from './types.js';
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

    client.once('ready', async (readyClient) => {
      log.info(
        `Erfolgreich als '${readyClient.user.tag}' (ID: ${readyClient.user.id}) angemeldet.`
      );

      if (botModule.onInit) {
        try {
          await botModule.onInit(context);
        } catch (initErr) {
          log.error(`Fehler bei onInit für Bot '${botModule.name}':`, initErr);
        }
      }
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
