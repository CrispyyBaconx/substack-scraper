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

// --- Dashboard state ---
let cachedArticles = [];
let cachedNewsletters = [];
let nameMap = {};
let sortMode = 'newsletter'; // 'newsletter' | 'recent'
let filterNewsletter = null; // null = all, or a newsletter URL

function getSearchQuery() {
  const input = document.getElementById('searchInput');
  return input ? input.value.trim().toLowerCase() : '';
}

function filterAndSort(articles) {
  let filtered = articles;

  // Text search
  const q = getSearchQuery();
  if (q) {
    filtered = filtered.filter(a => {
      const name = (nameMap[a.newsletter] || a.newsletter).toLowerCase();
      return a.title.toLowerCase().includes(q)
        || (a.subtitle && a.subtitle.toLowerCase().includes(q))
        || name.includes(q);
    });
  }

  // Newsletter filter
  if (filterNewsletter) {
    filtered = filtered.filter(a => a.newsletter === filterNewsletter);
  }

  return filtered;
}

function renderArticleList(articles) {
  const filtered = filterAndSort(articles);

  if (filtered.length === 0) {
    return '<div class="empty">No matching articles found.</div>';
  }

  let html = '';

  if (sortMode === 'newsletter') {
    // Group by newsletter
    const groups = {};
    for (const a of filtered) {
      if (!groups[a.newsletter]) groups[a.newsletter] = [];
      groups[a.newsletter].push(a);
    }
    const sortedKeys = Object.keys(groups).sort((a, b) =>
      (nameMap[a] || a).localeCompare(nameMap[b] || b)
    );
    for (const nlUrl of sortedKeys) {
      const arts = groups[nlUrl];
      const name = nameMap[nlUrl] || nlUrl;
      html += '<div class="newsletter-group">';
      html += '<h2>' + escHtml(name) + ' (' + arts.length + ')</h2>';
      for (const a of arts) {
        html += renderCard(a);
      }
      html += '</div>';
    }
  } else {
    // Sort by most recent
    const sorted = [...filtered].sort((a, b) =>
      new Date(b.post_date).getTime() - new Date(a.post_date).getTime()
    );
    for (const a of sorted) {
      html += renderCard(a, true);
    }
  }

  return html;
}

function renderCard(a, showNewsletter) {
  const date = new Date(a.post_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  let html = '<div class="article-card" onclick="navigateTo(\'/article/' + encodeURIComponent(a.newsletter) + '/' + encodeURIComponent(a.slug) + '\')">';
  html += '<div class="title">' + escHtml(a.title) + '</div>';
  if (a.subtitle) html += '<div class="subtitle">' + escHtml(a.subtitle) + '</div>';
  html += '<div class="meta">' + escHtml(date);
  if (showNewsletter) html += ' · ' + escHtml(nameMap[a.newsletter] || a.newsletter);
  html += '</div>';
  html += '</div>';
  return html;
}

function buildSidebar(newsletters, articles) {
  // Count articles per newsletter
  const counts = {};
  for (const a of articles) {
    counts[a.newsletter] = (counts[a.newsletter] || 0) + 1;
  }

  let html = '<div class="sort-sidebar">';
  html += '<h3>Sort</h3>';
  html += '<button class="sort-btn' + (sortMode === 'newsletter' ? ' active' : '') + '" onclick="setSort(\'newsletter\')">';
  html += '<span class="sort-icon">📰</span> By Newsletter</button>';
  html += '<button class="sort-btn' + (sortMode === 'recent' ? ' active' : '') + '" onclick="setSort(\'recent\')">';
  html += '<span class="sort-icon">🕐</span> Recently Added</button>';

  html += '<h3 style="margin-top:20px;">Newsletters</h3>';
  html += '<div class="nl-list">';
  html += '<button class="nl-btn' + (!filterNewsletter ? ' active' : '') + '" onclick="setNewsletterFilter(null)">All <span class="nl-count">' + articles.length + '</span></button>';

  const sorted = [...newsletters].sort((a, b) => (a.name || a.url).localeCompare(b.name || b.url));
  for (const n of sorted) {
    const count = counts[n.url] || 0;
    const active = filterNewsletter === n.url ? ' active' : '';
    html += '<button class="nl-btn' + active + '" onclick="setNewsletterFilter(\'' + escHtml(n.url).replace(/'/g, "\\'") + '\')" title="' + escHtml(n.name || n.url) + '">';
    html += escHtml(n.name || n.url) + ' <span class="nl-count">' + count + '</span></button>';
  }
  html += '</div></div>';
  return html;
}

function rerenderDashboard() {
  const main = document.querySelector('.dashboard-main');
  if (main) main.innerHTML = renderArticleList(cachedArticles);
  // Update sidebar active states
  const sidebar = document.querySelector('.sort-sidebar');
  if (sidebar) {
    sidebar.outerHTML = buildSidebar(cachedNewsletters, cachedArticles);
  }
  // Update article count badge
  const filtered = filterAndSort(cachedArticles);
  document.getElementById('articleCount').textContent = filtered.length + ' articles';
}

function setSort(mode) {
  sortMode = mode;
  rerenderDashboard();
}

function setNewsletterFilter(nlUrl) {
  filterNewsletter = nlUrl;
  rerenderDashboard();
}

// --- Dashboard ---
async function renderDashboard() {
  currentArticle = null;
  const app = document.getElementById('app');
  app.className = 'container';

  // Show/hide search bar
  document.getElementById('searchWrapper').style.display = 'flex';

  app.innerHTML = '<div class="loading">Loading articles...</div>';

  try {
    const [articles, newsletters] = await Promise.all([
      fetchJson('/api/articles?limit=200'),
      fetchJson('/api/newsletters'),
    ]);

    cachedArticles = articles;
    cachedNewsletters = newsletters;
    nameMap = {};
    for (const n of newsletters) nameMap[n.url] = n.name;

    document.getElementById('articleCount').textContent = articles.length + ' articles';

    if (articles.length === 0) {
      app.innerHTML = '<div class="empty">No articles scraped yet.<br>The scraper is running — articles will appear here automatically.</div>';
      return;
    }

    // Build layout with sidebar
    app.className = '';
    let html = '<div class="dashboard-layout">';
    html += buildSidebar(newsletters, articles);
    html += '<div class="dashboard-main">';
    html += renderArticleList(articles);
    html += '</div></div>';

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
  app.className = 'container';
  // Hide search bar on article view
  document.getElementById('searchWrapper').style.display = 'none';
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

// --- Search input ---
(function () {
  let debounceTimer;
  const input = document.getElementById('searchInput');
  if (input) {
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (cachedArticles.length) rerenderDashboard();
      }, 150);
    });
  }
})();

// --- Init ---
route();
connectWs();
