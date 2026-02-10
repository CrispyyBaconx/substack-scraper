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
  const match = currentPath.match(/^\/article\/([^/]+)\/([^/]+)$/);
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
        html += '<div class="article-card" onclick="navigateTo(\'/article/' + encodeURIComponent(a.newsletter) + '/' + encodeURIComponent(a.slug) + '\')">';
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
  let content = '# ' + a.title + '\n\n';
  if (a.subtitle) content += '*' + a.subtitle + '*\n\n';
  content += '**Date:** ' + new Date(a.post_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '\n';
  content += '**Source:** ' + a.canonical_url + '\n\n---\n\n';
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
    html += '<a class="back" href="#" onclick="event.preventDefault(); navigateTo(\'/\')">← Back to articles</a>';
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
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" loading="lazy">');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Blockquote
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');
  // Unordered lists
  html = html.replace(/^[*\-] (.+)$/gm, '<li>$1</li>');
  // Paragraphs: wrap remaining lines
  html = html.replace(/^(?!<[huplboi]|<\/|<li|<hr|<pre|<code|<img|<a |<strong|<em|<blockquote)(.+)$/gm, '<p>$1</p>');

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
