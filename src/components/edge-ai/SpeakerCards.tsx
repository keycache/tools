import type { VoiceSlot } from '@/components/edge-ai/useVoiceSlot'
import { VoiceSelect } from '@/components/edge-ai/VoiceSelect'
import { DEFAULT_EXAGGERATION, EXAGGERATION_RANGE } from '@/lib/tts/constants'
import type { SpeakerNumber } from '@/lib/tts/script'

interface Props {
  /** Speakers found in the script, in order of first appearance. */
  speakers: SpeakerNumber[]
  slots: Record<SpeakerNumber, VoiceSlot>
  exaggeration: Record<SpeakerNumber, number>
  onExaggerationChange: (speaker: SpeakerNumber, value: number) => void
  turns: Record<SpeakerNumber, number>
  disabled: boolean
}

/**
 * Conversation mode: one card per speaker in the script — voice (dropdown / your clip) and default exaggeration.
 * Reserves one row so the layout doesn't jump while the first tags are typed. docs/SPECIFICATIONS.md §S20.1.
 */
export function SpeakerCards({ speakers, slots, exaggeration, onExaggerationChange, turns, disabled }: Props) {
  if (!speakers.length) {
    return (
      <div className="flex min-h-52 items-center justify-center rounded-xl border border-dashed px-4 text-center text-sm text-muted-foreground">
        Speakers appear here as you tag lines with [S1]–[S4] — each gets its own voice.
      </div>
    )
  }
  return (
    <div className="grid min-h-52 gap-3 sm:grid-cols-2" role="group" aria-label="Speakers">
      {speakers.map((n) => {
        const slot = slots[n]
        const value = exaggeration[n]
        return (
          <VoiceSelect
            key={n}
            id={`speak-voice-s${n}`}
            label={`Speaker ${n}`}
            className="h-52"
            choice={slot.choice}
            onChoiceChange={slot.changeChoice}
            clip={slot.clip}
            onAudio={slot.addVoice}
            onRemove={slot.removeVoice}
            status={slot.status}
            error={slot.error}
            disabled={disabled || (slot.choice === 'custom' && slot.preparing)}
            footer={
              <label className="flex items-center gap-2 text-xs">
                <span className="font-medium">Exaggeration</span>
                <input
                  type="range"
                  min={EXAGGERATION_RANGE[0]}
                  max={EXAGGERATION_RANGE[1]}
                  step={0.05}
                  value={value}
                  disabled={disabled}
                  onChange={(e) => onExaggerationChange(n, Number(e.target.value))}
                  className="min-w-0 flex-1 accent-primary"
                  aria-label={`Speaker ${n} exaggeration`}
                  aria-valuetext={`${value.toFixed(2)}${value === DEFAULT_EXAGGERATION ? ', default' : ''}`}
                />
                <span className="w-9 tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
                <span className="text-muted-foreground">
                  · {turns[n]} turn{turns[n] === 1 ? '' : 's'}
                </span>
              </label>
            }
          />
        )
      })}
    </div>
  )
}
