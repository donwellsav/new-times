// KillTheRing2 EQ Advisor - GEQ/PEQ recommendations with pitch translation
// Phase 5: MINDS Adaptive Depth integration

import { ISO_31_BANDS, EQ_PRESETS, SPECTRAL_TRENDS } from './constants'
import { hzToPitch, formatPitch } from '@/lib/utils/pitchUtils'
import { clamp } from '@/lib/utils/mathHelpers'
import { calculateAdaptiveNotchDepth } from './acousticUtils'
import type { 
  Track, 
  TrackedPeak,
  SeverityLevel, 
  Preset,
  GEQRecommendation, 
  PEQRecommendation, 
  ShelfRecommendation,
  EQAdvisory,
  PitchInfo 
} from '@/types/advisory'

// Track input type that works with both Track and TrackedPeak
type TrackInput = Track | TrackedPeak

// Helper to get frequency from either type
function getTrackFrequency(track: TrackInput): number {
  return 'trueFrequencyHz' in track ? track.trueFrequencyHz : track.frequency
}

function getTrackQ(track: TrackInput): number {
  return track.qEstimate
}

function getTrackGrowthRate(track: TrackInput): number {
  if ('velocityDbPerSec' in track) {
    return track.velocityDbPerSec
  }
  if ('features' in track && track.features?.velocityDbPerSec !== undefined) {
    return track.features.velocityDbPerSec
  }
  return 0
}

function getTrackHasAdjacentPeaks(track: TrackInput): boolean {
  if ('hasAdjacentPeaks' in track) {
    return (track as Track).hasAdjacentPeaks ?? false
  }
  return false
}

/**
 * Find nearest ISO 31-band to a given frequency
 */
export function findNearestGEQBand(freqHz: number): { bandHz: number; bandIndex: number } {
  let minDist = Infinity
  let nearestIndex = 0

  for (let i = 0; i < ISO_31_BANDS.length; i++) {
    // Use log distance for frequency comparison
    const dist = Math.abs(Math.log2(freqHz / ISO_31_BANDS[i]))
    if (dist < minDist) {
      minDist = dist
      nearestIndex = i
    }
  }

  return {
    bandHz: ISO_31_BANDS[nearestIndex],
    bandIndex: nearestIndex,
  }
}

/**
 * Calculate recommended cut depth based on severity and preset
 */
export function calculateCutDepth(severity: SeverityLevel, preset: Preset): number {
  const presetConfig = EQ_PRESETS[preset]

  switch (severity) {
    case 'RUNAWAY':
      return presetConfig.maxCut // -18 or -12 dB
    case 'GROWING':
      return presetConfig.moderateCut // -9 or -6 dB
    case 'RESONANCE':
      return presetConfig.lightCut // -4 or -3 dB
    case 'POSSIBLE_RING':
      return -3 // Gentle for possible rings
    case 'WHISTLE':
      return 0 // No cut for whistles by default
    case 'INSTRUMENT':
      return 0 // No cut for instruments by default
    default:
      return presetConfig.lightCut
  }
}

/**
 * Calculate recommended Q for PEQ based on severity and preset
 */
export function calculateQ(severity: SeverityLevel, preset: Preset, trackQ: number): number {
  const presetConfig = EQ_PRESETS[preset]

  // Use higher Q for more severe issues
  let baseQ: number
  switch (severity) {
    case 'RUNAWAY':
      baseQ = presetConfig.runawayQ // 16 or 8
      break
    case 'GROWING':
      baseQ = presetConfig.defaultQ // 8 or 4
      break
    default:
      baseQ = presetConfig.defaultQ * 0.75
  }

  // Consider the actual measured Q of the feedback
  // Use a blend of preset Q and measured Q
  const measuredQ = clamp(trackQ, 2, 32)
  const blendedQ = (baseQ + measuredQ) / 2

  return clamp(blendedQ, 2, 32)
}

/**
 * Generate GEQ recommendation for a track
 */
export function generateGEQRecommendation(
  track: TrackInput,
  severity: SeverityLevel,
  preset: Preset
): GEQRecommendation {
  const { bandHz, bandIndex } = findNearestGEQBand(getTrackFrequency(track))
  const suggestedDb = calculateCutDepth(severity, preset)

  return {
    bandHz,
    bandIndex,
    suggestedDb,
  }
}

/**
 * Generate PEQ recommendation for a track
 */
