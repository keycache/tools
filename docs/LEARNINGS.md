# Project Learnings & Findings

This file documents non-obvious findings, solutions, and missteps encountered while developing this tools application. Entries are added when solving issues that required more than 2-3 attempts.

## PDF.js Worker Setup in Bundled Environment

**Problem**: PDF compression tool failed at runtime with "Setting up fake worker failed: 'error loading dynamically imported module from CDN'" when trying to load the PDF.js worker from a CDN URL.

**Solution**: 
- Use Vite's module resolution to load the worker from pdfjs-dist package directly
- Create the worker URL using `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href`
- Vite automatically bundles this as an asset and Provides the correct URL at runtime
- The worker gets bundled alongside the main app (~1.2 MB minified)

**Missteps**:
1. Initially tried loading worker from CDN: `//cdnjs.cloudflare.com/ajax/libs/pdf.js/...` - failed due to CORS and module import issues
2. Attempted to manually copy worker file with Vite plugin - unnecessary, Vite handles it automatically
3. Used wrong file extension `.min.js` instead of `.min.mjs` that pdfjs-dist actually provides

**Key Insight**: 
- pdfjs-dist uses `.mjs` (ES modules) not `.js`
- Vite automatically resolves `new URL()` with `import.meta.url` during build, converting it to a bundled asset path
- The worker is separate from the main bundle (~1.2 MB) for modularity but still included in the build
- No custom copy plugins needed - let Vite handle it

---

## PDF Compression via Image Rendering

**Problem**: Building a browser-based PDF compression tool that actually reduces file size while maintaining reasonable quality. Standard PDF stream compression isn't available client-side.

**Solution**: 
- Use `pdfjs-dist` to render each PDF page to canvas at 2x scale (viewport scale: 2)
- Compress canvas to JPEG/PNG/WebP using quality slider (1-100%)
- Use `pdf-lib` to embed compressed images back into a new PDF document
- Estimate output size by sampling first page, multiply by total pages, add 5% overhead for PDF structure

**Missteps**:
1. Initially tried to find a client-side PDF stream compression library - no good options exist
2. Attempted direct ArrayBuffer manipulation - PDF format is complex, error-prone
3. Used single-scale rendering (1x) - resulted in blurry text at lower quality levels; 2x scale mitigates this
4. Didn't account for PDF structure overhead in size estimation - estimated size was 10-15% off

