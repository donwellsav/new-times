/**
 * Acoustic Utilities for Kill The Ring
 * Based on "Sound Insulation" by Carl Hopkins (2007)
 * 
 * These utilities implement key acoustic formulas for improved feedback detection:
 * - Schroeder frequency calculation (room mode analysis)
 * - Modal overlap factor (isolated vs diffuse modes)
 * - Frequency band classification
 * - Cumulative growth tracking
 * - Formant/vibrato detection for voice discrimination
 */

import {
  SCHROEDER_CONSTANTS,
  FREQUENCY_BANDS,
  MODAL_OVERLAP,
  CUMULATIVE_GROWTH,
  VOCAL_FORMANTS,
  VIBRATO_DETECTION,
  ROOM_ESTIMATION,
  HARMONIC_SERIES_FILTER,
  ADJACENT_DETECTION,
  ROOM_MODE_CALCULATOR,
  MINDS_ADAPTIVE_DEPTH,
  HYBRID_FUSION,
} from './constants'

// ============================================================================
// ROOM DIMENSIONS TO RT60
// ============================================================================

/**
 * Calculate room volume from dimensions (L x W x H)
 * 
 * @param lengthM - Room length in meters
 * @param widthM - Room width in meters  
 * @param heightM - Room height in meters
 * @returns Volume in cubic meters
 */
export function calculateRoomVolume(lengthM: number, widthM: number, heightM: number): number {
  return lengthM * widthM * heightM
}

/**
 * Calculate total surface area of a rectangular room
 * 
 * @param lengthM - Room length in meters
 * @param widthM - Room width in meters
 * @param heightM - Room height in meters
 * @returns Total surface area in square meters
 */
export function calculateRoomSurfaceArea(lengthM: number, widthM: number, heightM: number): number {
  // Two walls of each pair + ceiling + floor
  return 2 * (lengthM * widthM + widthM * heightM + heightM * lengthM)
}

/**
 * Estimate RT60 from room dimensions using Sabine equation
 * RT60 = 0.161 * V / A
 * Where A = total absorption = surface area * absorption coefficient
 * 
 * @param lengthM - Room length in meters
 * @param widthM - Room width in meters
 * @param heightM - Room height in meters
 * @param absorptionCoeff - Average absorption coefficient (0.10-0.40, default 0.18)
 * @returns Estimated RT60 in seconds
 */
export function estimateRT60FromDimensions(
  lengthM: number,
  widthM: number,
  heightM: number,
  absorptionCoeff: number = ROOM_ESTIMATION.DEFAULT_ABSORPTION
): number {
  const volume = calculateRoomVolume(lengthM, widthM, heightM)
  const surfaceArea = calculateRoomSurfaceArea(lengthM, widthM, heightM)
  const totalAbsorption = surfaceArea * absorptionCoeff
  
  if (totalAbsorption <= 0) return 1.0 // Fallback
  
  // Sabine equation: RT60 = 0.161 * V / A
  const rt60 = (ROOM_ESTIMATION.SABINE_CONSTANT * volume) / totalAbsorption
  
  // Clamp to reasonable range (0.2s - 5s)
  return Math.max(0.2, Math.min(5.0, rt60))
}

/**
 * Convert feet to meters
 */
export function feetToMeters(feet: number): number {
  return feet * 0.3048
}

/**
 * Convert meters to feet
 */
export function metersToFeet(meters: number): number {
  return meters / 0.3048
}

/**
 * Get room parameters from dimensions with automatic RT60 estimation
 * 
 * @param lengthM - Room length in meters
 * @param widthM - Room width in meters
 * @param heightM - Room height in meters
 * @param absorptionType - Room treatment level
 * @returns Complete room acoustic parameters
 */
export function getRoomParametersFromDimensions(
  lengthM: number,
  widthM: number,
  heightM: number,
  absorptionType: 'untreated' | 'typical' | 'treated' | 'studio' = 'typical'
): {
  volume: number
  surfaceArea: number
  rt60: number
  schroederFrequency: number
  absorptionCoefficient: number
  roomSize: 'small' | 'medium' | 'large'
} {
  const absorptionCoeff = ROOM_ESTIMATION.ABSORPTION_COEFFICIENTS[absorptionType]
  const volume = calculateRoomVolume(lengthM, widthM, heightM)
  const surfaceArea = calculateRoomSurfaceArea(lengthM, widthM, heightM)
  const rt60 = estimateRT60FromDimensions(lengthM, widthM, heightM, absorptionCoeff)
  const schroederFrequency = calculateSchroederFrequency(rt60, volume)
  
  // Classify room size
  let roomSize: 'small' | 'medium' | 'large'
  if (volume < 150) {
    roomSize = 'small'
  } else if (volume < 500) {
    roomSize = 'medium'
  } else {
    roomSize = 'large'
  }
  
  return {
    volume,
    surfaceArea,
    rt60,
    schroederFrequency,
    absorptionCoefficient: absorptionCoeff,
    roomSize,
  }
}

// ============================================================================
// SCHROEDER FREQUENCY
// ============================================================================

/**
 * Calculate Schroeder frequency for a room
 * From textbook Equation 1.111: f_S = 2000 * sqrt(T/V)
 * 
 * Below this frequency, individual room modes dominate and statistical
 * analysis breaks down. Feedback detection needs different handling.
 * 
 * @param rt60 - Reverberation time in seconds (typical: 0.5-2.0)
 * @param volume - Room volume in cubic meters (typical: 100-2000)
 * @returns Schroeder cut-off frequency in Hz
 */
export function calculateSchroederFrequency(rt60: number, volume: number): number {
  // Validate inputs
  if (rt60 <= 0 || volume <= 0) {
    return SCHROEDER_CONSTANTS.DEFAULT_FREQUENCY
  }
  
  // f_S = 2000 * sqrt(T/V)
  const fs = SCHROEDER_CONSTANTS.COEFFICIENT * Math.sqrt(rt60 / volume)
  
  // Clamp to reasonable range (50Hz - 500Hz)
  return Math.max(50, Math.min(500, fs))
}

/**
 * Get frequency band for a given frequency
 * Uses Schroeder frequency to set the LOW/MID boundary
 * 
 * @param frequencyHz - Frequency to classify
 * @param schroederHz - Schroeder frequency (LOW/MID boundary)
 * @returns Band classification and multipliers
 */
