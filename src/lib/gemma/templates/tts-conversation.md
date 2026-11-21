You are writing a script for a text-to-speech app that turns a tagged script into a multi-speaker audio conversation. The app reads your output literally, so follow the format exactly.

## Settings (the only part to edit)
```
LANGUAGE      = English
FOREIGN_WORDS = none
TOPIC         = Two friends catch up after a long trip
SPEAKERS      = 2
LENGTH        = about 20 turns
TONE          = casual
```
- LANGUAGE: the language the whole conversation is spoken in.
- FOREIGN_WORDS: `none`, or which other-language words may appear (e.g. "Spanish words and short phrases for fruits,
  vegetables and telling the time"); everything else stays in LANGUAGE.
- TOPIC: the scene, who the speakers are and what happens.
- SPEAKERS: 1 to 4.
- LENGTH: a number of turns or minutes of audio.
- TONE: e.g. casual, dramatic, comedic, informative.

Everything below refers to these settings by name — follow them throughout.

## Output format
Output ONLY the script, inside a single fenced code block, with no commentary before or after it. Inside the block, use only spoken text and the markers below.

Example:
```
[S1] Hi, did you hear the news?
[S2] [exaggeration 0.8] No! Tell me everything.
[pause 1s]
[S1] Well… it's a long story.
```

## Markers (the only bracketed text allowed)
1. Speaker tags: `[S1]`, `[S2]`, `[S3]`, `[S4]`
   - Every turn starts with a speaker tag. A turn lasts until the next speaker tag.
   - At most 4 speakers. `[S0]`, `[S5]` and higher are errors.
   - Number the speakers from S1 upwards (S1, S2, S3…), and make S1 speak first.
   - The very first thing in the script must be a speaker tag. Text before it is still spoken by S1, but the app flags it.
   - Put each turn on its own line, starting with the complete tag — opening and closing bracket: `[S1]`, never `S1]`
     or `[S1`. A turn may span several lines.
2. Pauses: `[pause 1.5s]`, `[pause 500ms]`
   - Allowed range is 0 to 10 seconds. Decimals are fine. Units can be `s` or `ms`.
   - A pause replaces the automatic gap at that spot; it doesn't add to it.
   - On its own line between two turns, it sets the silence before the next turn.
   - Inside a turn, it adds silence mid-turn and splits that turn into two lines of the same speaker.
   - Several pauses in a row add up.
   - A pause before the first words or after the last words does nothing. Don't put one there.
3. Exaggeration: `[exaggeration 0.8]`
   - Allowed range is 0 to 1.5. The speaker's default is usually 0.5.
   - It applies to the whole turn it appears in, so it MUST come immediately after that turn's speaker tag, on the
     same line: `[S1] [exaggeration 0.7] Yes, we are!`. Never put it on its own line or before a speaker tag — there
     it belongs to the previous turn and changes the wrong speaker. At most once per turn.
     - Wrong: `[exaggeration 0.7]` on one line, then `[S1] Yes, we are!` on the next.
     - Right: `[S1] [exaggeration 0.7] Yes, we are!`
   - As a guide: 0.3 is calm or flat, 0.5 is neutral, 0.7–0.9 is lively or excited, and 1.0+ is very intense (use rarely).
   - Higher values also make speech a little faster.

## Hard rules
- All spoken text must be in LANGUAGE, except the words allowed by FOREIGN_WORDS (if it isn't `none`). Keep marker keywords exactly as shown (`S1`, `pause`, `exaggeration`) — never translate them.
- Foreign words (only if FOREIGN_WORDS isn't `none`): write them in their normal spelling with accents (manzana, piña, ¿Qué hora es?), keep them short — a word or a short phrase, then explain or repeat it in LANGUAGE in the same turn. No phonetic respellings, no translations in brackets or parentheses (brackets are read aloud).
- No other square brackets. Anything else in brackets, such as `[laughs]`, `[sighs]`, `[music]` or `[whispering]`, is read aloud as words. There are no sound effects or stage directions. Express emotion through wording, punctuation and the exaggeration marker.
- Markers must fit on one line, with no line break inside the brackets and no nested brackets.
- No speaker names or labels like "Alice:" or "HOST:". Voices are assigned to S1–S4 in the app, and labels would be read aloud. Characters may address each other by name inside their dialogue.
- No markdown inside the script: no `*asterisks*`, headings, bullets, emoji or (parenthetical stage directions).
- Speakers can't talk over each other. Turns play strictly one after another.
- The whole script must be under 10,000 characters including markers. Aim for at most 9,000.

## Timing the app adds automatically (only use [pause] to change it)
| Between | Silence |
|---|---|
| Turns of different speakers | 0.5 s |
| Consecutive turns of the same speaker | 0.4 s |
| Sentences within a turn | 0.15 s |
| Paragraphs within a turn (blank line inside a turn) | 0.4 s |

So use `[pause]` only for deliberate beats: a dramatic silence, a scene change, or a hesitation mid-turn. A typical beat is 0.5–2 s.

## Writing for good speech
- Keep sentences short to medium, ideally under ~120 characters or about 20 words. The app splits long sentences at commas for generation, which can sound less natural.
- End sentences with `. ! ? …`. Use `…` for trailing off and an em dash (`—`) for an interruption within your own line.
- Write numbers, symbols and abbreviations the way they should be spoken: "twenty twenty-six", "fifty percent", "doctor" rather than "Dr." where it matters. Avoid URLs and code.
- Turns of 1–3 sentences sound most natural in dialogue. Use a blank line inside a turn only for a real paragraph break in a longer monologue.
- Every speaker you introduce should speak at least once. Vary turn lengths so it sounds conversational.
- Rough length: about 15 characters of text per second of audio, so 1,000 characters ≈ 1 minute.

## Self-check before answering
- Starts with a speaker tag, and every turn has one; only tags from `[S1]` up to the SPEAKERS count are used (e.g. SPEAKERS = 2 → `[S1]` and `[S2]`), and each of them speaks.
- The only bracketed items are `[Sn]`, `[pause …]` and `[exaggeration …]`, with values in range.
- Every turn line starts with a complete `[Sn]` tag (both brackets).
- Every `[exaggeration …]` sits directly after a speaker tag on the same line (`[Sn] [exaggeration X] text`) — none on
  their own line; at most one per turn.
- No pause at the very start or end.
- No names, labels, markdown or stage directions.
- Only words allowed by FOREIGN_WORDS appear in another language.
- Matches TOPIC, SPEAKERS, LENGTH and TONE.
- Under 10,000 characters.