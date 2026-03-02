// Kill The Ring Constants - ISO bands, note frequencies, and configuration

// Standard ISO 31-band graphic EQ center frequencies (1/3 octave)
export const ISO_31_BANDS: readonly number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000,
  20000
] as const

// A4 = 440 Hz reference
export const A4_HZ = 440
export const A4_MIDI = 69

// Note names for pitch display
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

// Cents per semitone
export const CENTS_PER_SEMITONE = 100
export const SEMITONES_PER_OCTAVE = 12
export const CENTS_PER_OCTAVE = 1200

// Mathematical constants (precomputed for performance)
export const LN10_OVER_10 = Math.LN10 / 10 // For dB to power conversion
export const LOG10_E = Math.LOG10E // For power to dB conversion
export const TWO_PI = Math.PI * 2

// ============================================================================
// ACOUSTIC CONSTANTS (from Sound Insulation textbook, Carl Hopkins 2007)
// ============================================================================

// Schroeder frequency calculation: f_S = 2000 * sqrt(T/V)
// Below this frequency, individual room modes dominate
// T = reverberation time (seconds), V = room volume (m³)
export const SCHROEDER_CONSTANTS = {
  COEFFICIENT: 2000, // From textbook Equation 1.111
  // Default estimates for typical venues when room data unavailable
  DEFAULT_RT60: 1.2, // seconds - typical for medium venue
  DEFAULT_VOLUME: 500, // m³ - typical conference room / small venue
  // Pre-calculated default Schroeder frequency
  get DEFAULT_FREQUENCY() {
    return this.COEFFICIENT * Math.sqrt(this.DEFAULT_RT60 / this.DEFAULT_VOLUME)
  },
} as const

// Frequency band definitions for frequency-dependent thresholds
// Based on textbook + acoustic principles for PA feedback detection
export const FREQUENCY_BANDS = {
  // Low band: Below Schroeder frequency, room modes dominate
  // Requires longer sustain, higher prominence to distinguish from bass content
  LOW: {
    minHz: 20,
    maxHz: 300, // Approximate - adjusted by Schroeder calculation
    prominenceMultiplier: 1.4, // Require 40% more prominence
    sustainMultiplier: 1.5, // Require 50% longer sustain
    qThresholdMultiplier: 0.6, // Lower Q threshold (broader peaks expected)
    description: 'Sub-bass to low-mid (room modes)',
  },
  // Mid band: Primary speech/vocal range, most feedback-prone
  // Standard thresholds, fastest response
  MID: {
    minHz: 300,
    maxHz: 3000,
    prominenceMultiplier: 1.0, // Standard prominence
    sustainMultiplier: 1.0, // Standard sustain
    qThresholdMultiplier: 1.0, // Standard Q threshold
    description: 'Mid range (speech fundamental + harmonics)',
  },
  // High band: Sibilance and high harmonics
  // More sensitive to high-Q peaks, A-weighting affects perception
  HIGH: {
    minHz: 3000,
    maxHz: 20000,
    prominenceMultiplier: 0.85, // Slightly less prominence needed (more audible)
    sustainMultiplier: 0.8, // Faster response (high freq feedback builds fast)
    qThresholdMultiplier: 1.2, // Higher Q threshold (expect narrower peaks)
    description: 'High range (sibilance, harmonics)',
  },
} as const

// Modal overlap indicator thresholds (M = 1/Q)
// Based on textbook Section 1.2.6.7 adapted for feedback detection
// With M = 1/Q: high Q (feedback-like) gives low M, low Q (broad) gives high M
export const MODAL_OVERLAP = {
  ISOLATED: 0.03, // M < 0.03 (Q > 33): Sharp isolated peak, high feedback risk
  COUPLED: 0.1, // M ≈ 0.1 (Q ≈ 10): Moderate resonance
  DIFFUSE: 0.33, // M > 0.33 (Q < 3): Broad peak, low feedback risk
} as const