export function getFrequencyBand(
  frequencyHz: number,
  schroederHz: number = SCHROEDER_CONSTANTS.DEFAULT_FREQUENCY
): {
  band: 'LOW' | 'MID' | 'HIGH'
  prominenceMultiplier: number
  sustainMultiplier: number
  qThresholdMultiplier: number
  description: string
} {
  // Use Schroeder frequency as LOW/MID boundary
  const lowMidBoundary = Math.max(schroederHz, FREQUENCY_BANDS.LOW.maxHz)
  
  if (frequencyHz < lowMidBoundary) {
    return {
      band: 'LOW',
      ...FREQUENCY_BANDS.LOW,
    }
  } else if (frequencyHz < FREQUENCY_BANDS.MID.maxHz) {
    return {
      band: 'MID',
      ...FREQUENCY_BANDS.MID,
    }
  } else {
    return {
      band: 'HIGH',
      ...FREQUENCY_BANDS.HIGH,
    }
  }
}

// ============================================================================
// MODAL OVERLAP FACTOR
// ============================================================================

/**
 * Calculate modal overlap factor from Q value
 * 
 * From textbook Section 1.2.6.7, Equation 1.109: M = f * η * n
 * Where: η = loss factor, n = modal density
 * 
 * For a single resonance with measured Q:
 * - The loss factor η relates to Q via: η ≈ 1/Q (for lightly damped systems)
 * - Reference: textbook discusses η = Δf_3dB / (π * f) and Q = f / Δf_3dB
 * 
 * For feedback detection, we use a normalized modal overlap indicator:
 * M_indicator = 1/Q (dimensionless ratio indicating resonance sharpness)
 * 
 * Interpretation (based on textbook Fig 1.23):
 * - M << 1 (< 0.03, i.e. Q > 33): Sharp isolated peak with deep troughs
 *   → More likely to be feedback (sustained single frequency)
 * - M ≈ 0.1 (Q ≈ 10): Moderate resonance
 *   → Could be feedback or room resonance
 * - M >> 0.1 (Q < 10): Broad peak, overlapping response
 *   → Less likely to be feedback (more noise-like)
 * 
 * @param qFactor - Q factor of the resonance (Q = f / Δf_3dB)
 * @returns Modal overlap indicator (1/Q)
 */
export function calculateModalOverlap(qFactor: number): number {
  if (qFactor <= 0) return Infinity
  // M_indicator = 1/Q = Δf_3dB / f
  return 1 / qFactor
}

/**
 * Classify modal overlap indicator as isolated, coupled, or diffuse
 * 
 * With M = 1/Q:
 * - Low M (high Q) = sharp isolated peak = likely feedback
 * - High M (low Q) = broad peak = less likely feedback
 */
export function classifyModalOverlap(modalOverlap: number): {
  classification: 'ISOLATED' | 'COUPLED' | 'DIFFUSE'
  feedbackProbabilityBoost: number
  description: string
} {
  // Note: With M = 1/Q, ISOLATED has the LOWEST M value (highest Q)
  if (modalOverlap < MODAL_OVERLAP.ISOLATED) {
    return {
      classification: 'ISOLATED',
      feedbackProbabilityBoost: 0.15, // Boost feedback probability for sharp peaks
      description: 'Sharp isolated peak (Q > 33) - high feedback risk',
    }
  } else if (modalOverlap < MODAL_OVERLAP.COUPLED) {
    return {
      classification: 'COUPLED',
      feedbackProbabilityBoost: 0.05, // Slight boost
      description: 'Moderate resonance (Q 10-33) - possible feedback',
    }
  } else if (modalOverlap < MODAL_OVERLAP.DIFFUSE) {
    return {
      classification: 'COUPLED',
      feedbackProbabilityBoost: 0, // Neutral
      description: 'Broader resonance (Q 3-10) - lower feedback risk',
    }
  } else {
    return {
      classification: 'DIFFUSE',
      feedbackProbabilityBoost: -0.10, // Reduce feedback probability
      description: 'Broad peak (Q < 3) - unlikely feedback',
    }
  }
}

// ============================================================================
// CUMULATIVE GROWTH TRACKING
// ============================================================================

/**
 * Calculate cumulative growth from track history
 * Detects slow-building feedback that may not trigger velocity thresholds
 * 
 * @param onsetDb - Amplitude at track onset
 * @param currentDb - Current amplitude
 * @param durationMs - Time since onset
 * @returns Growth analysis
 */
export function analyzeCumulativeGrowth(
  onsetDb: number,
  currentDb: number,
  durationMs: number
): {
  totalGrowthDb: number
  averageGrowthRateDbPerSec: number
  severity: 'NONE' | 'BUILDING' | 'GROWING' | 'RUNAWAY'
  shouldAlert: boolean
} {
  const totalGrowthDb = currentDb - onsetDb
  
  // Calculate average growth rate
  const durationSec = Math.max(durationMs / 1000, 0.1) // Avoid division by zero
  const averageGrowthRateDbPerSec = totalGrowthDb / durationSec
  
  // Only consider cumulative growth if duration is within valid range
  if (durationMs < CUMULATIVE_GROWTH.MIN_DURATION_MS || 
      durationMs > CUMULATIVE_GROWTH.MAX_DURATION_MS) {
    return {
      totalGrowthDb,
      averageGrowthRateDbPerSec,
      severity: 'NONE',
      shouldAlert: false,
    }
  }
  
  // Determine severity based on cumulative growth
  let severity: 'NONE' | 'BUILDING' | 'GROWING' | 'RUNAWAY' = 'NONE'
  let shouldAlert = false
  
  if (totalGrowthDb >= CUMULATIVE_GROWTH.RUNAWAY_THRESHOLD_DB) {
    severity = 'RUNAWAY'
    shouldAlert = true
  } else if (totalGrowthDb >= CUMULATIVE_GROWTH.ALERT_THRESHOLD_DB) {
    severity = 'GROWING'
    shouldAlert = true
  } else if (totalGrowthDb >= CUMULATIVE_GROWTH.WARNING_THRESHOLD_DB) {
    severity = 'BUILDING'
    shouldAlert = true
  }
  
  return {
    totalGrowthDb,
    averageGrowthRateDbPerSec,
    severity,
    shouldAlert,
  }
}

// ============================================================================
// VOCAL/WHISTLE DISCRIMINATION
// ============================================================================

/**
 * Check if a set of peaks matches vocal formant pattern
 * Voice has characteristic formant structure that feedback lacks
 * 
 * @param peakFrequencies - Array of detected peak frequencies
 * @returns Formant analysis result
 */
