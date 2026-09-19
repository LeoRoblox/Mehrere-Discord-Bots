import http from 'node:http';
import { logger } from './logger.js';

let serverInstance: http.Server | null = null;

/**
 * Startet den minimalen HTTP-Server für Render und UptimeRobot.
 * Erlaubt AUSSCHLIESSLICH den Endpunkt /health und gibt für alle anderen Pfade 404 zurück.
 * Verhindert strikt jede Offenlegung interner Bot-Zustände, Datenbankdetails oder Geheimnisse.
 */
export function startHttpServer(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const log = logger.forContext('HttpHealthServer');

    const server = http.createServer((req, res) => {
      const url = req.url ? req.url.split('?')[0].replace(/\/+$/, '') || '/' : '/';

      // Nur /health beantworten
      if (url === '/health') {
        if (req.method === 'GET' || req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Connection: 'close'
          });

          if (req.method === 'HEAD') {
            res.end();
          } else {
            res.end(JSON.stringify({ status: 'ok' }));
          }
          return;
        }

        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }

      // Alle anderen Pfade geben strikt 404 zurück
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    server.on('error', (err) => {
      log.error('HTTP-Serverfehler:', err);
      reject(err);
    });

    server.listen(port, '0.0.0.0', () => {
      log.info(`Minimaler Health-Check-Server lauscht auf 0.0.0.0:${port} (Endpunkt: /health)`);
      serverInstance = server;
      resolve(server);
    });
  });
}

/**
 * Beendet den HTTP-Server sauber beim Graceful Shutdown
 */
export function stopHttpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (serverInstance) {
      logger.info('Stoppe HTTP Health-Server...');
      serverInstance.close(() => {
        serverInstance = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
