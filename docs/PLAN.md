# Gemma Chat — Implementation Plan

> This file records the original **Gemma Chat** implementation, the **[Pocket Chat](#pocket-chat-standalone-tool-and-prompt-templates)**
> standalone redesign, and **[Speak (Chatterbox TTS)](#speak-chatterbox-tts--implementation-plan)**.

Records the original **Chat** tab implementation (Gemma 4 E2B) in Edge AI Studio: a multimodal (text + image + audio)
chat that runs fully in the browser on WebGPU via Transformers.js. The planned standalone Pocket Chat redesign is
documented below. Technical details live in [SPECIFICATIONS.md](./SPECIFICATIONS.md).

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Placement | 4th tab in Edge AI Studio: `Listen · See · Act · Chat` |
| Engine | Separate from Cactus: Transformers.js + ONNX Runtime Web, own Web Worker |
| Model | `onnx-community/gemma-4-E2B-it-ONNX`, `q4f16` (≈3.2 GB core + 171 MB audio encoder) |
| Hosting | Weights from huggingface.co (too large for GitHub Pages); ORT runtime bundled with the site |
| Device | WebGPU first; CPU/WASM fallback is a stretch goal (Phase 6) |
| Scope | Streaming text, Stop, image, audio, Markdown, saved conversations, thinking toggle |
| UX rules | Same as other tabs: nothing auto-runs, fixed layout that never shifts, aligned rows, copy buttons |

## Phase overview

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Groundwork: dependency, shared gate refactor, capability checks | — |
| 1 | Text chat: load, stream, stop, settings, thinking toggle | 0 |
| 2 | Image attachments | 1 |
| 3 | Audio input (encoder already downloaded in Phase 1) | 1 |
| 4 | Markdown rendering | 1 |
| 5 | Saved conversations (IndexedDB) | 1, 2, 3 |
| 6 | Stretch: CPU (WASM) fallback | 1 |
| 7 | Hardening, docs, release | all |

Each phase ends with: `npm run build`, `npm run lint`, `npm test` green, and a manual browser check (Chrome + WebGPU).

---

## Phase 0 — Groundwork ✅ (2026-11-12)

**Goal:** everything the chat needs, without any chat UI yet.

- [x] `npm install --save-exact @huggingface/transformers@4.3.2`.
- [x] Bundle the ONNX Runtime Web files with the site and point `env.backends.onnx.wasm.wasmPaths` at them
      (`src/lib/gemma/runtime.ts`) — no runtime download from jsDelivr. Verified with a production build of a
      scratch worker: `ort-wasm-simd-threaded.asyncify.{wasm,mjs}` are emitted under `/tools/assets/` and the worker
      references them.
- [x] `src/lib/gemma/capability.ts`: WebGPU adapter detection, `shader-f16` check, `navigator.storage.estimate()`,
      choose dtype, human-readable `unsupported` / `blocked` reasons.
- [x] Generalise `ModelGate` → presentational `ModelGate({ source: ModelSource })` + `CactusModelGate` adapter.
- [x] Storage bar sums the Cactus cache **and** the Transformers cache; "Clear" opens a menu to pick which to
      remove (`StorageMenu`).
- [x] `Chat` tab shell in `EdgeAiStudioTool` (gate + placeholder panel with a device summary); the capability check
      runs only once the tab is first opened.

**Done when:** the Chat tab shows a correct gate on a WebGPU browser, a clear "not supported" message elsewhere, the existing three tabs are unchanged, and Transformers.js is not in the main chunk.

**Result:** all met. Chrome (WebGPU + shader-f16): gate shows `q4f16`, 3.03 GB (+163.6 MB audio), Download disabled
until Phase 1. WebGPU hidden: "Chat needs WebGPU…" and no Download button. Main chunk +10 KB (UI only; no
Transformers.js). Tests: `tests/unit/gemmaPhase0.test.ts` (14 tests).

## Phase 1 — Text chat (MVP) ✅ (2026-11-12)

**Goal:** a usable, streaming text chat.

- [x] `gemma.worker.ts`: `load` / `generate` / `stop` / `unload`, request ids, single in-flight generation,
      aggregated progress (`progress_total`), errors with codes.
- [x] `client.ts`: singleton worker (survives tab switches, like the Cactus client) + `useGemma()` hook.
- [x] `conversation.ts`: message model, chat-template formatting, history trimming to a token budget, thinking-channel
      parser, error classification (pure + tested).
- [x] `ChatTab.tsx`: fixed-height scrolling transcript, composer (textarea, Send/Stop), Enter = send,
      Shift+Enter = newline.
- [x] Streaming render (batched ~50 ms), Stop keeps the partial answer, Copy per message.
- [x] Settings row: temperature (0 = greedy, default), max new tokens, thinking toggle; thinking output shown in a
      collapsible "Reasoning" block.
- [x] "New chat" clears the transcript (in-memory only until Phase 5).
- [x] **Added:** OPFS model cache (`opfsCache.ts`) — Cache Storage rejected the 1.5 GB+ files, so every reload
      re-downloaded ~3 GB. Also pins `resolve/main/` lookups to the pinned revision (Transformers.js bug) so loading
      works offline.

**Done when:** load → ask → stream → stop → follow-up question uses prior turns; reload uses the browser cache
(no re-download); layout never shifts while streaming.

**Result:** all met (Chrome 150 / WebGPU / q4f16). First download 3.19 GB in ~8 min; reload from storage in 12–13 s
with **zero** network requests (also verified with Hugging Face + jsDelivr blocked). First token 0.3–1.0 s,
~23–25 tok/s decode. Follow-up ("its population") used prior turns; Stop kept the partial reply; thinking mode
streamed "Thinking…" then a collapsed Reasoning block. Transcript/composer positions identical before, during and
after streaming. Tests: +19 (conversation, OPFS cache, revision pinning) → 93 total.

## Phase 2 — Image attachments ✅ (2026-11-12)

- [x] Attach button + drop onto the composer (+ paste from clipboard); thumbnail preview with remove (×);
      up to 4 images per message; non-images rejected with a message.
- [x] Images stored on their message; formatting includes every image still in the trimmed history (in prompt
      order); trimming counts ~282 tokens per image.
- [x] Downscale large images client-side before sending (`prepareImage`: `fitWithin` 1024 px, re-encode JPEG only
      when needed).
- [x] Show the image in the transcript bubble (click opens full size).

**Done when:** ask about an attached image, then a follow-up about the same image works.

**Result:** met. Stop-sign photo: "What kind of sign… what word?" → "traffic sign … **ARRÊT**"; follow-up without
re-attaching → "French … means **STOP**". Composer is fixed-height (thumbnail strip takes space from the textarea),
so the settings row didn't move. First token 4–6.5 s with an image in history (vision encoder re-runs every turn) —
see the optimisation note in SPECIFICATIONS §5. Tests +3 (96 total).

## Phase 3 — Audio input ✅ (2026-11-12)

- [x] ~~Lazy-load the audio encoder on first use~~ — not possible with Transformers.js 4.3.2; it's part of the
      Phase 1 download (see SPECIFICATIONS §1.1).
- [x] Record / Upload / drop audio in the composer using the shared `useAudioCapture` hook (16 kHz mono PCM);
      the Listen tab's `AudioInput` now uses the same hook.
- [x] Audio chip on the message with a player; PCM passed straight to the processor (no `read_audio` fetch).
- [x] One clip per message, capped at 30 s (longer clips are trimmed and the chip says "(first 30 s)").
- [x] Only the newest clip in the history is sent (the processor reads just one); a hint says so, and older
      clips are reported in `droppedAudio`.

**Done when:** "What is said in this clip?" with a recorded clip returns a correct answer.

**Result:** met. speech.wav → the exact transcript ("Turn off the kitchen lights and set a timer for ten
minutes"); a follow-up about the clip worked. Image + audio in one message → "The image is **blue**" plus the
exact transcript (first token ~26 s while both encoders run). The 35 s clip was trimmed to 30 s with a notice.
The settings row stayed at the same position with attachments. Tests: 100 total.

## Phase 4 — Markdown rendering ✅ (2026-11-13)

- [x] Safe Markdown renderer (`Markdown.tsx`, `react-markdown` + `remark-gfm`, raw HTML disabled): headings, lists,
      tables, strikethrough, inline code, fenced code with a language label + Copy button; links open in a new tab;
      `javascript:` URLs stripped; Markdown images are not fetched (shown as `[image: alt]`).
- [x] Render incrementally while streaming without layout jumps (fixed transcript area); finished replies are
      memoized so only the streaming reply re-parses, and the streaming text goes through `useDeferredValue`.
- [x] Lazy `Markdown` chunk (~50 KB gzip), prefetched when the Chat tab is first visited.

**Done when:** code blocks, lists and tables render; `<script>`/HTML in model output is shown as text.

**Result:** met. Real Gemma replies rendered a `##` heading, bullet + numbered lists, bold, inline code, 2- and
3-column tables and a `python`/`javascript` code block with Copy. A reply that repeated
`<script>alert(1)</script> <b>bold?</b>` showed it as literal text (0 `script`/`b` elements). Transcript and composer
positions were identical before, during and after streaming. Markdown re-parse costs ~2 ms (160 chars) to ~11 ms
(3 KB) per update unthrottled. Tests +6 (106 total).

## Phase 5 — Saved conversations ✅ (2026-11-13)

- [x] IndexedDB store (`storage.ts`, DB `edge-ai-chat`): conversations + messages (image Blobs, audio as the ≤ 30 s
      PCM sent to the model; played back via a WAV rebuilt with `encodeWav`).
- [x] Conversation list (`ConversationList.tsx`; side column ≥ `lg`, same height as the transcript; overlay drawer
      below `lg`): new, rename (inline; Enter/blur saves, Esc cancels), delete (inline confirm), auto-title from the
      first prompt (40 chars, or "Image"/"Audio clip"); manual titles are never overwritten.
- [x] Auto-save: the user message on send, the reply when it completes or is stopped (appends only new messages);
      restores the last-open conversation on visit — before the model is loaded. Each chat keeps its own settings.
- [x] Storage bar includes "Saved chats (n)"; Clear lists it separately and does **not** pre-select it.

**Done when:** chats survive reload, can be switched/renamed/deleted, and attachments come back intact.

**Result:** met (verified in the browser with a stubbed model — see note). Image + audio + text chat saved
(244 KB) → reload → restored before load with the image (342 px) and a playable 3.02 s clip; continuing sent the
restored image (54,865 bytes) and audio (48,342 samples) byte-identical, and messages were saved with indexes 0–5.
Switching restored each chat's own Max reply (512 / 2048); rename kept its title after more messages; deleting the
open chat cascaded its messages and started a fresh chat; Clear → Saved chats emptied the list and reset the open
chat. List / drawer and transcript share top and height (448 px). Tests +10 (116 total).

> Note: the VS Code integrated browser keeps OPFS in an ephemeral, ~10 GB partition shared by all origins (see
> LEARNINGS). It dropped the downloaded model twice and then had no quota left for a re-download, so Phase 5 was
> tested with `gemma.generate` stubbed via the Vite dev server. The real-model path is unchanged from Phases 1–4.

## Phase 6 — Stretch: CPU (WASM) fallback

- [ ] When WebGPU is missing, offer "Run on CPU (very slow)" with `q4` weights on the WASM backend.
- [ ] Explicit warning (speed, memory), off by default; measure tokens/s and show it.

**Done when:** a non-WebGPU browser can complete a short reply; UI clearly communicates the trade-off.

## Phase 7 — Hardening & release ✅ (2026-11-13)

- [x] Error paths:
  - **Quota exceeded:** pre-download check (existing). Mid-download write failures — which Transformers.js only
    logs — now delete the partial file, are recorded by `OpfsModelCache.failures`, and show
    "Ready · not saved for offline use" with the reason. Chat saves report "Browser storage is full".
  - **GPU device lost:** the worker watches `device.lost` after loading and posts `lost`, even while idle; the
    client resets the worker and the gate shows the error (`role="alert"`) with Retry.
  - **Network drop mid-download:** Chrome/Firefox/Safari messages are classified as `network`; Retry resumes
    per file (finished files are kept). When offline and the model isn't stored, the gate says so before
    download.
  - **Tab backgrounded:** generation continues; replies are marked "tab was in the background" (explains low
    tok/s); the flag is saved with the chat.
- [x] Accessibility:
  - The transcript is not a live region while streaming (`aria-live="off"`, `aria-busy`, focusable for keyboard
    scrolling). A separate status says "Gemma is replying…", then announces the finished (or stopped) reply.
  - Esc stops generation. The gate announces phase changes only, and the progress bar has a label and value
    text.
  - Chat list: the drawer moves focus in, and Esc closes it and returns focus to Chats. Rename and delete
    restore focus; the delete confirm focuses Cancel; `aria-controls` now points at a real id.
- [x] `docs/LEARNINGS.md`: GitHub Pages file limits, serving ORT from the site, swallowed cache-write errors
      (multi-GB caching / OPFS and the VS Code browser were added in earlier phases).
- [x] Tool description in `src/tools.ts` mentions the Gemma chat and offline use.

**Result:** met. Tests +3 (119 total). Verified in the browser (dev server, stubbed model, since this VS Code browser
has no quota left for the model): offline notice on/off, "not saved for offline use" warning, device lost while
idle → alert + Retry + input disabled, Esc stop + announcement + background flag, and every keyboard focus step
above. Not reproducible here: a real GPU device loss and a real quota error mid-download (covered by unit tests
and the message paths).

---

## Pocket Chat: Standalone tool and prompt templates

The original Gemma Chat implementation remains documented above. This follow-on moves it out of Edge AI Studio and
redesigns it as **Pocket Chat**, a dedicated full-height tool. Its decisions and technical target are in
[SPECIFICATIONS.md](./SPECIFICATIONS.md#pocket-chat-standalone-planned).

### Decisions (agreed)

| Topic | Decision |
|---|---|
| Name and route | **Pocket Chat**, `#/pocket-chat` |
| Placement | Standalone tool; remove Chat from Edge AI Studio |
| Page | Full-width, viewport-height chat; sidebar + messages on desktop, chat-list drawer on narrow screens |
| Settings | Temperature, Max reply and Thinking move into a Settings popover |
| Composer | Grows from one to about eight lines; then scrolls internally |
| Existing data | Keep IndexedDB database `edge-ai-chat`, preserving saved conversations |
| Prompt templates | Ship built-in Markdown templates and let users import Markdown templates |
| Template fields | Use the example's `## Settings` block; values populate a form and the descriptions below it become help text |
| Template submission | Filling the fields renders and immediately submits the template as the first user message in a new chat |
| Template lifetime | Apply the template to the first turn only; follow-up turns are ordinary chat |
| Phase 6 | CPU/WASM fallback is intentionally deferred; it is not a prerequisite for these phases |

### Phase overview

| Phase | Deliverable | Depends on |
|---|---|---|
| C1 | Register Pocket Chat; move Chat-only UI; remove Chat from Edge AI Studio; preserve model/cache/chat data | — |
| C2 | Full-height responsive shell, compact model status, flexible message area and chat list | C1 |
| C3 | Growing composer and Settings popover | C2 |
| C4 | Keyboard/mobile/accessibility polish, docs and browser verification | C1–C3 |
| C5 | Built-in and imported prompt templates, Settings form, render-and-submit flow | C1–C4 |

### Phase C1 — Move Chat into its own tool ✅ (2026-11-21)

- [x] Register `pocket-chat` in the tool catalog and move the Chat-only components (`ChatTab`, `ConversationList`,
      `Markdown`) under `src/components/pocket-chat/`.
- [x] Remove Chat from the Edge AI Studio tabs and its Gemma / Saved chats entries from that tool's storage menu.
- [x] Give Pocket Chat its own Gemma / Saved chats storage menu; update both tool descriptions.
- [x] Preserve the `edge-ai-chat` IndexedDB name, Gemma OPFS cache, routes for other tools, and saved conversation data.

**Done when:** `#/pocket-chat` opens the existing chat and conversations; Edge AI Studio contains Listen, See, Act and
Speak only; existing routes and saved chats remain usable.

**Result:** met. The registry now exposes Pocket Chat at `#/pocket-chat`; Chat-only UI moved to
`src/components/pocket-chat/`; Edge AI Studio retains Listen, See, Act and Speak and its storage menu lists only
Cactus and Chatterbox. Pocket Chat owns the Gemma / Saved chats menu. Existing Gemma cache paths and the
`edge-ai-chat` database are unchanged; no data migration is needed. Browser checks confirmed both routes and the
studio tab list. Typecheck, lint, build and all 225 unit tests pass.

### Phase C2 — Full-height chat layout

- [x] Add an opt-in full-height tool-page layout; leave existing tools on the current contained page shell.
- [x] Use the viewport height (including mobile dynamic viewport sizing); the page itself does not scroll.
- [x] Desktop: chat list in a fixed-width left column; messages in a centred readable column. Narrow screens: chat
      list opens as a drawer.
- [x] Make the message transcript flex to fill the remaining height; keep its scroll position behavior and prevent
      the header, sidebar and composer from shifting during generation.
- [x] Put the download gate in the empty conversation area while loading/not ready; once ready, reduce it to a
      compact header status. Keep errors and cache warnings visible and actionable.

**Done when:** met by the opt-in `full-height` tool layout, fixed-width desktop sidebar, overlay mobile drawer, and
flexing transcript. The viewport shell uses `100dvh` where supported, safe-area padding, and keeps the model gate in
the empty conversation panel; loaded status and cache warnings remain visible.

### Phase C3 — Composer and settings

- [ ] Grow the message textarea from one to about eight lines, then scroll within the textarea; size the transcript
      to the remaining space.
- [ ] Move Temperature, Max reply and Thinking into a keyboard-accessible Settings popover beside Send.
- [ ] Keep attachments, recording, Enter-to-send, Shift+Enter newline and Esc-to-stop behavior.

**Done when:** long input and attachments do not move the header or sidebar; settings are reachable and operable by
keyboard.

### Phase C4 — Standalone-tool polish

- [ ] Verify desktop, narrow layout, mobile viewport / virtual keyboard, focus order, drawer behavior, live-region
      announcements and existing error paths.
- [ ] Verify reload, model-cache status, saved chats, clear-storage behavior, all non-chat tools and deep links.
- [ ] Update this plan and the specification with actual implementation and browser-test results; add a learning
      entry only for a non-obvious finding.

**Done when:** C1–C3 acceptance checks pass, the existing tools are unchanged, and build, lint and tests pass.

### Phase C5 — Prompt templates

- [ ] Provide built-in Markdown templates and an import action for user-supplied Markdown files; make templates
      selectable in Pocket Chat.
- [ ] Parse the example-style `## Settings` block into a form, seed each field from its example value and show its
      matching description as help text.
- [ ] On submit, replace the template's setting values, start a new conversation and send the completed template as
      the first user message. Keep subsequent turns as ordinary chat.
- [ ] Add template parsing/rendering tests, including malformed or missing Settings blocks and values containing
      Markdown-sensitive characters.
- [ ] Document supported template syntax and import/storage behavior.

**Done when:** the `tts-conversation.md` example can be selected/imported, its settings can be filled, and the
rendered instructions plus values reach the model in the first turn without changing normal follow-up behavior.

**Open implementation detail:** decide how imported templates persist across reloads and how field types/validation
are declared. The initial format is the example's `KEY = value` block; values can be text fields unless explicit
metadata is agreed before implementation.

## Risks

| Risk | Mitigation |
|---|---|
| 3+ GB first download | Show size up front, aggregated progress, OPFS cache + `storage.persist()` |
| Cache Storage rejects multi-GB entries | Model files stored in OPFS instead (Phase 1) |
| Browser storage quota (Safari, private windows) | Pre-check `storage.estimate()`; clear error; app still usable without caching |
| No `shader-f16` | Fall back to `q4` (larger) or show "not supported" |
| GPU memory (~4–5 GB) | Detect device-lost; suggest closing other tabs; Phase 6 fallback |
| Slow multi-turn prefill | History trimming now; KV-cache reuse as a later optimisation |
| Transformers.js API changes | Pin exact version; isolate all model calls in the worker |

---

# Speak (Chatterbox TTS) — Implementation Plan

Adds a **Speak** tab to Edge AI Studio: text-to-speech with optional voice cloning, using Resemble AI's
Chatterbox (0.5B Llama backbone, English, MIT). It runs fully in the browser via Transformers.js + ONNX Runtime Web,
on the same stack as Gemma Chat. Technical details are in
[SPECIFICATIONS.md — Speak](./SPECIFICATIONS.md#speak-chatterbox-tts--technical-specification).

**Status:** S0 done (2026-11-14) — **go**; S1 done (2026-11-15) — the app runs ONNX Runtime Web 1.32 and shares
the Transformers.js storage/runtime code. S2 done (2026-11-15) — TTS engine + Speak tab shell. S3 done (2026-11-15) — text → speech with the
default voice. S4 done (2026-11-15) — your own voice (upload / record / drop). S5 done (2026-11-15) — long text with
buffered playback. S8 done (2026-11-15) — 10,000 chars, 20 s start cap, parts kept on errors, lower memory. S9 done (2026-11-15) — 10 approved built-in voices in `public/voices/`.
S10 done (2026-11-15) — voice dropdown with preview, offline after first use. S11 done (2026-11-15) — script markers
([pause], [exaggeration], speaker tags) with live diagnostics. S12 done (2026-11-15) — conversation mode (up to 4
speakers, stitched audio). S13 done (2026-11-15) — "Download lines (.zip)". **Next: S7** (hardening) last. S6 dropped.
Based on the 2026-11-13 analysis with the local scripts in `.data/scripts/` (gitignored):
`download-model.mjs`, `graph.py`, `optimize.py`, `benchmark.mjs`, `test.mjs`, `tts.mjs`, and the S0 spike in
`.data/spike/`.

## Decisions (proposed — confirm before Phase S1)

| Topic | Decision |
|---|---|
| Placement | 5th tab in Edge AI Studio: `Listen · See · Act · Chat · Speak` |
| Engine | Transformers.js `ChatterboxModel` (already in the pinned 4.3.2) in its own Web Worker; **no** custom generation loop like `test.mjs` |
| Model | `onnx-community/chatterbox-ONNX`, pinned revision `3cab09af388d3f02bba43443fce88c1f4525ac43` |
| Dtypes | `language_model`: `q4f16` (WebGPU + `shader-f16`) or `q4` (otherwise); `embed_tokens`, `speech_encoder`, `conditional_decoder`: `fp32` (the only option in the repo) |
| Size | ≈ 1.53 GB (`q4f16`) / ≈ 1.58 GB (`q4`), including the ONNX Runtime and the default voice |
| ONNX Runtime | `onnxruntime-web` **≥ 1.32** via npm `overrides` (1.31 takes 80+ s to initialise the decoder — S0) |
| Hosting | Weights from huggingface.co (every weight file is > 100 MB); stored in OPFS like Gemma; ORT runtime bundled with the site |
| Device | WebGPU only (`q4f16`, or `q4` without `shader-f16`); no CPU fallback — S0 measured RTF 5–6 on WASM |
| Voices | The repo's `default_voice.wav` + your own voice (upload / record) in v1. The 592 MB speech encoder is downloaded anyway |
| Long text | Split into chunks of ≤ 120 chars (the 256-token cap is hit at ~150); buffer, then play chunk by chunk |
| Output | Play in the page + download WAV (24 kHz mono, 16-bit) |
| Generality | Worker/client written against a small model-agnostic TTS interface so a second model (e.g. Kokoro) can be added without UI changes |
| UX rules | Same as other tabs: nothing auto-runs, fixed layout that never shifts, aligned rows |

### Decisions for S8–S13 (agreed 2026-11-15)

| Topic | Decision |
|---|---|
| Built-in voices | 8–10 reference clips curated from **VCTK and LibriTTS-R (CC BY 4.0, attribution)**: ~5 female / ~5 male, spread over accents (US, English, Scottish, Irish, Indian, Australian/Canadian) and pitch/age; the Chatterbox `default_voice.wav` stays as an option. Described, not named (e.g. "Female · Scottish · warm, mid-pitch") |
| Voice hosting | Bundled with the site (`public/voices/`, ~4 MB), read through the TTS OPFS cache so they work offline |
| Voice choice | **One shared dropdown**: built-in voices with descriptions + "Your voice… (upload / record)"; used in single mode and for every conversation speaker |
| Script format | Tags `[S1]`–`[S4]` (case-insensitive, may be inline), shown as "Speaker 1–4"; number of speakers **detected from the script** (max 4) |
| Exaggeration | Each speaker has a default (slider on its card); `[exaggeration 0.8]` overrides it **for that turn only** |
| Pauses | Automatic gaps (0.5 s between speakers; 0.15 s / 0.4 s between a speaker's sentences / paragraphs); `[pause 1.5s]` / `[pause 500ms]` **replaces** the gap at that spot (0–10 s) |
| Markers in single mode | Yes — same parser; a "turn" is a line |
| Conversation placement | "Single voice / Conversation" switch inside the Speak tab |
| Output | One stitched WAV (play + Download) **and** "Download lines (.zip)": every line as its own WAV, numbered in order — `001-S1.wav`, `002-S2.wav`, … |
| Zip | Own store-only writer (no new dependency) |
| Uploaded voices | Memory only, not saved between visits |
| Long text | `MAX_INPUT_CHARS` 10,000; playback starts when gap-free **or after 20 s** (whichever first — short waits between parts allowed); finished parts kept on errors; lower memory |

## Findings from the analysis

- **Transformers.js already supports Chatterbox.** `ChatterboxModel` + `AutoProcessor` handle tokenisation, the
  autoregressive loop with KV cache, `repetition_penalty` 1.2, stop tokens `[2, 6562]`, speaker conditioning and the
  decoder (plus 3 trailing silence tokens). Resemble's own browser demo
  (`resemble-ai/transformersjs-chatterbox-demo`) uses exactly this.
- **Only `language_model` is quantised** in the repo; the other three sessions are fp32 only (verified from the repo
  tree). Transformers.js loads all four sessions up front, so the speech encoder (592 MB) can't be skipped.
- **Decoder initialisation looked like the main risk — S0 traced it to ONNX Runtime 1.31.**
  `conditional_decoder.onnx` has 23,934 nodes (4,585 MatMul, 545 Conv, 20 `If`, plus `STFT`, `RandomNormalLike`,
  `RandomUniformLike`) and 1,629 initializers. In Node (`onnxruntime-node` 1.31.1, CPU, arm64, 4 threads), reading
  its 509 MB of weights took 0.31–0.43 s, but creating the session took 61.7–82.7 s. ORT 1.32 does the same in
  2–6 s (native and web).
- **Offline graph optimisation doesn't help and can't ship.** `ORT_ENABLE_ALL` output is hardware-specific
  (NchwcTransformer warning), barely smaller (5.8 vs 6.4 MB graph), didn't speed up session creation, and would
  need self-hosting next to a > 100 MB weights file.
- **Output length:** one `generate` makes ≤ `max_new_tokens` (256) speech tokens, which is about 10 s of audio.
  Longer text has to be chunked.
- **Sample rate is 24 kHz** for both output and reference audio. The shared `useAudioCapture` hook is fixed at
  16 kHz today.
- **No watermark:** the Python package applies an optional Perth watermark; the ONNX/browser path doesn't.

## Phase overview

| Phase | Deliverable | Depends on |
|---|---|---|
| S0 | Browser feasibility spike: load + timing in Chrome (WebGPU and WASM) — **go/no-go** ✅ go | — |
| S1 | Shared Transformers.js groundwork + ORT ≥ 1.32 override ✅ | S0 |
| S2 | TTS engine: constants, capability check, worker, protocol, client ✅ | S1 |
| S3 | Speak tab MVP: default voice, text → audio, exaggeration, play, download ✅ | S2 |
| S4 | Your own voice: upload / record a reference, speaker cache ✅ | S3 |
| S5 | Long text: sentence chunking, progressive playback, Stop ✅ | S3 |
| S6 | ~~Stretch: CPU (WASM) fallback~~ — dropped after S0 (RTF 5–6) | — |
| S8 | Long-text upgrades: 10,000 chars, 20 s start cap, keep parts on error, lower memory ✅ | S5 |
| S9 | Built-in voice clips: curation tooling, quality gates, your approval, `public/voices/` + manifest + credits ✅ | S4 |
| S10 | Voice dropdown (single mode): built-in voices + "Your voice…", offline via the TTS cache ✅ | S9 |
| S11 | Script parser: `[S1]`–`[S4]`, `[pause …]`, `[exaggeration …]`, diagnostics, summary (pure, tested) ✅ | S5 |
| S12 | Conversation mode: speaker cards, per-chunk voice/exaggeration in the engine, stitching ✅ | S10, S11 |
| S13 | Zip of per-line WAVs (own store-only writer) ✅ | S12 |
| S7 | Hardening, docs, release — **runs last**, covering S8–S13 too | all |

Each phase ends with: `npm run build`, `npm run lint`, `npm test` green, and a manual browser check (Chrome + WebGPU).

---

## Phase S0 — Browser feasibility spike (go/no-go) ✅ (2026-11-14) — **GO, with ORT ≥ 1.32**

**Goal:** real numbers from the target environment before building anything. Throwaway code in `.data/spike/`
(gitignored): `vite.config.mjs` (spike server: serves `.data/models/` locally, optional COOP/COEP, optional ORT
1.32 dev alias), `index.html` + `spike.worker.js` (presets; times every session creation, voice encode, LM steps and
decoder), `inspect_decoder.py` (graph + native ORT init profile), `transcribe.mjs` (Whisper intelligibility check).
Nothing is merged.

- [x] Load `ChatterboxModel` + `AutoProcessor` in a worker with the S1 dtype map, `device: 'webgpu'` (`q4f16` and
      `q4`), and a mixed map with the decoder on `wasm`.
- [x] Measure session creation, cold load, `encode_speech`, time to first audio and real-time factor for 1, 2 and 4
      sentences. Peak memory: **not measured** — `performance.measureUserAgentSpecificMemory` isn't available in the
      VS Code browser (Electron) even when cross-origin isolated; measure with Chrome's task manager in S2.
- [x] Check which decoder ops fall back to the CPU on WebGPU, and whether the output is right (Whisper transcripts;
      `test.mjs` couldn't produce a reference — see below).
- [x] ~~If decoder session creation is > 10 s, try session-option variants~~ — not needed: the slowness is an ONNX
      Runtime 1.31 regression (below); on 1.32 the decoder initialises in ~6 s.
- [x] Record results in this plan and `docs/LEARNINGS.md`.

**Result** (MacBook, Apple GPU `metal-3`, `shader-f16`, 10 cores; VS Code browser = Chrome 150; model files served
locally, so "load" = reading + session creation, comparable to loading from OPFS):

1. **Decoder initialisation was an ONNX Runtime 1.31 regression, fixed in 1.32.** Same `conditional_decoder.onnx`,
   CPU, optimisation disabled: Python ORT **1.31.1 → 83.9 s**, **1.32.0 → 2.3 s** (`ORT_ENABLE_BASIC` 2.7 s,
   `ORT_ENABLE_ALL` 4.3 s); all of it in `session_initialization` (`model_loading_uri` 0.2 s). In the browser on
   WebGPU: `onnxruntime-web` **1.31.0-dev** (what Transformers.js 4.3.2 pins) **81.6 s**, **1.32.0-dev.20261110
   6.2 s**. `If` subgraphs are trivial (40 × 1 node), so the graph itself isn't the problem.
2. **Load (ORT 1.32 dev, WebGPU, `q4f16`): 10.2–11.6 s** for all four sessions (decoder 5.4–6.6 s, speech encoder
   1.1–1.2 s, embed 0.4–0.5 s, LM 0.2–0.3 s). Target ≤ 30 s ✅.
3. **Default voice encode:** 0.6 s (2.5 s on the very first run, incl. WebGPU shader compilation).
4. **Generation (WebGPU, `q4f16`):**

   | Text | Speech tokens | LM | Decoder | Total | Audio | RTF |
   |---|---|---|---|---|---|---|
   | 1 sentence (69 chars), first run | 115 | 3.2–4.0 s | 4.7–6.0 s | **8.0–10.0 s** | 4.64 s | 1.7–2.2 |
   | 1 sentence, warm | 115 | 2.8–3.0 s | 3.9–4.7 s | 6.7–7.6 s | 4.64 s | 1.45–1.64 |
   | 2 sentences (147 chars) | 231 | 6.0 s | 8.2–8.5 s | 14.2–14.6 s | 9.28 s | 1.53–1.57 |
   | 4 sentences (288 chars) | 256 (**cap hit**) | 6.8 s | 9.1–9.6 s | 16.0–16.4 s | 10.32 s (cut off) | 1.55–1.59 |

   First audio ≤ 10 s ✅. **RTF ≈ 1.5 > 1.0 target ❌** — generation is slower than playback. The LM runs at
   ~38 steps/s (≈ 1.5× real time on its own, 25 tokens/s of audio); the decoder takes ~60 % of the time.
   `q4` LM (no `shader-f16`): same picture — 8.3–10.0 s for one sentence, RTF 1.57–2.25.
5. **Cross-origin isolation doesn't matter on WebGPU:** without COOP/COEP (GitHub Pages conditions,
   single-threaded WASM) the numbers were the same (load 11.2 s, first sentence 8.0 s, warm 6.7 s).
6. **CPU is not viable:** decoder on WASM (4 threads, isolated) took **26–42 s** per chunk (RTF 5–6.4) with the LM
   still on WebGPU; single-threaded would be worse. → S6 is dropped.
7. **Placement on WebGPU:** 19,614 decoder nodes on WebGPU, 991 on CPU — almost all shape bookkeeping (`Gather`
   193, `Unsqueeze` 193, `Concat` 134, `Slice` 93, `Range` 56, …). Real compute on CPU: `STFT`,
   `RandomNormalLike` ×2, `RandomUniformLike` only.
8. **Output quality:** Whisper (`whisper-base.en`) transcribed every clip correctly (WER 0; 0.08–0.15 only from
   "Riverbank" → "River Bank"). The capped 4-sentence clip stops after "A light breeze" → chunking is required.
   Output is **not deterministic** (decoder samples noise) and **peaks reach 1.07–1.19** → needs peak limiting.
9. **Chunk size:** ~1.6–1.7 speech tokens per character → the 256-token cap is hit at ~150 chars. Use ≤ 120 chars
   per chunk (≈ 200 tokens, ≈ 8 s of audio).
10. **`test.mjs` is broken for `q4f16`:** it selects `language_model_q4f16` but feeds float32 KV-cache tensors
    (`Unexpected input data type … expected: (tensor(float16))`); its `float16Tensor` helper is unused. Its
    87.6 s initialisation reproduces the ORT 1.31 regression in Node.
11. **Gotcha:** with local models, `env.localModelPath` must be a path (`/tools/.data/models/`), not a URL —
    `get_file_metadata()` skips local lookups for `http(s)` URLs and the tokenizer silently isn't found.

**Decision: GO**, on condition that the app runs `onnxruntime-web` ≥ 1.32 (S1). No Transformers.js release ships it
yet (4.3.2 and 4.4.0-next.0 pin `1.31.0-dev.20260914`; npm `latest` is `1.31.1`, only 1.32/1.33 dev builds exist).
Because RTF > 1, long text can't be played back gap-free as soon as the first chunk is ready — S5 buffers first.

## Phase S1 — Shared Transformers.js groundwork ✅ (2026-11-15)

**Goal:** Gemma and Speak share the storage/runtime code without either depending on the other's constants, and
the app runs ONNX Runtime Web ≥ 1.32.

- [x] **ORT ≥ 1.32:** npm `overrides` in `package.json`: `onnxruntime-web` → `1.32.0-dev.20261110-53934832d`, and
      under `@huggingface/transformers` `onnxruntime-common` → `1.32.0-dev.20261105-527971bce` (Transformers.js
      imports `Tensor` from its own copy, which was 1.30.0; now it matches the web build, as in the spike).
      `ORT_RUNTIME_BYTES` = 29,950,319 + 53,959. `ORT_WEB_VERSION` records the pin and a unit test fails if the
      installed build differs. The ORT fix is in v1.32.0 (GitHub release 2026-11-13; PRs #33407, #33939, #34009,
      #34068, web #33563 — all contained in this dev build); npm had no `onnxruntime-web@1.32.0` yet on 2026-11-15 —
      switch both overrides to it when published, and drop them once Transformers.js pins ≥ 1.32.
      Pre-check (spike `gemma` preset, same local files): identical greedy answers for text, follow-up, image,
      audio, thinking and a long reply on 1.31 and 1.32; same load (11–13 s) and speed (21–28 tok/s).
- [x] **Stale runtime entries:** `pruneStaleOrtRuntime(dir)` deletes `ort-wasm-*` entries whose URL isn't one of
      the current `ORT_RUNTIME_URLS` (run when Gemma's cache details are read). "Stored" is now decided by
      `readyBytesFor(entries, dtype)` — that dtype's sessions + configs at the pinned revision + the current runtime —
      passed to `detectCapability({ readyBytes })`, instead of the sum of everything stored.
- [x] Shared module `src/lib/transformers/`: `opfsCache.ts` (`OpfsModelCache(dir, normalize)`, `opfsDir(name)`,
      `listOpfsEntries(dir)`, `removeOpfsEntries(dir, fn)`, `clearOpfsDir(name)`), `revision.ts`
      (`pinRevision(modelId, revision)`), `runtime.ts` (`ORT_RUNTIME_URLS`, `configureTransformers(env, cache)`,
      stale-runtime helpers), `constants.ts` (`ORT_WEB_VERSION`, `ORT_RUNTIME_BYTES`, `isOrtRuntimeUrl`; import-free).
- [x] Gemma's `opfsCache.ts` / `runtime.ts` / `constants.ts` are thin wrappers (`gemma-models` directory, existing
      exports and signatures kept), so existing downloads stay valid and imports don't change.
- [x] Gemma unit tests pass unchanged (119); +7 tests in `transformersShared.test.ts` (second directory/model,
      `pinRevision`, `removeOpfsEntries`, runtime URL matching, installed ORT version/size, ready bytes, stale
      runtime → download needed) → 126.

**Done when:** no Gemma behaviour change; the shared helpers are tested for a second directory/model.

**Result:** met. `tsc -b`, `npm test` (126), lint (no findings in changed files) and `npm run build` pass; the build
emits the 1.32 runtime (29,950 KB `.wasm` + 54 KB `.mjs`) and the main chunk has no ORT/Transformers.js code.
Verified with the production build (`vite preview`) in the VS Code browser, huggingface.co and jsDelivr blocked:
OPFS seeded like an existing user's (all 15 Gemma `q4f16` files, 3,401,448,435 bytes, + a 26.9 MB runtime entry
under an older build's URL) → the stale entry was pruned (storage bar 3.17 GB) and the gate offered
"Download 28.6 MB" (= the new runtime; the old byte-sum check would have said "stored" and failed offline) →
Ready in 13.6 s with zero Hugging Face/CDN requests, runtime cached under its new URLs → reload: auto-loaded from
storage in 12.1 s with zero Hugging Face/CDN/runtime requests; "The capital of France is Paris." at 21.7 tok/s.
Test data was removed from the browser afterwards. Not covered here: the `q4` path (needs a GPU without
`shader-f16`). Note: the first `npm install` after adding `overrides` only rewrote the lockfile; a second one
installed the overridden packages — check `npm ls onnxruntime-web`.

## Phase S2 — TTS engine ✅ (2026-11-15)

**Goal:** a working worker + client with no UI beyond the gate.

- [x] `src/lib/tts/constants.ts`: model id, revision, exact sizes per dtype (`TTS_SIZES`), `ttsTotalBytes(dtype)`
      (1,530,150,243 / 1,579,032,606 bytes), `ttsDtypeMap`, `isTtsFileFor`, sample rate, limits
      (`MAX_NEW_TOKENS` 256, `MAX_CHUNK_CHARS` 120, `MAX_INPUT_CHARS` 5,000, `MAX_REFERENCE_SECONDS` 10).
- [x] `src/lib/tts/capability.ts`: Gemma's pure detection moved to `src/lib/transformers/capability.ts`
      (`detectWebGpuCapability({ feature, totalBytes }, opts)`); Gemma and Speak wrap it ("Chat/Speak needs WebGPU…").
- [x] `src/lib/tts/protocol.ts` + `tts.worker.ts`: `load` / `encodeVoice` / `synthesize` / `stop` / `unload`, request
      ids, idempotent load, one job at a time (`busy`), aggregated progress, error codes (`no-voice` added), device-loss
      watch and cache warnings. Shared with Gemma now: `classifyError` / `describeCacheFailures(failures, name)`
      (`src/lib/transformers/errors.ts`) and `createDeviceWatch(env, onLost)` (`device.ts`).
- [x] `src/lib/tts/client.ts`: singleton worker + `useTts()`; `encodeVoice` transfers the PCM; `synthesize(chunks,
      voiceId, exaggeration, onChunk)` streams chunks. `cache.ts` (`tts-models/` OPFS dir, stale-runtime pruning,
      per-dtype ready bytes) + `hooks.ts` (`useTtsCache`, `useTtsCapability`).
- [x] Default voice: fetched from the pinned revision through the same OPFS cache, parsed in the worker
      (`audio.ts` `parseWav`: PCM 16/24/32, float32, extensible, any channels), encoded once as `default`.
- [x] Speak tab shell in `EdgeAiStudioTool` (5th tab, `AudioLines` icon) with its gate; the capability check runs only
      once the tab is first opened; storage menu gets "Speak model (Chatterbox)". `useOnline` and `DeviceSummary`
      moved out of `ChatTab` to share them.
- [x] **Added — Transformers.js 4.3.2 quirks** (both made every load send requests to Hugging Face, which fail
      offline): the repo's `config.json` has no `architectures`, so the progress-total pass probed a non-existent
      `onnx/model.onnx(_data)` → the worker loads the config and passes it with `architectures: ['ChatterboxModel']`;
      that pass then looked dtypes up by session key (`model`) and probed the fp32 `language_model.onnx(_data)` →
      `ttsDtypeMap` also sets `model`. See docs/LEARNINGS.md.
- [x] Tests: `ttsEngine.test.ts` (+18: sizes, dtype map, file matching, ready bytes vs stale runtime, capability
      messages, WAV parsing for every encoding + the real default voice, resampling) → 144 total; Gemma tests unchanged.

**Done when:** Download → Ready on a WebGPU browser; reload loads from OPFS with zero network requests; other tabs
unchanged; Transformers.js not in the main chunk.

**Result:** met (VS Code browser = Chrome 150, Apple GPU, `q4f16`, dev server). Real first download from
huggingface.co → "Ready · runs offline" with the default voice encoded; `tts-models/` holds exactly the 14 repo
files (only `language_model_q4f16`) + the runtime, storage bar 1.43 GB. Reload with huggingface.co/jsDelivr blocked:
Ready with **zero** Hugging Face/CDN requests and no warnings; load 12.9 s (model 10.2 s, voice 0.6 s) over three
runs. Engine through the app's `tts` client: 2 chunks → first audio 7.7 s, 4.64 + 3.08 s of audio, 114 + 75
speech tokens, RTF 1.76; Stop after chunk 1 of 3 → `stopped`, only chunk 0 delivered; a second job → `busy`;
`encodeVoice` 262 ms and synthesis with that voice works; unknown voice → `no-voice`. Chat/Listen tabs unchanged;
build: `tts.worker` 559 KB chunk, main chunk has no Transformers.js/ORT code. Note: four earlier reloads took
31–34 s with the same code (unexplained — not reproducible afterwards; watch load times in S3). In `vite dev` the
runtime URL is unhashed (`/tools/node_modules/onnxruntime-web/dist/…`), so stale-runtime pruning can't detect an
older ORT build stored under it there — clear the model once in dev after an ORT change (production URLs are hashed).

## Phase S3 — Speak tab MVP ✅ (2026-11-15)

- [x] Text area (fixed height, character count `n / 120`), Speak / Stop (Ctrl/⌘+Enter, Esc), exaggeration slider
      (0–1.5, step 0.05, default 0.5). Typing works before the model is loaded; Speak is enabled once it's ready.
- [x] Single-chunk generation with the default voice. Limit is `MAX_CHUNK_CHARS` (120), not 200: S0 showed the
      256-token cap is hit at ~150 chars. Over the limit the counter turns red, `aria-invalid` is set and Speak is
      disabled. Long text (sentence chunking) is S5.
- [x] Playback via `<audio>` (WAV blob from `encodeWav(pcm, 24000)`), started automatically after generation; Download
      WAV as `speech-<yyyyMMdd-HHmmss>.wav`.
- [x] **Brought forward from S5:** peak limiting to −1 dBFS (`limitPeak` in `audio.ts`) — S0 single sentences already
      peaked at 1.07–1.19 and would clip in the WAV.
- [x] Stats row: audio length, generation time, × real time, speech tokens; flags "may be cut off — shorten the text"
      (`hitCap`) and "tab was in the background" (`useHiddenWhile`, now shared with Chat).
- [x] Status line with an elapsed timer while generating; screen-reader announcements ("Generating speech…",
      "Audio ready, 4.6 seconds.", "Stopped."). Stop keeps the previous clip.
- [x] Generated clip stays when switching tabs (panel stays mounted); blob URLs are revoked when replaced/unmounted.

**Done when:** a sentence becomes playable, downloadable audio that matches `test.mjs` output quality; layout never
shifts while generating.

**Result:** met (VS Code browser = Chrome 150, Apple GPU, `q4f16`, dev server). "The quick brown fox … riverbank."
→ 4.6 s of audio in 7.9 s (1.70× real time, 114 speech tokens), played automatically to the end; Download WAV
222,764 bytes (24 kHz, 16-bit mono). A second sentence at exaggeration 0.8 → 4.8 s in 9.8 s (119 tokens). Quality
(`test.mjs` can't run `q4f16` — see S0, so Whisper as in S0): both clips transcribed word for word ("…Quiet River
Bank." / "Meanwhile, the old farmer watched from the porch, sipping his morning coffee."); peaks exactly −1 dBFS
(limiter engaged). Layout: text area, button row, output card and hint at identical positions before, during and
after generating. Esc mid-generation → "Stopped.", previous clip kept; tab switch keeps clip and text; 121 chars →
red counter, Speak disabled. Tests +3 (`limitPeak`, `speechFileName`) → 147. Main chunk +5 KB, no model code.

## Phase S4 — Your own voice ✅ (2026-11-15)

- [x] Voice picker (`VoicePicker.tsx`, fixed-height card next to the text box, below it on narrow screens):
      "Default" · "Your voice" (Record / Upload audio / drop onto the card) via `useAudioCapture(…, { sampleRate:
      24000 })`; `decodeAudio(blob, sampleRate)` gained the rate parameter (Listen/Chat keep 16 kHz).
- [x] Reference clip trimmed to `MAX_REFERENCE_SECONDS` (10 s) with "(first 10 s)"; hint under 3 s ("longer clips
      (5–10 s) clone better"); silent clips rejected (`isSilent`, peak < −40 dBFS); preview player plays exactly the
      trimmed PCM that's encoded; remove (×).
- [x] `encodeVoice` once per clip (id `voice-n`), as soon as the clip is added (or on the first Speak if the model
      wasn't loaded yet); status "Preparing your voice…" → "Voice ready". If the worker lost its speaker cache
      (restart after GPU loss / Retry), Speak gets `no-voice`, re-encodes the kept PCM once and retries.
- [x] Consent note in the card: "Only use voices you have permission to use. Your clip stays on this device and isn't
      saved."
- [x] Reference audio stays in memory only (the PCM in component state; blob URLs revoked on replace/unmount).
- [x] Speak disabled while there's no clip in "Your voice" mode or while the voice is being prepared; picker locked
      while generating or recording. Output stats say "your voice" / "default voice".

**Done when:** an uploaded and a recorded voice each produce speech that clearly follows the reference.

**Result:** met (VS Code browser = Chrome 150, Apple GPU, `q4f16`, dev server). References: macOS `say` voices
Samantha (female, 6.7 s) and Daniel (male, 7.4 s), 24 kHz. Same sentence each time. Speaker similarity (cosine of
Chatterbox's own `speech_encoder` `speaker_embeddings`, `.data/spike/speaker_sim.py`) — each output is clearly
closest to its own reference:

| Output | vs default voice | vs female ref | vs male ref |
|---|---|---|---|
| Default voice | **0.923** | 0.488 | 0.520 |
| Uploaded female (file input) | 0.544 | **0.929** | 0.591 |
| Recorded (female) | 0.565 | **0.939** | 0.608 |
| Dropped male (drag & drop) | 0.579 | 0.548 | **0.906** |
| Male after simulated GPU loss + Retry (re-encoded) | 0.537 | 0.521 | **0.904** |

All five transcribe word for word with Whisper. Generation 6.7–8.2 s for 4.2–4.9 s of audio (1.55–1.77× real time),
voice encode < 0.3 s. Long clip (10.3 s) → "long.wav · 10.0 s (first 10 s)", preview 10.00 s. Silent clip → "This
clip is silent — check the microphone or pick another file." Speak button at the same position in every picker
state. **Recording caveat:** the VS Code integrated browser (Electron) can't decode its own MediaRecorder output —
`decodeAudioData` and `<audio>` fail for WebM/Opus, WebM/PCM and MP4/Opus alike (also at 16 kHz, so Listen/Chat
recording is equally affected there; see LEARNINGS). The Record flow was therefore verified with `MediaRecorder`
stubbed to "record" the female WAV — button → timer → Stop → 24 kHz decode → encode → speech. The real mic +
Opus decode path is unchanged code from Listen/Chat; check it once in desktop Chrome. Tests +1 (`isSilent`) → 148.

## Phase S5 — Long text ✅ (2026-11-15)

- [x] `splitIntoChunks(text)` (`chunk.ts`, pure, 12 tests): paragraphs (blank lines) → sentences (abbreviations,
      initials and decimals don't split) → clause/space splits for sentences > 120 chars. **Added:** consecutive short
      sentences in a paragraph are merged up to 120 chars — each chunk is a separate generate call.
- [x] Chunks are generated in order into a playback queue on one `AudioContext` (`SpeechPlayer` in `playback.ts`),
      with 0.15 s silence between sentences and 0.4 s between paragraphs. Playback starts at
      `playbackStartDelay(plan)` — the earliest start that keeps every chunk ready before it's due, from the finished
      chunks' real timings and the measured RTF (projected 0.066 s of audio per char; +0.5 s margin) — re-checked
      after each chunk and by a timer. The card shows "Part n of m · Preparing audio — playback starts in about X s",
      then "Playing".
- [x] Each chunk is peak-limited (`limitPeak`) before playback and joining.
- [x] Chunks that hit `max_new_tokens` are regenerated **in the worker** as two halves (`splitInHalf`: clause break
      near the middle, else the nearest space) and joined with 0.1 s of silence, so chunk order and streaming are
      kept; `ChunkStats.resplit` / `hitCap` feed "n parts re-split" / "n parts may be cut off".
- [x] Progress "Part n of m" (bar + status line); Stop / Esc interrupts the current chunk, stops playback and keeps
      the finished chunks; Download (and the `<audio>` player) holds the finished chunks joined with their pauses.
      After generation, live playback continues; "Stop playback" stops it, and playing the `<audio>` stops it too.
- [x] Input cap 5,000 chars with a counter.

**Done when:** a 3-paragraph text plays without gaps or clicks once playback starts, and Stop + Download give the
finished part.

**Result:** met (VS Code browser = Chrome 150, Apple GPU, `q4f16`). 3-paragraph story (498 chars) → 6 parts:
estimate counted down 30 → 17 → 3 s, playback started at ~30 s, generation finished at 57 s (33.1 s of audio,
1.80× real time), **0 stalls** recorded by the player. Joined WAV (`joins.py`): every sample next to a pause is 0.0000
(each chunk fades to silence on its own) → no clicks; peak −1 dBFS. Whisper (in two halves — its 30 s window
truncated the whole file) transcribed every sentence; remaining differences are formatting ("Seven" → "7",
"three thousand" → "3,000"). Stop during part 3 → "stopped — first 2 of 6 parts", 9.3 s; the Download is exactly the
first two parts (Whisper: "The city had been empty for years. Rain fell … every room."); playback stopped.
Re-split: a 258-char chunk sent straight to the engine hit the cap, was regenerated as two halves (376 tokens,
`hitCap: false`) → 15.3 s, full sentence transcribed; 41.5 s because the capped first attempt is wasted (the chunker
keeps parts ≤ 120 chars, so this should be rare). Output card fits at 899 px (867×128, no overflow); below `sm` the
two buttons are icon-only. Tests +18 (`ttsChunk`, `ttsPlayback`) → 166.

## Phase S6 — ~~Stretch: CPU (WASM) fallback~~ (dropped after S0)

S0 measured the decoder on WASM (4 threads, cross-origin isolated) at 26–42 s per chunk (RTF 5–6.4), and
GitHub Pages can't enable multi-threading. Browsers without WebGPU get the gate's "needs WebGPU" message.

## Phase S8 — Long-text upgrades ✅

**Goal:** 10,000-char input without a multi-minute wait before audio, and without losing work on errors.

- [x] `MAX_INPUT_CHARS` 5,000 → 10,000 (counter, hint, docs).
- [x] Start cap: `maybeStart` also starts when **≥ 1 part is ready and 20 s have passed** since Speak
      (`MAX_START_WAIT_SECONDS`). Gap-free start still wins when it's earlier. Waits at part boundaries are counted
      ("playback waited n×") as today. Card: "playback starts in about X s" uses `min(planned, cap)`.
- [x] Keep finished parts on errors (GPU loss, quota, …): the error shows **and** the clip/Download holds the finished
      parts ("stopped by an error — first n of m parts"), like Stop.
- [x] Memory: drop per-part PCM copies once joined; `SpeechPlayer` releases each `AudioBuffer` after it has played
      (peak at 10,000 chars ≈ 100 MB instead of ≈ 220 MB). Measure with `performance.memory` in Chrome.
      *As built:* parts are kept as Int16 (`toPcm16`, half the size) and the WAV is assembled by `wavFromParts`
      straight from the parts (no joined copy); `SpeechPlayer` disconnects each source in `onended`.
- [x] Note under the output card when the tab was hidden during a long job (browsers throttle background GPU work).
      *As built:* `usePageHidden()` adds " · Keep this tab visible for full speed" to the status line while hidden.
- [x] Tests: start-cap rule in `ttsPlayback.test.ts`; error keeps parts (client/SpeakTab logic extracted where
      practical).

**Done when:** a ~10,000-char text starts playing within ~20 s of the first part, plays to the end (waits allowed and
counted), Download is complete; an error mid-way leaves the finished parts downloadable.

**Result (2026-11-15):**

- Error test (simulated GPU loss after 2 of 6 parts): error + Retry shown, clip kept — "stopped by an error — first 2
  of 6 parts", WAV 9.31 s.
- Long run, 9,721 chars → 124 parts: playback started at ≈ 21 s (the cap); generation 1,160.8 s for 674.1 s of audio
  (1.80× real time); playback waited 94× (470.2 s total, expected with the cap); 2 parts re-split; WAV 32.4 MB /
  674.1 s, complete. JS heap 75 MB → peak 135 MB → 106 MB after (≈ 60 MB for the job, under the 100 MB target).
- Join check (`joins.py`): 239 pauses, no clicks (max sample next to a pause 0.0001). Whisper on the last 25 s matches
  the end of the text.
- Footer hint now says playback starts within about 20 s and long texts may pause between parts.
- 171 unit tests (+5), tsc, oxlint, build clean; TTS code stays out of the main bundle.

## Phase S9 — Built-in voice clips ✅

**Goal:** 8–10 good, distinct, licensed reference voices shipped with the site.

- [x] Tooling in `.data/scripts/voices/` (gitignored, not shipped):
  - fetch metadata + only the needed audio: VCTK 0.92 speaker info (gender, age, accent) and shortlisted speakers'
    files; a LibriTTS-R subset (dev/test-clean, 24 kHz) with speaker gender from `speakers.tsv`;
  - shortlist ~14 candidates by gender/accent/pitch; build an 8–10 s clip per speaker from 2–3 clean sentences;
    resample to 24 kHz mono, trim leading/trailing silence, loudness-normalise (≈ −20 LUFS), peak ≤ −1 dBFS;
  - quality gates per candidate: (a) distinct from the others (Chatterbox `speech_encoder` speaker-embedding cosine
    < 0.75 to every other kept voice); (b) cloning works (generate a fixed test sentence → similarity to the reference
    ≥ 0.85); (c) Whisper transcribes the test sentence word for word; report pitch (median F0) for the description.
- [x] **Your approval:** a listening page in `.data/` with each candidate's reference + test output and its stats;
      you pick the final 8–10 and approve the descriptions.
- [x] Ship `public/voices/<id>.wav` (16-bit PCM, ~400 KB each, ~4 MB total) and `public/voices/voices.json`.
- [x] Credits: "Built-in voices: VCTK (CSTR, University of Edinburgh) and LibriTTS-R (Google), CC BY 4.0" in the Speak
      tab footer and the README; `voices.json` keeps dataset + speaker id + licence per voice.

**Done when:** approved voices are in `public/voices/` with a manifest, every gate passes, credits are visible.

**Result (2026-11-15):**

- Sources fetched without the full archives: VCTK from the `sanchit-gandhi/vctk` parquet mirror (metadata index of
  all 88,156 rows, then one 100-row group per speaker, mic1 only); LibriTTS-R utterances picked from the
  `parler-tts/libritts-r-filtered-speaker-descriptions` quality table (8–10.5 s, clean, close-mic, PESQ ≥ 3.6) and
  fetched from `mythicinfinity/libritts_r`. Tooling in `.data/voices/` (`vctk_index.py`, `vctk_fetch.py`,
  `libritts_fetch.py`, `build.py`, `clone.mjs`, `whisper.mjs`, `gates.py`, `review.py`, `export.py`).
- 38 candidates (29 VCTK across 12 accents, 9 LibriTTS-R). Clones generated in Node (CPU, q4 — the worker's calls).
- **Gate changes found while running them:** one test sentence was too noisy (the same clip scored 0.62 and 0.79
  on two sentences), so the cloning gate is the **mean over 2 sentences**. VCTK clips built from 3 short sentences
  cloned worse than 2 longer ones (e.g. p262 0.77 → 0.89, p294 0.80 → 0.88), so each VCTK speaker keeps the better
  of a *short* and a *long* variant. Added a fourth check: < 0.75 similarity to the Chatterbox default voice (this
  removed `ltts-3000`, 0.79).
- 29 / 38 passed (all transcripts word-perfect; the 9 failures were clone similarity 0.76–0.85 — incl. both
  Scottish men). Baseline: the default voice clones at 0.92.
- **Approved by you (the recommended 10):** female American (LibriTTS-R, narration), English, Indian, Irish,
  Scottish; male American ×2 (LibriTTS-R, narration), Australian, English, Indian. Clone similarity 0.856–0.929;
  max pairwise 0.70; max vs default 0.62. 4.11 MB total (376–453 KB each, 8.0–9.7 s).
- `.gitignore` gains `!public/voices/*.wav`; credits in the Speak footer (linked) and README;
  `tests/unit/ttsVoices.test.ts` checks the manifest against the clips (format, length, peak, licence) — 193 tests.
- Clones were checked with the Node CPU q4 path; the WebGPU q4f16 path is exercised when S10 wires the dropdown.

## Phase S10 — Voice dropdown (single mode) ✅

- [x] `VoiceSelect` (shared component): native `<select>` with option groups (Built-in · Your voice), each option
      "Female · Scottish — warm, mid-pitch"; the selected voice's description + ▶ preview under it; the last option
      "Your voice… (upload / record)" reveals the existing upload/record/drop UI (from `VoicePicker`).
- [x] Worker: `encodeBuiltinVoice(id)` — fetches `/tools/voices/<id>.wav` via `fetchCached` (stored in
      `tts-models/`, so offline works), parses, encodes, caches as `builtin:<id>`; encoded on first use (~0.3 s).
      The Chatterbox default stays `default` (encoded at load).
- [x] `voices.json` ~~loaded by the main thread~~ *bundled with the app (`src/lib/tts/voices.json`) — offline, no loading state*; unknown/failed voice → error note,
      falls back to Default.
- [x] Remember the last selected built-in voice in `localStorage` (not the uploaded audio).
- [x] Storage: built-in voice clips count towards Speak's stored size; Clear removes them with the model.

**Done when:** every built-in voice can be picked and previewed, speech follows it (similarity check as in S4),
and it works offline after first use.

**Result (2026-11-15):** `VoiceSelect` replaces `VoicePicker` (its upload/record/drop UI is the "Your voice…" part);
worker `encodeBuiltin`; clip URLs versioned by content hash (`?v=`), outdated stored clips pruned; choice remembered
in `localStorage`. In the browser (WebGPU q4f16) all 11 voices spoke the test sentence closest to their own reference
(0.84–0.94, margin ≥ 0.13), Whisper word-perfect; offline (Hugging Face + `/tools/voices/` blocked) the remembered
voice was restored, previewed from storage and spoke; a missing clip offline showed an error and fell back to
Default. 196 unit tests (+3: remembered choice, fallback, URL versioning/stale clips; + clip hash check), tsc, oxlint,
build clean. Details: SPECIFICATIONS.md §S18.1.

## Phase S11 — Script parser ✅

- [x] `script.ts`: `parseScript(text, { mode: 'single' | 'conversation' })` →
      `{ turns: Turn[], speakers: number[], diagnostics: Diagnostic[], summary }` with
      `Turn = { speaker: 1–4, text, exaggeration?, pauseBefore?, line }`. Pure, heavily unit-tested.
- [x] Syntax (case-insensitive): `[S1]`–`[S4]` start a turn (anywhere, also inline); `[pause 2s]`, `[pause 1.5 s]`,
      `[pause 500ms]` (0–10 s; replaces the automatic gap at that spot; inside a turn it splits the turn there);
      `[exaggeration 0.8]` (0–1.5; applies to the turn it's in).
- [x] Single mode: no speaker tags; each line is a turn for exaggeration markers; pauses as above.
- [x] Diagnostics with line numbers, shown under the text box: `[S5]`+ → error (Speak disabled); value out of range →
      error; unknown `[…]` → warning "will be read aloud" (Chatterbox has no `[laughs]`-style tags); text before the
      first tag in conversation mode → warning, assigned to Speaker 1; `[S2]` in single mode → hint "Switch to
      Conversation"; empty turns dropped.
- [x] Summary line: "3 speakers · 14 turns · about 1 min 40 s of audio" (0.066 s/char).
- [x] Turns are chunked with the existing `splitIntoChunks` (≤ 120 chars); a turn's sentence/paragraph pauses apply
      inside it.

**Done when:** the parser handles the documented syntax and edge cases (tests), and diagnostics appear while typing.

**Result (2026-11-15):** `src/lib/tts/script.ts` (`parseScript`, `planChunks`, `formatDuration`) + `ScriptNotes`.
Markers already work in single mode: `[pause]` adds silence, `[exaggeration]` applies per line — for that the worker's
`synthesize` now takes per-chunk exaggeration (pulled forward from S12; the voice stays per call). Marker-free text is
chunked exactly as before. In the browser: diagnostics while typing (errors first, "Line n" jumps), Speak disabled on
errors; a marked-up script generated with the right per-chunk exaggeration, a 2 s pause, and a word-perfect
transcript. 214 unit tests (+18), tsc, oxlint, build clean. Details: SPECIFICATIONS.md §S19.4.

## Phase S12 — Conversation mode ✅

- [x] Switch "Single voice / Conversation" in the Speak tab; text and settings kept per mode.
- [x] Speaker cards for the speakers found in the script (1–4, in order of first appearance): "Speaker n" +
      `VoiceSelect` + default exaggeration slider; cards appear/disappear as tags are added/removed (fixed-height
      area so the layout doesn't jump); a speaker without a usable voice blocks Speak with a note.
- [x] Engine: `synthesize` takes per-chunk `{ text, voiceId, exaggeration }` (single mode passes the same voice for all
      chunks); all voices used are encoded before generation starts; re-encode-on-`no-voice` per voice.
- [x] Stitching: chunks → turns (joined with intra-turn pauses) → conversation (automatic 0.5 s speaker-change gap,
      or the `[pause]` value). Same buffered playback (S5/S8).
- [x] Output card: stitched player + Download WAV + ~~"Download lines (.zip)"~~ *(added in S13)*; stats incl. turns per speaker;
      transcript-free in v1.
- [x] Single mode unchanged apart from the dropdown and markers.

**Done when:** a 3-speaker script with pauses and exaggeration overrides plays in order with the right voices (speaker
similarity per turn), and the stitched WAV matches the turn order.

**Result (2026-11-15):** `useVoiceSlot` (voice logic per slot, shared encode queue), `SpeakerCards`, per-chunk voice in
the worker, mode switch with text kept per mode, per-speaker remembered voices with distinct defaults. In the browser
a 3-speaker script with pause and exaggeration markers generated with the right voice/exaggeration per chunk; every
part was closest to its own speaker (0.66–0.83 vs ≤ 0.45); the stitched WAV is exactly the parts in turn order with
the planned 0.5 / 1.5 / 1.0 / 0.5 s gaps; Whisper word-perfect. 215 unit tests, tsc, oxlint, build clean. Details:
SPECIFICATIONS.md §S20.4.

## Phase S13 — Zip of per-line WAVs ✅

- [x] `zip.ts`: store-only ZIP writer (local file headers, CRC-32, central directory, end record; ZIP64 not needed —
      < 4 GB); returns a `Blob`. Pure + tests (CRC-32 vectors, structure, round-trip through a minimal reader).
- [x] One file per turn, numbered in order with zero-padding to the line count: `001-S1.wav`, `002-S2.wav`, …
      (single mode: `001.wav`, `002.wav`, … **per paragraph** — decided 2026-11-15); pauses are not separate files.
- [x] "Download lines (.zip)" next to Download WAV; name `speech-<date>-<time>.zip`.
- [x] Manual check: the zip opens in macOS Archive Utility (`ditto`) and other readers; files play. *Windows Explorer → S7.*

**Done when:** the zip opens in standard tools and its files, in name order, match the stitched conversation.

**Result (2026-11-15):** `zip.ts` (store-only writer, incremental CRC-32 over WAV pieces — no joined copies),
`lines.ts` (parts → per-line WAVs), `ScriptChunk.line`, "Download lines (.zip)" when there are ≥ 2 lines. A 5-line
3-speaker conversation zipped as `001-S1.wav` … `005-S3.wav`; `unzip -t`, Python `zipfile`, `ditto` and `afinfo` all
accept it, and the files in name order are byte-identical to the stitched WAV minus the gaps. 225 unit tests (+10:
CRC vectors, round-trip reader, DOS time, line grouping/naming, rejoin = stitched), tsc, oxlint, build clean.
Details: SPECIFICATIONS.md §S21.1.

## Phase S7 — Hardening & release

- [ ] Error paths (same set as Gemma Phase 7): quota before/during download, network drop + Retry, device lost,
      offline with model not stored, tab backgrounded during generation.
- [ ] GPU memory with Gemma also loaded: hint in the Speak gate when Chat's model is loaded (and vice versa);
      device-lost message suggests unloading the other model.
- [ ] Accessibility: labelled controls, status announcements ("Generating chunk 2 of 5", "Audio ready"), Esc stops,
      progress bar labels.
- [ ] `docs/LEARNINGS.md` entries for anything non-obvious found in S1–S7.
- [ ] Update `src/tools.ts` description and the Edge AI Studio intro text to mention speech generation.
- [ ] Move `onnxruntime-node` from `dependencies` to `devDependencies` (used only by `.data/scripts`).
- [ ] Covers S8–S13 too: conversation mode and dropdown accessibility (labels, announcements per part/turn),
      diagnostics announced politely, zip/voice-loading errors.
- [ ] Manual: open a "Download lines (.zip)" in Windows Explorer (not testable on the dev Mac; S13 verified `unzip`,
      Python `zipfile`, `ditto`).

**Done when:** all error paths are verified (or covered by unit tests where they can't be reproduced), offline
load verified with huggingface.co blocked.

## Speak risks

| Risk | Mitigation |
|---|---|
| Decoder session creation 60–80 s | ✅ S0: ORT 1.31 regression; ORT ≥ 1.32 override (S1) → ~6 s |
| Running a dev build of `onnxruntime-web` until 1.32.0 is stable | Pin the exact build; re-verify Gemma in S1; switch to stable as soon as it's published |
| Generation slower than playback (RTF ≈ 1.5) | Buffer before playing (S5); show progress; Download for long texts |
| WebGPU op coverage (`If`, `STFT`, random ops) | ✅ S0: only shape ops + `STFT`/random ops on CPU |
| 1.5 GB download, 592 MB of it only for voice cloning | Show size up front; OPFS + `storage.persist()`; revisit if Transformers.js allows skipping a session |
| GPU memory with Gemma (≈ 3.2 GB) also loaded | Hint + device-lost handling; unload option |
| ≤ ~10 s audio per generation | Chunks ≤ 120 chars (S5) |
| Voice-cloning misuse | Consent note; nothing uploaded; no persistence of reference audio in v1 |
| No watermark in browser output | Documented; not in scope |
| Transformers.js API changes | Same pinned 4.3.2; all model calls isolated in the worker |
| Built-in voices are real people's voices (dataset speakers) | CC BY 4.0 permits redistribution with attribution; speakers consented to research recordings; described, not named; consent note stays; credits in UI + README |
| Clip quality (VCTK sentences ~3 s; LibriTTS-R audiobook style) — Chatterbox copies accent and recording quality | Join 2–3 sentences per voice; quality gates (S9); your listening approval before shipping |
| Conversations are slower per second of audio (short turns, ≥ 1 generate call per turn, no merging across speakers) | 20 s start cap (S8); progress per part; Download lines for long dialogues |
| Long jobs (10,000 chars ≈ 20 min generation) | Start cap, keep parts on error, memory release (S8); background-tab note |
