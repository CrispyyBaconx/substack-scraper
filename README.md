# substack-scraper

A self-hosted Substack newsletter scraper with a built-in web reader and Discord notifications. Polls your favorite newsletters on a schedule, stores articles as HTML and Markdown in a local SQLite database, and serves them through a clean reading UI with live updates.

## Features

- **Automatic polling** — periodically fetches new articles from configured Substack newsletters
- **Full-text scraping** — downloads complete article HTML and converts it to Markdown (via Cheerio + Turndown)
- **SQLite storage** — articles and newsletter metadata persisted locally with `bun:sqlite`
- **Web reader** — minimal SPA with dark/light theme, article list grouped by newsletter, and a clean reading view
- **Live updates** — WebSocket pushes new articles to the browser in real time
- **Discord notifications** — optional webhook integration posts rich embeds when new articles are detected
- **Download articles** — export any article as Markdown or PDF directly from the reader
- **Paywall support** — optionally pass a `connect.sid` cookie to access subscriber-only content

## Prerequisites

- [Bun](https://bun.sh) (v1.3+)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/your-user/substack-scraper.git
cd substack-scraper

# Install dependencies
bun install

# Edit config.json with your newsletters
# (see Configuration below)

# Start the scraper + web server
bun start
```

The web UI will be available at **http://localhost:3000** (or whatever port you configure).

## Configuration

Edit `config.json` in the project root:

```json
{
  "newsletters": [
    "https://example.substack.com",
    "https://another.substack.com"
  ],
  "pollIntervalMinutes": 15,
  "port": 3000
}
```

| Key                    | Type       | Default | Description                                        |
| ---------------------- | ---------- | ------- | -------------------------------------------------- |
| `newsletters`          | `string[]` | —       | List of Substack newsletter base URLs to follow     |
| `pollIntervalMinutes`  | `number`   | `15`    | Minutes between poll cycles                         |
| `port`                 | `number`   | `3000`  | Port for the web server                             |

## Environment Variables

| Variable               | Description                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| `DISCORD_WEBHOOK_URL`  | Discord webhook URL for new-article notifications (optional)                |
| `BASE_URL`             | Public base URL used in Discord embeds (defaults to `http://localhost:3000`) |
| `CONNECT_SID`          | Substack `connect.sid` session cookie for accessing paywalled content (optional) |

Bun loads `.env` automatically — just create a `.env` file in the project root.

## Usage

```bash
# Production
bun start

# Development (hot reload)
bun run dev
```

On the first poll cycle, existing articles are backfilled into the database without sending Discord notifications. Subsequent cycles will notify for any newly published articles.

## API

The web server exposes a small JSON API:

| Endpoint                                | Method | Description                              |
| --------------------------------------- | ------ | ---------------------------------------- |
| `/api/articles?limit=&offset=&newsletter=` | GET    | List articles (optionally filter by newsletter) |
| `/api/articles/:newsletter/:slug`       | GET    | Get a single article by newsletter + slug |
| `/api/newsletters`                      | GET    | List all tracked newsletters              |
| `/api/stats`                            | GET    | Article and newsletter counts             |

WebSocket connections are accepted at the server root and receive JSON messages for `new_article`, `scrape_started`, and `scrape_complete` events.

## Project Structure

```
├── config.json          # Newsletter list & settings
├── public/              # Static frontend (SPA)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── src/
│   ├── index.ts         # Entrypoint — loads config, starts server & poller
│   ├── server.ts        # Bun.serve() web server + WebSocket broadcasting
│   ├── scraper.ts       # Polling loop & per-newsletter scrape orchestration
│   ├── substack.ts      # Substack API client (archive + article fetching)
│   ├── db.ts            # SQLite schema, queries, and helpers
│   ├── markdown.ts      # HTML → Markdown conversion (Cheerio + Turndown)
│   ├── discord.ts       # Discord webhook notifications
│   └── types.ts         # Zod schemas & TypeScript types
├── scraper.db           # SQLite database (created at runtime)
└── package.json
```

## License

MIT
