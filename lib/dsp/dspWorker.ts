/**
 * DSP Worker — runs off the main thread
 * Handles: track management, classification, EQ advisory generation
 * Receives: raw spectrum Float32Array + detected peaks from main thread
 * Sends back: advisory events, track updates, spectrum metadata
 *
 * Usage (main thread):
 *   const worker = new Worker(new URL('./dspWorker.ts', import.meta.url))
 */

import { TrackManager } from './trackManager'
import { classifyTrack, shouldReportIssue } from './classifier'
import { generateEQAdvisory } from './eqAdvisor'
import { generateId } from '@/lib/utils/mathHelpers'
import type {
  Advisory,
  DetectedPeak,
  DetectorSettings,
  TrackedPeak,
} from '@/types/advisory'
import { DEFAULT_SETTINGS } from './constants'

// ─── Message types ──────────────────────────────────────────────────────────

export type WorkerInboundMessage =
  | {
      type: 'init'
      settings: DetectorSettings
      sampleRate: number
      fftSize: number
    }
  | {
      type: 'updateSettings'
      settings: Partial<DetectorSettings>
    }
  | {
      type: 'processPeak'
      peak: DetectedPeak
      spectrum: Float32Array
      sampleRate: number
      fftSize: number
    }
  | {
      type: 'clearPeak'
      binIndex: number
      frequencyHz: number
      timestamp: number
    }
  | {
      type: 'reset'
    }

export type WorkerOutboundMessage =
  | { type: 'advisory'; advisory: Advisory }
  | { type: 'advisoryCleared'; advisoryId: string }
  | { type: 'advisoryReplaced'; replacedId: string; advisory: Advisory }
  | { type: 'tracksUpdate'; tracks: TrackedPeak[] }
  | { type: 'ready' }
  | { type: 'error'; message: string }

// ─── Worker state ────────────────────────────────────────────────────────────

let settings: DetectorSettings = { ...DEFAULT_SETTINGS }
let sampleRate = 48000
let fftSize = 8192