// Cumulative growth tracking for slow-building feedback
export const CUMULATIVE_GROWTH = {
  WARNING_THRESHOLD_DB: 3, // Flag as "building" after 3dB cumulative growth
  ALERT_THRESHOLD_DB: 6, // Flag as "growing" after 6dB cumulative growth
  RUNAWAY_THRESHOLD_DB: 10, // Flag as "runaway" after 10dB cumulative growth
  MIN_DURATION_MS: 500, // Minimum duration to consider cumulative growth
  MAX_DURATION_MS: 10000, // Maximum window for cumulative growth calculation
} as const

// Vocal formant frequencies for whistle/vocal discrimination
// Based on average adult formant frequencies
export const VOCAL_FORMANTS = {
  F1_CENTER: 500, // First formant (jaw opening)
  F1_RANGE: 200, // ±200Hz
  F2_CENTER: 1500, // Second formant (tongue position)
  F2_RANGE: 500, // ±500Hz
  F3_CENTER: 2500, // Third formant (lip rounding)
  F3_RANGE: 500, // ±500Hz
  // Formant detection requires multiple peaks at these ratios
  MIN_FORMANTS_FOR_VOICE: 2, // Need at least 2 formants to classify as voice
} as const

// Vibrato detection for whistle discrimination
export const VIBRATO_DETECTION = {
  MIN_RATE_HZ: 4, // Minimum vibrato rate
  MAX_RATE_HZ: 8, // Maximum vibrato rate
  MIN_DEPTH_CENTS: 20, // Minimum vibrato depth
  MAX_DEPTH_CENTS: 100, // Maximum vibrato depth (wider = more likely whistle)
  DETECTION_WINDOW_MS: 500, // Window for vibrato analysis
} as const

// ============================================================================
// MSD (MAGNITUDE SLOPE DEVIATION) ALGORITHM - from DAFx-16 paper
// "Acoustic Feedback Detection using the Magnitude Slope Deviation"
// ============================================================================
// Feedback howl has exponential growth (linear on dB scale) with low gradient deviation.
// MSD measures how consistently the magnitude grows over time.
// Lower MSD = more consistent growth = more likely feedback howl.
export const MSD_SETTINGS = {
  // History buffer size - number of frames to track per bin
  // DAFx paper: 11-16 frames for speech/classical, up to 24 for rock
  // Using 16 for balanced speed/accuracy (speed priority)
  HISTORY_SIZE: 16,
  
  // Minimum frames needed before MSD calculation is valid
  MIN_FRAMES: 8,
  
  // MSD threshold for feedback classification (lower = stricter)
  // DAFx paper: threshold around 0.1-0.5 depending on content
  // Speed priority: use higher threshold (0.8) to catch more, faster
  HOWL_THRESHOLD: 0.8,
  
  // Minimum magnitude growth rate (dB/frame) to be considered "growing"
  // Speeds up detection by only analyzing actively growing peaks
  MIN_GROWTH_RATE: 0.05,
  
  // Summing MSD coefficient (from DAFx Summing MSD method - 140x faster)
  // Uses sum of squared second derivatives instead of individual frame MSD
  USE_SUMMING_MSD: true,
  
  // Fast confirmation: if MSD is below this for MIN_CONFIRM_FRAMES, confirm as feedback
  FAST_CONFIRM_THRESHOLD: 0.3,
  FAST_CONFIRM_FRAMES: 6,
  
  // Frame interval in ms (should match analysis interval)
  FRAME_INTERVAL_MS: 20,
} as const

