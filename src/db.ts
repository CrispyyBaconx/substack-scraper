import { Database } from "bun:sqlite";
import type { DbArticle, DbNewsletter } from "./types.ts";

const DATA_DIR = process.env.DATA_DIR || ".";

let db: Database;

export function getDb(): Database {
  if (!db) {
    db = new Database(`${DATA_DIR}/scraper.db`, { create: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS newsletters (
      url TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_checked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      newsletter TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      canonical_url TEXT NOT NULL,
      post_date TEXT NOT NULL,
      content_html TEXT NOT NULL DEFAULT '',
      content_markdown TEXT NOT NULL DEFAULT '',
      scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
      notified INTEGER NOT NULL DEFAULT 0,
      UNIQUE(newsletter, slug),
      FOREIGN KEY (newsletter) REFERENCES newsletters(url)
    );

    CREATE INDEX IF NOT EXISTS idx_articles_newsletter ON articles(newsletter);
    CREATE INDEX IF NOT EXISTS idx_articles_post_date ON articles(post_date DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_notified ON articles(notified);
  `);
}

// --- Newsletter queries ---

export function upsertNewsletter(url: string, name: string): void {
  getDb()
    .prepare(
      `INSERT INTO newsletters (url, name) VALUES (?, ?)
       ON CONFLICT(url) DO UPDATE SET name = excluded.name`
    )
    .run(url, name);
}

export function updateNewsletterChecked(url: string): void {
  getDb()
    .prepare(`UPDATE newsletters SET last_checked_at = datetime('now') WHERE url = ?`)
    .run(url);
}

export function getAllNewsletters(): DbNewsletter[] {
  return getDb().prepare(`SELECT * FROM newsletters ORDER BY name`).all() as DbNewsletter[];
}

// --- Article queries ---

export function articleExists(newsletter: string, slug: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 FROM articles WHERE newsletter = ? AND slug = ?`)
    .get(newsletter, slug);
  return row !== null;
}

export function insertArticle(article: {
  newsletter: string;
  slug: string;
  title: string;
  subtitle: string | null;
  canonical_url: string;
  post_date: string;
  content_html: string;
  content_markdown: string;
}): DbArticle {
  const stmt = getDb().prepare(
    `INSERT INTO articles (newsletter, slug, title, subtitle, canonical_url, post_date, content_html, content_markdown)
     VALUES ($newsletter, $slug, $title, $subtitle, $canonical_url, $post_date, $content_html, $content_markdown)
     RETURNING *`
  );
  return stmt.get({
    $newsletter: article.newsletter,
    $slug: article.slug,
    $title: article.title,
    $subtitle: article.subtitle,
    $post_date: article.post_date,
    $canonical_url: article.canonical_url,
    $content_html: article.content_html,
    $content_markdown: article.content_markdown,
  }) as DbArticle;
}

export function markNotified(id: number): void {
  getDb().prepare(`UPDATE articles SET notified = 1 WHERE id = ?`).run(id);
}

export function getUnnotifiedArticles(): DbArticle[] {
  return getDb()
    .prepare(`SELECT * FROM articles WHERE notified = 0 ORDER BY post_date DESC`)
    .all() as DbArticle[];
}

export function getAllArticles(limit = 100, offset = 0): DbArticle[] {
  return getDb()
    .prepare(`SELECT * FROM articles ORDER BY post_date DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as DbArticle[];
}

export function getArticlesByNewsletter(newsletter: string, limit = 100, offset = 0): DbArticle[] {
  return getDb()
    .prepare(
      `SELECT * FROM articles WHERE newsletter = ? ORDER BY post_date DESC LIMIT ? OFFSET ?`
    )
    .all(newsletter, limit, offset) as DbArticle[];
}

export function getArticleBySlug(newsletter: string, slug: string): DbArticle | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM articles WHERE newsletter = ? AND slug = ?`)
      .get(newsletter, slug) as DbArticle | null) ?? null
  );
}

export function getArticleCount(): number {
  const row = getDb().prepare(`SELECT COUNT(*) as count FROM articles`).get() as { count: number };
  return row.count;
}

export function getArticleCountByNewsletter(newsletter: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM articles WHERE newsletter = ?`)
    .get(newsletter) as { count: number };
  return row.count;
}
