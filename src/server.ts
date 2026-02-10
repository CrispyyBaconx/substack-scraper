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

    // Catch-all for SPA routing — serve the frontend HTML for non-API routes
    fetch(req, server) {
      // Upgrade WebSocket connections
      if (req.headers.get("upgrade") === "websocket") {
        const success = server.upgrade(req);
        if (success) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // For any non-API route, serve the SPA shell
      return new Response(generateHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
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

/**
 * Generate the full SPA HTML shell.
 * The frontend is a self-contained vanilla JS app (no React build step needed).
 */
function generateHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Substack Scraper</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0d1117;
      --bg-card: #161b22;
      --bg-hover: #1c2333;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #ff6719;
      --accent-dim: rgba(255, 103, 25, 0.15);
      --link: #58a6ff;
      --font: "Geist Mono", monospace;
      --font-mono: "Geist Mono", monospace;
      --radius: 8px;
      --max-width: 720px;
    }

    [data-theme="light"] {
      --bg: #ffffff;
      --bg-card: #f6f8fa;
      --bg-hover: #eef1f5;
      --border: #d0d7de;
      --text: #1f2328;
      --text-muted: #656d76;
      --accent: #e5550d;
      --accent-dim: rgba(229, 85, 13, 0.12);
      --link: #0969da;
    }

    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* --- Header --- */
    .header {
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      position: sticky;
      top: 0;
      background: var(--bg);
      z-index: 100;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
    }
    .header h1:hover { color: var(--accent); }
    .header .badge {
      background: var(--accent-dim);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .header .spacer { flex: 1; }
    .theme-toggle {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      cursor: pointer;
      padding: 6px 10px;
      font-size: 16px;
      line-height: 1;
      transition: background 0.15s, border-color 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .theme-toggle:hover {
      background: var(--bg-hover);
      border-color: var(--accent);
    }

    .header .live-dot {
      width: 8px; height: 8px;
      background: #3fb950;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* --- Main content --- */
    .container {
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 24px;
    }

    /* --- Dashboard --- */
    .newsletter-group { margin-bottom: 32px; }
    .newsletter-group h2 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    .article-card {
      display: block;
      padding: 16px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      margin-bottom: 8px;
      transition: background 0.15s, border-color 0.15s;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
    }
    .article-card:hover {
      background: var(--bg-hover);
      border-color: var(--accent);
      text-decoration: none;
    }
    .article-card .title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .article-card .subtitle {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .article-card .meta {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* --- Article Reader --- */
    .article-header {
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
    }
    .article-header .back {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 16px;
      display: inline-block;
    }
    .article-header .back:hover { color: var(--accent); }
    .article-header h1 {
      font-size: 32px;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 8px;
    }
    .article-header .subtitle {
      font-size: 18px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }
    .article-header .meta {
      font-size: 13px;
      color: var(--text-muted);
    }

    .article-body {
      font-size: 17px;
      line-height: 1.8;
    }
    .article-body h1 { font-size: 28px; margin: 32px 0 16px; }
    .article-body h2 { font-size: 24px; margin: 28px 0 14px; }
    .article-body h3 { font-size: 20px; margin: 24px 0 12px; }
    .article-body p { margin-bottom: 16px; }
    .article-body img {
      max-width: 100%;
      border-radius: var(--radius);
      margin: 16px 0;
    }
    .article-body blockquote {
      border-left: 3px solid var(--accent);
      padding-left: 16px;
      margin: 16px 0;
      color: var(--text-muted);
    }
    .article-body pre {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      overflow-x: auto;
      margin: 16px 0;
      font-family: var(--font-mono);
      font-size: 14px;
    }
    .article-body code {
      background: var(--bg-card);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 0.9em;
    }
    .article-body pre code { background: none; padding: 0; }
    .article-body ul, .article-body ol {
      margin: 16px 0;
      padding-left: 24px;
    }
    .article-body li { margin-bottom: 8px; }
    .article-body hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 32px 0;
    }
    .article-body a { color: var(--link); }

    /* --- Download Dropdown --- */
    .download-wrapper {
      position: relative;
      display: inline-block;
    }
    .download-btn {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      cursor: pointer;
      padding: 6px 14px;
      font-size: 13px;
      font-family: var(--font);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s, border-color 0.15s;
    }
    .download-btn:hover {
      background: var(--bg-hover);
      border-color: var(--accent);
    }
    .download-btn svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .download-menu {
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      min-width: 160px;
      z-index: 150;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      overflow: hidden;
      animation: dropIn 0.15s ease;
    }
    .download-menu.open { display: block; }
    @keyframes dropIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .download-menu button {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 10px 14px;
      background: none;
      border: none;
      color: var(--text);
      font-family: var(--font);
      font-size: 13px;
      cursor: pointer;
      text-align: left;
      transition: background 0.1s;
    }
    .download-menu button:hover {
      background: var(--bg-hover);
    }
    .download-menu button span.dl-icon {
      font-size: 15px;
      width: 20px;
      text-align: center;
      flex-shrink: 0;
    }
    .download-menu .dl-label { flex: 1; }
    .download-menu .dl-ext {
      font-size: 11px;
      color: var(--text-muted);
      padding: 2px 6px;
      background: var(--accent-dim);
      border-radius: 4px;
    }

    /* --- Loading / Empty --- */
    .loading, .empty {
      text-align: center;
      padding: 64px 24px;
      color: var(--text-muted);
    }
    .loading { font-size: 14px; }
    .empty { font-size: 16px; }

    /* --- Print styles for PDF export --- */
    @media print {
      .header, .article-header .back, .download-wrapper, .toast { display: none !important; }
      body {
        background: #fff !important;
        color: #000 !important;
        font-size: 12pt;
      }
      .container { max-width: 100%; padding: 0; }
      .article-header { border-bottom: 1px solid #ccc; }
      .article-header h1 { font-size: 24pt; color: #000; }
      .article-header .subtitle { color: #444; }
      .article-header .meta { color: #666; }
      .article-body { font-size: 11pt; line-height: 1.6; }
      .article-body pre {
        background: #f5f5f5 !important;
        border: 1px solid #ddd;
      }
      .article-body a { color: #000; text-decoration: underline; }
      .article-body img { max-width: 100%; }
    }

    /* --- Toast notification --- */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--bg-card);
      border: 1px solid var(--accent);
      border-radius: var(--radius);
      padding: 12px 20px;
      font-size: 14px;
      z-index: 200;
      animation: slideIn 0.3s ease;
      max-width: 360px;
    }
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 onclick="navigateTo('/')">Substack Scraper</h1>
    <div class="live-dot" id="liveDot" title="Live"></div>
    <span class="badge" id="articleCount">...</span>
    <div class="spacer"></div>
    <button class="theme-toggle" id="themeToggle" onclick="toggleTheme()" title="Toggle light/dark mode">🌙</button>
  </div>
  <div class="container" id="app">
    <div class="loading">Loading...</div>
  </div>

  <script>
    // --- Theme toggle ---
    function getPreferredTheme() {
      const stored = localStorage.getItem('theme');
      if (stored) return stored;
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function applyTheme(theme) {
      if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      const btn = document.getElementById('themeToggle');
      if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
    }

    function toggleTheme() {
      const current = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      applyTheme(next);
    }

    // Apply theme immediately to avoid flash
    applyTheme(getPreferredTheme());

    // --- Simple SPA Router ---
    let currentPath = location.pathname;

    function navigateTo(path) {
      history.pushState(null, '', path);
      currentPath = path;
      route();
    }

    window.addEventListener('popstate', () => {
      currentPath = location.pathname;
      route();
    });

    function route() {
      const match = currentPath.match(/^\\/article\\/([^/]+)\\/([^/]+)$/);
      if (match) {
        renderArticle(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      } else {
        renderDashboard();
      }
    }

    // --- API helpers ---
    async function fetchJson(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    }

    // --- Dashboard ---
    async function renderDashboard() {
      currentArticle = null;
      const app = document.getElementById('app');
      app.innerHTML = '<div class="loading">Loading articles...</div>';

      try {
        const [articles, newsletters] = await Promise.all([
          fetchJson('/api/articles?limit=200'),
          fetchJson('/api/newsletters'),
        ]);

        document.getElementById('articleCount').textContent = articles.length + ' articles';

        if (articles.length === 0) {
          app.innerHTML = '<div class="empty">No articles scraped yet.<br>The scraper is running — articles will appear here automatically.</div>';
          return;
        }

        // Group by newsletter
        const groups = {};
        for (const a of articles) {
          if (!groups[a.newsletter]) groups[a.newsletter] = [];
          groups[a.newsletter].push(a);
        }

        let html = '';
        // Find names
        const nameMap = {};
        for (const n of newsletters) nameMap[n.url] = n.name;

        for (const [nlUrl, arts] of Object.entries(groups)) {
          const name = nameMap[nlUrl] || nlUrl;
          html += '<div class="newsletter-group">';
          html += '<h2>' + escHtml(name) + ' (' + arts.length + ')</h2>';
          for (const a of arts) {
            const date = new Date(a.post_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            html += '<div class="article-card" onclick="navigateTo(\\'/article/' + encodeURIComponent(a.newsletter) + '/' + encodeURIComponent(a.slug) + '\\')">';
            html += '<div class="title">' + escHtml(a.title) + '</div>';
            if (a.subtitle) html += '<div class="subtitle">' + escHtml(a.subtitle) + '</div>';
            html += '<div class="meta">' + escHtml(date) + '</div>';
            html += '</div>';
          }
          html += '</div>';
        }

        app.innerHTML = html;
      } catch (err) {
        app.innerHTML = '<div class="empty">Error loading articles: ' + escHtml(err.message) + '</div>';
      }
    }

    // --- Download helpers ---
    let currentArticle = null;

    function toggleDownloadMenu(e) {
      e.stopPropagation();
      const menu = document.getElementById('downloadMenu');
      menu.classList.toggle('open');
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      const menu = document.getElementById('downloadMenu');
      if (menu) menu.classList.remove('open');
    });

    function downloadMarkdown() {
      if (!currentArticle) return;
      const a = currentArticle;
      let content = '# ' + a.title + '\\n\\n';
      if (a.subtitle) content += '*' + a.subtitle + '*\\n\\n';
      content += '**Date:** ' + new Date(a.post_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '\\n';
      content += '**Source:** ' + a.canonical_url + '\\n\\n---\\n\\n';
      content += a.content_markdown || '';

      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (a.slug || 'article') + '.md';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const menu = document.getElementById('downloadMenu');
      if (menu) menu.classList.remove('open');
    }

    function downloadPdf() {
      const menu = document.getElementById('downloadMenu');
      if (menu) menu.classList.remove('open');
      window.print();
    }

    // --- Article Reader ---
    async function renderArticle(newsletter, slug) {
      const app = document.getElementById('app');
      app.innerHTML = '<div class="loading">Loading article...</div>';

      try {
        const article = await fetchJson('/api/articles/' + encodeURIComponent(newsletter) + '/' + encodeURIComponent(slug));
        currentArticle = article;

        const date = new Date(article.post_date).toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric'
        });

        // Convert markdown to HTML (simple converter)
        const bodyHtml = markdownToHtml(article.content_markdown);

        let html = '<div class="article-header">';
        html += '<a class="back" href="#" onclick="event.preventDefault(); navigateTo(\\'/\\')">← Back to articles</a>';
        html += '<h1>' + escHtml(article.title) + '</h1>';
        if (article.subtitle) html += '<div class="subtitle">' + escHtml(article.subtitle) + '</div>';
        html += '<div class="meta" style="display:flex;align-items:center;justify-content:space-between;">';
        html += '<span>' + escHtml(date) + ' · <a href="' + escHtml(article.canonical_url) + '" target="_blank">View on Substack</a></span>';
        html += '<div class="download-wrapper">';
        html += '  <button class="download-btn" onclick="toggleDownloadMenu(event)">';
        html += '    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        html += '    Download';
        html += '    <span style="font-size:10px;opacity:0.6;">▼</span>';
        html += '  </button>';
        html += '  <div class="download-menu" id="downloadMenu">';
        html += '    <button onclick="downloadMarkdown()"><span class="dl-icon">📝</span><span class="dl-label">Markdown</span><span class="dl-ext">.md</span></button>';
        html += '    <button onclick="downloadPdf()"><span class="dl-icon">📄</span><span class="dl-label">PDF</span><span class="dl-ext">.pdf</span></button>';
        html += '  </div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '<div class="article-body">' + bodyHtml + '</div>';

        app.innerHTML = html;
        window.scrollTo(0, 0);
      } catch (err) {
        app.innerHTML = '<div class="empty">Article not found</div>';
      }
    }

    // --- Simple Markdown→HTML ---
    function markdownToHtml(md) {
      if (!md) return '';
      let html = md;

      // Code blocks (fenced)
      html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
      // Inline code
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      // Images
      html = html.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, '<img alt="$1" src="$2" loading="lazy">');
      // Links
      html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
      // Headings
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
      // Bold
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      // Italic
      html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      // Blockquote
      html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
      // Horizontal rule
      html = html.replace(/^---$/gm, '<hr>');
      // Unordered lists
      html = html.replace(/^[\\*\\-] (.+)$/gm, '<li>$1</li>');
      // Paragraphs: wrap remaining lines
      html = html.replace(/^(?!<[huplboi]|<\\/|<li|<hr|<pre|<code|<img|<a |<strong|<em|<blockquote)(.+)$/gm, '<p>$1</p>');

      return html;
    }

    function escHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- WebSocket for live updates ---
    function connectWs() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(proto + '//' + location.host + '/ws');

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'new_article') {
            showToast('New: ' + msg.article.title);
            // Refresh dashboard if we're on it
            if (currentPath === '/' || currentPath === '') {
              renderDashboard();
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        document.getElementById('liveDot').style.background = '#f85149';
        setTimeout(connectWs, 3000);
      };

      ws.onopen = () => {
        document.getElementById('liveDot').style.background = '#3fb950';
      };
    }

    function showToast(text) {
      const existing = document.querySelector('.toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = text;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }

    // --- Init ---
    route();
    connectWs();
  </script>
</body>
</html>`;
}