// ============================================================================
// PEAK PERSISTENCE SCORING - Phase 2 Enhancement
// ============================================================================
// From Smaart research: "Constant tone shows up as a straight line on the 
// Spectrograph display... it becomes much harder to find on the RTA graph 
// in the presence of a complex dynamic signal like music."
// 
// Track how many consecutive frames a peak persists at the same frequency.
// High persistence = more likely feedback (pure tone)
// Low persistence = more likely transient/musical content
export const PERSISTENCE_SCORING = {
  // Number of consecutive frames to track for persistence
  HISTORY_FRAMES: 24, // ~480ms at 20ms intervals
  
  // Frequency tolerance for "same frequency" (cents)
  FREQUENCY_TOLERANCE_CENTS: 30, // Tighter than MSD for precision
  
  // Amplitude tolerance - peak must stay within this range to count as "persistent"
  AMPLITUDE_TOLERANCE_DB: 6,
  
  // Minimum persistence frames to start boosting feedback probability
  MIN_PERSISTENCE_FRAMES: 8, // ~160ms
  
  // High persistence threshold (strong feedback indicator)
  HIGH_PERSISTENCE_FRAMES: 16, // ~320ms
  
  // Very high persistence (almost certain feedback)
  VERY_HIGH_PERSISTENCE_FRAMES: 20, // ~400ms
  
  // Probability adjustments based on persistence
  MIN_PERSISTENCE_BOOST: 0.10, // 8+ frames
  HIGH_PERSISTENCE_BOOST: 0.20, // 16+ frames
  VERY_HIGH_PERSISTENCE_BOOST: 0.30, // 20+ frames
  
  // Penalty for low persistence (transient content)
  LOW_PERSISTENCE_PENALTY: 0.10, // <4 frames = reduce feedback probability
  LOW_PERSISTENCE_FRAMES: 4,
} as const

// ============================================================================
// ADJACENT FREQUENCY DETECTION (BEATING) - Phase 3 Enhancement
// ============================================================================
// From DBX research: "Two simultaneous tones so close in frequency that you 
// only perceive one tone whose amplitude oscillates (or 'beats') at a low 
// frequency which is the difference between the two feedback frequencies."
//
// When two feedback peaks are close together (within beat range), they cause
// audible beating/pulsing. This is a strong indicator of multiple feedback paths.
export const ADJACENT_DETECTION = {
  // Maximum Hz difference to consider "adjacent" (causes audible beating)
  // Beat frequency = |f1 - f2|, audible beating typically <50Hz difference
  MAX_ADJACENT_HZ: 50,
  
  // Minimum Hz difference (below this is same peak)
  MIN_ADJACENT_HZ: 3,
  
  // Both peaks must be within this many dB of each other
  AMPLITUDE_MATCH_DB: 12,
  
  // Both peaks must be above this amplitude
  MIN_AMPLITUDE_DB: -60,
  
  // Probability boost when adjacent peaks detected (multi-path feedback)
  ADJACENT_FEEDBACK_BOOST: 0.15,
  
  // EQ recommendation: use wider notch for adjacent peaks
  ADJACENT_NOTCH_Q_FACTOR: 0.5, // Multiply Q by this (wider notch)
  ADJACENT_NOTCH_DEPTH_FACTOR: 1.2, // Multiply depth by this (deeper cut)
  
  // Clustering: group adjacent peaks within this Hz range
  CLUSTER_RANGE_HZ: 100, // Group peaks within ±100Hz
  
  // Display warning threshold: flag if beat frequency would be this noticeable
  BEAT_WARNING_HZ: 30, // <30Hz beating is very noticeable
} as const

// ============================================================================
// ROOM MODE CALCULATOR - Phase 4 Enhancement
// ============================================================================
// Room modes are standing waves at specific frequencies determined by room dimensions.
// These can be confused with feedback but are actually room resonances.
// Formula: f = (c/2) * sqrt((nx/Lx)² + (ny/Ly)² + (nz/Lz)²)
// Where c = speed of sound (~343 m/s), nx/ny/nz are mode numbers (0,1,2,3...)
export const ROOM_MODE_CALCULATOR = {
  // Speed of sound in m/s (at 20°C)
  SPEED_OF_SOUND: 343,
  
  // Maximum mode number to calculate (0-3 for each axis)
  MAX_MODE_NUMBER: 3,
  
  // Minimum frequency to calculate modes for
  MIN_MODE_HZ: 20,
  
  // Maximum frequency to calculate modes for (room modes above this are less problematic)
  MAX_MODE_HZ: 300,
  
  // Frequency tolerance for matching peaks to room modes (Hz)
  MODE_MATCH_TOLERANCE_HZ: 5,
  
  // Confidence penalty when peak matches a room mode
  ROOM_MODE_CONFIDENCE_PENALTY: 0.15,
  
  // Mode types
  MODE_TYPES: {
    AXIAL: 'axial', // One dimension only (strongest)
    TANGENTIAL: 'tangential', // Two dimensions
    OBLIQUE: 'oblique', // Three dimensions (weakest)
  },
  
  // Relative strength of mode types (for display/sorting)
  MODE_STRENGTH: {
    axial: 1.0, // Strongest
    tangential: 0.5,
    oblique: 0.25, // Weakest
  },
} as const

