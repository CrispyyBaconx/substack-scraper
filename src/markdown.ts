import * as cheerio from "cheerio";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Custom rule: handle images cleanly
turndown.addRule("img", {
  filter: "img",
  replacement(_content: string, node: any) {
    const alt = (node.getAttribute("alt") || "").replace(/(\n+\s*)+/g, "\n");
    const src = node.getAttribute("src") || "";
    return src ? `![${alt}](${src})` : "";
  },
});

/**
 * Convert raw Substack article HTML into clean Markdown.
 * Images are kept as remote URLs (served via web reader, no local download).
 */
export function htmlToMarkdown(html: string): { markdown: string; title: string; subtitle: string } {
  const $ = cheerio.load(html);

  // Unwrap images from surrounding anchor tags
  $("a").each((_i, el) => {
    const $el = $(el);
    if ($el.find("img").length) {
      $el.replaceWith($el.find("img"));
    }
  });

  const title = $("article > div.post-header > h1").text().trim() || $("h1.post-title").text().trim() || $("title").text().trim() || "Untitled";
  const subtitle = $("article > div.post-header > h3").text().trim() || $("h3.subtitle").text().trim() || "";

  const titleHtml = $("article > div.post-header > h1").html() || $("h1.post-title").html() || "";
  const subtitleHtml = $("article > div.post-header > h3").html() || $("h3.subtitle").html() || "";
  const bodyHtml = $("div.body.markup").html() || $("div.available-content").html() || "";

  const combinedHtml = `
<h1>${titleHtml}</h1>
${subtitleHtml ? `<h3>${subtitleHtml}</h3>` : ""}
${bodyHtml}
  `.trim();

  const markdown = turndown.turndown(combinedHtml);

  return { markdown, title, subtitle };
}