export function generatePEQRecommendation(
  track: TrackInput,
  severity: SeverityLevel,
  preset: Preset
): PEQRecommendation {
  const freqHz = getTrackFrequency(track)
  const suggestedDb = calculateCutDepth(severity, preset)
  const q = calculateQ(severity, preset, getTrackQ(track))

  // Determine filter type
  let type: PEQRecommendation['type'] = 'bell'
  
  if (severity === 'RUNAWAY') {
    // Use notch for runaway (very narrow, deep cut)
    type = 'notch'
  } else if (freqHz < 80) {
    // Suggest HPF for very low frequencies
    type = 'HPF'
  } else if (freqHz > 12000) {
    // Suggest LPF for very high frequencies
    type = 'LPF'
  }

  return {
    type,
    hz: freqHz,
    q,
    gainDb: suggestedDb,
  }
}

/**
 * Generate adaptive PEQ recommendation using MINDS algorithm (Phase 5)
 * 
 * Uses growth rate and amplitude to determine minimum effective notch depth.
 * This provides more precise cuts - just enough to stop feedback, not more.
 */
export function generateAdaptivePEQRecommendation(
  track: TrackInput,
  severity: SeverityLevel,
  amplitudeAboveThresholdDb: number = 0
): PEQRecommendation & { reasoning: string[] } {
  const freqHz = getTrackFrequency(track)
  const growthRate = getTrackGrowthRate(track)
  const hasAdjacentPeaks = getTrackHasAdjacentPeaks(track)
  
  // Map severity to classification
  let classification: 'feedback' | 'whistle' | 'instrument' | 'unknown'
  switch (severity) {
    case 'WHISTLE':
      classification = 'whistle'
      break
    case 'INSTRUMENT':
      classification = 'instrument'
      break
    case 'RUNAWAY':
    case 'GROWING':
    case 'RESONANCE':
    case 'POSSIBLE_RING':
      classification = 'feedback'
      break
    default:
      classification = 'unknown'
  }
  
  // Get adaptive depth recommendation
  const adaptive = calculateAdaptiveNotchDepth(
    growthRate,
    amplitudeAboveThresholdDb,
    classification,
    hasAdjacentPeaks
  )
  
  // Determine filter type
  let type: PEQRecommendation['type'] = 'bell'
  if (adaptive.severity === 'runaway') {
    type = 'notch'
  } else if (freqHz < 80) {
    type = 'HPF'
  } else if (freqHz > 12000) {
    type = 'LPF'
  }

  return {
    type,
    hz: freqHz,
    q: adaptive.qFactor,
    gainDb: adaptive.depthDb,
    reasoning: adaptive.reasoning,
  }
}

/**
 * Analyze spectrum for shelf/filter recommendations
 */
export function analyzeSpectralTrends(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number
): ShelfRecommendation[] {
  const shelves: ShelfRecommendation[] = []
  const hzPerBin = sampleRate / fftSize
  const n = spectrum.length

  // Calculate average level
  let totalDb = 0
  for (let i = 0; i < n; i++) {
    totalDb += spectrum[i]
  }
  const avgDb = totalDb / n

  // Check low-end rumble
  const lowEndBin = Math.round(SPECTRAL_TRENDS.LOW_RUMBLE_THRESHOLD_HZ / hzPerBin)
  let lowSum = 0
  for (let i = 1; i < Math.min(lowEndBin, n); i++) {
    lowSum += spectrum[i]
  }
  const lowAvg = lowEndBin > 1 ? lowSum / (lowEndBin - 1) : avgDb

  if (lowAvg > avgDb + SPECTRAL_TRENDS.LOW_RUMBLE_EXCESS_DB) {
    shelves.push({
      type: 'HPF',
      hz: SPECTRAL_TRENDS.LOW_RUMBLE_THRESHOLD_HZ,
      gainDb: 0, // HPF doesn't have gain, but this indicates activation
      reason: `Low-end rumble detected (${(lowAvg - avgDb).toFixed(1)} dB excess below ${SPECTRAL_TRENDS.LOW_RUMBLE_THRESHOLD_HZ}Hz)`,
    })
  }

  // Check mud buildup (200-400 Hz)
  const mudLowBin = Math.round(SPECTRAL_TRENDS.MUD_FREQ_LOW / hzPerBin)
  const mudHighBin = Math.round(SPECTRAL_TRENDS.MUD_FREQ_HIGH / hzPerBin)
  let mudSum = 0
  for (let i = mudLowBin; i < Math.min(mudHighBin, n); i++) {
    mudSum += spectrum[i]
  }
  const mudAvg = mudHighBin > mudLowBin ? mudSum / (mudHighBin - mudLowBin) : avgDb

  if (mudAvg > avgDb + SPECTRAL_TRENDS.MUD_EXCESS_DB) {
    shelves.push({
      type: 'lowShelf',
      hz: 300, // Center of mud range
      gainDb: -3,
      reason: `Mud buildup detected (${(mudAvg - avgDb).toFixed(1)} dB excess in 200-400Hz)`,
    })
  }

  // Check harshness (6-10 kHz)
  const harshLowBin = Math.round(SPECTRAL_TRENDS.HARSH_FREQ_LOW / hzPerBin)
  const harshHighBin = Math.round(SPECTRAL_TRENDS.HARSH_FREQ_HIGH / hzPerBin)
  let harshSum = 0
  for (let i = harshLowBin; i < Math.min(harshHighBin, n); i++) {
    harshSum += spectrum[i]
  }
  const harshAvg = harshHighBin > harshLowBin ? harshSum / (harshHighBin - harshLowBin) : avgDb

  if (harshAvg > avgDb + SPECTRAL_TRENDS.HARSH_EXCESS_DB) {
    shelves.push({
      type: 'highShelf',
      hz: 8000,
      gainDb: -3,
      reason: `High-frequency harshness detected (${(harshAvg - avgDb).toFixed(1)} dB excess in 6-10kHz)`,
    })
  }

  return shelves
}

