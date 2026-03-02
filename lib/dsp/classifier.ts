// KillTheRing2 Classifier - Distinguishes feedback vs whistle vs instrument
// Enhanced with acoustic research from "Sound Insulation" (Carl Hopkins, 2007)

import { CLASSIFIER_WEIGHTS, SEVERITY_THRESHOLDS, SCHROEDER_CONSTANTS, MSD_SETTINGS, PERSISTENCE_SCORING } from './constants'
import type { Track, ClassificationResult, SeverityLevel, IssueLabel, TrackedPeak, DetectorSettings } from '@/types/advisory'
import {
  calculateSchroederFrequency,
  getFrequencyBand,
  calculateModalOverlap,
  classifyModalOverlap,
  analyzeCumulativeGrowth,
  calculateCalibratedConfidence,
  analyzeVibrato,
  analyzeHarmonicSeriesFromTracks,
  findAdjacentPeaks,
  calculateHybridFusion,
} from './acousticUtils'
import { ADJACENT_DETECTION } from './constants'

// Type union for track input
type TrackInput = Track | TrackedPeak

// Helper to normalize input to common interface
function normalizeTrackInput(input: TrackInput) {
  // Check if it's a TrackedPeak (has 'frequency' field) or Track (has 'trueFrequencyHz')
  if ('trueFrequencyHz' in input) {
  return {
  frequencyHz: input.trueFrequencyHz,
  amplitudeDb: input.trueAmplitudeDb,
  onsetDb: input.onsetDb,
  onsetTime: input.onsetTime,
  velocityDbPerSec: input.velocityDbPerSec,
  stabilityCentsStd: input.features.stabilityCentsStd,
  harmonicityScore: input.features.harmonicityScore,
  modulationScore: input.features.modulationScore,
  noiseSidebandScore: input.features.noiseSidebandScore,
  maxVelocityDbPerSec: input.features.maxVelocityDbPerSec,
  minQ: input.features.minQ,
  persistenceMs: input.features.persistenceMs,
  prominenceDb: input.prominenceDb,
  // Phase 2+6: Fields for hybrid fusion
  msd: input.msd ?? 0,
  msdIsHowl: input.msdIsHowl ?? false,
  persistenceFrames: input.persistenceFrames ?? 0,
  qEstimate: input.features.minQ,
  }
  }
  // TrackedPeak
  return {
  frequencyHz: input.frequency,
  amplitudeDb: input.amplitude,
  onsetDb: input.history[0]?.amplitude ?? input.amplitude,
  onsetTime: input.onsetTime,
  velocityDbPerSec: input.features.velocityDbPerSec,
  stabilityCentsStd: input.features.stabilityCentsStd,
  harmonicityScore: input.features.harmonicityScore,
  modulationScore: input.features.modulationScore,
  noiseSidebandScore: 0, // TrackedPeak doesn't have this
  maxVelocityDbPerSec: Math.abs(input.features.velocityDbPerSec),
  minQ: input.qEstimate,
  persistenceMs: input.lastUpdateTime - input.onsetTime,
  prominenceDb: input.prominenceDb,
  // Phase 2+6: Fields for hybrid fusion
  msd: input.msd ?? 0,
  msdIsHowl: input.msdIsHowl ?? false,
  persistenceFrames: input.persistenceFrames ?? 0,
  qEstimate: input.qEstimate,
  }
  }

/**
 * Classify a track as feedback, whistle, or instrument
 * Uses weighted scoring model based on extracted features
 * Enhanced with acoustic research from "Sound Insulation" (Carl Hopkins, 2007)
 */
