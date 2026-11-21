# Gemma Chat — Technical Specification

> This file has two specs: **Gemma Chat** (§1–15, below) and
> **[Speak (Chatterbox TTS)](#speak-chatterbox-tts--technical-specification)** (§S1–S21, S0–S5 and S8–S13 done; S7 hardening next).

Companion to [PLAN.md](./PLAN.md). Describes how the Chat tab of Edge AI Studio is built. Facts marked
*(verified)* were checked against the model repo / npm package on 2026-11-12.

## 1. Model and runtime

| Item | Value |
|---|---|
| Model repo | `onnx-community/gemma-4-E2B-it-ONNX` (Apache 2.0) *(verified)* |
| Library | `@huggingface/transformers` `4.3.2`, pinned *(verified: exports `Gemma4ForConditionalGeneration`, `InterruptableStoppingCriteria`, `read_audio`)* |
| Model class | `Gemma4ForConditionalGeneration` + `AutoProcessor` |
| Default dtype | `q4f16` (needs WebGPU `shader-f16`); fallback `q4` |
| Device | `webgpu`; stretch fallback `wasm` |
| Thinking | `apply_chat_template(..., { enable_thinking })` |
| Pinned revision | `6f21c99d7e18237f8d2ce92aadfdbfeba877f63a` (`GEMMA_REVISION` in `src/lib/gemma/constants.ts`) — pass as `revision` to every `from_pretrained` so cache keys and sizes stay stable |

### 1.1 Download sizes (`q4f16`, verified from the repo tree)

| ONNX session | Files | Size | Loaded |
|---|---|---|---|
| Decoder | `decoder_model_merged_q4f16.onnx(_data)` | 1.52 GB | Up front |
| Token embeddings | `embed_tokens_q4f16.onnx(_data)` | 1.59 GB | Up front |
| Vision encoder | `vision_encoder_q4f16.onnx(_data)` | 0.10 GB | Up front |
| Audio encoder | `audio_encoder_q4f16.onnx(_data)` | 0.17 GB | Up front (can't be deferred — see below) |
| **Total** | | **≈ 3.4 GB** | |

`q4` sizes (no `shader-f16`): decoder 1.86 GB, embeddings 1.76 GB, vision 0.11 GB, audio 0.19 GB (≈ 3.9 GB).

Also downloaded: model config + tokenizer files (19.5 MB, mostly `tokenizer.json`) and the ONNX Runtime asyncify
runtime from this site (ORT 1.32 dev since Speak S1: 30.0 MB `.wasm` + 54 KB `.mjs`; was 26.9 MB with 1.31).
`gemmaTotalBytes(dtype, { withAudio })` in `constants.ts` is the single source for all of these (exact byte counts
at the pinned revision; the runtime size is `ORT_RUNTIME_BYTES` in `src/lib/transformers/constants.ts`).

> **Resolved (Phase 1):** Transformers.js 4.3.2 has no public way to defer the audio encoder for
> `Gemma4ForConditionalGeneration`. Its session map (`MODEL_SESSION_CONFIG[ImageAudioTextToText]`) loads
> `embed_tokens`, `decoder_model_merged`, `vision_encoder` and `audio_encoder` together; the only alternative is
> text-only mode (`…ForCausalLM`), which also drops vision. So the first download includes audio:
> `GEMMA_LOADS_AUDIO = true`, ≈ 3.19 GB (q4f16) incl. runtime and config. Phase 3 only wires audio input — no
> second download.
>
> Note: the tokenizer loader requests `tokenizer_config.json` from `resolve/main` even when `revision` is set
> (observed in the network log); all other files use the pinned revision.

### 1.2 Hosting & network

- **Weights:** `https://huggingface.co/` (Transformers.js `env.remoteHost`). Files exceed GitHub Pages' 100 MB/file
  limit, so they cannot live in `public/`.
- **ORT runtime:** Transformers.js imports `onnxruntime-web/webgpu` and, by default, fetches
  `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` from `cdn.jsdelivr.net` *(verified)*. `src/lib/transformers/runtime.ts`
  (shared since Speak S1; `src/lib/gemma/runtime.ts` wraps it with Gemma's cache)
  imports both via Vite `?url` (package exports `onnxruntime-web/ort-wasm-simd-threaded.asyncify.{wasm,mjs}`) and
  `configureTransformers(env, cache)` sets `env.backends.onnx.wasm.wasmPaths = { mjs, wasm }` (absolute URLs). Must be
  called in the worker before any `from_pretrained`. With `env.useWasmCache` (default on) the runtime is also
  stored by our custom cache (OPFS, §10), keyed by those URLs, so it works offline after the first load.
- **ORT version:** `onnxruntime-web` is pinned to `1.32.0-dev.20261110-53934832d` with npm `overrides` (plus
  Transformers.js's `onnxruntime-common`), because 1.31 needs 80+ s to initialise Chatterbox's decoder (Speak S0).
  Gemma behaves the same on both (identical greedy output, load and tok/s — verified 2026-11-15).
- **Privacy:** prompts, images, audio and conversations never leave the device. Only static model files are
  downloaded.
- `env.allowLocalModels = false`, `env.useBrowserCache = false`, `env.useCustomCache = true`,
  `env.customCache = new OpfsModelCache(gemmaDir, pinGemmaRevision)` (§10).
- **Offline:** after the first download, loading makes **zero** network requests (verified with huggingface.co and
  jsDelivr blocked). This needs `pinGemmaRevision` — see §10.

## 2. Architecture

```
EdgeAiStudioTool (tabs: Listen · See · Act · Chat)
 └─ ChatTab ── useGemma() ── GemmaClient (singleton) ──postMessage──▶ gemma.worker.ts
                    │                                                  ├─ Transformers.js
                    │                                                  └─ ONNX Runtime Web (WebGPU / WASM)
                    └─ conversations.ts (IndexedDB)
```

### 2.1 Files

```
src/lib/transformers/   Shared by every Transformers.js model (Speak S1)
  constants.ts       ORT_WEB_VERSION, ORT_RUNTIME_BYTES, isOrtRuntimeUrl() — import-free (safe for UI code)
  runtime.ts         ORT_RUNTIME_URLS, configureTransformers(env, cache), isCurrentOrtRuntime / isStaleOrtRuntime,
                     pruneStaleOrtRuntime(dir)
  opfsCache.ts       OpfsModelCache(dir, normalize), opfsDir(name), listOpfsEntries(dir), removeOpfsEntries(dir, fn),
                     clearOpfsDir(name), keyName(), isOpfsSupported()
  revision.ts        pinRevision(modelId, revision) → URL normaliser
  capability.ts      detectWebGpuCapability({ feature, totalBytes }, opts) + Capability/GpuLike types (Speak S2)
  errors.ts          classifyError(), describeCacheFailures(failures, modelName) (Speak S2)
  device.ts          createDeviceWatch(env, onLost) — WebGPU device-loss watch for a model worker (Speak S2)
src/lib/gemma/
  constants.ts       Model id, pinned revision, exact sizes, gemmaTotalBytes(), context budget, pinGemmaRevision,
                     isGemmaFileFor(url, dtype)
  runtime.ts         Thin wrapper: configureTransformers(env) with Gemma's cache; re-exports ORT_RUNTIME_URLS
  capability.ts      Thin wrapper: detectCapability() = shared detection with Gemma sizes ("Chat needs WebGPU…")
  opfsCache.ts       Thin wrapper: OPFS_DIR = 'gemma-models', gemmaDir, list/clear for that directory
  cache.ts           Stored size + per-dtype ready bytes + clear (OPFS + legacy Cache Storage)
  hooks.ts           useGemmaCache(), useGemmaCapability(), notifyGemmaCacheChanged()
  protocol.ts        Worker request/response types
  gemma.worker.ts    Model load / generate / stop / unload
  client.ts          GemmaClient singleton + useGemma() hook
  conversation.ts    Template formatting, history trimming, thinking-channel parser, error classification
  storage.ts         IndexedDB persistence for conversations (ChatStore, titleFrom, last-open id)
src/components/edge-ai/
  useAudioCapture.ts Shared mic recording + audio-file decoding to 16 kHz mono PCM (also used by Listen's AudioInput)
  StorageMenu.tsx    "Stored in browser · Clear" menu
  ModelGate.tsx      Shared model gate used by Cactus, Gemma and Chatterbox
  shared.tsx         Shared tool controls and device summary
  useHiddenWhile.ts  Hidden-tab generation marker
  useOnline.ts       Online/offline state
src/components/pocket-chat/  (Phase C1)
  ChatTab.tsx        Gate + transcript + composer with image/audio attachments (Attach / drop / paste / Record)
  Markdown.tsx       Safe GFM renderer for assistant replies (lazy chunk)
  ConversationList.tsx  Saved-chat list: new / select / rename / delete (side column ≥ lg, drawer below)
```

### 2.2 Separation from Cactus

- Separate worker and engine; no shared state or memory.
- `ModelGate` is presentational and takes a `ModelSource` (name, blurb, href, sizeBytes, sizeNote, status
  incl. `checking`/`unsupported`, progress, error, cached, downloadBytes, origin, load?, unsupported?, blocked?,
  unavailableNote?). `CactusModelGate` adapts the Cactus `useModel()`; `ChatTab` builds its source from the
  capability check (and, from Phase 1, `useGemma()`).
- Originally, `EdgeAiStudioTool.TABS` had a `chat` entry with no Cactus `model`; ChatTab rendered its own gate.
- The capability check ran only after the Chat tab was first opened (`visited` set in `EdgeAiStudioTool`).

> This describes the original as-built placement. The planned standalone route and full-height layout are specified
> in [Pocket Chat](#pocket-chat-standalone-planned).

## 3. Capability detection (`capability.ts`)

```ts
interface Capability {
  webgpu: boolean
  shaderF16: boolean
  device: 'webgpu' | 'wasm' | null
  dtype: 'q4f16' | 'q4' | null
  downloadBytes: number      // for the chosen dtype, excluding cached files
  storage: { quota: number; usage: number; persisted: boolean } | null
  reason?: string            // human-readable when unsupported
}
```

Implemented in `detectCapability({ gpu?, storage?, cachedBytes?, readyBytes?, secureContext? })` — all inputs injectable for
tests; `unsupported` (can't run) and `blocked` (not enough storage) are separate fields.

1. `navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })` → none/throws ⇒ `webgpu=false`.
2. `adapter.features.has('shader-f16')` ⇒ `q4f16`, else `q4`.
3. `navigator.storage.estimate()`; block download (with message) if `quota - usage < downloadBytes × 1.1`.
4. Before download: `navigator.storage.persist()` (best effort).
5. No WebGPU: `reason` = "Needs WebGPU (Chrome/Edge 113+, Safari 26+)"; Phase 6 offers WASM opt-in.

## 4. Worker protocol (`protocol.ts`)

Every request carries an `id`; responses echo it. The client ignores responses whose `id` is no longer current.

```ts
type GemmaRequest =
  | { id; type: 'load'; device; dtype }
  | { id; type: 'generate'; turns: ChatTurn[]; settings: GenSettings }
  | { id; type: 'stop' }                     // targets the in-flight generate
  | { id; type: 'unload' }

type GemmaResponse =
  | { id; type: 'progress'; loaded: number; total: number }                  // from progress_total, ≤ every 150 ms
  | { id; type: 'ready' }
  | { id; type: 'stream'; answer: string; thinking: string }                 // cumulative parsed text, ≤ every 50 ms
  | { id; type: 'done'; answer: string; thinking: string; stopped: boolean; stats: GenStats }
  | { id; type: 'unloaded' }
  | { id; type: 'error'; code: ErrorCode; message: string }
  | { id: 0; type: 'lost'; message: string }          // unsolicited GPU device loss
// 'ready' is { id; type: 'ready'; cacheWarning?: string }

interface ChatTurn { role: 'user' | 'assistant'; text: string; images?: Blob[]; audio?: Float32Array /* 16 kHz mono */ }
interface GenSettings { temperature: number; maxNewTokens: number; thinking: boolean; topP: number }
interface GenStats { promptTokens; newTokens; ms; firstTokenMs; tokensPerSec; trimmedTurns; droppedAudio }
type ErrorCode = 'unsupported' | 'quota' | 'network' | 'device-lost' | 'busy' | 'not-loaded' | 'unknown'
```

### 4.1 Worker rules

- **Load is idempotent:** concurrent `load` calls share one promise (fixes the reference doc's silent
  `if (loading) return`).
- **One generation at a time:** a second `generate` while busy → `error{code:'busy'}`.
- **Stop:** `InterruptableStoppingCriteria.interrupt()`; reply `done{stopped:true}` with the partial text.
- **Streaming:** `TextStreamer({ skip_prompt: true, skip_special_tokens: false })` — special tokens are kept
  because the thinking markers `<|channel>` (id 100) / `<channel|>` (id 101) are special tokens and would otherwise
  vanish, merging reasoning into the answer. The raw text is re-parsed with `parseOutput()` and the cumulative
  `{answer, thinking}` is posted at most every 50 ms. `token_callback_function` counts tokens / first-token time.
- **Thinking:** `enable_thinking` puts `<|think|>` in the system turn; output is
  `<|channel>thought\n…<channel|>answer<turn|>`. `parseOutput()` splits it, strips `<turn|>`/`<eos>`/etc. and holds
  back half-received markers at the end of a streaming buffer.
- **Sampling:** `temperature === 0` ⇒ `do_sample: false` (greedy; overrides the repo's `do_sample: true`
  generation_config); else `do_sample: true, temperature, top_p, top_k: 64`.
- **Errors:** `classifyError()` maps QuotaExceeded → `quota`, GPU device lost / OOM → `device-lost`,
  fetch failures → `network`. On `device-lost` the client terminates the worker so the next load starts fresh.
- **Unload:** `model.dispose()`.
- **Device loss:** after a WebGPU load the worker awaits `env.backends.onnx.webgpu.device` (≤ 2 s) and subscribes
  once to `device.lost`; unless the reason is `destroyed` it clears the model and posts `{ id: 0, type: 'lost' }`.
  The client treats it like a crash (`fail('device-lost')`): rejects pending calls, terminates the worker, gate shows
  the error with Retry.
- **Cache warnings:** `ready` carries `cacheWarning` (`describeCacheFailures(cache.failures)`) when files loaded but
  couldn't be written to OPFS; the client keeps it in `state.warning`.

## 5. Conversation model (`conversation.ts`)

```ts
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  images?: Blob[]                 // user only, downscaled ≤ 1024px
  audio?: { pcm: Float32Array; seconds: number }   // user only, 16 kHz mono
  createdAt: number
  stats?: GenStats                // assistant only
  stopped?: boolean
}
```

- **Template formatting:** each user turn becomes `content: [{type:'image'}…, {type:'audio'}…, {type:'text', text}]`;
  assistant turns are plain text (thinking is **not** fed back). Images of all *kept* turns are passed to the
  processor in prompt order (`collectImages`) — `Gemma4Processor` replaces each image placeholder, in order, with
  `<boi>` + N soft tokens + `<eoi>` (N ≤ 280, `max_soft_tokens`).
- **Images (Phase 2):** the UI prepares each attachment with `prepareImage()` (≤ 1024 px; JPEG/PNG/WebP within size
  are passed through, others re-encoded as JPEG 0.9 on white). The worker decodes them with `RawImage.fromBlob`.
  Max 4 per message. The image processor resizes to ≤ 2,520 patches of 16 px (~800 × 800) itself.
- **Audio (Phase 3):** recorded / uploaded / dropped audio is decoded by `useAudioCapture` to 16 kHz mono PCM and
  passed straight to the processor as `[pcm]` (no `read_audio` fetch). One clip per message, capped at
  `MAX_AUDIO_SECONDS` (30 s, the model limit) — longer clips are trimmed in the UI and the chip says "(first 30 s)".
  `Gemma4Processor._call` only uses `audio_array[0]`, so `limitAudio()` keeps audio on the newest turn that has it
  and strips older clips (their text stays); the count is returned as `stats.droppedAudio` and the composer shows
  "Only the newest audio clip is sent". `collectAudio()` returns that clip. The worker order is
  `limitAudio → trimTurns → template → images/audio`.
- **Audio tokens:** `audioTokens(samples)` mirrors `_compute_audio_num_tokens`: 20 ms frames / 10 ms hop, two
  stride-2 reductions, capped at 750, +2 markers (1 s ≈ 27 tokens, 30 s = 752). Used by `trimTurns`.
- **Optimisation (later):** every turn re-runs the vision/audio encoders for all kept media (first token 4–6.5 s with
  one image, ~26 s with an image + 4 s clip, vs 0.3–1 s text-only). Reusing the KV cache / image features across turns would avoid that.
- **Trimming (`trimTurns`):** keep the newest turns that fit `GEMMA_CONTEXT_TOKENS (8192) - maxNewTokens`
  (count via `processor.tokenizer.encode`, +6 tokens/turn template overhead, +`IMAGE_TOKENS` (282) per image, +`audioTokens()` per clip); always keep the latest turn; the
  kept history always starts with a user turn; drop media of trimmed turns. `stats.trimmedTurns` drives the UI note
  "Older messages (n) weren't sent to the model".
- Pure functions, unit-tested without a model.

## 6. Client (`client.ts`)

- Lazily creates `new Worker(new URL('./gemma.worker.ts', import.meta.url), { type: 'module' })` on first load —
  Transformers.js only ever lands in the worker chunk.
- Singleton, like `cactus` client: survives tab switches; never terminated on unmount.
- `useSyncExternalStore` state: `status` (`idle|loading|ready|error`), `progress`, `error`, `errorCode`,
  `stream { id, answer, thinking } | null` (non-null while generating).
- API: `load(device, dtype)` (idempotent), `generate(turns, settings) → Promise<GemmaDone>`, `stop()`.
- Calls `navigator.storage.persist()` before the first load and `notifyGemmaCacheChanged()` after it.
- Gate progress: `total = max(event.total, totalBytes − runtime bytes)` so the bar never jumps backwards as new
  files start; label "Reading from browser storage…" when nothing needs downloading.

## 7. UI (`ChatTab`)

Follows the Edge AI Studio conventions: gate on top, nothing auto-runs, fixed layout that never shifts, aligned rows,
`hidden` (not unmounted) when another tab is active.

```
┌ ModelGate: Gemma 4 E2B · 3.2 GB (incl. audio encoder) · Ready ───────────────────────┐
┌ Conversations ┐ ┌ Transcript (fixed height, scrolls) ───────────────────────────────┐
│ + New chat     │ │  user bubble (images / audio chips)                              │
│ • Trip ideas   │ │  assistant bubble (Markdown) ▸ Reasoning   [Copy]                │
│ • Receipt Q&A  │ │  …streaming…                                                     │
└────────────────┘ └──────────────────────────────────────────────────────────────────┘
                   ┌ Composer ──────────────────────────────────────────────────────────┐
                   │ [thumbs/audio chips]                                               │
                   │ textarea (Enter send · Shift+Enter newline)                        │
                   │ [Attach (image/audio)] [Record]   Temp [0] Max [512] ☐Think [Send|Stop] │
                   └───────────────────────────────────────────────────────────────────┘
```

- Transcript: `h-[28rem] overflow-y-auto`, auto-scroll only when the user is already at the bottom.
- Accessibility (Phase 7): the transcript is `role="log"` with `aria-live="off"` and `aria-busy` while streaming,
  and `tabIndex=0` for keyboard scrolling. A separate `sr-only` status says "Gemma is replying…", then "Gemma
  replied: <answer>" (or "stopped"). Esc in the composer stops generation. The gate's status announces phase
  changes only (Starting / Downloading / Reading from storage / Initialising); the progress bar has `aria-label`
  and `aria-valuetext`; gate errors are `role="alert"`.
- Replies generated while the page was hidden are flagged `backgrounded` ("tab was in the background" next to the
  stats) because browsers throttle background GPU work.
- Offline (`navigator.onLine === false`) with the model not stored → the gate's Download is blocked with an
  offline notice. This takes precedence over the storage check.
- Conversation list: side column (15rem) at `lg`+, same top and height as the transcript; below `lg` a "Chats"
  button opens it as an overlay drawer aligned to the transcript (no layout shift).

## 8. Markdown (`Markdown.tsx`)

- Library: `react-markdown@10` + `remark-gfm@4` (tables, task lists, strikethrough); **no** `rehype-raw` → raw
  HTML in model output is shown as literal text. `javascript:` and other unsafe URLs are stripped by
  react-markdown's default `urlTransform`.
- Elements are styled through the `components` map (no typography plugin). Headings are demoted (`#` → `h3`…) so
  replies don't outrank the page headings.
- Code blocks (`pre`): header with the language (from `language-*`, else "code") + Copy button (copies the raw code
  text from the hast node); monospace, horizontal scroll; no syntax-highlighting dependency in v1. Inline code is
  a small chip.
- Links: `target="_blank" rel="noopener noreferrer"`.
- Images in Markdown are **not** loaded (rendered as `[image: alt]`) — a reply could otherwise make the browser
  fetch a remote URL, breaking the no-network promise.
- Streaming: the streaming answer is re-rendered on each batched delta (≤ every 50 ms) through `useDeferredValue`;
  `Markdown` is `memo`'d by text so finished replies are not re-parsed. Unclosed fences render as an
  open code block until the closing fence arrives. The transcript is fixed-height, so growth never shifts the page.
- Lazy chunk (`Markdown-*.js`, ~50 KB gzip) via `React.lazy`; prefetched when the Chat tab is first visited, with a
  plain `whitespace-pre-wrap` fallback while it loads. Other tools don't pay for it.

## 9. Persistence (`storage.ts`)

IndexedDB database `edge-ai-chat`, version 1 (`ChatStore`, injectable `IDBFactory` for tests):

| Store | Key | Value |
|---|---|---|
| `conversations` | `id` | `{ id, title, titleEdited, createdAt, updatedAt, settings: GenSettings }` |
| `messages` | `id` (index `conversationId`) | `{ id, conversationId, index, role, text, thinking?, images?: {blob, name}[], audio?: {pcm, name, seconds, trimmed}, stats?, stopped?, createdAt }` |

- **Saving:** the user message is saved on send (creating the conversation on the first message) and the reply when
  it completes or is stopped. Saves are queued and append only messages after `savedCount`; each save upserts the
  conversation (`updatedAt`, current settings) and the new messages in one transaction. The conversation is
  re-read before saving so a rename made meanwhile isn't overwritten.
- **Media:** images as Blobs (already downscaled by `prepareImage`); audio as the ≤ 30 s `Float32Array` actually sent
  to the model (no original file), so a restored chat sends identical inputs. Playback uses a 16-bit WAV rebuilt
  with `encodeWav()`.
- **Titles:** `titleFrom()` = first 40 chars of the first prompt on one line (`…` when cut), or "Image",
  "n images", "Audio clip", "Image + audio". Renaming sets `titleEdited`.
- **Restore:** the last-open id is kept in `localStorage` (`edge-ai-chat:last-open`); the first visit to the Chat
  tab reopens it — no model needed to read history. Opening a chat also restores its settings.
- **Sessions:** replacing the transcript (open / new chat) bumps a session counter; late replies and queued saves
  for an older session are dropped. Switching, starting a new chat and deleting the open chat are disabled while a
  reply is generating.
- **Delete** cascades to messages (`conversationId` index). If the open chat disappears (deleted, or cleared from
  the storage menu), the tab stops any generation and starts a new chat.
- **Size:** `usage()` sums text (UTF-16), image bytes, PCM bytes and a per-record overhead (`storage.estimate()`
  is origin-wide, so it can't separate chats from models). Shown in the storage bar as "Saved chats (n)"; the
  Clear menu lists it but does not pre-select it (models can be re-downloaded, chats can't).
- Change notifications: `notifyChatsChanged()` / `onChatsChanged()` in `hooks.ts`; `useChatStorage()` feeds the
  storage bar.

## 10. Caching & storage bar (`src/lib/transformers/opfsCache.ts`, `cache.ts`)

**Model files live in OPFS, not Cache Storage.** Transformers.js reads each file fully into memory and then calls
`cache.put(key, new Response(buffer))`. Chromium rejects entries of 1.5–1.6 GB ("Failed to execute 'put' on 'Cache':
Unexpected internal error") — verified for the Gemma decoder/embedding files, and also with a streamed body — so
with the default cache every reload re-downloaded ~3 GB. OPFS (`navigator.storage.getDirectory()`) stored and read
back the same files fine.

- **`OpfsModelCache`** (shared; plugged in as `env.customCache`, which only needs `match`/`put`):
  - one directory per model family, passed in as `opfsDir(name)` — Gemma: `gemma-models/` (`gemmaDir`); each
    entry is `<sha256(url)>.bin` + `<sha256(url)>.meta.json` (`{url, size, contentType}`);
  - `put` removes old meta, streams the body to the `.bin` (`createWritable`, or `createSyncAccessHandle` in
    Safari workers), then writes the meta **last** — a partially written file is never served;
  - `match` returns `new Response(file)` (disk-backed `File`) with `Content-Length`, only if the file size equals
    the meta size;
  - if a write fails (e.g. `QuotaExceededError`), `put` deletes the partial `.bin`/meta, appends to `failures`
    and rethrows. Transformers.js only *warns* on `put` errors for buffered responses and keeps loading, so the
    worker reports `failures` with `ready` (see §4.1) — otherwise the user would silently re-download next visit.
- **Revision pinning (`pinRevision(modelId, revision)`; Gemma: `pinGemmaRevision`):** Transformers.js 4.3.2's
  `get_tokenizer_files()` calls
  `get_file_metadata(model, 'tokenizer_config.json', {})` **without** `revision`, i.e. `resolve/main/…`. That misses
  the pinned-revision entry and hits the network on every load (and fails offline). The cache maps the model's
  `resolve/main/` URLs to `resolve/<revision>/` for both `match` and `put`, so it's a cache hit. Other models' URLs
  pass through unchanged.
- **Stale ORT runtime (Speak S1):** the runtime's cache key is its hashed asset URL, so after an ORT update the old
  entry is never read again. `getGemmaCacheDetails()` first deletes `ort-wasm-*` entries whose URL isn't one of the
  current `ORT_RUNTIME_URLS` (`pruneStaleOrtRuntime(gemmaDir)`).
- **Stored vs. download (`readyBytesFor(entries, dtype)`):** the gate's "cached" state and download size come from
  the bytes of exactly the files a load reads — that dtype's sessions + configs/tokenizer at the pinned revision +
  the current runtime — not from the sum of everything stored. A byte sum would treat a stale runtime, the other
  dtype's files or legacy Cache Storage entries (never read; loads only use OPFS) as "stored": after the ORT update
  it reported Gemma as stored while the new 30 MB runtime was missing, so an offline load would have failed.
  `useGemmaCache().ready` → `useGemmaCapability(visited, ready)` → `detectCapability({ readyBytes })`. Verified
  with the production build: seeded 3.4 GB + an old-build runtime → old entry pruned, gate "Download 28.6 MB";
  after download, a reload auto-loads from storage in 12 s with zero requests to huggingface.co, jsDelivr or the
  runtime URL.
- **Size (`getGemmaCacheInfo`):** OPFS entries (from the meta files) + any legacy Cache Storage entries in
  `transformers-cache` (checked with `caches.has()` first, never created). `bytes` = everything (incl. runtime wasm);
  `modelBytes` = URLs under `/<model id>/resolve/`. `useGemmaCache()` + `notifyGemmaCacheChanged()` keep views in
  sync.
- **Clear (`clearGemmaCache`):** removes the OPFS directory recursively and deletes `transformers-cache` +
  `experimental_transformers-hash-cache`.
- "Clear" menu (`StorageMenu`): one checkbox per store with a non-zero size — Cactus models · Gemma model ·
  Saved chats (not pre-selected).
- Clearing Gemma while loaded keeps the in-memory model usable until reload (same rule as Cactus).

## 11. Errors & edge cases

| Situation | Behaviour |
|---|---|
| No WebGPU | Gate shows reason; Phase 6 offers WASM opt-in |
| Insufficient quota (before download) | Block download, show needed vs available |
| Storage fills up during download | Partial file deleted; model still loads; gate shows "Ready · not saved for offline use" + reason (`cacheWarning`) |
| Storage full when saving a chat | "Browser storage is full — couldn't save this chat…" (chat stays on screen) |
| Offline, model not stored | Download blocked with an offline notice |
| Download interrupted (network drop) | `network` error ("files that finished downloading are kept") + Retry; resumes per file |
| GPU device lost / OOM | Detected via `device.lost` (also while idle) or a thrown error → worker reset, gate error (`role="alert"`) + Retry; suggests closing GPU-heavy tabs |
| Tab hidden during generation | Generation continues in the worker (slower — browsers throttle background GPU); reply flagged "tab was in the background" |
| Switching conversation mid-generation | Disabled while a reply is generating (Stop first); if the open chat is removed meanwhile, generation stops |
| Model output contains HTML | Rendered as text (no `rehype-raw`) |

## 12. Performance targets (indicative, M-series Mac, Chrome)

| Metric | Target |
|---|---|
| Cold load from cache | < 30 s — **measured 12–13 s** |
| First token (short prompt) | < 2 s — **measured 0.3–1.0 s** |
| Decode speed | ≥ 10 tokens/s — **measured 23–25 tok/s** (Chrome 150, Apple GPU, q4f16) |
| Main-thread jank while streaming | none (batched deltas) |

## 13. Testing

| Layer | How |
|---|---|
| `conversation.ts` formatting & trimming | Vitest, fake tokenizer |
| `capability.ts` | Vitest with mocked `navigator.gpu` / `storage` |
| Shared Transformers.js helpers | `transformersShared.test.ts`: two OPFS directories/models side by side, `pinRevision` for a second model, `removeOpfsEntries`, `isOrtRuntimeUrl`, installed `onnxruntime-web` = `ORT_WEB_VERSION` and runtime size = `ORT_RUNTIME_BYTES`, `readyBytesFor` per dtype, stale runtime → download needed |
| Progress aggregation, protocol reducers | Vitest |
| `storage.ts` | Vitest + `fake-indexeddb` (`gemmaStorage.test.ts`): order, Blob/PCM round-trip (Node `Blob` — jsdom's isn't structured-cloneable), append, rename, cascade delete, usage/clear, titles, `encodeWav` |
| `Markdown.tsx` safety & rendering | Vitest + jsdom + `renderToStaticMarkup` (`gemmaMarkdown.test.tsx`): HTML as text, `javascript:` links stripped, no remote images, code/lists/tables, partial input. The Vitest include glob covers `*.test.{ts,tsx}` |
| End-to-end | Manual in Chrome with WebGPU (cannot run in Vitest): load, stream, stop, image, audio, reload-from-cache, clear |

## 14. Dependencies

| Package | Why | Ships to browser |
|---|---|---|
| `@huggingface/transformers@4.3.2` | Model runtime | Worker chunk only (~560 KB min + ORT wasm) |
| `onnxruntime-web` (npm `overrides`: `1.32.0-dev.20261110-53934832d`; `onnxruntime-common` to match under Transformers.js) | ORT ≥ 1.32 for Speak (S0) | Worker chunk + 30.0 MB runtime asset |
| `react-markdown@^10.1`, `remark-gfm@^4.0` | Markdown | Lazy `Markdown` chunk (~50 KB gzip) |
| `fake-indexeddb` (dev) | Tests | No |

Note: `@huggingface/transformers` lists `onnxruntime-node` and `sharp` as dependencies; they install into
`node_modules` but are Node-only and never bundled (the web build is browser-only).

## 15. Deviations from the reference analysis

| Reference doc | This spec |
|---|---|
| React Router `/gemma` route, separate page | Hash-routed tool; Chat is a tab in Edge AI Studio |
| Worker created/terminated per page mount | Singleton worker; model survives tab switches |
| History saved via `useEffect` on `response` | Saved on `done` with request id |
| Per-file progress | Aggregated `progress_total` |
| `do_sample: true`, temp 0.8 | Greedy by default (temp 0), sampling opt-in |
| Only last image sent | All kept turns' media sent; trimmed turns' media dropped |
| ORT runtime from jsDelivr | Bundled locally |
| No capability / quota checks | WebGPU + `shader-f16` + storage checks before download |
| Audio "not yet wired" | Phase 3: wired via shared `useAudioCapture`; encoder loads up front (can't be deferred) |

> **Current planned direction:** the original in-studio Chat placement in this table and §2 is historical. The
> standalone Pocket Chat target is described in the section below; CPU/WASM fallback (Phase 6) is deferred.

---

# Speak (Chatterbox TTS) — Technical Specification

Companion to [PLAN.md — Speak](./PLAN.md#speak-chatterbox-tts--implementation-plan). Describes how the Speak tab of
Edge AI Studio will be built. **Status: S0 done (go, with ORT ≥ 1.32); S1 done (shared module + ORT 1.32 override); S2 done (engine + tab shell); S3 done (single-sentence Speak with the default voice); S4 done (your own voice); S5 done (long text, buffered playback); S8 done (§S16: 10,000 chars, start cap, parts kept on errors); S9 done (§S17: 10 built-in voices); S10 done (§S18: voice dropdown); S11 done (§S19: script markers); S12 done (§S20: conversations); S13 done (§S21: zip of per-line WAVs); S7 last.** Facts marked
*(verified)* were checked on 2026-11-14 against the model repo, the installed `@huggingface/transformers@4.3.2`
source, the local scripts in `.data/scripts/`, or the S0 spike (`.data/spike/`, see PLAN — Phase S0).
Items still marked *(S0)* weren't covered by the spike and stay open.

## S1. Model and runtime

| Item | Value |
|---|---|
| Model repo | `onnx-community/chatterbox-ONNX` (MIT, English) *(verified)* |
| Pinned revision | `3cab09af388d3f02bba43443fce88c1f4525ac43` (last modified 2025-10-20) *(verified)* |
| Library | `@huggingface/transformers` `4.3.2` (already pinned for Gemma) *(verified: exports `ChatterboxModel`, `ChatterboxProcessor`, `ChatterboxFeatureExtractor`)* |
| ONNX Runtime Web | **≥ 1.32** via npm `overrides` (`1.32.0-dev.20261110-53934832d` until a stable 1.32.0 is published). Transformers.js 4.3.2 pins `1.31.0-dev.20260914`, which needs **81.6 s** to initialise the decoder on WebGPU vs **6.2 s** on 1.32 *(verified, S0)* |
| Model class | `ChatterboxModel` + `AutoProcessor` (→ `ChatterboxProcessor`) |
| Architecture | Llama-style LM (T3): 30 layers, hidden 1024, 16 heads (16 KV heads), head dim 64, vocab 8194 → speech tokens → S3Gen conditional decoder → waveform |
| Sample rate | 24,000 Hz in and out (`preprocessor_config.json`) *(verified)* |
| Device | `webgpu` only. No CPU fallback: the decoder on WASM ran at RTF 5–6.4 even with 4 threads *(verified, S0)* |
| dtype map | `{ embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: 'q4f16' \| 'q4', conditional_decoder: 'fp32' }` — keyed by **file name** (`selectDtype(dtype, fileName)`) *(verified)* |
| KV cache dtype | `float16` for `q4f16`/`fp16`, else `float32` (`transformers.js_config.kv_cache_dtype`) *(verified)* |

### S1.1 Download sizes (exact, at the pinned revision) *(verified)*

| ONNX session | Files | Bytes | Size |
|---|---|---|---|
| Language model `q4f16` | `language_model_q4f16.onnx(_data)` | 304,966,796 | 305 MB |
| Language model `q4` (no `shader-f16`) | `language_model_q4.onnx(_data)` | 353,849,159 | 354 MB |
| Speech encoder | `speech_encoder.onnx(_data)` | 592,459,488 | 592 MB |
| Conditional decoder | `conditional_decoder.onnx(_data)` | 540,321,264 | 540 MB |
| Token embeddings | `embed_tokens.onnx(_data)` | 61,653,990 | 62 MB |
| Config + tokenizer | `config.json`, `generation_config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json` | 30,107 | 30 KB |
| Default voice | `default_voice.wav` | 714,320 | 0.7 MB |
| ORT runtime (from this site, shared with Gemma), 1.32 dev | `ort-wasm-simd-threaded.asyncify.{wasm,mjs}` | 30,004,278 | 30 MB |
| **Total `q4f16`** | | **1,530,150,243** | **≈ 1.53 GB** |
| **Total `q4`** | | **1,579,032,606** | **≈ 1.58 GB** |

Not used: `language_model.onnx(_data)` (fp32, 2.08 GB) and `language_model_fp16.onnx(_data)` (1.04 GB).
`ttsTotalBytes(dtype)` in `src/lib/tts/constants.ts` is the single source for these numbers. If Gemma already
stored the ORT runtime, it is a separate OPFS entry (per-directory caches), so it's counted again.

All four sessions load at `from_pretrained` (`MODEL_SESSION_CONFIG[Chatterbox]`: `embed_tokens`, `speech_encoder`,
`model` → `language_model`, `conditional_decoder`) *(verified)* — the speech encoder can't be deferred, even when
only the default voice is used.

### S1.2 Hosting & network

Same as Gemma (§1.2): weights from `https://huggingface.co/` (every `_data` file > 100 MB GitHub Pages limit); ORT
runtime bundled via Vite `?url`; `env.allowLocalModels = false`, `env.useBrowserCache = false`,
`env.useCustomCache = true` with an `OpfsModelCache` on its own directory and revision pinning for this model.
**Privacy:** text and reference audio never leave the device. **Offline:** after the first download, loading must
make zero network requests (verify with huggingface.co blocked).

## S2. Generation pipeline

```
text ──tokenizer──▶ input_ids ─┐
                               ├─ embed_tokens(input_ids, position_ids, exaggeration) ─▶ text embeds
reference 24 kHz ─speech_encoder─▶ audio_features [1,n,1024], audio_tokens [1,m],
                                   speaker_embeddings [1,192], speaker_features [1,t,80]
[audio_features ⧺ text embeds] ─language_model (KV cache, greedy, rep. penalty 1.2)─▶ speech tokens … 6562 (stop)
[audio_tokens ⧺ new tokens ⧺ 3 × silence(4299)] + speaker_embeddings + speaker_features
                               ─conditional_decoder─▶ waveform float32 [1, samples] @ 24 kHz
```

- `ChatterboxModel.generate({...inputs, ...speaker, exaggeration, max_new_tokens})` does all of this and returns
  the waveform `Tensor` *(verified)*. `position_ids` are derived from the start-of-speech token (6561) in
  `prepare_inputs_for_generation`.
- `generation_config.json`: `eos_token_id: [2, 6562]`, `repetition_penalty: 1.2`; no `do_sample` → greedy
  *(verified)*. `max_new_tokens` must be passed (the library default is ~20 tokens ≈ 0.2 s); use **256** (≈ 10 s of
  audio at ~25 speech tokens/s), as the reference implementation does. S0 measured ~1.6–1.7 speech tokens per
  character (69 chars → 110–115, 147 chars → 231–251), so the cap is hit at ~150 chars → chunks ≤ 120 chars (§S6).
- Output is **not deterministic**: the decoder samples noise (`RandomNormalLike`/`RandomUniformLike`), so the same
  text and voice give slightly different audio each time *(verified, S0)*.
- `exaggeration`: number, default 0.5, UI range 0–1.5. Higher values sound more expressive and tend to speed up
  speech.
- `model.encode_speech(Tensor('float32', pcm, [1, n]))` → speaker data; passing all four fields to `generate`
  skips the speech encoder for later requests *(verified)*.
- Stop: `generate` accepts `stopping_criteria`; an `InterruptableStoppingCriteria` ends the LM loop early, but the
  decoder still runs on the partial tokens — the worker drops that partial audio.
- `.data/scripts/test.mjs` re-implements this loop by hand with `onnxruntime-node`; it's a reference for
  correctness only (same tokens/penalty; it lacks the 3 silence tokens).

## S3. Architecture

```
EdgeAiStudioTool (tabs: Listen · See · Act · Chat · Speak)
 └─ SpeakTab ── useTts() ── TtsClient (singleton) ──postMessage──▶ tts.worker.ts
                                                                   ├─ Transformers.js (ChatterboxModel)
                                                                   └─ ONNX Runtime Web (WebGPU / WASM)
```

### S3.1 Files

```
src/lib/transformers/        (built in S1–S2, shared with Gemma — see §2.1)
  constants.ts, runtime.ts, opfsCache.ts, revision.ts, capability.ts, errors.ts, device.ts
src/lib/tts/                 (S2 ✅ unless marked)
  constants.ts       Model id, revision, exact sizes (TTS_SIZES), ttsTotalBytes(), ttsDtypeMap(), isTtsFileFor(),
                     SAMPLE_RATE, MAX_NEW_TOKENS, MAX_CHUNK_CHARS, MAX_INPUT_CHARS, MAX_REFERENCE_SECONDS,
                     DEFAULT_VOICE_URL, pinTtsRevision
  types.ts           Model-agnostic types (TtsModelInfo, SynthChunk (S11), AudioChunk, ChunkStats, SynthStats)
  capability.ts      detectTtsCapability() = shared detection with TTS sizes ("Speak needs WebGPU…")
  protocol.ts        Worker request/response types
  tts.worker.ts      load / encodeVoice / synthesize / stop / unload
  client.ts          TtsClient singleton (`tts`) + useTts()
  cache.ts           TTS_OPFS_DIR 'tts-models', ttsDir, getTtsCacheDetails() (prunes stale runtime; per-dtype ready
                     bytes via ttsReadyBytesFor), clearTtsCache()
  hooks.ts           useTtsCache(), useTtsCapability(), notifyTtsCacheChanged()
  audio.ts           parseWav (PCM 16/24/32, float32, WAVE_FORMAT_EXTENSIBLE, any channels → mono), resample,
                     trimTo, limitPeak (−1 dBFS, S3), speechFileName (S3), isSilent (S4), joinWithPauses (S5)
  chunk.ts           S5: splitIntoChunks(), splitSentences(), splitLong(), splitInHalf(), PAUSE_SECONDS
  playback.ts        S5: playbackStartDelay(plan), measuredRtf(), SpeechPlayer (AudioContext queue, stall counter);
                     S8: start cap (MAX_START_WAIT_SECONDS), buffer release
  script.ts          S11: parseScript() — [S1]–[S4], [pause …], [exaggeration …], diagnostics, summary;
                     planChunks() → generate calls with per-chunk exaggeration + pause; formatDuration (§S19)
  voices.ts          S10: bundled manifest (voices.json) types, clip URLs (?v=sha), remembered choice, stale-clip check
  voices.json        S9/S10: built-in voice manifest (bundled; clips in public/voices/) (§S17–S18)
  zip.ts             S13: store-only ZIP writer (createZip, crc32, dosDateTime) (§S21)
  lines.ts           S13: finished parts → one WAV per line (lineEntries, linesZip) (§S21)
src/components/edge-ai/
  SpeakTab.tsx       gate + text (≤ 5,000 chars, S5) + voice + exaggeration + Speak/Stop + status + output card
                     (live "Part n of m" progress → player / Stop playback / Download + stats)
  useHiddenWhile.ts  "page was hidden during the job" ref (moved out of ChatTab in S3; used by Chat and Speak)
  VoiceSelect.tsx    S10: voice dropdown (Default + built-in + "Your voice…"), preview, status; the S4 upload / record /
                     drop UI for "Your voice…" (replaces VoicePicker.tsx) (§S18)
  SpeakerCards.tsx   S12: conversation speaker cards (VoiceSelect + default exaggeration + turn count) (§S20)
  useVoiceSlot.ts    S12: one voice choice (default / built-in / your clip) → worker id; shared encode queue (§S20.4)
  ScriptNotes.tsx    S11: marker diagnostics list (errors first, "Line n" jumps)
  useOnline.ts       navigator.onLine hook (moved out of ChatTab in S2)
  shared.tsx         + DeviceSummary (moved out of ChatTab in S2)
  useAudioCapture.ts `useAudioCapture(onAudio, disabled, { sampleRate })` (S4; default 16 kHz for Listen/Chat) →
                     `decodeAudio(blob, sampleRate)` in src/lib/cactus/media.ts

Gemma keeps its own `src/lib/gemma/*` modules; after S1 they import the shared pieces instead of owning them.

### S3.2 Model-agnostic interface (`types.ts`)

Kept small so another engine (e.g. Kokoro) can be added behind the same worker protocol:

```ts
interface TtsModelInfo {
  id: string; name: string; revision: string; sampleRate: number; languages: string[]
  capabilities: { voiceCloning: boolean; exaggeration: boolean; maxCharsPerChunk: number }
}
interface AudioChunk { pcm: Float32Array; sampleRate: number; index: number; total: number }
```

### S3.3 Separation

- Separate worker and model from Gemma and Cactus; no shared in-memory state.
- `ModelGate` is reused as is (presentational `ModelSource`); `SpeakTab` builds its source from the capability
  check and `useTts()`, like `ChatTab`.
- `EdgeAiStudioTool.TABS` gains `{ id: 'speak', label: 'Speak', icon: AudioLines }` with no Cactus `model`; the
  capability check runs only after the tab is first opened (`visited`).
- Transformers.js ends up in each worker's chunk (Gemma and TTS); never in the main chunk.

## S4. Capability detection

`detectTtsCapability()` wraps the shared `detectWebGpuCapability` (moved from Gemma in S2): same steps as §3 (WebGPU adapter → `shader-f16` → dtype; `storage.estimate()` with `STORAGE_HEADROOM` 1.1;
`storage.persist()` before download), with `ttsTotalBytes(dtype)`. Without WebGPU: `unsupported` = "Speak needs
WebGPU (Chrome/Edge 113+, Safari 26+)" — there is no CPU fallback (S6 dropped after S0).

## S5. Worker protocol (`protocol.ts`)

```ts
type TtsRequestMsg =
  | { id; type: 'load'; device: 'webgpu'; dtype: 'q4f16' | 'q4' }
  | { id; type: 'encodeVoice'; voiceId: string; pcm: Float32Array /* 24 kHz mono, ≤ 10 s */ }   // transferred
  | { id; type: 'synthesize'; chunks: { text; exaggeration; voiceId }[] }   // S11: per-chunk exaggeration; S12: per-chunk voice — §S20.2
  | { id; type: 'stop' }                     // targets the in-flight synthesize
  | { id; type: 'unload' }

type TtsResponseMsg =
  | { id; type: 'progress'; loaded: number; total: number }       // progress_total, ≤ every 150 ms
  | { id; type: 'ready'; cacheWarning?: string }
  | { id; type: 'voice'; voiceId: string; ms: number }
  | { id; type: 'chunk'; index: number; total: number; pcm: Float32Array; stats: ChunkStats }   // transferred
  | { id; type: 'done'; stopped: boolean; stats: SynthStats }
  | { id; type: 'unloaded' }
  | { id; type: 'error'; code: ErrorCode; message: string }
  | { id: 0; type: 'lost'; message: string }

interface ChunkStats { chars: number; speechTokens: number; hitCap: boolean; resplit: boolean; ms: number; audioSeconds: number }
interface SynthStats { chunks: number; ms: number; firstAudioMs: number; audioSeconds: number; rtf: number }
// "tab was in the background" is tracked by the UI (S3), as in Chat — the worker can't see page visibility.
type ErrorCode = 'unsupported' | 'quota' | 'network' | 'device-lost' | 'busy' | 'not-loaded' | 'no-voice' | 'unknown'
```

### S5.1 Worker rules

- Same as §4.1 for idempotent load, one job at a time (`busy`), error classification, device-loss watch, cache
  warnings and unload (`model.dispose()`).
- **Default voice:** after load, the worker fetches `default_voice.wav` at the pinned revision through the OPFS
  cache, parses it (32-bit float, mono, 24 kHz, 7.44 s *(verified)*; `AudioContext` isn't available in workers, so
  `audio.ts` parses WAV directly), and encodes it as `voiceId: 'default'`.
- **Speaker cache:** `Map<voiceId, speakerData>`; `encodeVoice` replaces an existing id. `synthesize` with an unknown
  id → `error{code:'no-voice'}`.
- **Synthesis:** for each chunk: `processor(text)` → `model.generate({...inputs, ...speaker, exaggeration,
  max_new_tokens: 256, stopping_criteria})` → post `chunk` with the PCM (transferable). Chunks run sequentially.
- **Stop:** `interrupt()`; the partial chunk is discarded; reply `done{stopped:true}`; finished chunks already
  posted stay with the client.
- **Re-split (S5):** if a chunk's first attempt hits `MAX_NEW_TOKENS`, the worker regenerates it as `splitInHalf(text)`
  and joins the halves with 0.1 s of silence, posting one `chunk` (stats: summed tokens, `resplit: true`, `hitCap` if a
  half still hit the cap). Keeps order and streaming; costs the wasted first attempt.
- **Loading (verified S2):** `AutoProcessor.from_pretrained` → `AutoConfig.from_pretrained` + `architectures:
  ['ChatterboxModel']` → `ChatterboxModel.from_pretrained(id, { config, revision, dtype: ttsDtypeMap(dtype), device,
  progress_callback })` → default voice. Two Transformers.js 4.3.2 workarounds, both needed for zero-network loads:
  the repo config has no `architectures`, so without the injected config the progress-total pass falls back to
  "EncoderOnly" and probes a non-existent `onnx/model.onnx(_data)`; and that pass looks per-file dtypes up by
  **session key** (`model`) instead of file name (`language_model`), so `ttsDtypeMap` sets both or it probes the
  fp32 `language_model.onnx(_data)`. Real session loading uses the file-name key; the extra `model` key is ignored there.
- **Progress:** `progress_total` (aggregated by Transformers.js) covers configs + the four sessions; the runtime and
  default voice are fetched separately, so the gate's floor is `ttsTotalBytes − ORT_RUNTIME_BYTES − DEFAULT_VOICE_BYTES`.
- **Session options:** none needed. S0 found the slow decoder set-up was ONNX Runtime 1.31, not the options; all
  four sessions on `webgpu` with default options load in 10–12 s on ORT 1.32 *(verified, S0)*.
- **Chunk stats:** `speechTokens` comes from a minimal streamer passed to `generate`: `put()` is called once for the
  prompt and once per generated token, so `speechTokens = calls − 1`; `hitCap = speechTokens >= MAX_NEW_TOKENS`.
- **encodeVoice / busy:** `encodeVoice` and `synthesize` share the single-job slot (`busy` while either runs); the
  reference is trimmed to `MAX_REFERENCE_SECONDS` in the worker as well.

## S6. Text chunking (`chunk.ts`)

- `splitIntoChunks(text, maxChars = 120): { text: string; pause: 'paragraph' | 'sentence' }[]` (S0: ~150 chars
  reach the 256-token cap). `pause` is the silence before the chunk (`PAUSE_SECONDS`: sentence 0.15 s, paragraph
  0.4 s; none before the first).
- **As built (S5):** consecutive short sentences in a paragraph are merged up to `maxChars` (each chunk costs a
  generate call); abbreviations include titles, months, `e.g.`, `i.e.`, `etc.`, `a.m.`/`p.m.`, `U.S.`; single-letter
  words (initials) don't end a sentence; decimals never match (the terminator must be followed by whitespace).
  `splitLong` cuts at the last `,;:—–` that leaves ≥ 1/3 of `maxChars`, else the last space, else hard.
- Normalise whitespace; paragraphs split on blank lines; sentences on `.?!…` followed by space/quote, not after
  known abbreviations (`Mr`, `Dr`, `e.g.`, `i.e.`, `etc.`, …) or decimals; sentences > `maxChars` split at `;:,—`
  then at the last space before `maxChars`.
- Empty/whitespace-only chunks dropped. Input capped at `MAX_INPUT_CHARS` (5,000).
- Pure and unit-tested.

## S7. Audio (`audio.ts`, `useAudioCapture`)

- **Reference input (as built in S4):** `useAudioCapture(onAudio, disabled, { sampleRate: 24000 })` → mono
  `Float32Array` at 24 kHz; SpeakTab rejects silent clips (`isSilent`), trims to 10 s, keeps the PCM in memory (for
  re-encoding) and previews a WAV of exactly that PCM. Encoded via `tts.encodeVoice('voice-n', pcm.slice())` (the
  copy is transferred) when added, or on the first Speak; a `no-voice` error from Speak → re-encode once and retry.
  Originally specified: Needs a
  `sampleRate` parameter on `decodeAudio()` in `src/lib/cactus/media.ts` (today a fixed 16 kHz
  `OfflineAudioContext`, which does the resampling). Trimmed to `MAX_REFERENCE_SECONDS` = 10 *(S0:
  confirm what the speech encoder handles well)*; shorter than 3 s → hint "longer clips clone better".
- **Output:** each chunk's PCM is played in order on one `AudioContext` (24 kHz) by scheduling `AudioBufferSourceNode`s
  back-to-back with 0.15 s (sentence) / 0.4 s (paragraph) of silence, so there are no gaps between chunks.
  Each chunk is peak-limited to −1 dBFS when it clips (S0 peaks reached 1.07–1.19) — `limitPeak`, applied since S3.
- **As built (S5):** `SpeechPlayer` (created in the Speak click, so audio is allowed) schedules each peak-limited chunk
  at `max(previous end + pause, now)` and counts a stall whenever that's later than planned. `playbackStartDelay(plan)`
  implements the rule below with real `readyAt`/length for finished chunks, `measuredRtf` (default 1.7), 0.066 s/char
  for the rest and a 0.5 s margin (multi-chunk only); SpeakTab re-evaluates after every chunk and on a timer. When
  generation ends, the finished chunks are joined (`joinWithPauses`) into the WAV for the `<audio>` player and
  Download; live playback carries on ("Stop playback"; playing the `<audio>` stops it). Stop stops both and keeps
  the finished chunks.
- **Buffering:** generation is slower than playback (S0: RTF ≈ 1.5), so playing the first chunk immediately would
  stall. Estimate each chunk's audio length as `chars × 0.066 s` (S0: 4.64 s / 69 chars, 9.28 s / 147 chars) and the
  RTF from the finished chunks (start with 1.6). Start playback at the earliest time `D` (measured from the start of
  generation) such that every later chunk `k` is projected to be ready before it's due:
  `D ≥ rtf × A(k) − A(k−1)` for all `k`, where `A(k)` is the projected audio up to and including chunk `k`. Re-check
  after each chunk; if a chunk is late anyway, playback waits at the chunk boundary (never mid-chunk). For a
  single chunk this is "play when ready".
- **Download:** finished chunks + pauses joined and written with the existing `encodeWav(pcm, 24000)` from
  `src/lib/cactus/media.ts` (16-bit PCM, mono; already takes a sample rate). File name
  `speech-<yyyyMMdd-HHmmss>.wav`.
- Reference audio and generated audio stay in memory only (v1); nothing is persisted.

## S8. Client (`client.ts`)

- Lazily creates `new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' })` on first load;
  singleton that survives tab switches.
- `useSyncExternalStore` state: `status` (`idle|loading|ready|error`), `progress`, `error`, `errorCode`, `warning`,
  `voices` (encoded ids), `job { id, index, total } | null`.
- API: `load(device, dtype)`, `encodeVoice(id, pcm)`, `synthesize(text, voiceId, exaggeration, onChunk) →
  Promise<SynthDone>`, `stop()`.
- `navigator.storage.persist()` before the first load; `notifyTtsCacheChanged()` after it. Gate progress uses the
  same "never jumps backwards" rule as §6.

## S9. UI (`SpeakTab`)

```
┌ ModelGate: Chatterbox · 1.53 GB · Ready ──────────────────────────────────────────────┐
┌ Text (fixed height) ─────────────────────────────────────┐ ┌ Voice ─────────────────────┐
│ textarea                                    1,234/5,000  │ │ (•) Default  ( ) Your voice │
└──────────────────────────────────────────────────────────┘ │ [Upload] [Record] ▶ 0:07    │
 Exaggeration [──●────] 0.5        [Speak] / [Stop]          │ Only use voices you have    │
 Chunk 2 of 5 ▓▓▓▓░░░░░  Preparing audio…                   │ permission to use.          │
┌ Output ─────────────────────────────────────────────────┐ └─────────────────────────────┘
│ ▶ ─────●──────── 0:12 / 0:31   [Download WAV]            │
│ 31.0 s audio · 46.5 s · RTF 1.5 · 5 chunks               │
└──────────────────────────────────────────────────────────┘
```

- **As built in S3** (single sentence, default voice): text area `h-28` with `n / 120` counter; row with Exaggeration
  slider (0–1.5, step 0.05, "· default" at 0.5), "Voice Default" (picker in S4) and Speak/Stop; a `min-h-5` status
  line ("Generating speech… 3.2 s (usually about 1.5× the length of the audio)"); an `h-32` output card with
  `<audio controls>` + Download WAV and stats (`4.6 s audio · generated in 7.9 s · 1.70× real time · 114 speech
  tokens`, plus "may be cut off — shorten the text" / "tab was in the background"). The new clip autoplays (the user
  just pressed Speak; if the browser blocks it, the player is there). Stop keeps the previous clip. Ctrl/⌘+Enter
  speaks. Typing is allowed before the model loads.
- Nothing auto-runs; Speak disabled until loaded and text is non-empty; Esc / Stop stops.
- Fixed heights for text, voice and output areas so nothing shifts while generating.
- When Chat's Gemma model is loaded, the Speak gate shows "Chat's model is also loaded — close it if your GPU runs
  out of memory" (and vice versa).
- Accessibility: labelled controls; `sr-only` status announces "Generating chunk n of m", "Audio ready (31 s)",
  "Stopped"; progress bar with `aria-valuetext`; gate errors `role="alert"`.

## S10. Caching & storage bar

- OPFS directory `tts-models/` via the shared `OpfsModelCache(opfsDir('tts-models'), pinRevision(…))` (same
  `.bin` + `.meta.json` scheme, meta written last, failures recorded), with
  `pinRevision('onnx-community/chatterbox-ONNX', TTS_REVISION)`.
- `getTtsCacheInfo()` / `clearTtsCache()` operate only on `tts-models/` (`clearOpfsDir('tts-models')`); Gemma's
  `gemma-models/` is untouched. Like Gemma (§10), stale runtimes are pruned (`pruneStaleOrtRuntime`) and "stored"
  is decided from the files the load needs (configs + this dtype's sessions + `default_voice.wav` + current runtime),
  not from a byte sum.
- Storage menu gains "Speak model (Chatterbox)" (pre-selected like other models).
- Clearing while loaded keeps the in-memory model usable until reload (same rule as Cactus/Gemma).

## S11. Errors & edge cases

| Situation | Behaviour |
|---|---|
| No WebGPU | Gate reason ("Speak needs WebGPU …"); no CPU fallback |
| Insufficient quota / storage fills mid-download / offline / network drop | Same as §11 |
| GPU device lost / OOM | Same as §11, plus the hint to close Chat's model |
| Empty / whitespace text | Speak disabled |
| Text > 5,000 chars | Counter turns red; Speak disabled |
| Reference clip unreadable / silent | "Could not read audio: …" / "This clip is silent — check the microphone or pick another file." (S4); no clip is set, Speak stays disabled in "Your voice" mode |
| Worker restarted (GPU loss → Retry) with a custom voice selected | Speak gets `no-voice`, re-encodes the kept clip once and retries (verified S4) |
| Reference > 10 s | Trimmed with "(first 10 s)"; preview is the trimmed clip |
| Reference < 3 s | Accepted with "longer clips (5–10 s) clone better" |
| A chunk hits `max_new_tokens` without the stop token | Likely cut off (S0: a 288-char prompt stopped mid-sentence). Re-split once at a clause boundary and regenerate; if it still hits the cap, keep it and flag it in the stats |
| Tab hidden during generation | Continues; stats flagged "tab was in the background" |

## S12. Performance

**Baseline measured in Node before S0** (`.data/scripts/benchmark.mjs`, `onnxruntime-node` 1.31.1, CPU, arm64, 4 intra-op
threads, decoder only) *(verified)*:

| Metric | Value |
|---|---|
| Decoder graph | 23,934 nodes, 1,629 initializers; top ops MatMul 4,585 · Add 4,507 · Mul 3,358 · Transpose 3,170 · Reshape 2,404 · LayerNorm 1,433; also 20 `If`, `STFT`, `RandomNormalLike` ×2, `RandomUniformLike` |
| External weights read | 509 MB in 0.31–0.43 s |
| Session creation (`graphOptimizationLevel: 'disabled'`, offline-optimised graph) | **61.7–82.7 s** |
| RSS after creation | ~542 MB |

`optimize.py` (`ORT_ENABLE_ALL`, CPU EP) produced a hardware-specific graph (NchwcTransformer warning); it is not
portable and is not shipped.

**Root cause (S0):** the slow session creation is an ONNX Runtime 1.31 regression, entirely inside
`session_initialization`. Same model, Python, CPU, optimisation disabled: ORT 1.31.1 **83.9 s**, ORT 1.32.0
**2.3 s** (`basic` 2.7 s, `all` 4.3 s). Browser, WebGPU: `onnxruntime-web` 1.31.0-dev **81.6 s**, 1.32.0-dev
**6.2 s** *(verified)*.

**S0 browser measurements** (MacBook, Apple GPU `metal-3` with `shader-f16`, VS Code browser = Chrome 150,
`onnxruntime-web` 1.32.0-dev, files served locally — comparable to reading from OPFS) *(verified)*:

| Metric | Target | Measured (`q4f16`) | Measured (`q4`) |
|---|---|---|---|
| Load: all four sessions | ≤ 30 s | ✅ **10.2–11.3 s** (decoder 5.4–6.3 s, speech encoder 1.1–1.2 s, embed 0.4–0.5 s, LM 0.2–0.3 s) | ✅ 11.6 s |
| Default-voice encode | ≤ 2 s | ✅ 0.6 s (2.5 s on a first run incl. shader compilation) | ✅ 0.6 s |
| First audio, one sentence (69 chars, 4.6 s of audio) | ≤ 10 s | ✅ **8.0–10.0 s** cold, 6.7–7.6 s warm | ✅ 8.3–10.0 s |
| Real-time factor (generation ÷ audio length) | ≤ 1.0 | ❌ **1.45–1.72** (LM ~38 steps/s ≈ 0.66; decoder ≈ 0.9–1.0) | ❌ 1.57–2.25 |
| Same, not cross-origin isolated (single-threaded WASM, = GitHub Pages) | — | Same (load 11.2 s, first sentence 8.0 s) | — |
| Decoder on WASM (4 threads, isolated), LM on WebGPU | — | RTF 5.1–6.4 (decoder 26–42 s) → no CPU path | — |
| Peak memory | — | Not measured (`measureUserAgentSpecificMemory` unavailable in the VS Code browser) — measure in Chrome in S2 | — |
| Main-thread jank while generating | none | Not affected (everything runs in the worker) | — |

Because RTF > 1, long text is buffered before playback (§S7).

## S13. Testing

| Layer | How |
|---|---|
| `constants.ts`, `cache.ts`, `capability.ts`, `audio.ts` (S2–S3) | `ttsEngine.test.ts`: exact totals, dtype map, `isTtsFileFor`, ready bytes vs stale runtime, "Speak needs WebGPU", `parseWav` for PCM16/24/32/float/extensible/stereo + the real `default_voice.wav`, `encodeWav` round-trip, `resample`, `trimTo`, `limitPeak`, `speechFileName`, `isSilent` |
| Voice cloning (S4) | Browser: uploaded / dropped / recorded (stubbed recorder) references + Speak; speaker similarity of outputs vs references with Chatterbox's `speech_encoder` embeddings (`.data/spike/speaker_sim.py`), Whisper transcripts |
| `chunk.ts` (S5) | `ttsChunk.test.ts`: sentences, quotes, abbreviations/initials/decimals, clause and hard splits, merging, paragraphs and pauses, no words lost, `splitInHalf` |
| `playback.ts` (S5) | `ttsPlayback.test.ts`: start delay for one chunk / rtf 1.5 (simulated playback: no stall at the delay, stall 0.5 s earlier) / rtf < 1 / defaults + margin, `measuredRtf`, `joinWithPauses` |
| Long text end to end (S5) | Browser: 3-paragraph story → timeline + stall count; joined WAV checked for clicks at pause edges (`.data/spike/joins.py`) and with Whisper; Stop → finished parts only; re-split via a 258-char chunk |
| `capability.ts` / `constants.ts` | Vitest with mocked `navigator.gpu` / `storage`; exact byte totals |
| Shared OPFS cache / revision pinning | Existing Gemma tests + a second directory/model |
| Protocol / client reducers | Vitest |
| End-to-end | Manual in Chrome with WebGPU: download, reload from storage (network blocked), default voice, own voice, long text, stop, download, clear |

## S14. Dependencies

No new runtime packages: `@huggingface/transformers@4.3.2` is already pinned. **Done in S1:** npm `overrides` for
`onnxruntime-web` → `1.32.0-dev.20261110-53934832d` and, under `@huggingface/transformers`, `onnxruntime-common` →
`1.32.0-dev.20261105-527971bce` (the matching pair; Transformers.js imports `Tensor` from it). Switch both to stable
1.32.0 once published on npm (a unit test checks the installed version against `ORT_WEB_VERSION`). Gemma verified on
it. `onnxruntime-node` (currently in
`dependencies`) is only used by `.data/scripts/` and moves to `devDependencies` in S7. Python `onnx` /
`onnxruntime` are local analysis tools only.

## S15. Deviations from the reference demo (`resemble-ai/transformersjs-chatterbox-demo`)

| Reference demo | This spec |
|---|---|
| `@huggingface/transformers@^4.0.0-next` | Pinned 4.3.2 (shared with Gemma) + `onnxruntime-web` ≥ 1.32 override |
| Default browser cache | OPFS (Cache Storage rejects ≥ 1.5 GB entries; individual files here are ≤ 592 MB but stay consistent with Gemma) |
| ORT runtime from jsDelivr | Bundled locally |
| No capability / quota checks | WebGPU + `shader-f16` + storage checks before download |
| Whole result posted at the end | Per-chunk `chunk` messages for progressive playback |
| No stop | `InterruptableStoppingCriteria`; partial chunk dropped |
| React Router pages (Narrator, Echo, …) | One hash-routed tab in Edge AI Studio |
| Dialogue creator with user-recorded voices per character | Built-in voices + upload/record per speaker, tag-based script with pause/exaggeration markers, stitched WAV + per-line zip (S9–S13) |

## S16. Long-text upgrades (Phase S8 — done 2026-11-15)

- `MAX_INPUT_CHARS` = **10,000** (≈ 660 s / 11 min of audio at 0.066 s/char; ≈ 120 parts; ≈ 20 min generation at
  1.8× real time). WAV ≈ 32 MB.
- **Start rule:** start playback at `min(playbackStartDelay(plan), MAX_START_WAIT_SECONDS = 20)` seconds after Speak,
  once ≥ 1 part is ready. Gap-free planning (§S7) still decides when it's earlier; after the cap, the player waits at
  part boundaries when it catches up (never mid-part) and counts the waits (shown as "playback waited n× (x s)").
  The card's "playback starts in about X s" shows the capped value.
- **Errors keep finished parts:** if `synthesize` rejects after ≥ 1 part (device lost, quota, unknown), SpeakTab
  joins the finished parts into the clip/Download as for Stop, shows the error, and labels the stats "stopped by an
  error — first n of m parts". A `no-voice` retry still happens only before the first part.
- **Memory (as built):** finished parts are stored as Int16 (`toPcm16` in `audio.ts`, same quantisation as
  `encodeWav`); `wavFromParts(parts, sampleRate)` builds the WAV `Blob` from a 44-byte header, the Int16 parts and
  shared zero-gap arrays — no joined `Float32Array` (byte-identical to `encodeWav(joinWithPauses(…))`, unit-tested).
  `keep(outcome)` in SpeakTab builds the clip once and clears the parts array. `SpeechPlayer` disconnects each source
  in `onended`. Target ≈ 100 MB; measured ≈ 60 MB above baseline at 10,000 chars.
- **Implementation:** `MAX_START_WAIT_SECONDS = 20` and `playbackStartAt(plan, cap) = max(firstReady,
  min(playbackStartDelay(plan), cap))` in `playback.ts`; `Clip.outcome` is `'complete' | 'stopped' | 'error'`.
- **Background tab:** if the page was hidden during a long job, the stats keep "tab was in the background"; the
  status line adds "Keep this tab visible for full speed" while hidden (`usePageHidden()` in `useHiddenWhile.ts`).
- **Measured (Apple Silicon, WebGPU, 2026-11-15):** 9,721 chars / 124 parts → playback at ≈ 21 s, generation 1,160.8 s,
  audio 674.1 s (1.80× real time), 94 waits totalling 470.2 s, 2 re-splits, WAV 32.4 MB; JS heap 75 → peak 135 MB.
  No clicks at the 239 joins. Error after 2 of 6 parts → 9.31 s clip kept with the error shown.

## S17. Built-in voices (Phase S9 — done 2026-11-15)

### S17.1 Sources and licence

| Dataset | Licence | Format | Notes |
|---|---|---|---|
| VCTK 0.92 (CSTR, University of Edinburgh) | CC BY 4.0 | 48 kHz, ~110 speakers, short read sentences (~3 s), `speaker-info.txt` with gender, age, accent | Accent variety (English, Scottish, Irish, Indian, American, Canadian, Australian, …) |
| LibriTTS-R (Google; restored LibriTTS) | CC BY 4.0 | 24 kHz, audiobook utterances, `speakers.tsv` with gender | Longer, natural narration (mostly US) |

Attribution: Speak tab footer + README — "Built-in voices: VCTK (CSTR, University of Edinburgh) and LibriTTS-R
(Google), licensed CC BY 4.0". Each manifest entry records dataset, speaker id and licence. Voices are described,
not named after people.

### S17.2 Curation (tooling in `.data/scripts/voices/`, not shipped)

1. Download metadata and only the needed audio (shortlisted VCTK speakers; one LibriTTS-R subset).
2. Shortlist ~14 candidates: ~5–7 female / ~5–7 male; accents US, English, Scottish, Irish, Indian,
   Australian/Canadian; spread of pitch and age.
3. Per candidate: join 2–3 clean sentences (≤ 0.3 s gaps) into **8–10 s**; resample to 24 kHz mono (VCTK);
   trim silence; loudness-normalise to ≈ −20 LUFS; peak ≤ −1 dBFS; 16-bit PCM WAV.
4. Quality gates (scripts reuse `.data/spike/speaker_sim.py`, `transcribe.mjs`, `pitch.py`):
   - distinctness: speaker-embedding cosine (Chatterbox `speech_encoder`) **< 0.75** to every other kept voice;
   - cloning: a fixed test sentence generated with the clip → cosine to the clip **≥ 0.85**;
   - intelligibility: Whisper transcript of the test sentence matches (formatting aside);
   - median F0 recorded for the description ("low / mid / high pitch").
5. Listening page (`.data/voices/review.html`): reference, test output, stats per candidate → **user approves** the
   final 8–10 and their descriptions.

### S17.3 Shipped files

```
src/lib/tts/voices.json  (moved here from public/ in S10 — bundled, see §S18)
                       [{ id, label, gender, accent, pitch, age?, description, file, seconds, bytes, sha256,
                          source: { dataset, speaker, utterances[] }, licence: "CC BY 4.0" }]
public/voices/
  <id>.wav             24 kHz mono 16-bit, 8–10 s (~400 KB) — ~4 MB for 10 voices
```

`id` is stable and URL-safe (e.g. `f-scottish-1`); `label` is shown in the dropdown ("Female · Scottish"),
`description` under it ("warm, mid-pitch, measured pace"). The Chatterbox `default_voice.wav` is listed first as
"Default (Chatterbox sample)" with `id: "default"` (not in `public/voices/`; already loaded with the model).

### S17.4 As built (2026-11-15)

- **Fetching:** VCTK via the `sanchit-gandhi/vctk` parquet mirror (metadata index, then one row group per speaker,
  `mic1` files, sentences after #24 to skip the shared "Please call Stella" set); LibriTTS-R utterances chosen from
  `parler-tts/libritts-r-filtered-speaker-descriptions` (dev/test-clean; 8–10.5 s, clean, very close-sounding,
  PESQ ≥ 3.6) and fetched from `mythicinfinity/libritts_r`. Tooling lives in `.data/voices/` (gitignored).
- **Clips:** VCTK *short* = 3 sentences of 1.8–4.5 s, *long* = 2 sentences of 3.2–6.5 s, 0.25 s gaps, best SNR;
  LibriTTS-R = one utterance cut at a pause ≤ 10 s. Resampled with `resample_poly`, trimmed (−40 dB, 80 ms pad),
  −20 LUFS (`pyloudnorm`), peak ≤ −1 dBFS, 16-bit.
- **Gates as run** (replacing the single-sentence rule in §S17.2): clone similarity = **mean over 2 test sentences**
  ≥ 0.85, on the better of the short/long VCTK variants; Whisper WER 0 on both; pairwise < 0.75 among kept voices;
  **< 0.75 to the Chatterbox default voice**. Default voice baseline: 0.92.
- **Shipped (10, approved):**

| id | label | description | source | clone | s |
|---|---|---|---|---|---|
| f-american-1 | Female · American | low pitch, brisk pace, audiobook narration | LibriTTS-R 8463 | 0.887 | 9.68 |
| f-english-1 | Female · English | high pitch, measured pace | VCTK p276 | 0.867 | 8.51 |
| f-indian-1 | Female · Indian | high pitch, measured pace | VCTK p248 | 0.929 | 8.29 |
| f-irish-1 | Female · Irish | mid pitch, measured pace | VCTK p288 | 0.898 | 8.09 |
| f-scottish-1 | Female · Scottish | low pitch, measured pace | VCTK p262 | 0.891 | 8.36 |
| m-american-1 | Male · American | high pitch, brisk pace, audiobook narration | LibriTTS-R 2300 | 0.867 | 9.28 |
| m-american-2 | Male · American | mid pitch, brisk pace, audiobook narration | LibriTTS-R 8455 | 0.893 | 8.04 |
| m-australian-1 | Male · Australian | low pitch, even pace | VCTK p326 | 0.886 | 8.34 |
| m-english-1 | Male · English | mid pitch, even pace | VCTK p232 | 0.864 | 8.39 |
| m-indian-1 | Male · Indian | mid pitch, even pace | VCTK p251 | 0.856 | 8.59 |

  Total 4.11 MB. Pitch words come from median F0 (female < 175 / > 215 Hz, male < 105 / > 130 Hz), pace from
  words per second. The manifest does **not** list `default`; S10 adds it in code.
- **Repo:** `.gitignore` re-includes `public/voices/*.wav`; `tests/unit/ttsVoices.test.ts` checks manifest ↔ files
  (24 kHz mono 16-bit, 8–10 s, peak ≤ −1 dBFS, sizes, ids, licence, attribution). Credits in the Speak footer and README.

## S18. Voice dropdown (Phase S10 — done 2026-11-15)

- `VoiceSelect` (`src/components/edge-ai/VoiceSelect.tsx`): native `<select>` (accessible, keyboard/mobile-friendly)
  with `<optgroup>`s "Built-in voices" and "Your voice"; options show `label`; below it the selected voice's
  `description`, its length and a ▶ preview (an `<audio>` of the clip). "Your voice… (upload / record)" reveals the
  upload/record/drop area from `VoicePicker` (S4), which stays as the custom-voice part of `VoiceSelect`.
- Value model: `{ kind: 'builtin', id } | { kind: 'custom', voice: CustomVoice }`.
- Manifest: `voices.json` fetched once by the main thread (site asset, small); clip URLs are site-relative
  (`/tools/voices/<id>.wav`).
- Worker: new request `{ type: 'encodeBuiltin'; voiceId: 'builtin:<id>'; url }` → `fetchCached(url)` (stores the clip in
  `tts-models/` — offline after first use) → `parseWav` → `resample` if needed → `encode`. Replies `voice`. Encoded on
  first use; the speaker cache keeps it for the session. (Alternative considered: precomputed conditioning tensors
  instead of WAVs — rejected: ~250 KB each too, no preview possible, and ties assets to this model.)
- `isTtsFileFor` / ready bytes don't include voice clips (optional, fetched on demand); the storage bar does
  (everything in `tts-models/`).
- Last chosen built-in voice id remembered in `localStorage` (`edge-ai-speak:voice`); uploaded audio never stored.

### S18.1 As built (2026-11-15)

- **Manifest bundled, not fetched:** `src/lib/tts/voices.json` is imported by `voices.ts` (`resolveJsonModule`), so
  the list works offline with no loading/error state (4.6 KB in the main bundle). `.data/voices/export.py` writes it.
- **Clip URLs are content-versioned:** `builtinVoiceUrl(v)` = `<origin><BASE_URL>voices/<file>?v=<sha256[:16]>`
  (absolute — the worker needs it, and it's the OPFS key). `getTtsCacheDetails` prunes stored clips whose URL is no
  longer current (`isStaleVoiceUrl`), so a replaced clip is never served from storage.
- **Worker:** `encodeBuiltin { voiceId: 'builtin:<id>', url }` → returns at once if the speaker cache has it, else
  `fetchCached(url)` (OPFS, then network) → `parseWav` → `resample` → `encode`. Replies `voice`. The client calls
  `notifyTtsCacheChanged()` after it, so the storage bar includes clips; Clear removes them with the model.
- **Value model:** a string `VoiceChoice` — `'default'`, a built-in id, or `'custom'` — instead of the tagged union.
- **SpeakTab:** `prepareBuiltin(id, eager)` runs through a promise queue (the worker takes one job at a time); eager
  prepares (on choice / when the model becomes ready) are skipped once another voice is chosen. `ensureVoice(force)`
  gives Speak the worker id for any choice and re-encodes after a `no-voice` error (worker restart). A failed prepare
  shows "Couldn't load the … voice: it downloads (412 KB) the first time it's used — check your connection. Using the
  default voice." and selects Default (the stored preference is kept). The dropdown stays enabled while a built-in
  voice prepares (only generation and custom-voice encoding lock it). Clip stats name the voice ("Male · English voice").
- **Dropdown UI** (`VoiceSelect`, shared `Select` with a new `wrapperClassName`): options "Label — description";
  below: ▶ Preview (plays the stored copy from OPFS when there is one, else the URL), "8.4 s sample · VCTK 0.92 speaker
  p232, CC BY 4.0", status ("Preparing voice…" / "Voice ready"). The consent note shows only for "Your voice…".
- **Remembered choice:** `edge-ai-speak:voice` holds a built-in id; Default removes it; custom is never stored; an
  unknown id (voice removed) loads as Default.
- **Verified in the browser (WebGPU, q4f16):** the 11 voices each spoke the S9 test sentence — every output is closest
  to its own reference (similarity 0.84–0.94, margin ≥ 0.13 over the next voice), Whisper word-perfect on all,
  1.34–1.93× real time. With huggingface.co and `/tools/voices/` blocked (including the worker's requests): the
  remembered voice was restored and prepared after reload, Preview played the stored copy, speech was generated; a
  clip deleted from storage failed with the message above and fell back to Default, then loaded once unblocked.
  Five rapid dropdown changes: the select never disabled, the last choice ready ~0.3 s later.

## S19. Script format and parser (Phase S11 — done 2026-11-15)

### S19.1 Syntax

```
[S1] Hi, did you hear the news?
[S2] [exaggeration 0.8] No! Tell me everything.
[pause 1.5s]
[S1] Well… it's a long story. [pause 500ms] A very long one.
```

| Marker | Meaning | Values |
|---|---|---|
| `[S1]` … `[S4]` | Start a turn by that speaker (conversation mode). May appear at line start or inline | 1–4 |
| `[exaggeration X]` | Exaggeration for the turn it's in (overrides the speaker's default) | 0–1.5 |
| `[pause Xs]`, `[pause X s]`, `[pause Xms]` | Silence at that spot; **replaces** the automatic gap there. Inside a turn it splits the turn into two lines of the same speaker | 0–10 s |

Case-insensitive; whitespace inside brackets is tolerated. In **single mode** there are no speaker tags; each line is
a turn (for `[exaggeration]` scope); `[pause]` works the same.

### S19.2 Parser

`src/lib/tts/script.ts` — pure:

```ts
interface Turn { speaker: 1 | 2 | 3 | 4; text: string; exaggeration?: number; pauseBefore?: number; line: number }
interface Diagnostic { line: number; severity: 'error' | 'warning' | 'hint'; message: string }
function parseScript(text: string, opts: { mode: 'single' | 'conversation' }):
  { turns: Turn[]; speakers: number[] /* order of first appearance */; diagnostics: Diagnostic[];
    summary: { speakers: number; turns: number; chars: number; estSeconds: number } }
```

| Situation | Diagnostic |
|---|---|
| `[S5]` or higher / `[S0]` | error — "Up to 4 speakers ([S1]–[S4])"; Speak disabled |
| Value out of range / unparsable (`[pause 20s]`, `[exaggeration high]`) | error with the allowed range |
| Unknown `[…]` (e.g. `[laughs]`) | warning — "Not a marker — it will be read aloud" |
| Text before the first tag (conversation) | warning — assigned to Speaker 1 |
| Speaker tag in single mode | hint — "Switch to Conversation for multiple speakers" |
| Turn with only markers / whitespace | dropped silently (its `[pause]` still applies) |

Summary line under the text box: "3 speakers · 14 turns · about 1 min 40 s of audio". Turns are then chunked with
`splitIntoChunks` (≤ 120 chars), keeping sentence/paragraph pauses inside a turn.

### S19.3 Timing

| Between | Silence |
|---|---|
| Sentences of the same turn | 0.15 s (`PAUSE_SECONDS.sentence`) |
| Paragraphs of the same turn / consecutive turns of the same speaker | 0.4 s |
| Turns of different speakers | 0.5 s (`TURN_GAP_SECONDS`) |
| Where a `[pause]` marker is | the marker's value (replaces the above) |

### S19.4 As built (2026-11-15)

- **`parseScript`** (`src/lib/tts/script.ts`) tokenises `[…]` markers (no newlines inside), case-insensitive and
  whitespace-tolerant (`[ s3 ]`, `[PAUSE 2 S]`, `[Exaggeration .25]`). `[pause X]` accepts `s`, `sec(s)`, `second(s)`,
  `ms`, or no unit (seconds). `Turn` gains `paragraph` (single mode: the line follows a blank line).
- **Pauses:** consecutive `[pause]` markers add up; a pause applies to the next text, so `[pause]` on its own line
  between turns sets the gap before the next turn; one inside a turn splits it (same speaker and exaggeration). A pause
  before the first words / after the last → hint "has no effect" (ignored).
- **Extra diagnostics:** two different `[exaggeration]` values in one turn/line → warning, last wins. Single mode:
  speaker tags are removed with one hint ("speaker tags only apply in Conversation mode, so they're ignored here").
- **`planChunks(script, exaggeration | (speaker) => number)`** → `{ text, speaker, exaggeration, pause, turn }[]`:
  each turn is chunked with `splitIntoChunks`; between turns the `[pause]` value, else 0.5 s (speaker change), 0.4 s
  (same speaker, conversation) or the line / paragraph pause (single). Single mode first merges consecutive lines
  with the same exaggeration and no pause, so **marker-free text is chunked exactly as before** (unit-tested).
- **Engine (pulled forward from S12):** `synthesize` takes `SynthChunk = { text, exaggeration }[]` so single mode can
  honour `[exaggeration]` per line; the voice stays per call until S12.
- **UI:** `about 8 s of audio · 145 / 10,000` above the text box (estimate = chars × 0.066 s + gaps); `ScriptNotes`
  under the text box/voice row lists diagnostics (errors first, 3 shown + "Show n more"; "Line n" selects that line);
  any error disables Speak and sets `aria-invalid`; the footer hint explains the two markers.
- **Verified in the browser:** typing a script with `[S2]`, `[laughs]`, `[exaggeration 3]`, `[pause 20s]` showed the
  hint, warning and two errors (errors first), Speak disabled, "Line 3" selected `[pause 20s]`. A valid single-mode
  script (`[exaggeration 0.3]` line, `[exaggeration 1.3]` line with `[pause 2s]` inside) sent chunks with
  exaggeration 0.3 / 1.3 / 1.3; the WAV had a 2.16 s silence at the pause (2 s + natural) and 0.32 s at the line
  change; Whisper transcript word-perfect, no marker read aloud.

## S20. Conversation mode (Phase S12 — done 2026-11-15)

### S20.1 UI

- Switch "Single voice / Conversation" (Segmented) above the text box; each mode keeps its own text, voices and
  settings.
- Speaker cards (fixed-height row, up to 4, in order of first appearance): "Speaker n" · `VoiceSelect` · default
  exaggeration slider. Cards follow the detected speakers; a removed speaker's choice is remembered while the tab is
  open. A speaker without a usable voice (custom selected, no clip yet) blocks Speak with a note.
- Output card: stitched `<audio>` + Download WAV + "Download lines (.zip)"; stats add "n turns · S1: a, S2: b, …".
  Progress shows "Part n of m".

### S20.2 Engine

- `synthesize` request becomes `{ chunks: { text: string; voiceId: string; exaggeration: number }[] }`
  (single mode fills the same voice/exaggeration). The client keeps `TtsClient.synthesize(chunks, onChunk)`.
- Before generation: every voice used is encoded (built-in via `encodeBuiltin`, custom via `encodeVoice`); a
  `no-voice` error triggers one re-encode of that voice and a retry (as S4).
- The worker looks up the speaker per chunk; switching speakers costs nothing extra (cached conditioning tensors).

### S20.3 Stitching

- Each chunk carries `{ turnIndex, pauseBefore }` (computed from §S19.3) in the client-side plan.
- Playback: the same `SpeechPlayer` queue and start rule (§S7, §S16) with these pauses.
- Final WAV: `joinWithPauses` over all chunks. Per-turn WAVs (for the zip): `joinWithPauses` over each turn's chunks
  (intra-turn pauses only).
- Re-split chunks (§S5.1) stay within their turn.

### S20.4 As built (2026-11-15)

- **`useVoiceSlot`** (`src/components/edge-ai/useVoiceSlot.ts`): the S10 voice logic moved out of SpeakTab — choice,
  your-voice clip, prepare / encode, errors and fallback, `ensure(force)` → worker voice id. SpeakTab calls it five
  times (single + Speakers 1–4, fixed hook order). All slots share one module-level encode queue (the worker takes one
  job at a time). Only slots in use prepare their built-in voice eagerly. Custom clip ids are `voice-<slot>-<n>`.
- **Remembered voices:** single mode `edge-ai-speak:voice`, speakers `edge-ai-speak:voice:s<n>`; `default` is now
  stored too (so a speaker can keep Default instead of its fallback). New conversations start with distinct voices
  (`DEFAULT_SPEAKER_VOICES`: S1 Female · American, S2 Male · American (mid), S3 Female · English, S4 Male · Australian).
- **Engine:** `SynthChunk = { text, exaggeration, voiceId }`; the worker resolves every chunk's voice before generating
  (a missing one → `no-voice` before any audio); SpeakTab then re-encodes every voice used (`ensure(true)`) and retries
  once. Re-split halves use their chunk's voice.
- **UI:** "Single voice / Conversation" switch (Segmented, locked while generating); text kept per mode. Conversation:
  a taller text box (h-56) with an example placeholder, the summary "3 speakers · 5 turns · about 16 s of audio",
  then `SpeakerCards` (2 columns ≥ sm, h-52 cards with the exaggeration slider and turn count; an empty dashed area
  of the same height until the first tag). The global exaggeration slider is single-mode only. A speaker on "Your
  voice…" without a clip disables Speak: "Speaker 2 needs a voice clip — record or upload one, or pick a voice."
- **Output:** the same buffered playback and stitched WAV (`wavFromParts`; gaps from `planChunks`); parts carry
  `turn` for the S13 zip. Stats: "5 turns", "Speaker 1: Female · American voice, 2 turns", …
- **Verified in the browser (WebGPU):** a 3-speaker, 5-turn script with `[exaggeration 0.9]`, `[pause 1.5s]` between
  turns and `[pause 1s]` inside a turn, Speaker 3 at 0.3: the request carried the right voice and exaggeration per
  chunk (0.5 / 0.9 / 0.3 / 0.3 / 0.5); each part was closest to its own speaker's reference (0.66–0.83 vs ≤ 0.45 for
  the others); the stitched WAV = parts in turn order with 0.5 / 1.5 / 1.0 / 0.5 s of digital silence (segment
  correlation 1.000; only the peak limiter differs), 16.22 s; Whisper word-perfect. Speak blocked for a speaker
  without a clip; text and speaker voices kept across mode switches and when a speaker's tag is removed and re-added;
  single mode still generated with a `[pause]`.

## S21. Zip of per-line WAVs (Phase S13 — done 2026-11-15)

- `src/lib/tts/zip.ts`: `createZip(files: { name: string; data: Uint8Array | Blob }[]): Blob` — **store-only**
  (method 0), local file header + data + central directory + end-of-central-directory record; CRC-32 (table-driven);
  UTF-8 names (flag bit 11); DOS date/time of creation. No ZIP64 (well under 4 GB / 65,535 entries). No dependency.
- Contents: one WAV per turn, numbered in turn order with zero-padding to the turn count — `001-S1.wav`,
  `002-S2.wav`, …; single mode: `001.wav`, `002.wav`, … per line/turn. Pauses are not separate files.
- Button "Download lines (.zip)" next to Download WAV; file name `speech-<yyyyMMdd-HHmmss>.zip`.
- Tests: CRC-32 test vectors; header/central-directory fields; a minimal reader in the test round-trips names and
  bytes. Manual: opens in macOS Archive Utility and Windows Explorer.

### S21.1 As built (2026-11-15)

- **What a line is** (decided 2026-11-15): conversation — one file per turn (a `[pause]` inside a turn splits it, as in
  §S19); single mode — **one file per paragraph** (blank-line separated), plus where a marker splits a line
  (`[pause]`, a line with its own `[exaggeration]`). Generation is unchanged: `planChunks` adds `line` to each chunk
  (chunks never cross a line).
- **`zip.ts`:** `createZip(entries: { name, data: Uint8Array | Uint8Array[] }[], modified)` — data may be pieces
  (WAV header + PCM buffers), CRC-32 is computed incrementally over them and the Blob is built from them, so no
  joined copy. Version 2.0, flag bit 11 (UTF-8), method 0, DOS local time; throws past 65,535 entries / 4 GB.
- **`audio.ts`:** `wavPieces(parts, sampleRate)` (header + part buffers + shared silence) — `wavFromParts` wraps it.
- **`lines.ts`:** `lineEntries(parts, sampleRate, conversation, total)` groups consecutive parts by `line`, names them
  `lineFileName(line, total, speaker?)` → `001-S1.wav` / `001.wav` (≥ 3 digits, padded to the job's line count even
  after Stop), first part's pause dropped, pauses inside a line kept. `linesZip` returns null for a single line.
- **UI:** "Download lines (.zip)" (FileArchive icon; label hidden below `sm`; aria-label "Download lines (.zip, n
  files)", tooltip "One WAV per turn/paragraph, numbered in order") next to Download WAV, only when there are ≥ 2
  lines. Built in `keep()` from the same Int16 parts as the WAV, so Stop / error zips hold the finished lines;
  `speech-<yyyyMMdd-HHmmss>.zip` with the same timestamp as the WAV; its blob URL is revoked with the clip.
- **Verified:** a 3-speaker, 5-line conversation → zip `001-S1 … 005-S3.wav`; `unzip -t` OK, Python `zipfile.testzip()`
  OK, `ditto -x -k` (the engine behind macOS Archive Utility) extracts, `afinfo` reads each as 24 kHz Int16 mono;
  in name order the files are byte-identical runs of the stitched WAV separated only by digital silence (0.5 / 1.0 /
  0.5 / 0.5 s). Single mode: two paragraphs → 2-file zip; one paragraph → no zip button. Windows Explorer not tested
  here (no Windows machine) — the format is the plain stored-zip subset it reads; left for S7's manual check.

---

## Pocket Chat (standalone; C1–C3 done, C4–C5 planned)

Companion to [PLAN.md — Pocket Chat](./PLAN.md#pocket-chat-standalone-tool-and-prompt-templates). This section is
the agreed target design for moving Gemma Chat out of Edge AI Studio. C1–C3 are implemented; polish and
templates remain planned. The existing Gemma worker, model cache and `edge-ai-chat` IndexedDB data remain the
foundation.

### Placement and migration

- **Tool name / route:** Pocket Chat, hash route `#/pocket-chat`.
- **Registry:** `pocket-chat` is registered in `src/tools.ts` with the opt-in `full-height` layout field on `Tool`;
  `App.tsx` uses that layout only for Pocket Chat. All other tool routes keep the existing contained `max-w-6xl`
  shell, title and padding.
- **Edge AI Studio:** Chat and its Gemma / Saved chats entries have been removed from its storage menu. It keeps
  Listen, See, Act and Speak. Pocket Chat owns the storage menu for Gemma weights and Saved chats.
- **Component ownership:** Chat-only `ChatTab`, `ConversationList` and `Markdown` now live under
  `src/components/pocket-chat/`; shared `ModelGate`, `StorageMenu`, `useAudioCapture`, `shared.tsx`,
  `useHiddenWhile` and `useOnline` remain under `src/components/edge-ai/`.
- **Preserve data:** do not rename the OPFS Gemma directory or IndexedDB database `edge-ai-chat`. Existing
  conversations, attachments and last-open conversation must continue to work after the route change.

### Full-height responsive UI

- The page occupies the viewport height (`100dvh`, falling back to `100vh`) and does not scroll as a whole. A slim
  app header contains the All tools link and Pocket Chat name; the chat header contains compact Gemma status and the
  storage menu. Safe-area insets are respected.
- The chat body is a `min-h-0 flex-1` region. On desktop it contains a fixed-width conversation sidebar and a
  flexible message/composer column. The transcript scrolls independently and centres its content in a readable
  max-width column; the sidebar scrolls independently.
- On narrow screens the sidebar is hidden behind a Chats button and opens as an overlay drawer aligned to the
  transcript. Opening/closing it does not resize or shift the conversation.
- Before the model is ready, the download gate occupies the empty conversation area rather than a permanent row;
  saved messages remain readable with the gate above them. Once ready, show a compact status in the chat header.
  Model errors and cache-write warnings remain visible.
- The existing transcript auto-scroll, attachments, audio playback/recording, Markdown, Stop, Copy, saved-chat
  actions, keyboard behavior and screen-reader status remain available.
- Use mobile dynamic viewport sizing and safe-area insets; the composer remains visible when the virtual keyboard
  is open. Verify at desktop, tablet and phone sizes.

### Composer and generation settings

- The composer is anchored at the bottom of the message column. Its textarea grows from one to about eight lines,
  then scrolls internally; the transcript takes the remaining height (`min-h-0 flex-1`).
- Attachments occupy a bounded strip inside the composer. Adding/removing files or typing does not move the header,
  sidebar or surrounding tool layout.
- Enter sends; Shift+Enter adds a newline; Esc stops generation. Keep the existing labels and accessible names.
- Temperature, Max reply and Thinking move from the visible settings row into a keyboard-accessible Settings
  popover beside Send. It closes on Escape or outside click and retains per-conversation settings.

### Prompt templates (Phase C5)

- **Sources:** ship built-in Markdown templates and let users import `.md` files through the browser file picker.
  Templates are selectable in Pocket Chat. The app remains static and processes template content locally; no
  template service or network request is introduced.
- **Initial format:** follow `.data/prompts/tts-conversation.md`. A `## Settings` section contains one fenced block
  of `KEY = value` lines. Each initial value seeds a form field. Matching `- KEY: description` entries below the
  block are shown as help text; wrapped description lines belong to that setting. Split a setting line at its first
  `=` so values may themselves contain `=`.
- The Settings block is the editable input region. Rendering substitutes only its values and preserves the
  template's other instructions and output constraints verbatim. Validate template structure and show a useful
  error rather than silently dropping instructions or submitting an empty prompt.
- Selecting a template opens its generated fields. On submit, render the whole template, start a new conversation,
  and immediately send the rendered text as that conversation's first user message. The normal chat pipeline,
  worker, generation settings and save path handle it.
- The rendered first message is persisted in the conversation, so reload and follow-up turns retain the template
  instructions in history. Do not reapply the template to later turns; subsequent messages are normal chat.
- The attached TTS conversation prompt is an example of a *template input*, not content to hard-code as the only
  template. It must be possible to add other built-in or imported templates.
- **Still to decide before implementation:** how imported templates persist across reloads, and how authors declare
  field types, required values and validation constraints. Until a schema is agreed, treat values as text fields
  seeded from the Settings block; do not infer validation rules from prose.

### Pocket Chat verification targets

- **C3 as built:** `SettingsPopover` (in `ChatTab.tsx`) holds Temperature, Max reply and Thinking; the composer
  textarea is sized from `scrollHeight` in a layout effect and capped at `max-h-44`.
- **C2 as built:** Only Pocket Chat opts into `full-height`. The shell uses the dynamic viewport height where
  supported, with safe-area padding, and keeps the rest of the routes on the existing contained layout. The
  conversation list has its own scroll area; the transcript fills and scrolls within the remaining height. On
  narrow screens, the list opens as an overlay drawer without changing the transcript width.
- Existing saved conversations survive the move and open at `#/pocket-chat`; Edge AI Studio no longer loads or
  displays Chat.
- At desktop and mobile viewport sizes, the app page does not scroll; only transcript, sidebar/drawer and a
  long textarea scroll. Opening the drawer and streaming do not shift the layout.
- All composer actions, settings, drawer and saved-chat controls work by keyboard and remain announced accessibly.
- A built-in and an imported sample template each render the correct values and preserved instructions. The
  rendered prompt is the first persisted user message; the next follow-up does not receive a second template
  injection.
