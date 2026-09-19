# 🤖 Mehrere-Discord-Bots: Produktionsfähiger Multi-Bot Runner

Ein hochgradig ressourcenschonender, modularer Multi-Discord-Bot-Runner für **Node.js (TypeScript)** und **Turso (libSQL)**, maßgeschneidert für den Betrieb auf einem **Render Free Web Service** (ca. 0,1 CPU / 400–512 MB RAM).

---

## 📑 Inhaltsverzeichnis

1. [Architektur & Besonderheiten](#-architektur--besonderheiten)
2. [Aktive Bots im System](#-aktive-bots-im-system)
   - [Bot 1: Verifizierungs-Bot (Christlichernico)](#bot-1-verifizierungs-bot-christlichernico)
   - [Bot 2: System-Bot (Adminpanel)](#bot-2-system-bot-adminpanel)
   - [Umgebungsvariablen beider Bots](#umgebungsvariablen-beider-bots)
3. [Wichtige Plattform-Einschränkungen (Render, Discord, Turso, UptimeRobot)](#-wichtige-plattform-einschränkungen)
4. [Vollständige Schritt-für-Schritt-Einrichtung](#-vollständige-schritt-für-schritt-einrichtung)
   - [Schritt 1: Discord Developer Portal einrichten (zwei Anwendungen)](#schritt-1-discord-developer-portal-einrichten)
   - [Schritt 2: Turso-Datenbank erstellen & verbinden](#schritt-2-turso-datenbank-erstellen--verbinden)
   - [Schritt 3: Slash-Commands registrieren](#schritt-3-slash-commands-registrieren)
   - [Schritt 4: Render Free Web Service deployen](#schritt-4-render-free-web-service-deployen)
   - [Schritt 5: UptimeRobot regelkonform konfigurieren](#schritt-5-uptimerobot-regelkonform-konfigurieren)
5. [Anleitung: Neuen Bot zum System hinzufügen](#-anleitung-neuen-bot-hinzufügen)
6. [Lokale Entwicklung & Tests](#-lokale-entwicklung--tests)
7. [Sicherheitshinweise](#-sicherheitshinweise)

---

## 🏛 Architektur & Besonderheiten

- **Single-Process Multi-Hosting:** Mehrere autonome Discord-Bots laufen in einer einzigen Node.js-Laufzeit. Das spart RAM und CPU-Zyklen.
- **Strikt getrennte Bots:** Aktuell laufen **zwei vollständig getrennte Discord-Bots** (Verify-Bot und System-Bot). Jeder Bot ist eine eigene Discord-Anwendung mit eigenem Token, eigener Client-ID, eigenem Discord-Login, eigener Command-Registrierung, eigenen Handlern und eigenen Datenbanktabellen. Der Verify-Bot registriert niemals `/adminpanel`, der System-Bot niemals `/verifysystem`.
- **Aggressives Speichermanagement:** Ungenutzte Discord-Caches (Nachrichten, Emojis, Reaktionen, Presences, etc.) sind vollständig deaktiviert (`Options.cacheWithLimits`). Der gesamte Speicherverbrauch beträgt nur ca. **100 MB RAM**, wodurch der Render Free-Tier (512 MB Limit) mühelos eingehalten wird.
- **Minimaler HTTP-Server:** Ein nativer `node:http`-Server (0 externe Webframework-Abhängigkeiten) bedient ausschließlich den Pfad `/health` mit `{"status":"ok"}`. Alle anderen Pfade liefern `404 Not Found`. Keine Dashboards, keine Frontends, keine Leaks interner Daten.
- **Zentrale libSQL / Turso Schicht:** Gemeinsame Datenbankverbindung mit automatischem Migrations-System (`_system_migrations`) und Namespace-Isolation je Bot.
- **Fehlerisolierung & Resilienz:** Sollte ein einzelnes Bot-Modul einen Fehler oder Verbindungsabbruch erleiden, laufen die übrigen Bots und der Health-Server unbeeinträchtigt weiter.
- **Log-Sanitizing:** Sensible Discord-Tokens, JWTs und Passwörter werden automatisch vor der Konsolenausgabe maskiert.
- **Graceful Shutdown:** Ordnungsgemäße Signalbehandlung (`SIGTERM`/`SIGINT`) für Render-Deployments ohne hängende Verbindungen.

---

## 🤖 Aktive Bots im System

### Bot 1: Verifizierungs-Bot (Christlichernico)

Vollständig implementierter, produktionsbereiter Bot für den **Christlichernico Community Server**.

- **Slash-Command:** `/verifysystem`
  - Richtet das Regelwerk und den Verifizierungs-Button im Kanal ein.
  - **Berechtigung:** Ausschließlich ausführbar von Benutzern mit einer der folgenden Rollen ODER dem `BOT_OWNER_ID`:
    - Rolle 1: `1548429120948670616`
    - Rolle 2: `1548458441566330970`
- **Container V2 & Embed-Fallback:**
  - Titel: `✝️ Christlichernico Community Server`
  - Vollständiges Regelwerk (12 Abschnitte: Respektvoller Umgang, Christlicher Umgang, Kein Spam, Werbung, Privatsphäre, Sicherheit, Gaming & Community, Voice-Channels, Unangemessene Inhalte, Team & Moderation, Bugs melden, Konsequenzen)
  - Grüner Erfolgs-Button: `[ ✅ Verifizieren ]`
- **Button-Interaktion (Verifizierung):**
  - Vergibt automatisch die Verifizierungs-Rolle: **`1550951446961332495`**
  - Antwortet mit einer **ephemeren Nachricht** (nur für den Klickenden sichtbar, Container V2):
    > _"Du hast bestätigt dass du die Regeln gelesen hast. **Unwissenheit schützt nicht vor Strafe!**"_
  - Speichert das Verifizierungsdatum in Turso in der Tabelle `verify_members` sowie ein Audit-Event in `verify_audit_log`.
- **Umgebungsvariablen:** `VERIFY_BOT_TOKEN`, `VERIFY_BOT_CLIENT_ID`
- **Modul:** `src/bots/verify-bot/` (Migrations-Namespace `verify-bot`, Tabellen `verify_*`)

### Bot 2: System-Bot (Adminpanel)

Eigenständiger Moderations-Bot – eine **separate Discord-Anwendung**, vollständig getrennt vom Verify-Bot.

- **Slash-Command:** `/adminpanel user:<Benutzer>`
  - Pflichtoption `user` als **Discord-User-Auswahl** (Benutzer des jeweiligen Servers).
  - Nur innerhalb von Servern verwendbar.
  - **Berechtigung:** Ausschließlich für Mitglieder mit einer dieser Rollen (keine Ausnahme für Owner):
    - `1548429120948670616`
    - `1548458441566330970`
    - `1548458919074988082`
    - `1548459353504223274`
    - `1548459569867526174`
  - Die Berechtigung wird **serverseitig bei jeder Interaktion** geprüft: beim Command sowie bei jedem Button, Select-Menü und Modal.
- **Antwort (Discord Components V2 Container):**
  - Titel: `ADMIN PANEL <ausgewählter Benutzer>`
  - Text: _„Willkommen im Admin Panel. Wähle bei dem Button aus wie du diese Person bestrafen willst oder von dieser Person wissen willst.“_
  - Buttons: `🕒 Timeout` · `Kicken` · `Bannen` · `Warnen` · `Unwarn` · `User Infos`
- **Aktionen (alle Rückmeldungen ephemer, nur für den ausführenden Moderator sichtbar):**
  1. **Timeout** – Frage _„Wie lange möchtest du die Person Timeouten?“_ mit String-Select-Menü (Placeholder _„Wähle die länge aus..“_): `1 Minute`, `2,5 Minuten`, `10 Minuten`, `1 Stunde`, `13 Stunden`, `4 Tage`, `7 Tage`, `20 Tage`. Der gewählte Zeitraum wird als echter Discord-Timeout gesetzt.
  2. **Kicken** – kickt die Person vom Server; fehlende Bot-Rechte werden sauber gemeldet.
  3. **Bannen** – bannt die Person (auch per ID, falls sie den Server bereits verlassen hat); fehlende Bot-Rechte werden sauber gemeldet.
  4. **Warnen** – Frage _„Warum möchtest du die Person warnen?“_ mit Button _„Formular öffnen“_ → Modal mit Pflichtfeld für den Grund. Maximal **5 aktive Warnungen** (atomar in der Datenbank geprüft). Die Person erhält eine private Components-V2-Nachricht mit Titel **„WARNUNG“** und dem Text _„Du wurdest gewarnt. Bitte halte dich jetzt an die Regeln bevor du bestraft wirst. Du hast jetzt X von 5 Warns.“_
  5. **Unwarn** – Select-Menü (Placeholder _„Wähle einen Warn aus..“_) mit allen aktiven Warnungen. Die gewählte Warnung wird als aufgehoben markiert, verschwindet aus dem Menü und die Person erhält eine private Components-V2-Nachricht mit Titel **„GLÜCKWUNSCH“** und dem Text _„Dein Warn wurde aufgehoben. Du hast jetzt X von 5 Warns.“_
  6. **User Infos** – _„Kommt bald.“_
- **Zusätzliche Schutzmechanismen:** Keine Aktionen gegen sich selbst, Bots, den Server-Inhaber oder Personen mit gleich hoher/höherer Rolle; Prüfung von `moderatable`/`kickable`/`bannable` vor jeder Aktion.
- **Datenbank:** Eigene Tabelle `system_warnings` (Soft-Delete über `revoked_at`), Migrations-Namespace `system-bot`. Warnungen aus der früheren Tabelle `admin_warnings` werden beim ersten Start einmalig übernommen (die alte Tabelle bleibt unangetastet und kann manuell gelöscht werden).
- **Umgebungsvariablen:** `SYSTEM_BOT_TOKEN`, `SYSTEM_BOT_CLIENT_ID`
- **Benötigte Bot-Berechtigungen:** `Moderate Members` (Timeout), `Kick Members`, `Ban Members`, `Send Messages`. Die Bot-Rolle muss **über** den Rollen der zu moderierenden Mitglieder stehen.
- **Modul:** `src/bots/system-bot/`

### Umgebungsvariablen beider Bots

| Variable               | Bot        | Pflicht | Beschreibung                                               |
| ---------------------- | ---------- | ------- | ---------------------------------------------------------- |
| `VERIFY_BOT_TOKEN`     | Verify-Bot | ✅      | Bot-Token der Verify-Anwendung (Developer Portal → Bot)    |
| `VERIFY_BOT_CLIENT_ID` | Verify-Bot | ✅      | Application-ID der Verify-Anwendung (General Information)  |
| `SYSTEM_BOT_TOKEN`     | System-Bot | ✅      | Bot-Token der System-Anwendung (Developer Portal → Bot)    |
| `SYSTEM_BOT_CLIENT_ID` | System-Bot | ✅      | Application-ID der System-Anwendung (General Information)  |
| `DISCORD_DEV_GUILD_ID` | beide      | ❌      | Optionaler Test-Server für sofortige Command-Registrierung |

Die Konfigurationsvalidierung (`zod`) prüft beim Start **beide** Bots: Fehlt oder ist eine der vier Variablen ungültig, bricht der Start mit einer verständlichen Fehlermeldung ab. Identische Tokens oder Client-IDs für beide Bots werden ebenfalls abgelehnt. Zusätzlich vergleicht der Runner nach dem Login die Application-ID des eingeloggten Accounts mit der konfigurierten Client-ID – bei einem Konflikt (z. B. vertauschte Tokens) wird der betroffene Bot gestoppt und registriert keine Commands.

**Start-Log (Beispiel):**

```
[INFO] [App] Starte 2 getrennte(n) Discord-Bot(s): 'Verifizierungs-Bot (Christlichernico)' (verify-bot), 'System-Bot (Adminpanel)' (system-bot)
[INFO] [Bot:verify-bot] ▶️  Starte Bot 'Verifizierungs-Bot (Christlichernico)' (ID: verify-bot) | Token aus VERIFY_BOT_TOKEN | Client-ID aus VERIFY_BOT_CLIENT_ID=1111… | Commands: /verifysystem
[INFO] [Bot:verify-bot] ✅ Bot 'Verifizierungs-Bot (Christlichernico)' (verify-bot) ist eingeloggt als 'VerifyBot#1234' (User-ID: 1111…, Application-ID: 1111…).
[INFO] [Bot:verify-bot] ✅ 1 globale(r) Slash-Command(s) für Bot 'Verifizierungs-Bot (Christlichernico)' (verify-bot) registriert: /verifysystem
[INFO] [Bot:system-bot] ▶️  Starte Bot 'System-Bot (Adminpanel)' (ID: system-bot) | Token aus SYSTEM_BOT_TOKEN | Client-ID aus SYSTEM_BOT_CLIENT_ID=2222… | Commands: /adminpanel
[INFO] [Bot:system-bot] ✅ Bot 'System-Bot (Adminpanel)' (system-bot) ist eingeloggt als 'SystemBot#5678' (User-ID: 2222…, Application-ID: 2222…).
[INFO] [Bot:system-bot] ✅ 1 globale(r) Slash-Command(s) für Bot 'System-Bot (Adminpanel)' (system-bot) registriert: /adminpanel
[INFO] [App] === Übersicht der getrennten Discord-Bots ===
[INFO] [App]   ✅ Verifizierungs-Bot (Christlichernico) [verify-bot] → eingeloggt als 'VerifyBot#1234' (…) | Token: VERIFY_BOT_TOKEN | Commands: /verifysystem
[INFO] [App]   ✅ System-Bot (Adminpanel) [system-bot] → eingeloggt als 'SystemBot#5678' (…) | Token: SYSTEM_BOT_TOKEN | Commands: /adminpanel
```

---

## ⚖️ Wichtige Plattform-Einschränkungen

### 1. Render Free Tier

- **750 freie Instanzstunden pro Monat:** Ein Monat mit 31 Tagen hat 744 Stunden. Das Betreiben **aller Bots in diesem einen gemeinsamen Web Service** stellt sicher, dass das monatliche Freikontingent nicht überschritten wird.
- **15-Minuten Idle-Sleep:** Free Web Services auf Render fahren herunter, wenn für 15 Minuten kein eingehender HTTP-Traffic registriert wird.
- **Kaltstart:** Das Aufwachen nach dem Schlafzustand benötigt ca. 30–60 Sekunden.
- **Ressourcen:** 512 MB RAM und geteilte ca. 0,1 CPU.

### 2. Discord API & Gateway

- Discord-Bots benötigen eine dauerhafte WebSocket-Verbindung (Gateway).
- Wenn der Free-Tier-Service schläft, trennt sich der Gateway. Bei einem Aufweck-Request (z. B. durch UptimeRobot) verbindet sich der Runner automatisch neu und setzt die Session fort.
- **Intents:** Beide Bots benötigen **keine** privilegierten Intents – sie verwenden ausschließlich den `Guilds`-Intent (kein `GuildMembers`-Intent erforderlich, da Interaktionen das `GuildMember`-Objekt direkt übermitteln und der System-Bot Zielmitglieder gezielt per API lädt).
- **Zwei Gateway-Verbindungen:** Jeder Bot hält seine eigene WebSocket-Verbindung mit seinem eigenen Token. Discord erlaubt pro Bot-Token 1000 Logins pro 24 Stunden – für zwei Bots unproblematisch.

### 3. Turso Free Tier

- 500 Millionen Row-Reads/Monat, 10 Millionen Row-Writes/Monat, 5 GB Speicherplatz und bis zu 100 Datenbanken kostenfrei. Ausreichend für hunderte Discord-Server.

---

## 🛠 Vollständige Schritt-für-Schritt-Einrichtung

### Schritt 1: Discord Developer Portal einrichten

> **Wichtig:** Es werden **zwei getrennte Anwendungen** benötigt – eine für den Verify-Bot und eine für den System-Bot. Verwende niemals dasselbe Token/dieselbe Application-ID für beide Bots (die Konfigurationsvalidierung lehnt das ab).

#### 1a) Anwendung für den Verify-Bot

1. Öffne das [Discord Developer Portal](https://discord.com/developers/applications).
2. Klicke auf **New Application** und gib einen Namen ein (z. B. `Christlichernico Verify`).
3. Kopiere unter **General Information** die **Application ID** (wird später als `VERIFY_BOT_CLIENT_ID` genutzt).
4. Gehe im linken Menü auf **Bot**:
   - Klicke auf **Reset Token** und kopiere das erzeugte Token (wird später als `VERIFY_BOT_TOKEN` in Render eingetragen).
   - **Privileged Gateway Intents:** Du musst **keine** privilegierten Intents (wie Presence oder Server Members) aktivieren! Das spart Berechtigungsprüfungen und massiv RAM.
5. **Rollen-Hierarchie auf deinem Discord-Server (WICHTIG):**
   - Gehe in Discord in die **Servereinstellungen -> Rollen**.
   - Ziehe die Rolle deines Verify-Bots in der Rollenliste **ÜBER** die Verifizierungs-Rolle (`1550951446961332495`). Ein Bot kann in Discord niemals Rollen vergeben, die gleichrangig oder höher als seine eigene höchste Rolle sind!
   - Gib der Bot-Rolle die Berechtigung **Rollen verwalten** (`Manage Roles`).
6. **Bot auf den Server einladen:**
   - Gehe im Developer Portal auf **OAuth2 -> URL Generator**.
   - Wähle unter **Scopes**: `bot` und `applications.commands`.
   - Wähle unter **Bot Permissions**:
     - `Manage Roles` (Rollen verwalten)
     - `Send Messages` (Nachrichten senden)
     - `Embed Links` (Links einbetten)
     - `Use Slash Commands` (Slash-Befehle verwenden)
   - Öffne die generierte URL im Browser und füge den Bot deinem Server hinzu.

#### 1b) Anwendung für den System-Bot (Adminpanel)

1. Klicke erneut auf **New Application** und gib einen Namen ein (z. B. `Christlichernico System`).
2. Kopiere unter **General Information** die **Application ID** (wird später als `SYSTEM_BOT_CLIENT_ID` genutzt).
3. Gehe auf **Bot** -> **Reset Token** und kopiere das Token (wird später als `SYSTEM_BOT_TOKEN` eingetragen). Auch hier sind **keine** privilegierten Intents nötig.
4. **Rollen-Hierarchie:** Ziehe die Rolle des System-Bots **ÜBER** alle Rollen, deren Mitglieder moderiert werden sollen (Timeout, Kick, Bann funktionieren nur nach unten in der Hierarchie).
5. **Bot auf den Server einladen:**
   - **OAuth2 -> URL Generator**, Scopes: `bot` und `applications.commands`.
   - **Bot Permissions**:
     - `Moderate Members` (Mitglieder moderieren – für Timeouts)
     - `Kick Members` (Mitglieder kicken)
     - `Ban Members` (Mitglieder bannen)
     - `Send Messages` (Nachrichten senden)
     - `Use Slash Commands` (Slash-Befehle verwenden)
   - Öffne die generierte URL im Browser und füge auch diesen Bot deinem Server hinzu.
6. Stelle sicher, dass die fünf Adminpanel-Rollen (siehe [Bot 2](#bot-2-system-bot-adminpanel)) auf dem Server existieren – nur ihre Mitglieder können `/adminpanel` verwenden.

---

### Schritt 2: Turso-Datenbank erstellen & verbinden

1. Falls noch nicht geschehen, erstelle ein kostenloses Konto auf [Turso.tech](https://turso.tech).
2. Installiere das Turso-CLI oder nutze das Web-Dashboard:
   ```bash
   turso db create discord-bots
   ```
3. Ermittle die Datenbank-URL:
   ```bash
   turso db show discord-bots --url
   # Beispiel: libsql://discord-bots-deinuser.turso.io
   ```
4. Erstelle ein sicheres Zugangs-Token:
   ```bash
   turso db tokens create discord-bots
   ```
5. Notiere dir die URL (`TURSO_DATABASE_URL`) und das Token (`TURSO_AUTH_TOKEN`).

---

### Schritt 3: Slash-Commands registrieren

**Gute Nachricht: Das erledigt der Bot jetzt automatisch bei jedem Start!** 🎉

Bei jedem Bot-Start (also auch nach jedem Render-Deployment oder Kaltstart) registriert **jeder Bot getrennt seine eigenen** Slash-Commands automatisch bei Discord – der Verify-Bot nur `/verifysystem`, der System-Bot nur `/adminpanel`:

1. **Global** – gilt für alle aktuellen und zukünftigen Server.
2. **Zusätzlich pro Server** – für jeden Server, auf dem der jeweilige Bot aktuell Mitglied ist. Guild-Commands sind bei Discord **sofort aktiv** (keine Cache-Wartezeit von bis zu 60 Minuten wie bei globalen Commands). Es entstehen keine Duplikate: Ein Guild-Command mit demselben Namen überschreibt den globalen Command lokal.
3. **Beim Server-Beitritt** – tritt ein Bot einem neuen Server bei, werden seine Commands ebenfalls sofort registriert, ohne dass ein Neustart nötig ist.

> **Hinweis:** `DISCORD_DEV_GUILD_ID` schließt andere Server nicht mehr aus – sie wird nur zusätzlich bedient (praktisch für Tests).

Ein manuelles Registrieren ist damit nicht mehr nötig, aber weiterhin möglich (z. B. um Commands ohne Bot-Neustart zu aktualisieren):

1. Erstelle lokal eine `.env`-Datei (Vorlage: `.env.example`):
   ```bash
   cp .env.example .env
   ```
2. Trage `VERIFY_BOT_TOKEN`, `VERIFY_BOT_CLIENT_ID`, `SYSTEM_BOT_TOKEN`, `SYSTEM_BOT_CLIENT_ID` und optional deine `DISCORD_DEV_GUILD_ID` ein.
3. Führe den Registrierungsbefehl aus (registriert für **jeden Bot getrennt** global + auf allen Servern, auf denen der jeweilige Bot ist):

   ```bash
   # Dry-Run (zeigt die Payloads beider Bots ohne Senden)
   npm run deploy-commands -- --dry-run

   # Echte Registrierung für beide Bots
   npm run deploy-commands

   # Nur einen einzelnen Bot registrieren
   npm run deploy-commands -- --bot=system-bot
   npm run deploy-commands -- --bot=verify-bot
   ```

---

### Schritt 4: Render Free Web Service deployen

1. Logge dich auf [render.com](https://render.com) ein.
2. Klicke auf **New +** -> **Web Service**.
3. Verbinde dein GitHub-Repository `LeoRoblox/Mehrere-Discord-Bots` und wähle den Branch `arena/01a0bb2d-mehrere-discord-bots`.
4. Konfiguriere die Service-Details:
   - **Name:** `mehrere-discord-bots`
   - **Language:** `Node`
   - **Region:** `Frankfurt (EU Central)` (oder die dir am nächsten gelegene Region)
   - **Branch:** `arena/01a0bb2d-mehrere-discord-bots`
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `npm run start`
   - **Instance Type:** `Free`
5. Öffne den Reiter **Advanced** -> **Health Check Path**:
   - Trage `/health` ein.
6. Trage im Bereich **Environment Variables** folgende Schlüssel ein:
   - `NODE_ENV`: `production`
   - `BOT_OWNER_ID`: Deine Discord-User-ID (z. B. `123456789012345678`)
   - `TURSO_DATABASE_URL`: Deine Turso-URL (`libsql://...`)
   - `TURSO_AUTH_TOKEN`: Dein Turso Auth Token
   - `VERIFY_BOT_TOKEN`: Das Discord Bot Token deines Verify-Bots (Anwendung 1)
   - `VERIFY_BOT_CLIENT_ID`: Die Application ID deines Verify-Bots (Anwendung 1)
   - `SYSTEM_BOT_TOKEN`: Das Discord Bot Token deines System-Bots (Anwendung 2)
   - `SYSTEM_BOT_CLIENT_ID`: Die Application ID deines System-Bots (Anwendung 2)
7. Klicke auf **Deploy Web Service**.
8. Überprüfe das Bereitstellungs-Log:
   - Die Datenbankmigrationen beider Bots werden automatisch beim Start ausgeführt (Namespaces `verify-bot` und `system-bot`).
   - Der Health-Check-Server lauscht auf `0.0.0.0:10000`.
   - **Beide Bots loggen sich getrennt bei Discord ein.** Das Log zeigt für jeden Bot eindeutig, welcher Bot gestartet wird, unter welchem Discord-Account er eingeloggt ist und welche Commands er registriert hat (siehe [Start-Log-Beispiel](#umgebungsvariablen-beider-bots)).
   - Der RAM-Verbrauch wird protokolliert (`RSS ~100MB`).

---

### Schritt 5: UptimeRobot regelkonform konfigurieren

Um den Health-Status des Services zu überwachen und über Ausfälle informiert zu werden:

1. Registriere dich kostenlos auf [uptimerobot.com](https://uptimerobot.com).
2. Klicke auf **Add New Monitor**:
   - **Monitor Type:** `HTTP(s)`
   - **Friendly Name:** `Discord Multi-Bot Health`
   - **URL (or IP):** `https://<dein-service-name>.onrender.com/health`
   - **Monitoring Interval:** `5 minutes` oder `10 minutes`
   - **HTTP Method:** `HEAD` oder `GET`
   - **Alert Contacts:** Deine E-Mail-Adresse
3. Klicke auf **Create Monitor**.

> **Transparenter Regelhinweis:**
> UptimeRobot dient primär der Erreichbarkeits- und Integritätsüberwachung deines Dienstes. Bei Render-Free-Instanzen verhindert regelmäßiger HTTP-Traffic zwar das vorzeitige Einschlafen nach 15 Minuten Inaktivität, garantiert jedoch **keine unterbrechungsfreie 24/7-Verfügbarkeit** (Render führt gelegentliche Restarts durch, und das Monatslimit von 750 Stunden darf über deinen Workspace hinweg nicht überschritten werden). Solltest du für eine große Community eine strikte 99,9 % SLA benötigen, empfiehlt Render das Upgrade auf den kleinsten Starter-Plan ($7/Monat) oder einen Hintergrund-Worker.

---

## ➕ Anleitung: Neuen Bot hinzufügen

Dank der zentralen Plugin- und Registry-Architektur kann jederzeit ein weiterer eigenständiger Bot hinzugefügt werden, ohne bestehenden Code zu stören:

1. **Neuen Ordner anlegen:**
   Erstelle unter `src/bots/` ein neues Verzeichnis, z. B. `src/bots/ticket-bot/`.

2. **Bot-Modul implementieren (`src/bots/ticket-bot/index.ts`):**

   ```typescript
   import { GatewayIntentBits } from 'discord.js';
   import type { IBotModule, BotContext } from '../../core/types.js';

   export const ticketBotModule: IBotModule = {
     id: 'ticket-bot',
     name: 'Ticket-System Bot',
     // Eindeutige eigene Umgebungsvariablen für Token und Client-ID:
     tokenEnvVar: 'TICKET_BOT_TOKEN',
     clientIdEnvVar: 'TICKET_BOT_CLIENT_ID',
     requiredIntents: [GatewayIntentBits.Guilds],
     migrations: [
       {
         id: '001_create_tickets',
         up: async (db) => {
           // Eigener Namespace mit eindeutigem Präfix ticket_*
           await db.execute(`
             CREATE TABLE IF NOT EXISTS ticket_records (
               ticket_id TEXT PRIMARY KEY,
               guild_id TEXT NOT NULL,
               user_id TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'open',
               created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
           `);
         }
       }
     ],
     commands: [
       /* Deine Slash-Commands */
     ],
     buttons: [
       /* Deine Button-Handler */
     ],
     selectMenus: [
       /* Deine Select-Menü-Handler (optional) */
     ],
     modals: [
       /* Deine Modal-Handler (optional) */
     ],
     async onInit(ctx: BotContext) {
       ctx.logger.info('Ticket-Bot initialisiert!');
     }
   };
   ```

3. **In `src/index.ts` registrieren:**

   ```typescript
   import { ticketBotModule } from './bots/ticket-bot/index.js';

   // Nach Verify-Bot und System-Bot einfach registrieren:
   registry.register(verifyBotModule);
   registry.register(systemBotModule);
   registry.register(ticketBotModule);
   ```

4. **Konfiguration ergänzen:**

   - Ergänze `TICKET_BOT_TOKEN` und `TICKET_BOT_CLIENT_ID` im Zod-Schema in `src/core/config.ts` (und in `BOT_ENV_DEFINITIONS`), damit der Start bei fehlender Konfiguration sauber abbricht.
   - Füge das Modul in `src/scripts/deploy-commands.ts` zur Liste `ALL_BOT_MODULES` hinzu.
   - Trage die neuen Variablen in `.env.example` und `render.yaml` ein.

5. **In Render & `.env` hinterlegen:**
   - Trage in der Render Web Service Konfiguration die neuen geheimen Umgebungsvariablen `TICKET_BOT_TOKEN` und `TICKET_BOT_CLIENT_ID` ein.
   - Nach dem nächsten Push baut Render die Anwendung automatisch neu. Alle Bots teilen sich dieselbe Laufzeit, denselben Health-Check und dieselbe Turso-Datenbank bei minimalem Ressourcenverbrauch – jeder Bot mit eigenem Discord-Login und eigener Command-Registrierung!

---

## 💻 Lokale Entwicklung & Tests

```bash
# Abhängigkeiten installieren
npm ci

# Typecheck & Build
npm run build

# Linter ausführen
npm run lint

# Automatisierte Tests ausführen (Vitest)
npm run test

# Diagnosetest für Umgebung & Turso-Verbindung
npm run test-connection

# Slash-Commands im Dry-Run Modus prüfen
npm run deploy-commands -- --dry-run
```

---

## 🔒 Sicherheitshinweise

- **Keine Secrets im Quellcode:** Weder Discord-Tokens noch Turso-Keys dürfen im Git-Repository gespeichert werden.
- **Strikte Start-Validierung:** Das System startet mit `zod`-Validierung nur, wenn alle erforderlichen Variablen **beider Bots** im erwarteten Format vorliegen und sich Tokens/Client-IDs der Bots unterscheiden.
- **Identitätsprüfung beim Login:** Nach dem Login wird die Application-ID des eingeloggten Accounts mit der konfigurierten Client-ID verglichen. Bei einem Konflikt (vertauschte Tokens) wird der Bot gestoppt, bevor er Commands registriert.
- **Owner-Schutz:** Kritische Befehle des Verify-Bots überprüfen server- und code-seitig immer die Discord-ID gegen `BOT_OWNER_ID` und vertrauen niemals reiner Client-seitiger Verborgenheit.
- **Rollenbasierter Adminpanel-Schutz:** Jede Adminpanel-Interaktion (Command, Button, Select-Menü, Modal) wird serverseitig gegen die fünf erlaubten Rollen geprüft; Select-Werte werden nur aus einer festen Whitelist übernommen.
- **Minimaler Attack Surface:** Der HTTP-Server bietet keinerlei interaktive Webfunktionen, Dateiauslieferungen oder Schnittstellen außer `/health`.
