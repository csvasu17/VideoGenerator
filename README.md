# ACL Video Generator

AI-powered product demo video generator — **Remotion + Playwright + Azure OpenAI**.
Point it at a live web app, and it logs in, records the UI, writes AI narration/benefit
copy, sources b-roll, generates voice-over, and renders a finished MP4.

---

## Repository layout

```
automation/                 The pipeline (Playwright recording, AI content, TTS, rendering)
  config.ts                 Resolves out/<slug> from APP_PRODUCT_NAME / APP_URL
  record-app-clips.ts       CURRENT enterprise-template recorder (npm run pipeline:enterprise)
  render-demo.ts            Renders the final video (npm run render:demo)
  generate-voice.ts         TTS narration + background music (npm run voice)
  download-broll-videos.ts  Pexels stock footage matched to AI-generated queries
  generate-presenter-video.ts  D-ID talking-head presenter overlay
  fetch-background-music.ts Pixabay background music
  config-server.ts          Express API (port 4001) behind the in-Studio Config UI
  e2e-test.ts               modern_saas-template pipeline (agent/DDD architecture)
  utils/
    session.ts               Login/session helpers (form login + Quick Access cards)
    constants.ts              GENERIC_NARRATIONS — fallback strings used to detect silent AI failures
    demoValidation.ts         Post-recording QA: duplicate frames/text, generic narration, URL mismatches
    roleLabel.ts              Parses role names out of APP_ROUTE_MAP labels

src/
  Root.tsx                 Remotion composition registry
  compositions/
    ConfigPage.tsx          "Config" composition — the in-Studio settings/pipeline-launcher UI
    DemoVideo.tsx           modern_saas template composition
    EnterpriseVideo.tsx     enterprise template composition
  video-templates/
    VideoTemplateStrategy.ts Resolves VIDEO_TEMPLATE ('modern_saas' | 'enterprise')
  agents/, application/, infrastructure/, core/domain/   modern_saas agent pipeline (DDD-style)

projects/rheem/, core/ (root)   Legacy, pre-recorded-clip Rheem demo (RheemDemo composition).
                                Not part of the current AI pipeline — kept for reference only.
render/, scripts/               Legacy pipeline/validate scripts, superseded by automation/.

out/<slug>/                Generated per-app: demo-package.json, voice-script.json, demo-video.mp4
public/                    Static assets (logos, fallback images) served to Remotion
.tmp/                      Cached login sessions (session-state[-<role>].json)
```

> `projects/`, root-level `core/`, `render/`, and `scripts/` are legacy holdovers from an earlier
> architecture. They still work in isolation but are not touched by any of the workflows below —
> don't add new features there.

---

## Quick start

```bash
npm install
npm run playwright:install     # one-time: install Chromium
cp .env.example .env           # fill in APP_URL, credentials, Azure OpenAI keys, etc.
npm run dev                    # Config UI (:4001) + Remotion Studio (:3000)
```

Open `http://localhost:3000`, select the **Config** composition, fill in the form (or edit `.env`
directly), and click **Run Pipeline** — this is the easiest way to run an end-to-end recording.

---

## End-to-end workflow

### 1. Configure `.env`

Copy `.env.example` → `.env`. Key variables (see `.env.example` for the full commented list):

