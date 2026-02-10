import type { ServerWebSocket } from "bun";
import {
  getAllArticles,
  getArticleBySlug,
  getArticlesByNewsletter,
  getAllNewsletters,
  getArticleCount,
} from "./db.ts";
import type { WsMessage } from "./types.ts";

// Track all connected WebSocket clients
const wsClients = new Set<ServerWebSocket<unknown>>();

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
  const server = Bun.serve({
    port,

    routes: {
      // --- API routes ---

      "/api/articles": {
        GET(_req) {
          const url = new URL(_req.url);
          const limit = parseInt(url.searchParams.get("limit") || "100");
          const offset = parseInt(url.searchParams.get("offset") || "0");
          const newsletter = url.searchParams.get("newsletter");

          const articles = newsletter
            ? getArticlesByNewsletter(newsletter, limit, offset)
            : getAllArticles(limit, offset);

          return Response.json(articles);
        },
      },

      "/api/articles/:newsletter/:slug": {
        GET(req) {
          const { newsletter, slug } = req.params;
          const article = getArticleBySlug(
            decodeURIComponent(newsletter),
            decodeURIComponent(slug)
          );
          if (!article) {
            return Response.json({ error: "Article not found" }, { status: 404 });
          }
          return Response.json(article);
        },
      },

      "/api/newsletters": {
        GET() {
          const newsletters = getAllNewsletters();
          return Response.json(newsletters);
        },
      },

      "/api/stats": {
        GET() {
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
        },
      },
    },

    // Catch-all for SPA routing — serve static files or the SPA shell
    fetch(req, server) {
      // Upgrade WebSocket connections
      if (req.headers.get("upgrade") === "websocket") {
        const success = server.upgrade(req);
        if (success) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

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
      open(ws) {
        wsClients.add(ws);
        console.log(`[ws] client connected (${wsClients.size} total)`);
      },
      message(_ws, _message) {
        // No client->server messages needed for now
      },
      close(ws) {
        wsClients.delete(ws);
        console.log(`[ws] client disconnected (${wsClients.size} total)`);
      },
    },
  });

  console.log(`[server] listening on http://localhost:${port}`);
  return server;
}

