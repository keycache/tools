# Project Learnings & Findings

This file documents non-obvious findings, solutions, and missteps encountered while developing this tools application. Entries are added when solving issues that required more than 2-3 attempts.

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