**Key Insight**: 
- Image-based approach is lossy but transparent to users (similar to Acrobat's export to image-then-PDF workflow)
- Rendering at 2x then compressing gives better quality than rendering at 1x
- Size estimation only needs to sample first page - pages in a document typically have similar compression ratios
- pdf-lib type definitions have complex SharedArrayBuffer issues with TypeScript - use `as any` for ArrayBuffer conversions

---

## Web Audio API - Oscillator Timing & AudioContext Closure

**Problem**: Timer completion sound was continuing to play even after clicking "Dismiss Alarm". Sound played twice when triggered, creating a confusing user experience.

**Solution**: 
- Moved sound start logic into a dedicated `useEffect` with `isCompleted` dependency
- Used a `useRef` flag (`soundStartedRef`) to prevent multiple sound instances
- Called `ctx.close()` immediately when dismissing instead of deferred muting
- Key: `ctx.close()` is the only reliable way to halt all oscillators and audio graph processing

**Missteps**:
1. Initially tried setting `gain.gain = 0` to silence output, but oscillators continued running in the audio graph
2. Called `playTimerCompleteSoundLooped()` inside a `setState` callback, which runs multiple times in Strict Mode
3. Delayed closure of AudioContext with `setTimeout`, which didn't stop audio immediately

**Key Insight**: 
- Oscillators scheduled on the audio timeline execute independently of JavaScript event loop
- Setting gain to 0 mutes output but doesn't stop audio graph processing
- `useEffect` with guard flags (`useRef`) is the correct pattern for side effects that should only run once
- `useState` callbacks (second argument) are not reliable for one-time initialization

---

## React State Initialization from localStorage

**Problem**: Sound selection would revert to "alarm" after page refresh instead of persisting.

**Solution**: Initialize state with a function that reads localStorage immediately:
```typescript
const [selectedSound, setSelectedSound] = useState(() => {
  return localStorage.getItem('selectedSound') || 'alarm'
})
```

**Missteps**:
1. Used a separate `useEffect` to load from localStorage after initial render - created race condition where initial render was "alarm", then updated to saved value
2. This caused visual flicker and selection loss across tab changes

**Key Insight**: 
- `useState` runs during render with its initial value
- A separate `useEffect` runs *after* render completes
- For localStorage-backed state, use an initializer function in `useState` to avoid render/update race conditions
- The save effect can remain separate - it's the load that needs to be in initialization

---

## Sound Looping - Interval-Based Repetition

**Problem**: Non-looped sounds (alarm, beep, etc.) would play only once instead of for the full 60-second duration like the timer.

**Solution**: Created a `playLoopedSound()` wrapper that:
- Calls the sound function every 500ms (matches typical sound duration)
- Runs for exactly 60 seconds
- Returns a `stop()` function for immediate cancellation

**Missteps**:
1. Tried to have each sound function handle its own looping - error-prone and inconsistent
2. Initially set interval to 1000ms, which created noticeable gaps between sounds

**Key Insight**: 
- Not all sounds are naturally "looped" - the Web Audio API requires manual repetition with `setInterval`
- Consistent 500ms interval works well for all sound types (covers all durations)
- Centralizing loop logic in one wrapper prevents duplicate code and bugs

---

## Component State vs Parent State - Sound Selection

**Problem**: Sound selection was lost when switching between tabs because state was local to `SoundTab` component.

**Solution**: Moved `selectedSound` state to parent `ClockTool` component and passed it down as props to all child tabs.

**Missteps**:
1. Initially kept sound selection state only in `SoundTab` - works until you switch tabs
2. Tried to use only localStorage as the source of truth - adds unnecessary latency and complexity

**Key Insight**: 
- State needed by multiple components should live at their common parent
- Stopwatch already had this pattern (parent-level state passed down)
- localStorage is for *persistence* across sessions, not for cross-component communication
- This pattern makes it easy to use `selectedSound` in alarm/timer triggers

---

## Alarm Time Monitoring - Polling Interval

**Problem**: Setting alarms for future times required checking when the current time matched the alarm time.

**Solution**: Use a 1-second `setInterval` in a `useEffect` to check if `now.getHours() === alarmDateTime.getHours() && now.getMinutes() === alarmDateTime.getMinutes()`.

**Missteps**:
1. Initially thought about using `setTimeout` to calculate exact delay until alarm time - too fragile with timezone changes and page visibility
2. Considered using `requestAnimationFrame` - overkill for second-level precision

**Key Insight**: 
- Polling every 1 second is simple and resilient for minute-level timing
- Much simpler than calculating exact delay or using precision timers
- Page can lose focus, browser can be throttled - polling handles these gracefully
- Only checking hours and minutes (not seconds) is intentional - user sets alarms to the minute level


---

## Cactus WASM Engine (Edge AI Studio) - Loading & Calling the C ABI

**Problem**: Run the Cactus engine (`public/models/cactus/cactus.js` + `cactus.wasm`) and three `.cact` models in the browser, cache-first, without blocking the UI.

**Solution**:
- Run everything in a module Web Worker (`src/lib/cactus/cactus.worker.ts`); describe/complete take 0.3–2 s and would freeze the page.
- `cactus.js` is UMD/CommonJS Emscripten glue. Read it from Cache Storage, append `export default createCactus`, and `import()` it from a blob URL. Pass `wasmBinary` so it never fetches `cactus.wasm` itself.
- The build is single-threaded (no `SharedArrayBuffer`), so no COOP/COEP headers are needed – works on GitHub Pages.
- `cactus_load(ptr, n)` takes a `u64` → pass a `BigInt`. The engine copies the bytes, so free the buffer right after.
- One engine holds all three models at once (`cactus_models()` bitmask 1|2|4, ~260 MB heap).
- Needle is stateful: call `cactus_init(system, toolsJson, NULL)` then `cactus_reset()` before every independent `cactus_complete`.
- Mirage geometry (bbox `[x1,y1,x2,y2]`, flat polygon masks) is on a 0–1000 scale relative to the image → SVG `viewBox="0 0 1000 1000" preserveAspectRatio="none"`.
- Mirage string form fields (`{type:"string"}`) are unreliable; enum/integer fields return calibrated probabilities (`"-"` = abstain).

**Missteps**:
1. `require('cactus.js')` in Vitest returned nothing: the repo's `"type": "module"` makes Node treat it as ESM. Tests evaluate it with `new Function('module','exports','require',…)` instead.
2. `/// <reference lib="webworker" />` in the worker leaks WebWorker types into the whole DOM program and clashes – type the few worker globals locally.
3. `caches.open()` *creates* a cache, so a status check after "Clear" resurrected an empty cache. Check with `caches.has()` first.

**Key Insight**: The Python SDK in github.com/cactus-compute/cactus (`cactus/agent/*.py`) is the best reference for the C ABI contract. Bump `ASSET_VERSION` in `src/lib/cactus/assets.ts` whenever model files change; `tests/unit/cactusEngine.test.ts` fails if registry byte sizes drift.

---

## Timers Pause in Background Tabs (Clock: Timer & Stopwatch)

**Problem**: The countdown timer (and stopwatch) nearly stopped while the browser tab was hidden, but kept running when the tab stayed visible and only the window lost focus.

**Solution**: Derive time from the wall clock instead of counting ticks. Store a deadline (`endAt = Date.now() + remaining`) or start anchor (`startedAt = Date.now() - elapsed`) when starting, and on each tick compute `endAt - Date.now()` / `Date.now() - startedAt`. Also re-sync on `visibilitychange`, and schedule a one-shot `setTimeout` for the exact finish time so the alarm isn't delayed.

**Missteps**: The original code did `timeLeft - 100` every 100ms `setInterval` tick (stopwatch: `time + 10` every 10ms), assuming ticks arrive on schedule.

**Second cause (the one actually reported)**: "the tab" meant the Clock tool's own Timer tab, not the browser tab. `ClockTool` rendered panels with `activeTab === 'timer' && <TimerTab/>`, so switching to Stopwatch/Alarm *unmounted* the timer and killed its interval (and its state). Fix: keep every panel mounted and toggle the `hidden` attribute; a ringing timer/alarm calls `onAlert` so the parent switches to its tab (otherwise Dismiss would be hidden).

**Key Insight**: Anything that must keep running (timers, alarms, recordings) can't live in a conditionally-rendered component. Also: browsers throttle timers in *hidden* tabs (≥1s; Chrome's intensive throttling ~1/min for chained timers after ~5 min hidden). A blurred-but-visible window isn't throttled, which is why it "worked" there. Tick counting is only correct if every tick fires; wall-clock math is correct no matter how often ticks fire.

