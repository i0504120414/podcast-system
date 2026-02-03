# Podcast System

A serverless podcast proxy using GitHub Actions + GitHub Pages.

## How It Works

1. **Discovery** - Top podcasts are cached in GitHub Pages, updated daily
2. **Search** - Trigger GitHub Action, poll for results
3. **Subscribe** - Trigger action to fetch feed and episodes
4. **Download** - Episodes uploaded to Internet Archive for streaming
5. **Updates** - Cron job checks for new episodes every 6 hours

## API Endpoints (GitHub Pages)

All data is served from: `https://{username}.github.io/podcast-system/`

| Endpoint | Description |
|----------|-------------|
| `/data/index.json` | API info and status |
| `/data/top_IL.json` | Top podcasts for Israel |
| `/data/lookups_{country}.json` | Feed URLs by country |
| `/data/all_lookups.json` | All cached feed URLs |
| `/data/subscriptions.json` | Active subscriptions |
| `/data/feeds/{id}.json` | Podcast feed info |
| `/data/episodes/{id}/list.json` | Episode list |
| `/data/requests/{id}.json` | Request results |

## Triggering Actions

Send a repository_dispatch event:

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer {token}" \
  https://api.github.com/repos/{owner}/podcast-system/dispatches \
  -d '{"event_type":"search","client_payload":{"query":"podcast name","request_id":"123"}}'
```

## Action Types

| Event Type | Payload |
|------------|---------|
| `update-top` | `{ country: "IL" }` |
| `search` | `{ query: "...", request_id: "...", limit: 25 }` |
| `subscribe` | `{ feed_url: "...", podcast_id: "...", request_id: "..." }` |
| `unsubscribe` | `{ podcast_id: "...", request_id: "..." }` |
| `download` | `{ episode_url: "...", episode_id: "...", podcast_id: "...", request_id: "..." }` |

## Setup

1. Create GitHub repository
2. Enable GitHub Pages (source: main branch, /data folder or root)
3. Add secrets:
   - `IA_ACCESS_KEY` - Internet Archive S3 access key
   - `IA_SECRET_KEY` - Internet Archive S3 secret key
4. Create a Personal Access Token with `repo` scope for the Android app