export function classifyTrack(track: TrackInput, settings?: DetectorSettings): ClassificationResult {
  const features = normalizeTrackInput(track)
  const reasons: string[] = []

  // ==================== Acoustic Context ====================
  
  // Calculate Schroeder frequency for frequency-dependent analysis
  const roomRT60 = settings?.roomRT60 ?? 1.2
  const roomVolume = settings?.roomVolume ?? 500
  const schroederFreq = calculateSchroederFrequency(roomRT60, roomVolume)
  
  // Get frequency band and modifiers
  const freqBand = getFrequencyBand(features.frequencyHz, schroederFreq)
  
  // Calculate modal overlap indicator (M = 1/Q, based on textbook Section 1.2.6.7)
  const modalOverlap = calculateModalOverlap(features.minQ)
  const modalAnalysis = classifyModalOverlap(modalOverlap)
  
  // Analyze cumulative growth for slow-building feedback
  const cumulativeGrowth = analyzeCumulativeGrowth(
    features.onsetDb,
    features.amplitudeDb,
    features.persistenceMs
  )

  // Initialize probabilities
  let pFeedback = 0.33
  let pWhistle = 0.33
  let pInstrument = 0.33

  // ==================== Feature Analysis ====================

  // 1. Stationarity (low pitch variation = feedback)
  // Apply frequency-dependent threshold
  const stabilityThreshold = CLASSIFIER_WEIGHTS.STABILITY_THRESHOLD_CENTS * freqBand.sustainMultiplier
  const stabilityScore = features.stabilityCentsStd < stabilityThreshold ? 1 : 0
  if (stabilityScore > 0) {
    pFeedback += CLASSIFIER_WEIGHTS.STABILITY_FEEDBACK * stabilityScore
    reasons.push(`Pitch stability: ${features.stabilityCentsStd.toFixed(1)} cents std dev`)
  } else {
    // High variation suggests whistle or instrument
    pWhistle += 0.1
    pInstrument += 0.1
  }

  // 2. Harmonicity (coherent harmonics = instrument)
  if (features.harmonicityScore > CLASSIFIER_WEIGHTS.HARMONICITY_THRESHOLD) {
    pInstrument += CLASSIFIER_WEIGHTS.HARMONICITY_INSTRUMENT * features.harmonicityScore
    reasons.push(`Harmonic structure detected: ${(features.harmonicityScore * 100).toFixed(0)}%`)
  }

  // 3. Modulation (vibrato = whistle)
  if (features.modulationScore > CLASSIFIER_WEIGHTS.MODULATION_THRESHOLD) {
    pWhistle += CLASSIFIER_WEIGHTS.MODULATION_WHISTLE * features.modulationScore
    reasons.push(`Vibrato/modulation: ${(features.modulationScore * 100).toFixed(0)}%`)
  }

  // 4. Sideband noise (breath = whistle)
  if (features.noiseSidebandScore > CLASSIFIER_WEIGHTS.SIDEBAND_THRESHOLD) {
    pWhistle += CLASSIFIER_WEIGHTS.SIDEBAND_WHISTLE * features.noiseSidebandScore
    reasons.push(`Breath noise detected: ${(features.noiseSidebandScore * 100).toFixed(0)}%`)
  }

  // 4b. NEW: Enhanced vibrato detection for whistle discrimination
  // Check frequency history for characteristic 4-8 Hz vibrato
  if ('history' in track && Array.isArray(track.history) && track.history.length >= 10) {
    const frequencyHistory = track.history.map((h: { time: number; frequency?: number; freqHz?: number }) => ({
      time: h.time,
      frequency: h.frequency ?? h.freqHz ?? 0,
    }))
    const vibratoAnalysis = analyzeVibrato(frequencyHistory)
    if (vibratoAnalysis.hasVibrato) {
      pWhistle += vibratoAnalysis.whistleProbability
      pFeedback -= vibratoAnalysis.whistleProbability * 0.5 // Reduce feedback probability
      reasons.push(`Vibrato detected: ${vibratoAnalysis.vibratoRateHz?.toFixed(1)}Hz rate, ${vibratoAnalysis.vibratoDepthCents?.toFixed(0)}¢ depth`)
    }
  }

  // 5. Runaway growth (high velocity = feedback)
  // Use settings.growthRateThreshold if provided, otherwise fall back to constant
  const growthThreshold = settings?.growthRateThreshold ?? CLASSIFIER_WEIGHTS.GROWTH_THRESHOLD
  if (features.maxVelocityDbPerSec > growthThreshold) {
    const growthFactor = Math.min(features.maxVelocityDbPerSec / 20, 1)
    pFeedback += CLASSIFIER_WEIGHTS.GROWTH_FEEDBACK * growthFactor
    reasons.push(`Rapid growth: ${features.maxVelocityDbPerSec.toFixed(1)} dB/sec`)
  }

  // 6. Q factor with frequency-dependent threshold
  const qThreshold = SEVERITY_THRESHOLDS.HIGH_Q * freqBand.qThresholdMultiplier
  if (features.minQ > qThreshold) {
    pFeedback += 0.15
    reasons.push(`Narrow Q: ${features.minQ.toFixed(1)} (band: ${freqBand.band})`)
  }

  // 7. Persistence without modulation
  const persistenceThreshold = 1000 * freqBand.sustainMultiplier
  if (features.persistenceMs > persistenceThreshold && features.modulationScore < 0.2) {
    pFeedback += 0.1
    reasons.push(`Sustained without modulation: ${(features.persistenceMs / 1000).toFixed(1)}s`)
  }

  // 8. NEW: Modal overlap analysis (from textbook)
  // Isolated modes (M < 0.3) are more likely feedback
  pFeedback += modalAnalysis.feedbackProbabilityBoost
  if (modalAnalysis.classification === 'ISOLATED') {
    reasons.push(`Isolated mode (M=${modalOverlap.toFixed(2)}) - high feedback risk`)
  } else if (modalAnalysis.classification === 'DIFFUSE') {
    reasons.push(`Diffuse field (M=${modalOverlap.toFixed(2)}) - likely room noise`)
  }

  // 9. NEW: Cumulative growth analysis (slow-building feedback)
  if (cumulativeGrowth.shouldAlert) {
    if (cumulativeGrowth.severity === 'RUNAWAY') {
      pFeedback += 0.25
      reasons.push(`Cumulative growth: +${cumulativeGrowth.totalGrowthDb.toFixed(1)}dB (RUNAWAY)`)
    } else if (cumulativeGrowth.severity === 'GROWING') {
      pFeedback += 0.15
      reasons.push(`Cumulative growth: +${cumulativeGrowth.totalGrowthDb.toFixed(1)}dB (growing)`)
    } else if (cumulativeGrowth.severity === 'BUILDING') {
      pFeedback += 0.08
      reasons.push(`Cumulative growth: +${cumulativeGrowth.totalGrowthDb.toFixed(1)}dB (building)`)
    }
  }

  // 10. NEW: Frequency band context
  if (freqBand.band === 'LOW' && features.frequencyHz < schroederFreq) {
    // Below Schroeder frequency - more likely room mode than feedback
    pFeedback -= 0.1
    pInstrument += 0.05
    reasons.push(`Below Schroeder freq (${schroederFreq.toFixed(0)}Hz) - possible room mode`)
  }

  // 11. NEW: MSD (Magnitude Slope Deviation) analysis - DAFx-16 algorithm
  // MSD measures how consistently magnitude grows over time
  // Lower MSD = more linear growth = more likely feedback howl
  // Check if track has MSD data (from enhanced feedbackDetector)
  const hasMsdData = 'msd' in track || ('features' in track && 'msd' in (track.features as Record<string, unknown>))
  if (hasMsdData) {
    const msdData = 'msd' in track 
      ? track as unknown as { msd: number; msdGrowthRate: number; msdIsHowl: boolean; msdFastConfirm: boolean }
      : null
    
    if (msdData && msdData.msd >= 0) {
      // MSD is valid (not -1)
      if (msdData.msdFastConfirm) {
        // Fast confirmation: very consistent growth pattern
        pFeedback += 0.35
        reasons.push(`MSD fast confirm: consistent growth pattern (MSD=${msdData.msd.toFixed(2)})`)
      } else if (msdData.msdIsHowl) {
        // Below howl threshold
        pFeedback += 0.25
        reasons.push(`MSD howl detected: linear growth (MSD=${msdData.msd.toFixed(2)})`)
      } else if (msdData.msd < MSD_SETTINGS.HOWL_THRESHOLD * 1.5) {
        // Borderline - some growth consistency
        pFeedback += 0.12
        reasons.push(`MSD elevated: possible feedback buildup (MSD=${msdData.msd.toFixed(2)})`)
      }
      
      // High MSD = erratic changes, more likely instrument/voice
      if (msdData.msd > MSD_SETTINGS.HOWL_THRESHOLD * 2) {
        pInstrument += 0.1
        pWhistle += 0.05
        reasons.push(`MSD high: erratic magnitude changes`)
      }
    }
  }

  // 12. NEW: Harmonic Series Filter - Phase 1 Enhancement
  // Feedback is typically a pure sinusoid. Instruments have harmonic overtones.
  // If we detect harmonics of this frequency, it's more likely an instrument.
  const harmonicFilterEnabled = settings?.harmonicFilterEnabled ?? true // Default enabled
  
  // Declare harmonicAnalysis at function scope so it's available for hybrid fusion
  let harmonicAnalysis: { harmonicCount: number; hasHarmonicSeries: boolean; instrumentBoost: number; feedbackPenalty: number; reason: string } | null = null
  
  if (harmonicFilterEnabled) {
    // Check if track has activeTracks data for harmonic analysis
    // This would be passed from the track manager or analyzer
    const hasActiveTracksData = 'activeTracks' in track || 
      (settings && 'activeTracks' in settings)
    
    if (hasActiveTracksData) {
      const activeTracks = ('activeTracks' in track 
        ? (track as unknown as { activeTracks: Array<{ frequencyHz: number; amplitudeDb: number }> }).activeTracks
        : (settings as unknown as { activeTracks: Array<{ frequencyHz: number; amplitudeDb: number }> }).activeTracks
      ) || []
      
      harmonicAnalysis = analyzeHarmonicSeriesFromTracks(
        features.frequencyHz,
        features.amplitudeDb,
        activeTracks
      )
      
      if (harmonicAnalysis.hasHarmonicSeries) {
        pInstrument += harmonicAnalysis.instrumentBoost
        pFeedback -= harmonicAnalysis.feedbackPenalty
        reasons.push(harmonicAnalysis.reason)
      }
    }
    
    // Alternative: Use harmonicityScore from features if available
    // This is a simpler check that's already computed
    if (features.harmonicityScore > 0.5) {
      // Moderate harmonic content detected via existing harmonicity scoring
      const existingHarmonicBoost = features.harmonicityScore * 0.15
      pInstrument += existingHarmonicBoost
      pFeedback -= existingHarmonicBoost * 0.5
      // Don't add reason here as it's already captured in feature #2
    }
  }

  // 13. NEW: Peak Persistence Scoring - Phase 2 Enhancement
  // Feedback shows as vertical streak on spectrograph (persistent at one frequency)
  // Transient content (drums, speech) has low persistence
  const hasPersistenceData = 'persistenceFrames' in track || 'isPersistent' in track
  if (hasPersistenceData) {
    const persistenceData = track as unknown as { 
      persistenceFrames?: number
      persistenceBoost?: number
      isPersistent?: boolean
      isHighlyPersistent?: boolean
    }
    
    if (persistenceData.isHighlyPersistent) {
      // Very high persistence (320ms+) - strong feedback indicator
      pFeedback += PERSISTENCE_SCORING.HIGH_PERSISTENCE_BOOST
      reasons.push(`High persistence: ${persistenceData.persistenceFrames} frames (~${((persistenceData.persistenceFrames || 0) * 20)}ms)`)
    } else if (persistenceData.isPersistent) {
      // Moderate persistence (160ms+)
      pFeedback += PERSISTENCE_SCORING.MIN_PERSISTENCE_BOOST
      reasons.push(`Persistent: ${persistenceData.persistenceFrames} frames`)
    } else if ((persistenceData.persistenceFrames || 0) < PERSISTENCE_SCORING.LOW_PERSISTENCE_FRAMES) {
      // Very low persistence - likely transient, reduce feedback probability
      pFeedback -= PERSISTENCE_SCORING.LOW_PERSISTENCE_PENALTY
      pInstrument += PERSISTENCE_SCORING.LOW_PERSISTENCE_PENALTY * 0.5
      reasons.push(`Transient: low persistence (${persistenceData.persistenceFrames} frames)`)
    }
  }

  // 14. NEW: Adjacent Frequency Detection (Beating) - Phase 3 Enhancement
  // From DBX research: two close frequencies create audible "beating"
  // This indicates multiple feedback paths and requires wider notch treatment
  const hasAdjacentData = 'hasAdjacentPeaks' in track || 'adjacentPeakIds' in track
  if (hasAdjacentData) {
    const adjacentData = track as unknown as {
      hasAdjacentPeaks?: boolean
      adjacentPeakIds?: string[]
      beatFrequencies?: number[]
      clusterCenterHz?: number
      clusterWidthHz?: number
    }
    
    if (adjacentData.hasAdjacentPeaks && adjacentData.adjacentPeakIds && adjacentData.adjacentPeakIds.length > 0) {
      // Adjacent peaks detected - boost feedback probability (multi-path feedback)
      pFeedback += ADJACENT_DETECTION.ADJACENT_FEEDBACK_BOOST
      
      // Build reason string
      const beatStr = adjacentData.beatFrequencies?.map(b => `${b.toFixed(0)}Hz`).join(', ') || 'unknown'
      const noticeableBeating = adjacentData.beatFrequencies?.some(b => b <= ADJACENT_DETECTION.BEAT_WARNING_HZ)
      if (noticeableBeating) {
        reasons.push(`Adjacent peaks with noticeable beating (${beatStr})`)
      } else {
        reasons.push(`Adjacent peaks detected: ${adjacentData.adjacentPeakIds.length} nearby, beat freq: ${beatStr}`)
      }
    }
  }
  
  // ==================== Normalization ====================

  // Clamp probabilities to valid range before normalization
  pFeedback = Math.max(0, Math.min(1, pFeedback))
  pWhistle = Math.max(0, Math.min(1, pWhistle))
  pInstrument = Math.max(0, Math.min(1, pInstrument))

  const total = pFeedback + pWhistle + pInstrument
  if (total > 0) {
    pFeedback /= total
    pWhistle /= total
    pInstrument /= total
  }

  // Calculate calibrated confidence using new utility
  const calibratedResult = calculateCalibratedConfidence(
    pFeedback,
    pWhistle,
    pInstrument,
    modalAnalysis.feedbackProbabilityBoost,
    cumulativeGrowth.severity
  )
  
  // Phase 6: Hybrid Detection Fusion
  // Combine multiple detection methods for improved accuracy
  const hybridInput = {
    msd: features.msd,
    msdIsHowl: features.msdIsHowl,
    persistenceFrames: features.persistenceFrames,
    qFactor: features.qEstimate,
    growthRateDbPerSec: features.velocityDbPerSec,
    harmonicCount: harmonicAnalysis?.harmonicCount ?? 0,
    hasAdjacentPeaks: hasAdjacentData && (track as unknown as { hasAdjacentPeaks?: boolean }).hasAdjacentPeaks,
  }
  const hybridResult = calculateHybridFusion(hybridInput)
  
  // Blend calibrated confidence with hybrid fusion
  // Use hybrid for feedback detection boost, but don't override clear whistle/instrument
  let confidence = calibratedResult.confidence
  if (pFeedback > pWhistle && pFeedback > pInstrument) {
    // Feedback is leading - use hybrid fusion to boost/validate
    confidence = (calibratedResult.confidence * 0.6) + (hybridResult.confidence * 0.4)
    if (hybridResult.agreementLevel >= 4) {
      reasons.push(`Hybrid: ${hybridResult.agreementLevel}/6 methods agree`)
    }
  }
  
  const pUnknown = 1 - confidence

  // ==================== Classification ====================

  let label: IssueLabel
  let severity: SeverityLevel

  // Determine severity based on velocity, cumulative growth, prominence, and other factors
  // Use settings thresholds if provided, otherwise fall back to constants
  const runawayVelocity = SEVERITY_THRESHOLDS.RUNAWAY_VELOCITY
  const growingVelocity = settings?.growthRateThreshold ?? SEVERITY_THRESHOLDS.GROWING_VELOCITY
  const ringThreshold = settings?.ringThresholdDb ?? 5 // Default 5dB prominence for ring
  
  // Check for MSD fast confirm (fastest detection path)
  const msdFastConfirm = hasMsdData && 'msdFastConfirm' in track && (track as { msdFastConfirm?: boolean }).msdFastConfirm
  const msdIsHowl = hasMsdData && 'msdIsHowl' in track && (track as { msdIsHowl?: boolean }).msdIsHowl

  // Priority 1: Check for runaway (instantaneous OR cumulative OR MSD fast confirm)
  if (features.maxVelocityDbPerSec >= runawayVelocity || cumulativeGrowth.severity === 'RUNAWAY') {
    severity = 'RUNAWAY'
    pFeedback = Math.max(pFeedback, 0.85) // Runaway almost always feedback
  }
  // Priority 1b: MSD fast confirm with significant growth = treat as runaway
  else if (msdFastConfirm && features.maxVelocityDbPerSec >= growingVelocity * 0.5) {
    severity = 'RUNAWAY'
    pFeedback = Math.max(pFeedback, 0.80)
    reasons.push('MSD fast confirm: catching feedback early')
  }
  // Priority 2: Check for growing (instantaneous OR cumulative OR MSD howl)
  else if (features.maxVelocityDbPerSec >= growingVelocity || cumulativeGrowth.severity === 'GROWING' || msdIsHowl) {
    severity = 'GROWING'
    pFeedback = Math.max(pFeedback, 0.7)
  }
  // Priority 3: Check cumulative building (slow but steady growth)
  else if (cumulativeGrowth.severity === 'BUILDING') {
    severity = 'GROWING' // Treat as growing for early warning
    reasons.push('Early warning: slow buildup detected')
  }
  // Priority 4: High Q resonance
  else if (features.minQ > qThreshold) {
    severity = 'RESONANCE'
  }
  // Priority 5: Prominent but short-lived = ring
  else if (features.prominenceDb >= ringThreshold && features.persistenceMs < SEVERITY_THRESHOLDS.PERSISTENCE_MS) {
    severity = 'POSSIBLE_RING'
  }
  // Priority 6: Prominent and persisting = resonance
  else if (features.prominenceDb >= ringThreshold) {
    severity = 'RESONANCE'
  }
  // Default: resonance
  else {
    severity = 'RESONANCE'
  }

  // Determine label
  if (pWhistle >= CLASSIFIER_WEIGHTS.WHISTLE_THRESHOLD && pWhistle > pFeedback) {
    label = 'WHISTLE'
    severity = 'WHISTLE'
  } else if (pInstrument >= CLASSIFIER_WEIGHTS.INSTRUMENT_THRESHOLD && pInstrument > pFeedback) {
    label = 'INSTRUMENT'
    severity = 'INSTRUMENT'
  } else if (severity === 'POSSIBLE_RING') {
    label = 'POSSIBLE_RING'
  } else {
    label = 'ACOUSTIC_FEEDBACK'
  }

  // Override: Runaway is always feedback
  if (severity === 'RUNAWAY') {
    label = 'ACOUSTIC_FEEDBACK'
  }

  return {
    pFeedback,
    pWhistle,
    pInstrument,
    pUnknown,
    label,
    severity,
    confidence,
    reasons,
    // Enhanced fields from acoustic analysis
    modalOverlapFactor: modalOverlap,
    cumulativeGrowthDb: cumulativeGrowth.totalGrowthDb,
    frequencyBand: freqBand.band,
    confidenceLabel: calibratedResult.confidenceLabel,
  }
}

