import type { Server, ServerWebSocket } from "bun";
import {
  getAllArticles,
  getArticleBySlug,
  getArticlesByNewsletter,
  getAllNewsletters,
  getArticleCount,
} from "./db.ts";
import type { WsMessage } from "./types.ts";

// ── WebSocket heartbeat ─────────────────────────────────────────────
type WsData = { isAlive: boolean };

const HEARTBEAT_INTERVAL_MS = 30_000; // ping every 30 s
const wsClients = new Set<ServerWebSocket<WsData>>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const ws of wsClients) {
      if (!ws.data || !ws.data.isAlive) {
        // Missed the last pong — terminate
        console.log(`[ws] terminating unresponsive client (${wsClients.size - 1} remaining)`);
        wsClients.delete(ws);
        ws.close(1001, "Ping timeout");
        continue;
      }
      ws.data.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// ── Rate limiting by IP ──────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 50; // per window per IP

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
let serverInstance: Server<WsData> | null = null;

function getIP(req: Request): string {
  // Prefer X-Forwarded-For when behind a reverse proxy
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return serverInstance?.requestIP(req)?.address ?? "unknown";
}

function checkRateLimit(req: Request): Response | null {
  const ip = getIP(req);
  const now = Date.now();

  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count);
  const resetSec = Math.ceil((entry.resetAt - now) / 1000);

  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return Response.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(resetSec),
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(resetSec),
        },
      }
    );
  }

  return null; // allowed
}

/** Wrap a route handler with rate-limit checking. */
function rl<T extends (...args: any[]) => any>(handler: T): T {
  return ((...args: any[]) => {
    const blocked = checkRateLimit(args[0] as Request);
    if (blocked) return blocked;
    return handler(...args);
  }) as T;
}

// Periodically purge stale entries so the map doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

/**
 * Broadcast a message to all connected WebSocket clients.
 */
export function broadcast(msg: WsMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of wsClients) {
    try {
      ws.send(data);
    } catch {
      wsClients.delete(ws);
    }
  }
}

/**
 * Create and start the Bun web server.
 */
export function createServer(port: number) {
  const server = Bun.serve<WsData>({
    port,
    hostname: "0.0.0.0",

    routes: {
      // --- API routes ---

      "/api/articles": {
        GET: rl((_req) => {
          const url = new URL(_req.url);
          const limit = parseInt(url.searchParams.get("limit") || "100");
          const offset = parseInt(url.searchParams.get("offset") || "0");
          const newsletter = url.searchParams.get("newsletter");

          const articles = newsletter
            ? getArticlesByNewsletter(newsletter, limit, offset)
            : getAllArticles(limit, offset);

          return Response.json(articles);
        }),
      },

      "/api/articles/:newsletter/:slug": {
        GET: rl((req) => {
          const { newsletter, slug } = req.params;
          const article = getArticleBySlug(
            decodeURIComponent(newsletter),
            decodeURIComponent(slug)
          );
          if (!article) {
            return Response.json({ error: "Article not found" }, { status: 404 });
          }
          return Response.json(article);
        }),
      },

      "/api/newsletters": {
        GET: rl(() => {
          const newsletters = getAllNewsletters();
          return Response.json(newsletters);
        }),
      },

      "/api/stats": {
        GET: rl(() => {
          const newsletters = getAllNewsletters();
          const totalArticles = getArticleCount();
          return Response.json({
            totalArticles,
            totalNewsletters: newsletters.length,
            newsletters: newsletters.map((n) => ({
              ...n,
              articleCount: getArticleCount(),
            })),
          });
        }),
      },

      "/health": {
        GET: () => {
          return Response.json({ status: "ok", uptime: process.uptime() });
        },
      },

      "/docs": {
        GET: () => new Response(Bun.file("public/docs.html")),
      },
    },

    // Catch-all for SPA routing — serve static files or the SPA shell
    fetch(req, server) {
      // Upgrade WebSocket connections
      if (req.headers.get("upgrade") === "websocket") {
        const success = server.upgrade(req, { data: { isAlive: true } });
        if (success) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Rate-limit non-route requests too
      const blocked = checkRateLimit(req);
      if (blocked) return blocked;

      const url = new URL(req.url);

      // Serve static files from public/
      const staticFile = Bun.file(`public${url.pathname}`);
      if (url.pathname !== "/" && staticFile.size > 0) {
        return new Response(staticFile);
      }

      // For any non-API/non-static route, serve the SPA shell
      return new Response(Bun.file("public/index.html"));
    },

    websocket: {
      idleTimeout: 60, // close if no data at all for 60 s (safety net)
      sendPings: false, // we handle pings ourselves via the heartbeat
      open(ws) {
        if (!ws.data) (ws as any).data = { isAlive: true };
        ws.data.isAlive = true;
        wsClients.add(ws);
        startHeartbeat();
        console.log(`[ws] client connected (${wsClients.size} total)`);
      },
      message(_ws, _message) {
        // No client->server messages needed for now
      },
      pong(ws) {
        if (ws.data) ws.data.isAlive = true;
      },
      close(ws) {
        wsClients.delete(ws);
        console.log(`[ws] client disconnected (${wsClients.size} total)`);
        // Stop heartbeat if no clients remain
        if (wsClients.size === 0 && heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      },
    },
  });

  serverInstance = server;
  console.log(`[server] listening on http://localhost:${port}`);
  return server;
}