// ============================================================================
// MINDS ADAPTIVE NOTCH DEPTH - Phase 5 Enhancement
// ============================================================================
// From DAFx-16 paper: MINDS algorithm monitors if magnitude is still growing
// and adjusts notch depth incrementally until growth stops.
// We simplify this to severity-based depth recommendations.
export const MINDS_ADAPTIVE_DEPTH = {
  // Base notch depths for each severity level (starting points)
  BASE_DEPTH: {
    STATIC: -3, // Resonance not growing - light cut
    GROWING: -6, // Slow growth - moderate cut
    RUNAWAY: -12, // Fast growth - deep cut
    WHISTLE: -4, // Whistle (human) - light cut
    INSTRUMENT: -2, // Instrument false positive - minimal cut (or none)
  },
  
  // Growth rate thresholds (dB/sec)
  GROWTH_RATE_THRESHOLDS: {
    STATIC: 0.5, // Below this = static
    GROWING: 2.0, // Below this = growing
    RUNAWAY: 5.0, // Above this = runaway
  },
  
  // Depth adjustment based on growth rate
  // Formula: depth = BASE + (growthRate * GROWTH_MULTIPLIER)
  GROWTH_MULTIPLIER: -1.5, // Each dB/sec growth adds 1.5dB cut
  
  // Depth adjustment based on amplitude above threshold
  // Louder = needs more cut
  AMPLITUDE_MULTIPLIER: -0.3, // Each dB above threshold adds 0.3dB cut
  
  // Maximum notch depth (safety limit)
  MAX_DEPTH: -18,
  
  // Minimum notch depth (don't recommend less than this)
  MIN_DEPTH: -2,
  
  // Q adjustment based on growth rate
  // Faster growth = narrower notch (more surgical)
  Q_BASE: 8,
  Q_RUNAWAY_MULTIPLIER: 2, // Double Q for runaway
  Q_STATIC_MULTIPLIER: 0.75, // Lower Q for static (wider)
  
  // Safety margin: add this much extra after growth stops
  SAFETY_MARGIN_DB: -1.5,
} as const

// ============================================================================
// HYBRID DETECTION FUSION - Phase 6 Enhancement
// ============================================================================
// Combine multiple detection methods into a single weighted score.
// Each method has strengths and weaknesses - fusion improves accuracy.
export const HYBRID_FUSION = {
  // Weight for each detection method (should sum to ~1.0)
  WEIGHTS: {
    MSD: 0.25, // MSD is good for consistent growth detection
    PERSISTENCE: 0.20, // Pure tones persist; music is dynamic
    Q_FACTOR: 0.15, // High Q = narrow peak = likely feedback
    GROWTH_RATE: 0.20, // Growing = definitely feedback
    HARMONIC_FILTER: 0.10, // Instruments have harmonics; feedback doesn't
    ADJACENT_PEAKS: 0.10, // Multiple nearby peaks = multi-path feedback
  },
  
  // Score thresholds for each method (normalized 0-1)
  // These determine when each method "votes" for feedback
  THRESHOLDS: {
    MSD_HOWL: 0.5, // MSD below this = consistent growth (feedback)
    PERSISTENCE_FRAMES: 12, // Frames above this = persistent (feedback)
    Q_FACTOR_HIGH: 30, // Q above this = narrow peak (feedback)
    GROWTH_RATE_POSITIVE: 1.0, // dB/sec above this = growing (feedback)
    HARMONIC_COUNT: 2, // Harmonics below this = no series (feedback)
  },
  
  // Confidence calibration
  // Final score is scaled to this range
  MIN_CONFIDENCE: 0.1,
  MAX_CONFIDENCE: 0.95,
  
  // Agreement bonus: if multiple methods agree, boost confidence
  AGREEMENT_BONUS: 0.10, // Add this if 4+ methods agree
  STRONG_AGREEMENT_BONUS: 0.15, // Add this if 5+ methods agree
  
  // Disagreement penalty: if methods strongly disagree, reduce confidence
  DISAGREEMENT_PENALTY: 0.10, // Subtract this if signals are mixed
} as const

