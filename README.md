# 90 Days to 2027

A minimal tracker for a daily YouTube upload challenge, from Day 1 (Oct 3, 2026) to Day 90 (Dec 31, 2026).

The site has two modes:

| | Where | What you can do |
|---|---|---|
| **Admin** | Your computer, at `npm start` → http://localhost:3090 | Edit days, pick movies, sync the playlist, change settings, **Publish** |
| **Public** | GitHub Pages or Vercel | Read-only. Visitors can browse the days, watch the videos, and see the movie picks |

Admin mode turns on automatically when the local server is running. The hosted site is a plain static page with no settings and no way to edit anything.

## Daily workflow

1. Run `npm start` and open http://localhost:3090.
2. Update the day: sync the playlist, add your note, pick a movie.
3. Click **Publish**. This commits `public/data.json` and pushes it, and the live site updates about a minute later.

## One-time setup

### 1. Put it on GitHub

```bash
git init -b main
git add .
git commit -m "90 Days to 2027 tracker"
gh repo create 90-days-to-2027 --public --source . --push
```

If you don't use the `gh` CLI, create an empty repo on github.com, then run `git remote add origin <url>` and `git push -u origin main`.

### 2a. Host on GitHub Pages

In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**. The included workflow (`.github/workflows/pages.yml`) deploys `public/` on every push. Your site will be at `https://<user>.github.io/90-days-to-2027/`.

### 2b. Or host on Vercel

On vercel.com, choose **Add New → Project** and import the repo. `vercel.json` already sets things up (no build step, it serves `public/`). Vercel redeploys on every push.

Use one host or both, since each just redeploys whenever you push.

## Settings (admin only, ⚙)

- **Playlist URL**: syncs every time you open the admin page, or when you press *Sync playlist*. Each video is placed on a day by its upload date.
  - With no API key, the app reads the playlist's public RSS feed, which only holds the **latest 15 videos**.
  - With a **YouTube Data API key** (Google Cloud Console → enable "YouTube Data API v3"), it reads the whole playlist.
- **TMDB key**: a v3 API key or a v4 read access token, from themoviedb.org → Settings → API.

## Data & privacy

- `public/data.json` holds your days, notes and movie picks. It's committed and **public**.
- `data/secrets.json` holds your API keys. It's **gitignored and never published**. The `data/` folder also keeps `data.prev.json`, the previous version of your data, as an undo backup.
- Settings also has **Export/Import JSON** for manual backups.
- The local server only listens on `127.0.0.1` and rejects writes from other websites.
