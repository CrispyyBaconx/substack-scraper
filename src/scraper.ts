import { SubstackClient } from "./substack.ts";
import { htmlToMarkdown } from "./markdown.ts";
import { notifyDiscord } from "./discord.ts";
import {
  upsertNewsletter,
  updateNewsletterChecked,
  articleExists,
  insertArticle,
  markNotified,
} from "./db.ts";
import type { Config, DbArticle, WsMessage } from "./types.ts";

const client = new SubstackClient();

type BroadcastFn = (msg: WsMessage) => void;

/**
 * Scrape a single newsletter: fetch archive, find new articles, scrape content,
 * store in DB, and send Discord notifications for articles not yet notified.
 */
export async function scrapeNewsletter(
  newsletterUrl: string,
  options: { broadcast?: BroadcastFn } = {}
): Promise<DbArticle[]> {
  const name = client.extractNewsletterName(newsletterUrl);
  console.log(`[scraper] checking ${name} (${newsletterUrl})`);

  options.broadcast?.({ type: "scrape_started", newsletter: name });

  // Ensure the newsletter row exists
  upsertNewsletter(newsletterUrl, name);

  // Fetch the archive (just metadata, not full content)
  const archive = await client.fetchArchive(newsletterUrl);

  // Find articles we haven't scraped yet
  const newArticles = archive.filter((a) => !articleExists(newsletterUrl, a.slug));

  if (newArticles.length === 0) {
    console.log(`[scraper] ${name}: no new articles`);
    updateNewsletterChecked(newsletterUrl);
    options.broadcast?.({ type: "scrape_complete", newsletter: name, newCount: 0 });
    return [];
  }

  console.log(`[scraper] ${name}: ${newArticles.length} new article(s)`);

  const scraped: DbArticle[] = [];

  for (const article of newArticles) {
    try {
      // Fetch full article HTML
      const html = await client.fetchArticleHtml(article.canonical_url);

      // Convert to markdown
      const { markdown } = htmlToMarkdown(html);

      // Store in DB
      const row = insertArticle({
        newsletter: newsletterUrl,
        slug: article.slug,
        title: article.title,
        subtitle: article.subtitle,
        canonical_url: article.canonical_url,
        post_date: article.post_date,
        content_html: html,
        content_markdown: markdown,
      });

      scraped.push(row);

      // Send Discord notification if not already notified (checked via DB)
      if (!row.notified) {
        const sent = await notifyDiscord(row);
        if (sent) markNotified(row.id);
      }

      // Broadcast to WebSocket clients
      options.broadcast?.({ type: "new_article", article: row });

      console.log(`[scraper] scraped: ${article.title}`);

      // Rate limit between articles
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[scraper] failed to scrape ${article.slug}:`, err);
    }
  }

  updateNewsletterChecked(newsletterUrl);
  options.broadcast?.({ type: "scrape_complete", newsletter: name, newCount: scraped.length });

  return scraped;
}

/**
 * Run a single poll cycle: scrape all configured newsletters.
 */
export async function pollAll(
  config: Config,
  options: { broadcast?: BroadcastFn } = {}
): Promise<void> {
  console.log(`[scraper] starting poll cycle (${config.newsletters.length} newsletter(s))`);

  for (const url of config.newsletters) {
    try {
      await scrapeNewsletter(url, options);
    } catch (err) {
      console.error(`[scraper] error scraping ${url}:`, err);
    }
  }

  console.log("[scraper] poll cycle complete");
}

/**
 * Return a jittered delay: base ± up to 25%, so polls aren't metronomic.
 */
function jitteredDelay(baseMs: number): number {
  const jitter = baseMs * 0.25; // ±25 %
  return baseMs + (Math.random() * 2 - 1) * jitter;
}

/**
 * Start the persistent polling loop.
 * Notifications are determined by the DB `notified` column, not cycle order.
 */
export function startPolling(
  config: Config,
  broadcast?: BroadcastFn
): { stop: () => void } {
  const baseMs = config.pollIntervalMinutes * 60 * 1000;
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  console.log(`[scraper] polling every ~${config.pollIntervalMinutes} min (±25 % jitter)`);

  function scheduleNext() {
    if (!running) return;
    const delay = jitteredDelay(baseMs);
    console.log(`[scraper] next poll in ${(delay / 60000).toFixed(1)} min`);
    timer = setTimeout(async () => {
      if (!running) return;
      try {
        await pollAll(config, { broadcast });
      } catch (err) {
        console.error("[scraper] poll failed:", err);
      }
      scheduleNext();
    }, delay);
  }

  // Initial cycle, then schedule the next one
  pollAll(config, { broadcast })
    .catch((err) => console.error("[scraper] initial poll failed:", err))
    .finally(() => scheduleNext());

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