// Room acoustics estimation from dimensions
// Using Sabine equation: RT60 = 0.161 * V / A
// Where V = volume (m³), A = total absorption (sabins)
export const ROOM_ESTIMATION = {
  // Average absorption coefficients for common room types
  ABSORPTION_COEFFICIENTS: {
    untreated: 0.10, // Bare walls, hard floors
    typical: 0.15, // Some carpet, curtains
    treated: 0.25, // Acoustic panels, soft furnishings
    studio: 0.40, // Heavy treatment
  },
  // Sabine constant (metric)
  SABINE_CONSTANT: 0.161,
  // Default absorption for conference/corporate rooms
  DEFAULT_ABSORPTION: 0.18,
} as const

// A-weighting constants (IEC/CD 1672)
export const A_WEIGHTING = {
  C1: 20.6,
  C2: 107.7,
  C3: 737.9,
  C4: 12200,
  OFFSET: 2.0, // dB offset for A-weighting formula
  MIN_DB: -120, // Clamp for frequencies near 0 Hz
} as const

// FFT size options
export const FFT_SIZE_OPTIONS = [2048, 4096, 8192, 16384, 32768] as const

// Severity thresholds - tuned for PA system feedback detection
export const SEVERITY_THRESHOLDS = {
  RUNAWAY_VELOCITY: 8, // dB/sec growth rate for runaway (lower = catch faster)
  GROWING_VELOCITY: 2, // dB/sec for growing (more sensitive)
  HIGH_Q: 40, // Q value indicating narrow resonance (lower = catch more)
  PERSISTENCE_MS: 400, // ms for resonance classification (faster detection)
} as const

// Classification weights - optimized for PA feedback detection
export const CLASSIFIER_WEIGHTS = {
  // Stationarity (low pitch variation = feedback) - increased weight
  STABILITY_FEEDBACK: 0.30,
  STABILITY_THRESHOLD_CENTS: 12, // tighter threshold for feedback detection
  
  // Harmonicity (coherent harmonics = instrument)
  HARMONICITY_INSTRUMENT: 0.25,
  HARMONICITY_THRESHOLD: 0.65, // higher threshold = less false instrument classification
  
  // Modulation (vibrato = whistle)
  MODULATION_WHISTLE: 0.20,
  MODULATION_THRESHOLD: 0.45, // slightly higher threshold
  
  // Sideband noise (breath = whistle)
  SIDEBAND_WHISTLE: 0.10,
  SIDEBAND_THRESHOLD: 0.35, // slightly higher threshold
  
  // Runaway growth (high velocity = feedback) - increased weight
  GROWTH_FEEDBACK: 0.25,
  GROWTH_THRESHOLD: 4, // lower threshold = catch feedback growth earlier
  
  // Classification thresholds - more conservative for PA use
  CLASSIFICATION_THRESHOLD: 0.45, // lower = more likely to flag as potential issue
  WHISTLE_THRESHOLD: 0.65, // higher = less false whistle classification
  INSTRUMENT_THRESHOLD: 0.60, // higher = less false instrument classification
} as const

// EQ recommendation presets
export const EQ_PRESETS = {
  surgical: {
    defaultQ: 8,
    runawayQ: 16,
    maxCut: -18,
    moderateCut: -9,
    lightCut: -4,
  },
  heavy: {
    defaultQ: 4,
    runawayQ: 8,
    maxCut: -12,
    moderateCut: -6,
    lightCut: -3,
  },
} as const

