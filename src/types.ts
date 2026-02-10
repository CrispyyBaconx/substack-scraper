import { z } from "zod/v4";

// --- Substack API schemas ---

export const ArticleSchema = z.object({
  title: z.string(),
  canonical_url: z.url(),
  slug: z.string(),
  post_date: z.iso.datetime(),
  subtitle: z.string().nullable(),
  publication_id: z.number(),
});

export const ArchiveSchema = z.array(ArticleSchema);

export type Article = z.infer<typeof ArticleSchema>;
export type Archive = z.infer<typeof ArticleSchema>[];

// --- Config schema ---

export const ConfigSchema = z.object({
  newsletters: z.array(z.string()),
  pollIntervalMinutes: z.number().min(1).default(15),
  port: z.number().default(3000),
});

export type Config = z.infer<typeof ConfigSchema>;

// --- Database row types ---

export interface DbArticle {
  id: number;
  newsletter: string;
  slug: string;
  title: string;
  subtitle: string | null;
  canonical_url: string;
  post_date: string;
  content_html: string;
  content_markdown: string;
  scraped_at: string;
  notified: number; // 0 or 1 (SQLite boolean)
}

export interface DbNewsletter {
  url: string;
  name: string;
  last_checked_at: string | null;
}

// --- WebSocket message types ---

export type WsMessage =
  | { type: "new_article"; article: DbArticle }
  | { type: "scrape_started"; newsletter: string }
  | { type: "scrape_complete"; newsletter: string; newCount: number };
