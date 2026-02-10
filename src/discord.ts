import type { DbArticle } from "./types.ts";

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: { text: string };
}

/**
 * Send a rich embed to the configured Discord webhook for a single article.
 */
export async function notifyDiscord(article: DbArticle): Promise<boolean> {
  if (!WEBHOOK_URL) {
    console.log("[discord] no webhook URL configured, skipping notification");
    return false;
  }

  const articleUrl = `${BASE_URL}/article/${encodeURIComponent(article.newsletter)}/${encodeURIComponent(article.slug)}`;

  const embed: DiscordEmbed = {
    title: article.title,
    description: article.subtitle || undefined,
    url: articleUrl,
    color: 0xff6719, // Substack orange
    timestamp: article.post_date,
    footer: { text: article.newsletter },
  };

  const body = {
    content: `📰 New article from **${article.newsletter}**`,
    embeds: [embed],
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[discord] webhook failed [${res.status}]: ${text.slice(0, 200)}`);
      return false;
    }

    console.log(`[discord] notified: ${article.title}`);
    return true;
  } catch (err) {
    console.error("[discord] webhook error:", err);
    return false;
  }
}