/**
 * Determine if an issue should be reported based on mode, classification, and confidence
 * Enhanced with confidence threshold filtering to reduce false positives
 */
export function shouldReportIssue(
  classification: ClassificationResult,
  settings: DetectorSettings
): boolean {
  const mode = settings.mode
  const ignoreWhistle = !settings.musicAware // If music aware, don't filter whistles
  const { label, severity, confidence } = classification
  
  // Get confidence threshold from settings (default 0.40 = 40%, range 0.0-1.0)
  const confidenceThreshold = settings.confidenceThreshold ?? 0.40

  // Always report runaway regardless of mode or confidence
  if (severity === 'RUNAWAY') {
    return true
  }
  
  // Always report GROWING severity regardless of confidence (early warning)
  if (severity === 'GROWING') {
    return true
  }

  // Filter by confidence threshold (reduces low-confidence alerts)
  if (confidence < confidenceThreshold) {
    return false
  }

  // Handle whistle filtering
  if (label === 'WHISTLE' && ignoreWhistle) {
    return false
  }

  // Mode-specific filtering
  switch (mode) {
    case 'feedbackHunt':
      // Report feedback and possible rings, not instruments
      return label !== 'INSTRUMENT'

    case 'vocalRing':
      // Report all issues including possible rings
      return true

    case 'musicAware':
      // Skip instruments (RUNAWAY severity already handled above)
      if (label === 'INSTRUMENT') {
        return false
      }
      return true

    case 'aggressive':
      // Report everything
      return true

    case 'calibration':
      // Report everything including instruments
      return true

    default:
      return label === 'ACOUSTIC_FEEDBACK' || label === 'POSSIBLE_RING'
  }
}

/**
 * Get display text for severity level
 */
export function getSeverityText(severity: SeverityLevel): string {
  switch (severity) {
    case 'RUNAWAY': return 'RUNAWAY'
    case 'GROWING': return 'Growing'
    case 'RESONANCE': return 'Resonance'
    case 'POSSIBLE_RING': return 'Ring'
    case 'WHISTLE': return 'Whistle'
    case 'INSTRUMENT': return 'Instrument'
    default: return 'Unknown'
  }
}

/**
 * Get urgency level (1-5) for severity
 */
export function getSeverityUrgency(severity: SeverityLevel): number {
  switch (severity) {
    case 'RUNAWAY': return 5
    case 'GROWING': return 4
    case 'RESONANCE': return 3
    case 'POSSIBLE_RING': return 2
    case 'WHISTLE': return 1
    case 'INSTRUMENT': return 1
    default: return 0
  }
}
