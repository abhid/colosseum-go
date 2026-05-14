# Secure360 presentation

A static [reveal.js](https://revealjs.com/) deck for a vendor-neutral Secure360 talk on governing intelligent agents. The main talk is 18 primary slides for a 45-minute presentation, followed by appendix slides for Q&A, references, demo fallback, implementation options, and attendee takeaway material.

## Run locally

```bash
cd presentation
python3 -m http.server 8080
# open http://localhost:8080/
```

## Speaker view

Press `S` anywhere in the deck. Reveal opens a second window with speaker notes, next-slide preview, and a timer. The main slides include spoken notes with:

- first sentence
- final sentence
- cue bullets
- timing guidance
- pauses and audience interaction
- transitions
- what to skip if behind
- demo fallback guidance

## PDF export

Append `?print-pdf` and use Chrome's **Print -> Save as PDF**:

```text
http://localhost:8080/?print-pdf
```

Use fit-to-page with background graphics enabled.

## Live demo prep

The deck no longer embeds a localhost demo target. Keep the demo in a separate browser window so the audience deck stays clean and does not expose local URLs, tokens, or environment details.

Pre-talk checklist:

- [ ] Known-good demo run recorded.
- [ ] Screenshots captured for agent profile, tool allowlist, scoped credentials, hostile ticket, approval/denial gate, run graph/evidence, and replay result.
- [ ] Short fallback screen recording tested.
- [ ] Local static demo dataset ready.
- [ ] Clean reset command or clean demo environment ready.
- [ ] Hosted model/API keys tested outside the audience deck.
- [ ] Speaker-notes window opened and positioned on presenter display.
- [ ] Screen zoom and font size tested from the back of the room.

Fallback trigger: if the live demo has not reached the approval/denial moment within 5 minutes, switch to the captured run.

Fallback line:

> I'm going to switch to the captured run. Same scenario, same controls. The important part is not the randomness of the model response; it is where the runtime draws the boundary.

## Layout

```text
presentation/
├── index.html              # reveal shell + 18 main slides + appendix backup
├── css/theme.css           # light Secure360/Colosseum visual theme
├── js/config.js            # reveal init
├── assets/
│   ├── logo.svg
│   ├── architecture.svg
│   └── threat-model.svg
└── README.md
```

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `N` / `->` | Next slide |
| `P` / `<-` | Previous slide |
| `S` | Speaker notes window |
| `F` | Fullscreen |
| `Esc` / `O` | Slide overview |
| `.` | Black out screen |
| `?` | Full shortcut list |