export function analyzeFormantStructure(peakFrequencies: number[]): {
  hasFormantStructure: boolean
  formantCount: number
  voiceProbability: number
  detectedFormants: { formant: string; frequency: number }[]
} {
  const detectedFormants: { formant: string; frequency: number }[] = []
  
  // Check for F1 (first formant)
  const f1Match = peakFrequencies.find(f => 
    f >= VOCAL_FORMANTS.F1_CENTER - VOCAL_FORMANTS.F1_RANGE &&
    f <= VOCAL_FORMANTS.F1_CENTER + VOCAL_FORMANTS.F1_RANGE
  )
  if (f1Match) {
    detectedFormants.push({ formant: 'F1', frequency: f1Match })
  }
  
  // Check for F2 (second formant)
  const f2Match = peakFrequencies.find(f => 
    f >= VOCAL_FORMANTS.F2_CENTER - VOCAL_FORMANTS.F2_RANGE &&
    f <= VOCAL_FORMANTS.F2_CENTER + VOCAL_FORMANTS.F2_RANGE
  )
  if (f2Match) {
    detectedFormants.push({ formant: 'F2', frequency: f2Match })
  }
  
  // Check for F3 (third formant)
  const f3Match = peakFrequencies.find(f => 
    f >= VOCAL_FORMANTS.F3_CENTER - VOCAL_FORMANTS.F3_RANGE &&
    f <= VOCAL_FORMANTS.F3_CENTER + VOCAL_FORMANTS.F3_RANGE
  )
  if (f3Match) {
    detectedFormants.push({ formant: 'F3', frequency: f3Match })
  }
  
  const formantCount = detectedFormants.length
  const hasFormantStructure = formantCount >= VOCAL_FORMANTS.MIN_FORMANTS_FOR_VOICE
  
  // Calculate voice probability based on formant matches
  // More formants = higher probability of voice
  const voiceProbability = Math.min(formantCount / 3, 1) * 0.5 // Max 50% boost from formants
  
  return {
    hasFormantStructure,
    formantCount,
    voiceProbability,
    detectedFormants,
  }
}

/**
 * Analyze frequency stability for vibrato detection
 * Whistle has characteristic 4-8 Hz vibrato; feedback is rock-steady
 * 
 * @param frequencyHistory - Array of {time, frequency} measurements
 * @returns Vibrato analysis
 */
export function analyzeVibrato(
  frequencyHistory: Array<{ time: number; frequency: number }>
): {
  hasVibrato: boolean
  vibratoRateHz: number | null
  vibratoDepthCents: number | null
  whistleProbability: number
} {
  if (frequencyHistory.length < 10) {
    return {
      hasVibrato: false,
      vibratoRateHz: null,
      vibratoDepthCents: null,
      whistleProbability: 0,
    }
  }
  
  // Calculate frequency deviation over recent history
  const recentHistory = frequencyHistory.slice(-20) // Last 20 samples
  const frequencies = recentHistory.map(h => h.frequency)
  const meanFreq = frequencies.reduce((a, b) => a + b, 0) / frequencies.length
  
  // Calculate standard deviation
  const variance = frequencies.reduce((sum, f) => sum + Math.pow(f - meanFreq, 2), 0) / frequencies.length
  const stdDev = Math.sqrt(variance)
  
  // Convert to cents: cents = 1200 * log2(f1/f2)
  // Guard against division by zero or invalid log input
  const denominator = Math.max(meanFreq - stdDev, 1)
  const depthCents = stdDev > 0 ? 1200 * Math.log2((meanFreq + stdDev) / denominator) : 0
  
  // Estimate vibrato rate from zero crossings of deviation
  const deviations = frequencies.map(f => f - meanFreq)
  let zeroCrossings = 0
  for (let i = 1; i < deviations.length; i++) {
    if (deviations[i] * deviations[i - 1] < 0) {
      zeroCrossings++
    }
  }
  
  // Time span of history
  const timeSpanMs = recentHistory[recentHistory.length - 1].time - recentHistory[0].time
  const timeSpanSec = timeSpanMs / 1000
  
  // Vibrato rate ≈ zero crossings / (2 * time span)
  const vibratoRateHz = timeSpanSec > 0 ? zeroCrossings / (2 * timeSpanSec) : 0
  
  // Check if this matches whistle vibrato characteristics
  const isVibratoRate = vibratoRateHz >= VIBRATO_DETECTION.MIN_RATE_HZ && 
                        vibratoRateHz <= VIBRATO_DETECTION.MAX_RATE_HZ
  const isVibratoDepth = depthCents >= VIBRATO_DETECTION.MIN_DEPTH_CENTS && 
                         depthCents <= VIBRATO_DETECTION.MAX_DEPTH_CENTS
  
  const hasVibrato = isVibratoRate && isVibratoDepth
  
  // Calculate whistle probability
  let whistleProbability = 0
  if (hasVibrato) {
    // Strong vibrato in the right range = likely whistle
    whistleProbability = 0.3
    // Wider vibrato = more likely whistle
    if (depthCents > 50) whistleProbability += 0.1
    if (depthCents > 80) whistleProbability += 0.1
  }
  
  return {
    hasVibrato,
    vibratoRateHz: hasVibrato ? vibratoRateHz : null,
    vibratoDepthCents: hasVibrato ? depthCents : null,
    whistleProbability,
  }
}

// ============================================================================
// CONFIDENCE CALIBRATION
// ============================================================================

/**
 * Calculate calibrated confidence score
 * Combines multiple factors into a well-calibrated confidence percentage
 * 
 * @param pFeedback - Raw feedback probability
 * @param pWhistle - Raw whistle probability  
 * @param pInstrument - Raw instrument probability
 * @param modalOverlapBoost - Boost from modal overlap analysis
 * @param cumulativeGrowthSeverity - Severity from cumulative growth
 * @returns Calibrated confidence (0-1)
 */