---

## Multi-GB Models in the Browser: Cache Storage Fails, Use OPFS (Gemma Chat)

**Problem**: Gemma 4 E2B (~3.2 GB) loaded fine, but every reload re-downloaded ~3 GB. The console showed `Unable to add response to browser cache: UnknownError: Failed to execute 'put' on 'Cache': Unexpected internal error.` for exactly the two largest files (1.52 GB and 1.59 GB). Then, with caching fixed, loading **offline** still failed with "Failed to fetch".

**Solution**:
1. Store model files in the **Origin Private File System** via Transformers.js's custom-cache hook: `env.useBrowserCache = false; env.useCustomCache = true; env.customCache = new OpfsModelCache(...)` (`src/lib/gemma/opfsCache.ts`, only `match`/`put` needed). Stream to disk and write a small `.meta.json` last so partial files are never served.
2. Map `resolve/main/` URLs to the pinned revision inside the cache (`pinGemmaRevision`), because Transformers.js 4.3.2's `get_tokenizer_files()` probes `tokenizer_config.json` without passing `revision`.

**Missteps**:
1. Assumed "it's a quota problem" — quota was 10.5 GB with ~9 GB free.
2. Tried streaming the body into `cache.put` (`new Response(ReadableStream)`) instead of one big buffer — Chromium rejected the 1.6 GB entry the same way. A quick in-page probe (Cache API buffer vs stream vs OPFS, same 1.6 GB) settled it: only OPFS worked.
3. A normal online reload looked fine (13 s, model from storage) — only blocking huggingface.co revealed the stray `resolve/main/tokenizer_config.json` request that breaks offline use.

**Key Insight**: Cache Storage is fine for tens of MB (the Cactus models) but not for single files in the GB range; OPFS is the right store for large model weights. And "works offline" must be tested by actually blocking the network — libraries can make small metadata requests that bypass caches.