// Vocal ring assist mode settings - optimized for speech/corporate PA
export const VOCAL_RING_SETTINGS = {
  BASELINE_EMA_ALPHA: 0.02, // Slow LTAS baseline adaptation
  RING_THRESHOLD_DB: 4, // Lower threshold for earlier ring detection
  RING_PERSISTENCE_MS: 150, // Faster confirmation for speech dynamics
  VOICE_FREQ_LOW: 200, // Hz - vocal-focused lower bound
  VOICE_FREQ_HIGH: 8000, // Hz - extended for speech sibilance
  SUGGESTED_CUT_MIN: -2, // dB
  SUGGESTED_CUT_MAX: -6, // dB
} as const

// Spectral trend monitor settings
export const SPECTRAL_TRENDS = {
  LOW_RUMBLE_THRESHOLD_HZ: 80,
  LOW_RUMBLE_EXCESS_DB: 6,
  MUD_FREQ_LOW: 200,
  MUD_FREQ_HIGH: 400,
  MUD_EXCESS_DB: 4,
  HARSH_FREQ_LOW: 6000,
  HARSH_FREQ_HIGH: 10000,
  HARSH_EXCESS_DB: 5,
} as const

// Track history settings
export const TRACK_SETTINGS = {
  HISTORY_SIZE: 128, // Ring buffer size for track history
  ASSOCIATION_TOLERANCE_CENTS: 50, // Max cents difference to associate peak to track
  MAX_TRACKS: 64, // Maximum simultaneous tracks
  TRACK_TIMEOUT_MS: 1000, // Remove track after this inactive time
} as const

// Harmonic detection settings
export const HARMONIC_SETTINGS = {
  MAX_HARMONIC: 8, // Check overtones up to this partial (2nd–8th)
  TOLERANCE_CENTS: 50, // ±50 cents = half a semitone; matches track association tolerance
  // Sub-harmonic check: if new peak F and an active track is near F*k, new peak may be the fundamental
  CHECK_SUB_HARMONICS: true,
} as const

// ============================================================================
// HARMONIC SERIES FILTER - Phase 1 Enhancement
// ============================================================================
// Feedback is typically a pure sinusoid (single frequency).
// Instruments produce harmonic series (fundamental + overtones at integer multiples).
// By detecting harmonic series presence, we can reduce false positives for instruments.
export const HARMONIC_SERIES_FILTER = {
  // Minimum harmonics required to classify as "has harmonic structure"
  // 2 = just one overtone present, 3 = fundamental + 2 overtones (more confident)
  MIN_HARMONICS_FOR_INSTRUMENT: 2,
  
  // Minimum amplitude ratio (harmonic dB relative to fundamental)
  // Harmonics must be within this many dB of the fundamental to count
  MAX_HARMONIC_DECAY_DB: 30, // Harmonics can be up to 30dB below fundamental
  
  // Minimum amplitude for a harmonic to be counted (absolute)
  MIN_HARMONIC_AMPLITUDE_DB: -70,
  
  // Frequency tolerance for harmonic matching (cents)
  HARMONIC_TOLERANCE_CENTS: 40, // Tighter than general peak matching
  
  // Maximum harmonic number to check
  MAX_HARMONIC_NUMBER: 6, // Check 2nd through 6th harmonics
  
  // Probability adjustments when harmonic series detected
  INSTRUMENT_BOOST: 0.25, // Add to instrument probability
  FEEDBACK_PENALTY: 0.20, // Subtract from feedback probability
  
  // Strong harmonic series (3+ harmonics) = very likely instrument
  STRONG_HARMONIC_COUNT: 3,
  STRONG_INSTRUMENT_BOOST: 0.35,
  STRONG_FEEDBACK_PENALTY: 0.30,
} as const