export function calculateCalibratedConfidence(
  pFeedback: number,
  pWhistle: number,
  pInstrument: number,
  modalOverlapBoost: number = 0,
  cumulativeGrowthSeverity: 'NONE' | 'BUILDING' | 'GROWING' | 'RUNAWAY' = 'NONE'
): {
  confidence: number
  adjustedPFeedback: number
  confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
} {
  // Start with the highest probability
  let confidence = Math.max(pFeedback, pWhistle, pInstrument)
  let adjustedPFeedback = pFeedback
  
  // Apply modal overlap boost to feedback probability
  adjustedPFeedback = Math.min(1, pFeedback + modalOverlapBoost)
  
  // Apply cumulative growth boost
  switch (cumulativeGrowthSeverity) {
    case 'RUNAWAY':
      adjustedPFeedback = Math.max(adjustedPFeedback, 0.85)
      confidence = Math.max(confidence, 0.85)
      break
    case 'GROWING':
      adjustedPFeedback = Math.min(1, adjustedPFeedback + 0.15)
      confidence = Math.max(confidence, adjustedPFeedback)
      break
    case 'BUILDING':
      adjustedPFeedback = Math.min(1, adjustedPFeedback + 0.08)
      confidence = Math.max(confidence, adjustedPFeedback)
      break
  }
  
  // Determine confidence label
  let confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
  if (confidence >= 0.85) {
    confidenceLabel = 'VERY_HIGH'
  } else if (confidence >= 0.70) {
    confidenceLabel = 'HIGH'
  } else if (confidence >= 0.45) {
    confidenceLabel = 'MEDIUM'
  } else {
    confidenceLabel = 'LOW'
  }
  
  return {
    confidence,
    adjustedPFeedback,
    confidenceLabel,
  }
}

/**
 * Apply frequency-dependent threshold multipliers
 * Adjusts detection thresholds based on frequency band
 * 
 * @param baseThreshold - Base threshold value
 * @param frequencyHz - Frequency being analyzed
 * @param schroederHz - Schroeder frequency
 * @param thresholdType - Which type of threshold to adjust
 * @returns Adjusted threshold
 */
export function applyFrequencyDependentThreshold(
  baseThreshold: number,
  frequencyHz: number,
  schroederHz: number,
  thresholdType: 'prominence' | 'sustain' | 'q'
): number {
  const band = getFrequencyBand(frequencyHz, schroederHz)
  
  switch (thresholdType) {
    case 'prominence':
      return baseThreshold * band.prominenceMultiplier
    case 'sustain':
      return baseThreshold * band.sustainMultiplier
    case 'q':
      return baseThreshold * band.qThresholdMultiplier
    default:
      return baseThreshold
  }
}

// ============================================================================
// HARMONIC SERIES FILTER - Phase 1 Enhancement
// ============================================================================

/**
 * Convert frequency ratio to cents difference
 */
function ratioCents(f1: number, f2: number): number {
  return Math.abs(1200 * Math.log2(f1 / f2))
}

/**
 * Analyze if a frequency has harmonic series present in the spectrum
 * 
 * Feedback is typically a pure sinusoid (single frequency).
 * Instruments produce harmonic series (fundamental + overtones at integer multiples).
 * 
 * @param fundamentalHz - The fundamental frequency to check
 * @param fundamentalDb - The amplitude of the fundamental
 * @param spectrum - The full spectrum data (Float32Array of dB values)
 * @param sampleRate - Audio sample rate
 * @param fftSize - FFT size used
 * @returns Analysis result with harmonic count and probability adjustments
 */
export function analyzeHarmonicSeries(
  fundamentalHz: number,
  fundamentalDb: number,
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number
): {
  hasHarmonicSeries: boolean
  harmonicCount: number
  isStrongHarmonicSeries: boolean
  harmonicsFound: number[]
  instrumentBoost: number
  feedbackPenalty: number
  reason: string
} {
  const binResolution = sampleRate / fftSize
  const harmonicsFound: number[] = []
  
  // Check for harmonics 2 through MAX_HARMONIC_NUMBER
  for (let h = 2; h <= HARMONIC_SERIES_FILTER.MAX_HARMONIC_NUMBER; h++) {
    const expectedHz = fundamentalHz * h
    
    // Skip if harmonic is above Nyquist
    if (expectedHz > sampleRate / 2) break
    
    // Find the bin for this expected harmonic
    const expectedBin = Math.round(expectedHz / binResolution)
    if (expectedBin >= spectrum.length) break
    
    // Search nearby bins for a peak (±2 bins for tolerance)
    let peakDb = -Infinity
    let peakBin = expectedBin
    for (let offset = -2; offset <= 2; offset++) {
      const checkBin = expectedBin + offset
      if (checkBin >= 0 && checkBin < spectrum.length) {
        if (spectrum[checkBin] > peakDb) {
          peakDb = spectrum[checkBin]
          peakBin = checkBin
        }
      }
    }
    
    // Calculate actual frequency of the found peak
    const actualHz = peakBin * binResolution
    const centsDiff = ratioCents(actualHz, expectedHz)
    
    // Check if this qualifies as a harmonic
    const isInTolerance = centsDiff <= HARMONIC_SERIES_FILTER.HARMONIC_TOLERANCE_CENTS
    const isAboveMinAmplitude = peakDb >= HARMONIC_SERIES_FILTER.MIN_HARMONIC_AMPLITUDE_DB
    const isWithinDecay = (fundamentalDb - peakDb) <= HARMONIC_SERIES_FILTER.MAX_HARMONIC_DECAY_DB
    
    if (isInTolerance && isAboveMinAmplitude && isWithinDecay) {
      harmonicsFound.push(h)
    }
  }
  
  const harmonicCount = harmonicsFound.length
  const hasHarmonicSeries = harmonicCount >= HARMONIC_SERIES_FILTER.MIN_HARMONICS_FOR_INSTRUMENT
  const isStrongHarmonicSeries = harmonicCount >= HARMONIC_SERIES_FILTER.STRONG_HARMONIC_COUNT
  
  // Calculate probability adjustments
  let instrumentBoost = 0
  let feedbackPenalty = 0
  let reason = ''
  
  if (isStrongHarmonicSeries) {
    instrumentBoost = HARMONIC_SERIES_FILTER.STRONG_INSTRUMENT_BOOST
    feedbackPenalty = HARMONIC_SERIES_FILTER.STRONG_FEEDBACK_PENALTY
    reason = `Strong harmonic series: ${harmonicCount} harmonics (${harmonicsFound.join(', ')})`
  } else if (hasHarmonicSeries) {
    instrumentBoost = HARMONIC_SERIES_FILTER.INSTRUMENT_BOOST
    feedbackPenalty = HARMONIC_SERIES_FILTER.FEEDBACK_PENALTY
    reason = `Harmonic series detected: ${harmonicCount} harmonics (${harmonicsFound.join(', ')})`
  }
  
  return {
    hasHarmonicSeries,
    harmonicCount,
    isStrongHarmonicSeries,
    harmonicsFound,
    instrumentBoost,
    feedbackPenalty,
    reason,
  }
}