const trackManager = new TrackManager()
const advisories = new Map<string, Advisory>()
const trackToAdvisoryId = new Map<string, string>()

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSeverityUrgency(severity: string): number {
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

function isHarmonicOfExisting(freqHz: number, bandIndex: number): boolean {
  // Use the same cents-based tolerance as FeedbackDetector to stay consistent.
  const toleranceCents = settings.harmonicToleranceCents ?? 50
  const MAX_HARMONIC = 8
  for (const advisory of advisories.values()) {
    const fundamental = advisory.trueFrequencyHz
    if (fundamental >= freqHz) continue
    for (let n = 2; n <= MAX_HARMONIC; n++) {
      const harmonic = fundamental * n
      const cents = Math.abs(1200 * Math.log2(freqHz / harmonic))
      if (cents <= toleranceCents) return true
    }
    // Also suppress if harmonic lands in same GEQ band as existing advisory
    if (advisory.advisory.geq.bandIndex === bandIndex) return true
  }
  return false
}

// Beating frequencies are close enough to cause audible "beats" — merge them
const BEATING_THRESHOLD_HZ = 20 // Frequencies within 20Hz are perceptually beating

function findDuplicateAdvisory(freqHz: number, bandIndex: number, excludeTrackId?: string): Advisory | null {
  const mergeCents = settings.peakMergeCents
  for (const advisory of advisories.values()) {
    if (excludeTrackId && advisory.trackId === excludeTrackId) continue

    // 1. Cents-based merge (widened to 100 cents = full 1/3 octave band)
    const centsDistance = Math.abs(1200 * Math.log2(freqHz / advisory.trueFrequencyHz))
    if (centsDistance <= mergeCents) return advisory

    // 2. Same GEQ band merge — if two peaks map to the same ISO band, merge them
    if (advisory.advisory.geq.bandIndex === bandIndex) return advisory

    // 3. Beating merge — frequencies within 20Hz cause audible beating, treat as one
    const hzDistance = Math.abs(freqHz - advisory.trueFrequencyHz)
    if (hzDistance <= BEATING_THRESHOLD_HZ) return advisory
  }
  return null
}

// ─── Message handler ─────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data

  switch (msg.type) {
    case 'init': {
      settings = { ...DEFAULT_SETTINGS, ...msg.settings }
      sampleRate = msg.sampleRate
      fftSize = msg.fftSize
      trackManager.clear()
      advisories.clear()
      trackToAdvisoryId.clear()
      self.postMessage({ type: 'ready' } satisfies WorkerOutboundMessage)
      break
    }

    case 'updateSettings': {
      settings = { ...settings, ...msg.settings }
      break
    }

    case 'reset': {
      trackManager.clear()
      advisories.clear()
      trackToAdvisoryId.clear()
      break
    }

    case 'processPeak': {
      const { peak, spectrum, sampleRate: sr, fftSize: fft } = msg
      sampleRate = sr
      fftSize = fft

      // Process through track manager
      const track = trackManager.processPeak(peak)

      // Classify
      const classification = classifyTrack(track, settings)

      // Gate on reporting threshold
      // Note: only clean up internal state — do NOT send advisoryCleared to main thread.
      // Advisories persist on the main thread for the entire session until stop() is called.
      if (!shouldReportIssue(classification, settings)) {
        const existingId = trackToAdvisoryId.get(track.id)
        if (existingId) {
          advisories.delete(existingId)
          trackToAdvisoryId.delete(track.id)
          // Do not postMessage advisoryCleared — issues persist until session ends
        }
        self.postMessage({ type: 'tracksUpdate', tracks: trackManager.getActiveTracks() } satisfies WorkerOutboundMessage)
        break
      }

      // Generate EQ advisory first — we need bandIndex for dedup checks
      const eqAdvisory = generateEQAdvisory(
        track,
        classification.severity,
        settings.eqPreset,
        spectrum,
        sampleRate,
        fftSize
      )

      // Skip harmonics (now band-aware)
      if (isHarmonicOfExisting(track.trueFrequencyHz, eqAdvisory.geq.bandIndex)) break

      // Dedup within merge tolerance — check cents, band, and beating
      // Severity ALWAYS wins: higher severity replaces lower, regardless of amplitude
      const existingId = trackToAdvisoryId.get(track.id)
      let inheritedClusterCount = 1
      if (!existingId) {
        const dup = findDuplicateAdvisory(track.trueFrequencyHz, eqAdvisory.geq.bandIndex, track.id)
        if (dup) {
          const existingUrgency = getSeverityUrgency(dup.severity)
          const newUrgency = getSeverityUrgency(classification.severity)
          // Severity-first: higher urgency (lower number) always wins
          // If same severity, higher amplitude wins
          if (newUrgency > existingUrgency || 
              (newUrgency === existingUrgency && track.trueAmplitudeDb <= dup.trueAmplitudeDb)) {
            // Existing wins — increment its cluster count and skip this peak
            dup.clusterCount = (dup.clusterCount ?? 1) + 1
            self.postMessage({ type: 'advisory', advisory: dup } satisfies WorkerOutboundMessage)
            break
          }
          // New peak wins — inherit cluster count, then send atomic replace after advisory is built
          inheritedClusterCount = (dup.clusterCount ?? 1) + 1
          const replacedId = dup.id
          advisories.delete(dup.id)
          trackToAdvisoryId.delete(dup.trackId)
          // Build the winning advisory now and send as one atomic replace message below
          const advisoryId = existingId ?? generateId()
          const advisory: Advisory = {
            id: advisoryId,
            trackId: track.id,
            timestamp: peak.timestamp,
            label: classification.label,
            severity: classification.severity,
            confidence: classification.confidence,
            why: classification.reasons,
            trueFrequencyHz: track.trueFrequencyHz,
            trueAmplitudeDb: track.trueAmplitudeDb,
            prominenceDb: track.prominenceDb,
            qEstimate: track.qEstimate,
            bandwidthHz: track.bandwidthHz,
            velocityDbPerSec: track.velocityDbPerSec,
            stabilityCentsStd: track.features.stabilityCentsStd,
            harmonicityScore: track.features.harmonicityScore,
            modulationScore: track.features.modulationScore,
            advisory: eqAdvisory,
            modalOverlapFactor: classification.modalOverlapFactor,
            cumulativeGrowthDb: classification.cumulativeGrowthDb,
            frequencyBand: classification.frequencyBand,
            clusterCount: inheritedClusterCount,
          }
          advisories.set(advisoryId, advisory)
          if (!existingId) trackToAdvisoryId.set(track.id, advisoryId)
          // Single atomic message — main thread removes old and inserts new in one state update
          self.postMessage({ type: 'advisoryReplaced', replacedId, advisory } satisfies WorkerOutboundMessage)
          self.postMessage({ type: 'tracksUpdate', tracks: trackManager.getActiveTracks() } satisfies WorkerOutboundMessage)
          break
        }
      }

      const advisoryId = existingId ?? generateId()
      const advisory: Advisory = {
        id: advisoryId,
        trackId: track.id,
        timestamp: peak.timestamp,
        label: classification.label,
        severity: classification.severity,
        confidence: classification.confidence,
        why: classification.reasons,
        trueFrequencyHz: track.trueFrequencyHz,
        trueAmplitudeDb: track.trueAmplitudeDb,
        prominenceDb: track.prominenceDb,
        qEstimate: track.qEstimate,
        bandwidthHz: track.bandwidthHz,
        velocityDbPerSec: track.velocityDbPerSec,
        stabilityCentsStd: track.features.stabilityCentsStd,
        harmonicityScore: track.features.harmonicityScore,
        modulationScore: track.features.modulationScore,
        advisory: eqAdvisory,
        // Enhanced detection fields from acoustic analysis
        modalOverlapFactor: classification.modalOverlapFactor,
        cumulativeGrowthDb: classification.cumulativeGrowthDb,
        frequencyBand: classification.frequencyBand,
        // Cluster info — how many peaks were merged into this advisory
        clusterCount: inheritedClusterCount,
      }

      advisories.set(advisoryId, advisory)
      if (!existingId) trackToAdvisoryId.set(track.id, advisoryId)

      self.postMessage({ type: 'advisory', advisory } satisfies WorkerOutboundMessage)
      self.postMessage({ type: 'tracksUpdate', tracks: trackManager.getActiveTracks() } satisfies WorkerOutboundMessage)
      break
    }

    case 'clearPeak': {
      const { binIndex, timestamp } = msg
      trackManager.clearTrack(binIndex, timestamp)
      trackManager.pruneInactiveTracks(timestamp)
      // Do not send advisoryCleared — issues persist on the main thread for the entire session.
      // Internal advisory map is cleaned up above via pruneInactiveTracks.
      self.postMessage({ type: 'tracksUpdate', tracks: trackManager.getActiveTracks() } satisfies WorkerOutboundMessage)
      break
    }
  }
}

export {}