// Canvas rendering settings
export const CANVAS_SETTINGS = {
  RTA_DB_MIN: -100,
  RTA_DB_MAX: 0,
  RTA_FREQ_MIN: 20,
  RTA_FREQ_MAX: 20000,
  WATERFALL_HISTORY_FRAMES: 256,
  GEQ_BAR_WIDTH_RATIO: 0.8, // Bar width as ratio of band spacing
} as const

// Operation mode presets - optimized for PA system feedback detection
// Default is Aggressive for corporate/conference environments with vocal focus
export const OPERATION_MODES = {
  feedbackHunt: {
    // Balanced PA mode - good sensitivity without excessive false positives
    feedbackThreshold: 8, // Moderate threshold for balanced detection
    ringThreshold: 5, // Catch resonances before they become problematic
    growthRateThreshold: 2, // Responsive to growing feedback
    musicAware: false,
  },
  vocalRing: {
    // Optimized for vocal frequencies (200Hz-8kHz)
    feedbackThreshold: 6, // More sensitive for speech feedback
    ringThreshold: 4, // Catch vocal ring-outs
    growthRateThreshold: 1.5, // Fast response for speech dynamics
    musicAware: false,
  },
  musicAware: {
    // Use during live performance to reduce false positives
    feedbackThreshold: 12, // Higher threshold to ignore musical content
    ringThreshold: 7, // Less sensitive during music
    growthRateThreshold: 3, // Only catch severe feedback
    musicAware: true,
  },
  aggressive: {
    // DEFAULT - Maximum sensitivity for corporate/conference PA
    // Catches feedback early before it becomes audible to audience
    feedbackThreshold: 6, // Very sensitive detection
    ringThreshold: 3, // Catch subtle resonances
    growthRateThreshold: 1, // Immediate response to any growth
    musicAware: false,
  },
  calibration: {
    // Ultra-sensitive for initial system setup and ring-out
    feedbackThreshold: 4, // Maximum sensitivity
    ringThreshold: 2, // Catch everything
    growthRateThreshold: 0.5, // Fastest possible response
    musicAware: false,
  },
} as const

// Default settings for the analyzer - OPTIMIZED FOR CORPORATE/CONFERENCE SPEECH SYSTEMS
// AGGRESSIVE DETECTION - better to have false positives than miss real feedback!
export const DEFAULT_SETTINGS = {
  mode: 'vocalRing' as const, // Vocal Ring is the default - optimized for speech/vocal PA systems
  fftSize: 4096 as const, // Balanced frequency resolution with lower CPU overhead
  smoothingTimeConstant: 0.5, // Faster response for quick detection
  minFrequency: 200, // Vocal-focused lower bound (below this is mostly HVAC rumble)
  maxFrequency: 8000, // Vocal-focused upper bound - where most speech feedback occurs
  feedbackThresholdDb: 6, // AGGRESSIVE - catch feedback early, before it's dangerous
  ringThresholdDb: 4, // AGGRESSIVE - catch resonances before they become feedback
  growthRateThreshold: 1.5, // FAST - detect growing peaks quickly
  holdTimeMs: 3000, // Longer hold for reference during EQ adjustments
  noiseFloorDecay: 0.98, // Fast adaptation for dynamic environments
  peakMergeCents: 100, // Widened to match 1/3 octave band width — prevents duplicates in same GEQ band
  maxDisplayedIssues: 8, // Show more issues - don't hide potential problems
  eqPreset: 'surgical' as const, // Precise narrow cuts for speech (preserve clarity)
  musicAware: false, // Disabled - no music in corporate/conference
  autoMusicAware: false, // Auto music-aware mode off for speech systems
  autoMusicAwareHysteresisDb: 15, // 15dB above noise floor = band is playing
  inputGainDb: 12, // Default gain for speech systems (adjustable -40 to +40 dB)
  graphFontSize: 15, // Default label size for canvas graphs (8-26px range, 15px center)
  harmonicToleranceCents: 50, // ±50 cents for harmonic matching
  showTooltips: true, // Show help tooltips (useful for AV techs)
  aWeightingEnabled: true, // A-WEIGHTING ON - prioritizes speech frequencies (2-5kHz)
  // Confidence filtering - LOW threshold, better false positives than missing real feedback
  confidenceThreshold: 0.40, // 40% - full range 0-100%, default 40%
  // Room acoustics - defaults to medium conference room
  roomRT60: 0.7, // Typical treated conference room (0.5-0.8s)
  roomVolume: 250, // Medium conference room ~250m³ (seats ~30 people)
  // Room preset identifier
  roomPreset: 'medium' as const, // Default to medium conference room
  // Phase 1: Harmonic Series Filter (reduces bass guitar/instrument false positives)
  harmonicFilterEnabled: true, // Default enabled - filter out instruments with harmonics
  // Phase 4: Room Mode Calculator
  roomModesEnabled: false, // Default disabled - user can enable in settings
  roomLengthM: 10, // Default 10m length
  roomWidthM: 8, // Default 8m width
  roomHeightM: 3, // Default 3m height (typical ceiling)
  roomDimensionsUnit: 'meters' as const,
}