| Variable | Purpose |
|---|---|
| `APP_URL` | Target app to record |
| `APP_PRODUCT_NAME` | Product name → output folder `out/<slug>/` + narration copy |
| `LOGIN_TYPE` | `0` = app has no login, skip authentication entirely; `1` = fill a login form with `APP_USERNAME`/`APP_PASSWORD`; `2` = click a Quick Access card (`APP_QUICK_ACCESS_INDEX`) |
| `APP_LOGIN_PATH` | Override the login path — set to `/` if the app redirects root → login client-side |
| `APP_ROUTE_MAP` | JSON `{ "/path": "Page description" }` — drives which pages get recorded and can encode multiple roles (e.g. `"Surgeon — dashboard"`), each recorded under its own login session |
| `APP_CONTEXT_TEXT` | Product description — powers AI narration, benefit slide, and b-roll queries |
| `APP_GLOSSARY` | Domain terms the narration should use verbatim |
| `APP_LANGUAGE` | Narration/UI locale (default `en`); non-`en` triggers a batch AI translation pass |
| `AZURE_OPENAI_API_KEY` / `_ENDPOINT` / `_DEPLOYMENT` | LLM used for narration, benefit copy, b-roll search queries, and screenshot vision analysis |
| `VIDEO_TEMPLATE` | `modern_saas` (default) or `enterprise` — see below |
| `SCREEN_FIT`, `SHOW_AVATAR` | Enterprise-template layout options |
| `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `D_ID_API_KEY` | Optional: b-roll footage, background music, presenter avatar |

### 2. Record + generate content

```bash
npm run pipeline:enterprise    # automation/record-app-clips.ts — the current, generic recorder
```

This single script, driven entirely by `.env` (no hardcoded product data):

1. Generates benefit-slide bullets and b-roll problem statements via Azure OpenAI, in parallel.
2. Builds a recording plan from `APP_ROUTE_MAP` — one `login` clip, then one clip per route.
3. Logs in per role using a three-layer strategy: reuse a cached session in `.tmp/`
   (`session-state[-<role>].json`, valid 8h) → headless form/Quick-Access login →
   visible-browser fallback that waits up to 3 minutes for a human to log in manually.
4. Records each route with Playwright, converts WebM → MP4, and screenshots a frame.
5. Sends each frame to Azure OpenAI vision for narration; falls back to text-only analysis if
   vision fails or returns a value in `GENERIC_NARRATIONS`.
6. Runs non-blocking QA (`utils/demoValidation.ts`) for duplicate frames/narration and
   login/URL mismatches, writing `out/<slug>/validation-report.json`.
7. Writes `out/<slug>/demo-package.json` (`meta.templateId: 'enterprise'`) and `voice-script.json`.
8. Downloads matching b-roll from Pexels if missing, then shells out to `npm run voice:only`
   to generate narration audio.

For `VIDEO_TEMPLATE=modern_saas` (the default), use `npm run e2e-test` instead — it runs the
newer agent/DDD pipeline (`src/agents/`, `src/application/pipeline/WorkflowOrchestrator.ts`).

> There is also a standalone `npm run record:enterprise` (`automation/record-enterprise-clips.ts`)
> with hardcoded two-role credentials (`APP_USERNAME`/`APP_USERNAME_2`). It predates
> `record-app-clips.ts`, is **not** wired into the Config UI, and should be treated as legacy.

### 3. Render

```bash
npm run render:demo            # automation/render-demo.ts → out/<slug>/demo-video.mp4
npm run render:demo:preview    # half-res, faster CRF 28
npm run render:demo:voice      # render:demo, then (re)generate voice-over
```

`render-demo.ts` reads `out/<slug>/demo-package.json` and picks the composition by
`meta.templateId`: `enterprise` → `EnterpriseVideo`, otherwise → `DemoVideo`. Enterprise-template
videos render in resumable chunks (`--chunk-size`, default 75 frames) and concatenate via ffmpeg,
to avoid Chrome OOM on long renders. ffmpeg is found on `PATH` or at the hardcoded fallbacks
`C:/ffmpeg/bin/ffmpeg.exe` / `D:/ffmpeg/bin/ffmpeg.exe`.

### 4. Voice-over (standalone)

```bash
npm run voice          # generate narration audio + merge into the render
npm run voice:only      # generate narration audio only, skip merge
```

Provider fallback order: Azure OpenAI TTS → OpenAI TTS → Windows SAPI (no key needed, last
resort). Background music is optionally auto-fetched from Pixabay based on `APP_CONTEXT_TEXT`.

### 5. Preview in Remotion Studio

```bash
npm start        # Remotion Studio → http://localhost:3000
npm run dev       # Studio + Config UI together (recommended)
```

---

## Config UI

`npm run dev` (or `npm run config-ui` alone) starts an Express API on **port 4001**
(`automation/config-server.ts`), paired with a Remotion composition, **`Config`**
(`src/compositions/ConfigPage.tsx`), viewed inside Studio at `localhost:3000`.

From the Config UI you can:
- Edit `.env` values through a form (including the `VIDEO_TEMPLATE` picker).
- Click **Run Pipeline**, which runs `pipeline:enterprise` or `e2e-test` server-side depending
  on the current `VIDEO_TEMPLATE`, and streams progress back over SSE.
- View/edit the generated `voice-script.json` and regenerate voice-over.
- Chat with an AI assistant (`automation/chat-service.ts`) that patches `demo-package.json`
  in place (via `fast-json-patch`) to tweak generated content without re-recording.

---

## Video templates

Selected via `VIDEO_TEMPLATE` in `.env` (`src/video-templates/VideoTemplateStrategy.ts`,
default `modern_saas`):

| Template | Look | Pipeline | Composition |
|---|---|---|---|
| `modern_saas` | Dark background, glassmorphic UI, animated camera + title, feature-pill closing card | `npm run e2e-test` | `DemoVideo` |
| `enterprise` | B-roll problem opening, white product screens, static camera, presenter overlay, benefit slide, full-screen presenter closing | `npm run pipeline:enterprise` | `EnterpriseVideo` |

Both compositions are always registered in `src/Root.tsx`; only the one matching the generated
`demo-package.json`'s `meta.templateId` gets real data — the other falls back to a short stub.

---

## Known caveat: reasoning-model content fallback

`AZURE_OPENAI_DEPLOYMENT` may point at a reasoning model (e.g. `gpt-5-mini`), where
`max_completion_tokens` covers hidden reasoning tokens *and* the visible output. If the limit is
too low, the model returns empty output and the pipeline silently falls back to the generic
strings in `automation/utils/constants.ts` (`GENERIC_NARRATIONS`).

- `automation/record-app-clips.ts` sets `reasoning_effort: 'low'` and adequate
  `max_completion_tokens` on all of its LLM calls (narration, benefit copy, b-roll subtitles,
  translation) — safe for reasoning models.
- `automation/record-enterprise-clips.ts` and `automation/download-broll-videos.ts` do **not**
  set `reasoning_effort` and still use lower token limits — if you use those scripts with a
  reasoning-family deployment, watch `validation-report.json` / narration output for
  `GENERIC_NARRATIONS` matches.

---

## Login flow

`automation/record-app-clips.ts`'s visible-browser login fallback (`tryInteractiveLogin`) waits
for the login form's password field to actually appear before racing "login completed"
conditions — this specifically handles `APP_LOGIN_PATH=/` apps that client-side redirect from
root to `/login`, where checking "URL moved away from login" too early used to resolve instantly
and fake a successful login. `recordClip()` also re-verifies after every navigation that the
landed page isn't a login/signin screen, so a session that silently expired mid-run fails loudly
with the offending route named, instead of recording clips against a login page.

---

## Requirements

- Node.js 18+ / npm 9+
- ffmpeg/ffprobe on `PATH` (or set `FFPROBE_PATH`) — [ffmpeg.org](https://ffmpeg.org/download.html)
- Chromium: `npm run playwright:install`
- Azure OpenAI (or OpenAI) API access for narration/vision/TTS content generation