/**
 * Generate complete EQ advisory for a track
 */
export function generateEQAdvisory(
  track: TrackInput,
  severity: SeverityLevel,
  preset: Preset,
  spectrum?: Float32Array,
  sampleRate?: number,
  fftSize?: number
): EQAdvisory {
  const freqHz = getTrackFrequency(track)
  const geq = generateGEQRecommendation(track, severity, preset)
  const peq = generatePEQRecommendation(track, severity, preset)
  const pitch = hzToPitch(freqHz)

  // Generate shelf recommendations if spectrum provided
  let shelves: ShelfRecommendation[] = []
  if (spectrum && sampleRate && fftSize) {
    shelves = analyzeSpectralTrends(spectrum, sampleRate, fftSize)
  }

  return {
    geq,
    peq,
    shelves,
    pitch,
  }
}

/**
 * Format EQ recommendation as human-readable string
 */
export function formatEQRecommendation(advisory: EQAdvisory): string {
  const { geq, peq, pitch } = advisory

  const parts: string[] = []

  // GEQ recommendation
  if (geq.suggestedDb < 0) {
    parts.push(`GEQ: Pull ${geq.bandHz}Hz fader to ${geq.suggestedDb}dB`)
  }

  // PEQ recommendation
  if (peq.gainDb < 0) {
    const typeStr = peq.type === 'notch' ? 'Notch' : peq.type === 'bell' ? 'Bell' : peq.type
    parts.push(`PEQ: ${typeStr} at ${peq.hz.toFixed(1)}Hz, Q=${peq.q.toFixed(1)}, ${peq.gainDb}dB`)
  }

  // Pitch info
  parts.push(`Pitch: ${formatPitch(pitch)}`)

  return parts.join(' | ')
}

/**
 * Get GEQ band labels for display
 */
export function getGEQBandLabels(): string[] {
  return ISO_31_BANDS.map(hz => {
    if (hz >= 1000) {
      return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k`
    }
    return `${hz}`
  })
}

// Cache resolved CSS variable values so getComputedStyle is only called once
// per variable, not on every canvas frame for every advisory.
const _cssColorCache = new Map<string, string>()

/**
 * Resolve a CSS variable color string (e.g. "var(--severity-runaway)") to its
 * computed hex/rgb value so it can be used as a Canvas fillStyle/strokeStyle.
 * Falls back to the input string if resolution fails (e.g. during SSR).
 * Results are cached — getComputedStyle is only called once per variable.
 */
export function resolveCSSColor(cssVar: string): string {
  if (typeof window === 'undefined') return cssVar
  const cached = _cssColorCache.get(cssVar)
  if (cached) return cached
  const match = cssVar.match(/var\((--[^)]+)\)/)
  if (!match) return cssVar
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() || cssVar
  _cssColorCache.set(cssVar, resolved)
  return resolved
}

/**
 * Get color for severity level.
 * Returns CSS variable references so the output always respects the active
 * theme defined in globals.css (--severity-* tokens) rather than
 * hard-coded hex values that bypass the design system.
 */
export function getSeverityColor(severity: SeverityLevel): string {
  switch (severity) {
    case 'RUNAWAY':      return 'var(--severity-runaway)'
    case 'GROWING':      return 'var(--severity-growing)'
    case 'RESONANCE':    return 'var(--severity-resonance)'
    case 'POSSIBLE_RING': return 'var(--severity-ring)'
    case 'WHISTLE':      return 'var(--severity-whistle)'
    case 'INSTRUMENT':   return 'var(--severity-instrument)'
    default:             return 'var(--muted-foreground)'
  }
}