// Room size presets for quick switching in corporate/conference environments
// AGGRESSIVE THRESHOLDS - better false positives than missing real feedback!
export const ROOM_PRESETS = {
  small: {
    label: 'Small Boardroom',
    description: '10-20 people, huddle rooms, small meeting spaces',
    roomRT60: 0.5, // Well-treated small room
    roomVolume: 80, // ~80m³ (approx 20x15x10 ft)
    schroederFreq: 158, // Pre-calculated: 2000 * sqrt(0.5/80)
    feedbackThresholdDb: 5, // AGGRESSIVE - quiet rooms need early warning
    ringThresholdDb: 3,
  },
  medium: {
    label: 'Medium Conference Room',
    description: '20-50 people, standard conference/training rooms',
    roomRT60: 0.7, // Typical treated conference room
    roomVolume: 250, // ~250m³ (approx 30x25x12 ft)
    schroederFreq: 106, // Pre-calculated: 2000 * sqrt(0.7/250)
    feedbackThresholdDb: 6, // AGGRESSIVE - catch problems early
    ringThresholdDb: 4,
  },
  large: {
    label: 'Large Auditorium',
    description: '50-200 people, ballrooms, auditoriums, town halls',
    roomRT60: 1.0, // Larger spaces have more reverb
    roomVolume: 1000, // ~1000m³ (approx 50x40x20 ft)
    schroederFreq: 63, // Pre-calculated: 2000 * sqrt(1.0/1000)
    feedbackThresholdDb: 7, // Slightly less aggressive due to ambient noise
    ringThresholdDb: 5,
  },
  custom: {
    label: 'Custom',
    description: 'Manual RT60 and volume settings',
    roomRT60: 0.7,
    roomVolume: 250,
    schroederFreq: 106,
    feedbackThresholdDb: 6,
    ringThresholdDb: 4,
  },
} as const

export type RoomPresetKey = keyof typeof ROOM_PRESETS

// Frequency range presets — quick switching for different use cases
export const FREQ_RANGE_PRESETS = [
  { label: 'Vocal',    minFrequency: 200,  maxFrequency: 8000  },
  { label: 'Monitor',  minFrequency: 300,  maxFrequency: 3000  },
  { label: 'Full',     minFrequency: 20,   maxFrequency: 20000 },
  { label: 'Sub',      minFrequency: 20,   maxFrequency: 250   },
] as const

// Color palette for visualizations
export const VIZ_COLORS = {
  RUNAWAY: '#ef4444', // red-500
  GROWING: '#f97316', // orange-500
  RESONANCE: '#eab308', // yellow-500
  POSSIBLE_RING: '#a855f7', // purple-500
  WHISTLE: '#06b6d4', // cyan-500
  INSTRUMENT: '#22c55e', // green-500
  NOISE_FLOOR: '#6b7280', // gray-500
  THRESHOLD: '#3b82f6', // blue-500
  SPECTRUM: '#10b981', // emerald-500
  PEAK_MARKER: '#f59e0b', // amber-500
} as const
