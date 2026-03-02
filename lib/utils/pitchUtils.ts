// KillTheRing2 Pitch Utilities - Hz to note/cents/MIDI conversion

import { A4_HZ, A4_MIDI, NOTE_NAMES, CENTS_PER_SEMITONE, SEMITONES_PER_OCTAVE } from '@/lib/dsp/constants'
import type { PitchInfo } from '@/types/advisory'

/**
 * Convert frequency in Hz to pitch information
 */
export function hzToPitch(hz: number): PitchInfo {
  if (hz <= 0 || !Number.isFinite(hz)) {
    return { note: '-', octave: 0, cents: 0, midi: 0 }
  }

  // Calculate MIDI note number (can be fractional)
  const midiFloat = 12 * Math.log2(hz / A4_HZ) + A4_MIDI
  
  // Round to nearest semitone for note name
  const midiRounded = Math.round(midiFloat)
  
  // Calculate cents deviation from nearest note
  const cents = Math.round((midiFloat - midiRounded) * CENTS_PER_SEMITONE)
  
  // Get note name and octave
  const noteIndex = ((midiRounded % 12) + 12) % 12
  const note = NOTE_NAMES[noteIndex]
  const octave = Math.floor(midiRounded / 12) - 1
  
  return {
    note,
    octave,
    cents,
    midi: midiRounded,
  }
}

/**
 * Convert MIDI note number to frequency in Hz
 */
export function midiToHz(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / SEMITONES_PER_OCTAVE)
}

/**
 * Convert note name and octave to frequency in Hz
 */
export function noteToHz(note: string, octave: number): number {
  const noteIndex = NOTE_NAMES.indexOf(note.toUpperCase() as typeof NOTE_NAMES[number])
  if (noteIndex === -1) return 0
  
  const midi = (octave + 1) * 12 + noteIndex
  return midiToHz(midi)
}

/**
 * Calculate cents difference between two frequencies
 */
export function hzToCents(hz1: number, hz2: number): number {
  if (hz1 <= 0 || hz2 <= 0) return 0
  return 1200 * Math.log2(hz1 / hz2)
}

/**
 * Format pitch for display (e.g., "A4 +12c" or "C#5 -5c")
 */
export function formatPitch(pitch: PitchInfo): string {
  if (pitch.note === '-') return '-'
  
  const centsStr = pitch.cents >= 0 ? `+${pitch.cents}` : `${pitch.cents}`
  return `${pitch.note}${pitch.octave} ${centsStr}c`
}

/**
 * Format frequency for display with appropriate precision
 */
export function formatFrequency(hz: number): string {
  if (hz < 100) return hz.toFixed(1)
  if (hz < 1000) return hz.toFixed(0)
  return `${(hz / 1000).toFixed(2)}k`
}

/**
 * Get musical interval name from cents
 */
export function centsToInterval(cents: number): string {
  const absCents = Math.abs(cents)
  
  if (absCents < 50) return 'unison'
  if (absCents < 150) return 'minor 2nd'
  if (absCents < 250) return 'major 2nd'
  if (absCents < 350) return 'minor 3rd'
  if (absCents < 450) return 'major 3rd'
  if (absCents < 550) return 'perfect 4th'
  if (absCents < 650) return 'tritone'
  if (absCents < 750) return 'perfect 5th'
  if (absCents < 850) return 'minor 6th'
  if (absCents < 950) return 'major 6th'
  if (absCents < 1050) return 'minor 7th'
  if (absCents < 1150) return 'major 7th'
  return 'octave'
}

/**
 * Check if two frequencies are harmonically related
 * Returns the harmonic number (2, 3, 4, etc.) or 0 if not harmonic
 */
export function getHarmonicRelation(fundamental: number, harmonic: number, tolerance: number = 0.015): number {
  if (fundamental <= 0 || harmonic <= 0 || harmonic <= fundamental) return 0
  
  const ratio = harmonic / fundamental
  const k = Math.round(ratio)
  
  if (k < 2 || k > 16) return 0
  
  const expected = fundamental * k
  const diff = Math.abs(harmonic - expected)
  
  return diff <= expected * tolerance ? k : 0
}

// ─── Session / time formatting ────────────────────────────────────────────────

/** Human-readable session duration, e.g. "1h 4m", "3m 12s", "45s" */
export function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'In progress'
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

/** Locale-aware short date + time string */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Generate harmonic series from fundamental
 */
export function harmonicSeries(fundamental: number, count: number = 8): number[] {
  const harmonics: number[] = []
  for (let i = 1; i <= count; i++) {
    harmonics.push(fundamental * i)
  }
  return harmonics
}