/**
 * Simplified harmonic series check using active tracks
 * This version doesn't require full spectrum, just checks if other active tracks
 * are at harmonic frequencies of the candidate
 * 
 * @param fundamentalHz - The fundamental frequency to check
 * @param activeTracks - Array of currently active track frequencies and amplitudes
 * @returns Analysis result
 */
export function analyzeHarmonicSeriesFromTracks(
  fundamentalHz: number,
  fundamentalDb: number,
  activeTracks: Array<{ frequencyHz: number; amplitudeDb: number }>
): {
  hasHarmonicSeries: boolean
  harmonicCount: number
  isStrongHarmonicSeries: boolean
  harmonicsFound: number[]
  instrumentBoost: number
  feedbackPenalty: number
  reason: string
} {
  const harmonicsFound: number[] = []
  
  // Check for harmonics 2 through MAX_HARMONIC_NUMBER
  for (let h = 2; h <= HARMONIC_SERIES_FILTER.MAX_HARMONIC_NUMBER; h++) {
    const expectedHz = fundamentalHz * h
    
    // Check if any active track is at this harmonic frequency
    for (const track of activeTracks) {
      const centsDiff = ratioCents(track.frequencyHz, expectedHz)
      const isInTolerance = centsDiff <= HARMONIC_SERIES_FILTER.HARMONIC_TOLERANCE_CENTS
      const isAboveMinAmplitude = track.amplitudeDb >= HARMONIC_SERIES_FILTER.MIN_HARMONIC_AMPLITUDE_DB
      const isWithinDecay = (fundamentalDb - track.amplitudeDb) <= HARMONIC_SERIES_FILTER.MAX_HARMONIC_DECAY_DB
      
      if (isInTolerance && isAboveMinAmplitude && isWithinDecay) {
        harmonicsFound.push(h)
        break // Found this harmonic, move to next
      }
    }
  }
  
  const harmonicCount = harmonicsFound.length
  const hasHarmonicSeries = harmonicCount >= HARMONIC_SERIES_FILTER.MIN_HARMONICS_FOR_INSTRUMENT
  const isStrongHarmonicSeries = harmonicCount >= HARMONIC_SERIES_FILTER.STRONG_HARMONIC_COUNT
  
  // Calculate probability adjustments
  let instrumentBoost = 0
  let feedbackPenalty = 0
  let reason = ''
  
  if (isStrongHarmonicSeries) {
    instrumentBoost = HARMONIC_SERIES_FILTER.STRONG_INSTRUMENT_BOOST
    feedbackPenalty = HARMONIC_SERIES_FILTER.STRONG_FEEDBACK_PENALTY
    reason = `Strong harmonic series: ${harmonicCount} harmonics (${harmonicsFound.join(', ')})`
  } else if (hasHarmonicSeries) {
    instrumentBoost = HARMONIC_SERIES_FILTER.INSTRUMENT_BOOST
    feedbackPenalty = HARMONIC_SERIES_FILTER.FEEDBACK_PENALTY
    reason = `Harmonic series detected: ${harmonicCount} harmonics (${harmonicsFound.join(', ')})`
  }
  
  return {
    hasHarmonicSeries,
    harmonicCount,
    isStrongHarmonicSeries,
    harmonicsFound,
    instrumentBoost,
    feedbackPenalty,
    reason,
  }
}

// ============================================================================
// ADJACENT FREQUENCY DETECTION (BEATING) - Phase 3 Enhancement
// ============================================================================

/**
 * Find adjacent peaks that could cause audible beating
 * When two feedback frequencies are close together (within ~50Hz),
 * they create an audible "beating" effect indicating multiple feedback paths.
 */
export function findAdjacentPeaks(
  candidateHz: number,
  candidateDb: number,
  activePeaks: Array<{ frequencyHz: number; amplitudeDb: number; id?: string }>
): {
  hasAdjacent: boolean
  adjacentPeaks: Array<{ frequencyHz: number; amplitudeDb: number; beatHz: number; id?: string }>
  beatFrequencies: number[]
  feedbackBoost: number
  notchQFactor: number
  notchDepthFactor: number
  clusterCenterHz: number
  clusterWidthHz: number
  reason: string
} {
  const adjacentPeaks: Array<{ frequencyHz: number; amplitudeDb: number; beatHz: number; id?: string }> = []
  const beatFrequencies: number[] = []
  
  if (candidateDb < ADJACENT_DETECTION.MIN_AMPLITUDE_DB) {
    return {
      hasAdjacent: false, adjacentPeaks: [], beatFrequencies: [],
      feedbackBoost: 0, notchQFactor: 1, notchDepthFactor: 1,
      clusterCenterHz: candidateHz, clusterWidthHz: 0, reason: '',
    }
  }
  
  for (const peak of activePeaks) {
    const hzDiff = Math.abs(peak.frequencyHz - candidateHz)
    if (hzDiff < ADJACENT_DETECTION.MIN_ADJACENT_HZ || hzDiff > ADJACENT_DETECTION.MAX_ADJACENT_HZ) continue
    if (peak.amplitudeDb < ADJACENT_DETECTION.MIN_AMPLITUDE_DB) continue
    if (Math.abs(peak.amplitudeDb - candidateDb) > ADJACENT_DETECTION.AMPLITUDE_MATCH_DB) continue
    
    adjacentPeaks.push({ frequencyHz: peak.frequencyHz, amplitudeDb: peak.amplitudeDb, beatHz: hzDiff, id: peak.id })
    beatFrequencies.push(hzDiff)
  }
  
  const hasAdjacent = adjacentPeaks.length > 0
  let clusterCenterHz = candidateHz, clusterWidthHz = 0, adjReason = ''
  
  if (hasAdjacent) {
    const allFreqs = [candidateHz, ...adjacentPeaks.map(p => p.frequencyHz)]
    clusterCenterHz = (Math.min(...allFreqs) + Math.max(...allFreqs)) / 2
    clusterWidthHz = Math.max(...allFreqs) - Math.min(...allFreqs)
    const beatStr = beatFrequencies.map(b => `${b.toFixed(1)}Hz`).join(', ')
    const warning = beatFrequencies.some(b => b <= ADJACENT_DETECTION.BEAT_WARNING_HZ) ? ' (NOTICEABLE BEATING)' : ''
    adjReason = `Adjacent peaks: ${adjacentPeaks.length}, beat freq: ${beatStr}${warning}`
  }
  
  return {
    hasAdjacent, adjacentPeaks, beatFrequencies,
    feedbackBoost: hasAdjacent ? ADJACENT_DETECTION.ADJACENT_FEEDBACK_BOOST : 0,
    notchQFactor: hasAdjacent ? ADJACENT_DETECTION.ADJACENT_NOTCH_Q_FACTOR : 1,
    notchDepthFactor: hasAdjacent ? ADJACENT_DETECTION.ADJACENT_NOTCH_DEPTH_FACTOR : 1,
    clusterCenterHz, clusterWidthHz, reason: adjReason,
  }
}

