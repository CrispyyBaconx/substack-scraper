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
 * store in DB, and optionally send a grouped Discord notification.
 */
export async function scrapeNewsletter(
  newsletterUrl: string,
  options: { notify: boolean; broadcast?: BroadcastFn }
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

      // Send Discord notification (skip on first cycle)
      if (options.notify) {
        const sent = await notifyDiscord(row);
        if (sent) markNotified(row.id);
      } else {
        // First cycle: mark as notified so they don't re-trigger later
        markNotified(row.id);
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

  if (!options.notify && scraped.length > 0) {
    console.log(`[scraper] first cycle — skipped Discord for ${scraped.length} article(s)`);
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
  options: { notify: boolean; broadcast?: BroadcastFn }
): Promise<void> {
  console.log(`[scraper] starting poll cycle (${config.newsletters.length} newsletter(s))${options.notify ? "" : " [first run, notifications suppressed]"}`);

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
 * Start the persistent polling loop.
 * The first cycle skips Discord notifications (backfill).
 */
export function startPolling(
  config: Config,
  broadcast?: BroadcastFn
): { stop: () => void } {
  const intervalMs = config.pollIntervalMinutes * 60 * 1000;
  let running = true;

  console.log(`[scraper] polling every ${config.pollIntervalMinutes} min`);

  // First cycle: scrape but don't notify (backfill existing articles)
  pollAll(config, { notify: false, broadcast }).catch((err) =>
    console.error("[scraper] initial poll failed:", err)
  );

  // Subsequent cycles: notify on new articles
  const timer = setInterval(() => {
    if (!running) return;
    pollAll(config, { notify: true, broadcast }).catch((err) =>
      console.error("[scraper] poll failed:", err)
    );
  }, intervalMs);

  return {
    stop() {
      running = false;
      clearInterval(timer);
    },
  };
}
