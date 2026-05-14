# Colosseum — Secure360 presentation

A static [reveal.js](https://revealjs.com/) deck for the Secure360 2026 Colosseum talk in Minneapolis. Self-contained HTML; no build step.

## Run locally

```bash
cd presentation
python3 -m http.server 8080
# open http://localhost:8080/
```

In a second terminal, start the Colosseum server that the demo slide will iframe:

```bash
./bin/colosseum server --port 8001
```

Open the deck in a browser. The demo slide (slide 19) will auto-ping `http://localhost:8001/healthz` and show a green dot when it's reachable.

## Configure the demo target

The demo iframe reads a `?demo=<url>` query string:

```
http://localhost:8080/                            # defaults to http://localhost:8001
http://localhost:8080/?demo=http://10.0.0.5:8001  # remote host on the conference LAN
http://localhost:8080/?demo=https://colosseum.example.com   # deployed demo
http://localhost:8080/?demo=video                 # swap the iframe for assets/demo-fallback.mp4
```

If you want a prerecorded fallback, drop an `.mp4` at `assets/demo-fallback.mp4` and use `?demo=video`.

## Speaker view

Press `S` anywhere in the deck — reveal opens a second window with speaker notes, next-slide preview, and a timer. Every slide has notes in `<aside class="notes">`; the demo slide's notes are the full demo script.

## PDF export

Append `?print-pdf` and use Chrome's **Print → Save as PDF**:

```
http://localhost:8080/?print-pdf
```

Fit-to-page, background graphics enabled. The demo iframe is hidden in `@media print` so the PDF doesn't try to render a live app.

## Deploy

Anything that serves static files works:

- **GitHub Pages** — push the `presentation/` folder to a branch, enable Pages. The `.nojekyll` file keeps Jekyll from eating the assets.
- **Netlify / Vercel / Cloudflare Pages** — drop the folder in as a static site, no build command.
- **S3 + CloudFront** — sync the folder to a bucket, serve behind CloudFront.

### Mixed content (important)

Browsers block an **HTTPS** page from iframing **HTTP** content. At the conference, the two supported setups are:

1. **Serve the deck over HTTP too** (e.g., GitHub Pages via a custom domain with HTTP kept on, or just host the deck on the presenter laptop). Simplest for a local demo.
2. **Put the demo Colosseum on HTTPS**: `ngrok http 8001`, a VPS with Caddy, or a self-signed cert trusted on the presenter laptop.

Use `?demo=video` as the bulletproof fallback — the deck works on HTTPS with no live target.

### X-Frame-Options

Colosseum intentionally sets no `X-Frame-Options` or restrictive `Content-Security-Policy: frame-ancestors` header — iframing is explicitly supported for this presentation and for embedded-operator scenarios. See `docs/07-security-reliability.md` for the reasoning.

## Pre-talk checklist

- [ ] `./bin/colosseum server --port 8001` running on the presenter laptop with the demo DB preset
- [ ] Deck served via `python3 -m http.server 8080` (or deployed ahead of time)
- [ ] Demo slide shows a green status dot
- [ ] Speaker-notes window opened (`S`) and positioned on the second display
- [ ] `assets/demo-fallback.mp4` recorded and playable via `?demo=video` as backup
- [ ] Wifi/backup-hotspot tested
- [ ] Screen zoom / font size tested from the back of the room

## Layout

```
presentation/
├── index.html              # reveal shell + all 26 slides inline
├── css/theme.css           # Colosseum palette overrides on reveal's black base
├── js/config.js            # reveal init + ?demo=<url> handling + healthz ping
├── assets/
│   ├── logo.svg            # presentation logo matching ui/src/assets/colosseum-logo.svg
│   ├── architecture.svg    # simplified architecture diagram
│   └── threat-model.svg    # three-failure-mode illustration
├── .nojekyll               # GitHub Pages: skip Jekyll
└── README.md               # this file
```

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `N` / `→` | Next slide |
| `P` / `←` | Previous slide |
| `S` | Speaker notes window |
| `F` | Fullscreen |
| `Esc` / `O` | Slide overview |
| `.` | Black out screen |
| `?` | Full shortcut list |