// ============================================================================
// ROOM MODE CALCULATOR - Phase 4 Enhancement
// ============================================================================

export interface RoomMode {
  frequencyHz: number
  nx: number // Mode number for length
  ny: number // Mode number for width
  nz: number // Mode number for height
  type: 'axial' | 'tangential' | 'oblique'
  strength: number // Relative strength (axial strongest)
}

/**
 * Calculate room modes from dimensions
 * 
 * Room modes are standing waves at specific frequencies determined by room dimensions.
 * Formula: f = (c/2) * sqrt((nx/Lx)² + (ny/Ly)² + (nz/Lz)²)
 * 
 * @param lengthM - Room length in meters
 * @param widthM - Room width in meters
 * @param heightM - Room height in meters
 * @returns Array of room modes sorted by frequency
 */
export function calculateRoomModes(
  lengthM: number,
  widthM: number,
  heightM: number
): RoomMode[] {
  const c = ROOM_MODE_CALCULATOR.SPEED_OF_SOUND
  const maxN = ROOM_MODE_CALCULATOR.MAX_MODE_NUMBER
  const modes: RoomMode[] = []
  
  // Validate inputs
  if (lengthM <= 0 || widthM <= 0 || heightM <= 0) {
    return []
  }
  
  // Calculate all mode combinations
  for (let nx = 0; nx <= maxN; nx++) {
    for (let ny = 0; ny <= maxN; ny++) {
      for (let nz = 0; nz <= maxN; nz++) {
        // Skip the (0,0,0) mode (DC)
        if (nx === 0 && ny === 0 && nz === 0) continue
        
        // Calculate frequency
        const fSquared = 
          Math.pow(nx / lengthM, 2) + 
          Math.pow(ny / widthM, 2) + 
          Math.pow(nz / heightM, 2)
        const frequencyHz = (c / 2) * Math.sqrt(fSquared)
        
        // Skip if outside useful range
        if (frequencyHz < ROOM_MODE_CALCULATOR.MIN_MODE_HZ || 
            frequencyHz > ROOM_MODE_CALCULATOR.MAX_MODE_HZ) {
          continue
        }
        
        // Determine mode type
        const nonZeroCount = (nx > 0 ? 1 : 0) + (ny > 0 ? 1 : 0) + (nz > 0 ? 1 : 0)
        let type: 'axial' | 'tangential' | 'oblique'
        let strength: number
        
        if (nonZeroCount === 1) {
          type = 'axial'
          strength = ROOM_MODE_CALCULATOR.MODE_STRENGTH.axial
        } else if (nonZeroCount === 2) {
          type = 'tangential'
          strength = ROOM_MODE_CALCULATOR.MODE_STRENGTH.tangential
        } else {
          type = 'oblique'
          strength = ROOM_MODE_CALCULATOR.MODE_STRENGTH.oblique
        }
        
        modes.push({ frequencyHz, nx, ny, nz, type, strength })
      }
    }
  }
  
  // Sort by frequency
  modes.sort((a, b) => a.frequencyHz - b.frequencyHz)
  
  return modes
}

/**
 * Check if a frequency matches any room mode
 * 
 * @param frequencyHz - Frequency to check
 * @param roomModes - Pre-calculated room modes
 * @returns Match result with closest mode if found
 */
export function matchRoomMode(
  frequencyHz: number,
  roomModes: RoomMode[]
): {
  isRoomMode: boolean
  matchedMode: RoomMode | null
  confidencePenalty: number
  reason: string
} {
  if (!roomModes.length) {
    return { isRoomMode: false, matchedMode: null, confidencePenalty: 0, reason: '' }
  }
  
  // Find closest mode within tolerance
  let closestMode: RoomMode | null = null
  let closestDiff = Infinity
  
  for (const mode of roomModes) {
    const diff = Math.abs(frequencyHz - mode.frequencyHz)
    if (diff <= ROOM_MODE_CALCULATOR.MODE_MATCH_TOLERANCE_HZ && diff < closestDiff) {
      closestMode = mode
      closestDiff = diff
    }
  }
  
  if (closestMode) {
    const modeLabel = `(${closestMode.nx},${closestMode.ny},${closestMode.nz})`
    return {
      isRoomMode: true,
      matchedMode: closestMode,
      confidencePenalty: ROOM_MODE_CALCULATOR.ROOM_MODE_CONFIDENCE_PENALTY * closestMode.strength,
      reason: `Matches room mode ${modeLabel} at ${closestMode.frequencyHz.toFixed(1)}Hz (${closestMode.type})`,
    }
  }
  
  return { isRoomMode: false, matchedMode: null, confidencePenalty: 0, reason: '' }
}

/**
 * Get formatted room mode display data
 * Groups modes by type for UI display
 */
export function formatRoomModesForDisplay(modes: RoomMode[]): {
  axial: Array<{ hz: string; label: string }>
  tangential: Array<{ hz: string; label: string }>
  oblique: Array<{ hz: string; label: string }>
  all: Array<{ hz: string; label: string; type: string; strength: number }>
} {
  const axial: Array<{ hz: string; label: string }> = []
  const tangential: Array<{ hz: string; label: string }> = []
  const oblique: Array<{ hz: string; label: string }> = []
  const all: Array<{ hz: string; label: string; type: string; strength: number }> = []
  
  for (const mode of modes) {
    const hz = mode.frequencyHz.toFixed(1)
    const label = `(${mode.nx},${mode.ny},${mode.nz})`
    const entry = { hz, label }
    
    all.push({ hz, label, type: mode.type, strength: mode.strength })
    
    switch (mode.type) {
      case 'axial':
        axial.push(entry)
        break
      case 'tangential':
        tangential.push(entry)
        break
      case 'oblique':
        oblique.push(entry)
        break
    }
  }
  
  return { axial, tangential, oblique, all }
}

