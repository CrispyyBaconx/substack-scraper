import type { Article, Archive } from "./types.ts";
import { ArchiveSchema } from "./types.ts";

export class SubstackClient {
  private connectSid: string;

  constructor(connectSid?: string) {
    this.connectSid = connectSid || process.env.CONNECT_SID || "";
  }

  private get headers(): Record<string, string> {
    return this.connectSid ? { cookie: `connect.sid=${this.connectSid}` } : {};
  }

  /**
   * Fetch the full archive list for a newsletter.
   * Returns article metadata (no body content).
   */
  async fetchArchive(newsletterUrl: string, limit?: number): Promise<Archive> {
    console.log(`[substack] fetching archive: ${newsletterUrl}`);

    let api: URL;
    try {
      api = new URL(newsletterUrl);
      api.pathname = "/api/v1/archive";
    } catch {
      throw new Error(`Invalid newsletter URL: ${newsletterUrl}`);
    }

    const batchSize = 10;
    let offset = 0;
    const articles: Article[] = [];

    while (true) {
      api.searchParams.set("limit", batchSize.toString());
      api.searchParams.set("offset", offset.toString());

      const response = await fetch(api.href, { headers: this.headers });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Archive fetch failed [${response.status}]: ${body.slice(0, 300)}`
        );
      }

      const data: unknown[] = (await response.json()) as unknown[];

      if (!data || data.length === 0) break;

      const batch = ArchiveSchema.parse(data);
      articles.push(...batch);

      console.log(`[substack] fetched ${articles.length} articles so far`);

      if (limit && articles.length >= limit) {
        return articles.slice(0, limit);
      }

      if (data.length < batchSize) break; // last page

      offset += batchSize;
      await new Promise((r) => setTimeout(r, 500)); // rate limit
    }

    console.log(`[substack] archive complete: ${articles.length} articles`);
    return articles;
  }

  /**
   * Fetch the full HTML of a single article page.
   */
  async fetchArticleHtml(url: string): Promise<string> {
    console.log(`[substack] fetching article: ${url}`);

    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status === 403 || response.status === 401) {
        throw new Error(
          `Access denied (${response.status}) for ${url} — may need connect.sid`
        );
      }
      throw new Error(
        `Article fetch failed [${response.status}]: ${body.slice(0, 300)}`
      );
    }

    return response.text();
  }

  /**
   * Extract the newsletter name from a URL (used as a key/folder name).
   */
  extractNewsletterName(newsletterUrl: string): string {
    try {
      const hostname = new URL(newsletterUrl).hostname;
      if (hostname.endsWith(".substack.com")) {
        return hostname.replace(".substack.com", "");
      }
      return hostname.replace(/\./g, "-");
    } catch {
      return "unknown";
    }
  }
}
