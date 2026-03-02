'use client'

import { useState, useCallback } from 'react'
import { ClipboardCopy, Trash2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatFrequency } from '@/lib/utils/pitchUtils'
import type { Advisory } from '@/types/advisory'

export interface PinnedCut {
  id: string           // advisory id
  freq: number
  geqBand: number
  geqDb: number
  peqQ: number
  peqDb: number
  severity: string
  pinnedAt: number
}

export function advisoryToPin(advisory: Advisory): PinnedCut | null {
  const geq = advisory.advisory?.geq
  const peq = advisory.advisory?.peq
  if (!geq || !peq) return null
  return {
    id: advisory.id,
    freq: advisory.trueFrequencyHz,
    geqBand: geq.bandHz,
    geqDb: geq.suggestedDb,
    peqQ: peq.q ?? 1,
    peqDb: peq.gainDb ?? 0,
    severity: advisory.severity,
    pinnedAt: Date.now(),
  }
}

interface EQNotepadProps {
  pins: PinnedCut[]
  onRemove: (id: string) => void
  onClear: () => void
}

export function EQNotepad({ pins, onRemove, onClear }: EQNotepadProps) {
  const [copied, setCopied] = useState(false)

  const copyText = useCallback(() => {
    if (pins.length === 0) return
    const lines = pins
      .slice()
      .sort((a, b) => a.freq - b.freq)
      .map(
        (p) =>
          `${formatFrequency(p.freq)} (GEQ ${p.geqBand}Hz ${p.geqDb}dB | PEQ Q${p.peqQ.toFixed(0)} ${p.peqDb}dB)`,
      )
    const text = `EQ Notepad — ${pins.length} cut${pins.length === 1 ? '' : 's'}\n${lines.join('\n')}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [pins])

  if (pins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-1">
        <span className="text-xs">No cuts applied yet</span>
        <span className="text-[10px] opacity-60">Tap "Apply" on an issue to log it here</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Action bar */}
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-muted-foreground">{pins.length} cut{pins.length === 1 ? '' : 's'} applied</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={copyText}
            className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
            aria-label="Copy EQ cuts to clipboard"
          >
            {copied ? <Check className="w-3 h-3 text-primary" /> : <ClipboardCopy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-6 px-2 text-[10px] text-muted-foreground/50 hover:text-destructive"
            aria-label="Clear all applied cuts"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Cut rows */}
      {pins
        .slice()
        .sort((a, b) => a.freq - b.freq)
        .map((pin) => (
          <PinRow key={pin.id} pin={pin} onRemove={onRemove} />
        ))}
    </div>
  )
}

function PinRow({ pin, onRemove }: { pin: PinnedCut; onRemove: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-border bg-primary/5 text-[10px] group">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="font-mono font-medium text-foreground whitespace-nowrap">
          {formatFrequency(pin.freq)}Hz
        </span>
        <span className="text-muted-foreground truncate font-mono">
          GEQ {pin.geqBand}Hz <span className="text-primary">{pin.geqDb}dB</span>
          {' | '}
          PEQ Q{pin.peqQ.toFixed(0)} <span className="text-primary">{pin.peqDb}dB</span>
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onRemove(pin.id)}
        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-destructive"
        aria-label={`Remove ${formatFrequency(pin.freq)}Hz cut`}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  )
}