// ============================================================================
// MINDS ADAPTIVE NOTCH DEPTH - Phase 5 Enhancement
// ============================================================================

export interface AdaptiveNotchRecommendation {
  depthDb: number
  qFactor: number
  reasoning: string[]
  severity: 'static' | 'growing' | 'runaway' | 'whistle' | 'instrument'
  safetyApplied: boolean
}

/**
 * Calculate adaptive notch depth based on growth rate and amplitude
 * 
 * From MINDS algorithm concept: monitor growth and adjust depth until it stops.
 * We provide a single recommendation based on current growth rate and severity.
 * 
 * @param growthRateDbPerSec - Current growth rate in dB/sec
 * @param amplitudeAboveThresholdDb - How much above detection threshold
 * @param classification - Current classification (feedback/whistle/instrument)
 * @param hasAdjacentPeaks - Whether adjacent peaks were detected
 * @returns Adaptive notch recommendation
 */
export function calculateAdaptiveNotchDepth(
  growthRateDbPerSec: number,
  amplitudeAboveThresholdDb: number,
  classification: 'feedback' | 'whistle' | 'instrument' | 'unknown',
  hasAdjacentPeaks: boolean = false
): AdaptiveNotchRecommendation {
  const reasons: string[] = []
  let severity: 'static' | 'growing' | 'runaway' | 'whistle' | 'instrument'
  let baseDepth: number
  let qFactor: number = MINDS_ADAPTIVE_DEPTH.Q_BASE
  
  // Determine severity from classification and growth rate
  if (classification === 'whistle') {
    severity = 'whistle'
    baseDepth = MINDS_ADAPTIVE_DEPTH.BASE_DEPTH.WHISTLE
    reasons.push('Whistle detected (human vocal)')
  } else if (classification === 'instrument') {
    severity = 'instrument'
    baseDepth = MINDS_ADAPTIVE_DEPTH.BASE_DEPTH.INSTRUMENT
    reasons.push('Instrument detected (minimal cut)')
  } else if (growthRateDbPerSec >= MINDS_ADAPTIVE_DEPTH.GROWTH_RATE_THRESHOLDS.RUNAWAY) {
    severity = 'runaway'
    baseDepth = MINDS_ADAPTIVE_DEPTH.BASE_DEPTH.RUNAWAY
    qFactor = MINDS_ADAPTIVE_DEPTH.Q_BASE * MINDS_ADAPTIVE_DEPTH.Q_RUNAWAY_MULTIPLIER
    reasons.push(`Runaway growth: ${growthRateDbPerSec.toFixed(1)} dB/sec`)
  } else if (growthRateDbPerSec >= MINDS_ADAPTIVE_DEPTH.GROWTH_RATE_THRESHOLDS.GROWING) {
    severity = 'growing'
    baseDepth = MINDS_ADAPTIVE_DEPTH.BASE_DEPTH.GROWING
    reasons.push(`Growing feedback: ${growthRateDbPerSec.toFixed(1)} dB/sec`)
  } else {
    severity = 'static'
    baseDepth = MINDS_ADAPTIVE_DEPTH.BASE_DEPTH.STATIC
    qFactor = MINDS_ADAPTIVE_DEPTH.Q_BASE * MINDS_ADAPTIVE_DEPTH.Q_STATIC_MULTIPLIER
    reasons.push('Static resonance (not growing)')
  }
  
  // Adjust depth based on growth rate
  let depthDb = baseDepth
  if (severity === 'growing' || severity === 'runaway') {
    const growthAdjustment = growthRateDbPerSec * MINDS_ADAPTIVE_DEPTH.GROWTH_MULTIPLIER
    depthDb += growthAdjustment
    reasons.push(`Growth rate adjustment: ${growthAdjustment.toFixed(1)} dB`)
  }
  
  // Adjust depth based on amplitude above threshold
  if (amplitudeAboveThresholdDb > 0) {
    const ampAdjustment = amplitudeAboveThresholdDb * MINDS_ADAPTIVE_DEPTH.AMPLITUDE_MULTIPLIER
    depthDb += ampAdjustment
    reasons.push(`Amplitude adjustment: ${ampAdjustment.toFixed(1)} dB`)
  }
  
  // Apply safety margin for active growth
  let safetyApplied = false
  if (severity === 'growing' || severity === 'runaway') {
    depthDb += MINDS_ADAPTIVE_DEPTH.SAFETY_MARGIN_DB
    safetyApplied = true
    reasons.push(`Safety margin: ${MINDS_ADAPTIVE_DEPTH.SAFETY_MARGIN_DB} dB`)
  }
  
  // Adjust for adjacent peaks (wider notch, deeper cut)
  if (hasAdjacentPeaks) {
    depthDb *= 1.2 // 20% deeper
    qFactor *= 0.5 // Half Q (wider)
    reasons.push('Adjacent peaks: wider notch, deeper cut')
  }
  
  // Clamp to limits
  depthDb = Math.max(MINDS_ADAPTIVE_DEPTH.MAX_DEPTH, Math.min(MINDS_ADAPTIVE_DEPTH.MIN_DEPTH, depthDb))
  
  return {
    depthDb: Math.round(depthDb * 10) / 10, // Round to 0.1 dB
    qFactor: Math.round(qFactor * 10) / 10,
    reasoning: reasons,
    severity,
    safetyApplied,
  }
}

// ============================================================================
// HYBRID DETECTION FUSION - Phase 6 Enhancement
// ============================================================================

export interface HybridDetectionInput {
  msd?: number // MSD value (lower = more feedback-like)
  msdIsHowl?: boolean // MSD classification
  persistenceFrames?: number // Consecutive frames at frequency
  qFactor?: number // Q factor (higher = narrower peak)
  growthRateDbPerSec?: number // Growth rate
  harmonicCount?: number // Number of harmonics detected
  hasAdjacentPeaks?: boolean // Adjacent peaks detected
}

export interface HybridFusionResult {
  feedbackScore: number // 0-1 probability of feedback
  confidence: number // 0-1 confidence in the score
  methodScores: {
    msd: number
    persistence: number
    qFactor: number
    growthRate: number
    harmonicFilter: number
    adjacentPeaks: number
  }
  agreementLevel: number // How many methods agree (0-6)
  reasoning: string[]
}

/**
 * Hybrid Detection Fusion
 * 
 * Combines multiple detection methods into a single weighted score.
 * Each method contributes based on its confidence and weight.
 * 
 * @param input - Detection signals from various methods
 * @returns Fused detection result with confidence
 */
export function calculateHybridFusion(input: HybridDetectionInput): HybridFusionResult {
  const reasons: string[] = []
  const methodScores = {
    msd: 0,
    persistence: 0,
    qFactor: 0,
    growthRate: 0,
    harmonicFilter: 0,
    adjacentPeaks: 0,
  }
  
  let feedbackVotes = 0
  let totalWeight = 0
  let weightedScore = 0
  
  // 1. MSD Analysis
  if (input.msd !== undefined && input.msd >= 0) {
    totalWeight += HYBRID_FUSION.WEIGHTS.MSD
    // Lower MSD = more consistent growth = more feedback-like
    // Normalize: MSD 0 = score 1, MSD > threshold = score 0
    const msdScore = input.msdIsHowl ? 1 : Math.max(0, 1 - (input.msd / HYBRID_FUSION.THRESHOLDS.MSD_HOWL))
    methodScores.msd = msdScore
    weightedScore += msdScore * HYBRID_FUSION.WEIGHTS.MSD
    if (msdScore > 0.5) {
      feedbackVotes++
      reasons.push(`MSD indicates howl (${input.msd.toFixed(2)})`)
    }
  }
  
  // 2. Persistence Analysis
  if (input.persistenceFrames !== undefined) {
    totalWeight += HYBRID_FUSION.WEIGHTS.PERSISTENCE
    // Higher persistence = more feedback-like
    const persistenceScore = Math.min(1, input.persistenceFrames / HYBRID_FUSION.THRESHOLDS.PERSISTENCE_FRAMES)
    methodScores.persistence = persistenceScore
    weightedScore += persistenceScore * HYBRID_FUSION.WEIGHTS.PERSISTENCE
    if (persistenceScore > 0.5) {
      feedbackVotes++
      reasons.push(`High persistence (${input.persistenceFrames} frames)`)
    }
  }
  
  // 3. Q-Factor Analysis
  if (input.qFactor !== undefined && input.qFactor > 0) {
    totalWeight += HYBRID_FUSION.WEIGHTS.Q_FACTOR
    // Higher Q = narrower peak = more feedback-like
    const qScore = Math.min(1, input.qFactor / HYBRID_FUSION.THRESHOLDS.Q_FACTOR_HIGH)
    methodScores.qFactor = qScore
    weightedScore += qScore * HYBRID_FUSION.WEIGHTS.Q_FACTOR
    if (qScore > 0.5) {
      feedbackVotes++
      reasons.push(`High Q-factor (${input.qFactor.toFixed(0)})`)
    }
  }
  
  // 4. Growth Rate Analysis
  if (input.growthRateDbPerSec !== undefined) {
    totalWeight += HYBRID_FUSION.WEIGHTS.GROWTH_RATE
    // Positive growth = feedback-like
    const growthScore = input.growthRateDbPerSec > 0 
      ? Math.min(1, input.growthRateDbPerSec / HYBRID_FUSION.THRESHOLDS.GROWTH_RATE_POSITIVE)
      : 0
    methodScores.growthRate = growthScore
    weightedScore += growthScore * HYBRID_FUSION.WEIGHTS.GROWTH_RATE
    if (growthScore > 0.5) {
      feedbackVotes++
      reasons.push(`Growing (${input.growthRateDbPerSec.toFixed(1)} dB/s)`)
    }
  }
  
  // 5. Harmonic Filter Analysis
  if (input.harmonicCount !== undefined) {
    totalWeight += HYBRID_FUSION.WEIGHTS.HARMONIC_FILTER
    // Fewer harmonics = more feedback-like (feedback is pure tone)
    const harmonicScore = input.harmonicCount < HYBRID_FUSION.THRESHOLDS.HARMONIC_COUNT ? 1 : 0
    methodScores.harmonicFilter = harmonicScore
    weightedScore += harmonicScore * HYBRID_FUSION.WEIGHTS.HARMONIC_FILTER
    if (harmonicScore > 0.5) {
      feedbackVotes++
      reasons.push('No harmonic series (pure tone)')
    } else {
      reasons.push(`Harmonic series present (${input.harmonicCount} harmonics)`)
    }
  }
  
  // 6. Adjacent Peaks Analysis
  if (input.hasAdjacentPeaks !== undefined) {
    totalWeight += HYBRID_FUSION.WEIGHTS.ADJACENT_PEAKS
    // Adjacent peaks = multi-path feedback
    const adjacentScore = input.hasAdjacentPeaks ? 1 : 0
    methodScores.adjacentPeaks = adjacentScore
    weightedScore += adjacentScore * HYBRID_FUSION.WEIGHTS.ADJACENT_PEAKS
    if (adjacentScore > 0.5) {
      feedbackVotes++
      reasons.push('Adjacent peaks detected (multi-path)')
    }
  }
  
  // Calculate normalized feedback score
  let feedbackScore = totalWeight > 0 ? weightedScore / totalWeight : 0
  
  // Apply agreement bonuses/penalties
  let confidence = feedbackScore
  if (feedbackVotes >= 5) {
    feedbackScore = Math.min(1, feedbackScore + HYBRID_FUSION.STRONG_AGREEMENT_BONUS)
    confidence = Math.min(1, confidence + HYBRID_FUSION.STRONG_AGREEMENT_BONUS)
    reasons.push('Strong multi-method agreement')
  } else if (feedbackVotes >= 4) {
    feedbackScore = Math.min(1, feedbackScore + HYBRID_FUSION.AGREEMENT_BONUS)
    confidence = Math.min(1, confidence + HYBRID_FUSION.AGREEMENT_BONUS)
    reasons.push('Multi-method agreement')
  } else if (feedbackVotes <= 1 && totalWeight > 0.5) {
    // Methods disagree - reduce confidence
    confidence = Math.max(0, confidence - HYBRID_FUSION.DISAGREEMENT_PENALTY)
    reasons.push('Mixed signals (low agreement)')
  }
  
  // Clamp to valid range
  feedbackScore = Math.max(HYBRID_FUSION.MIN_CONFIDENCE, Math.min(HYBRID_FUSION.MAX_CONFIDENCE, feedbackScore))
  confidence = Math.max(HYBRID_FUSION.MIN_CONFIDENCE, Math.min(HYBRID_FUSION.MAX_CONFIDENCE, confidence))
  
  return {
    feedbackScore,
    confidence,
    methodScores,
    agreementLevel: feedbackVotes,
    reasoning: reasons,
  }
}
