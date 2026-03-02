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
// All mutable state is encapsulated in WorkerState so there are no bare
// module-level lets and no silent side-effects from processPeak overwriting
// sampleRate/fftSize as an undocumented mutation.

class WorkerState {
  settings: DetectorSettings = { ...DEFAULT_SETTINGS }
  sampleRate = 48000
  fftSize = 8192
  readonly trackManager = new TrackManager()
  readonly advisories = new Map<string, Advisory>()
  readonly trackToAdvisoryId = new Map<string, string>()

  reset() {
    this.trackManager.clear()
    this.advisories.clear()
    this.trackToAdvisoryId.clear()
  }

  /** Called on init and whenever processPeak carries updated audio config. */
  updateAudioConfig(sampleRate: number, fftSize: number) {
    this.sampleRate = sampleRate
    this.fftSize = fftSize
  }
}

const state = new WorkerState()

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
  const toleranceCents = state.settings.harmonicToleranceCents ?? 50
  const MAX_HARMONIC = 8
  for (const advisory of state.advisories.values()) {
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
  const mergeCents = state.settings.peakMergeCents
  for (const advisory of state.advisories.values()) {
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
      state.settings = { ...DEFAULT_SETTINGS, ...msg.settings }
      state.updateAudioConfig(msg.sampleRate, msg.fftSize)
      state.reset()
      self.postMessage({ type: 'ready' } satisfies WorkerOutboundMessage)
      break
    }

    case 'updateSettings': {
      state.settings = { ...state.settings, ...msg.settings }
      break
    }

    case 'reset': {
      state.reset()
      break
    }

    case 'processPeak': {
      const { peak, spectrum, sampleRate: sr, fftSize: fft } = msg
      state.updateAudioConfig(sr, fft)

      // Process through track manager
      const track = state.trackManager.processPeak(peak)

      // Classify
      const classification = classifyTrack(track, state.settings)

      // Gate on reporting threshold
      // Note: only clean up internal state — do NOT send advisoryCleared to main thread.
      // Advisories persist on the main thread for the entire session until stop() is called.
      if (!shouldReportIssue(classification, state.settings)) {
        const existingId = state.trackToAdvisoryId.get(track.id)
        if (existingId) {
          state.advisories.delete(existingId)
          state.trackToAdvisoryId.delete(track.id)
        }
        self.postMessage({ type: 'tracksUpdate', tracks: state.trackManager.getActiveTracks() } satisfies WorkerOutboundMessage)
        break
      }

      const eqAdvisory = generateEQAdvisory(
        track,
        classification.severity,
        state.settings.eqPreset,
        spectrum,
        state.sampleRate,
        state.fftSize
      )

      if (isHarmonicOfExisting(track.trueFrequencyHz, eqAdvisory.geq.bandIndex)) break

      const existingId = state.trackToAdvisoryId.get(track.id)
      let inheritedClusterCount = 1
      if (!existingId) {
        const dup = findDuplicateAdvisory(track.trueFrequencyHz, eqAdvisory.geq.bandIndex, track.id)
        if (dup) {
          const existingUrgency = getSeverityUrgency(dup.severity)
          const newUrgency = getSeverityUrgency(classification.severity)
          if (newUrgency > existingUrgency ||
              (newUrgency === existingUrgency && track.trueAmplitudeDb <= dup.trueAmplitudeDb)) {
            dup.clusterCount = (dup.clusterCount ?? 1) + 1
            self.postMessage({ type: 'advisory', advisory: dup } satisfies WorkerOutboundMessage)
            break
          }
          inheritedClusterCount = (dup.clusterCount ?? 1) + 1
          const replacedId = dup.id
          state.advisories.delete(dup.id)
          state.trackToAdvisoryId.delete(dup.trackId)
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
          state.advisories.set(advisoryId, advisory)
          if (!existingId) state.trackToAdvisoryId.set(track.id, advisoryId)
          self.postMessage({ type: 'advisoryReplaced', replacedId, advisory } satisfies WorkerOutboundMessage)
          self.postMessage({ type: 'tracksUpdate', tracks: state.trackManager.getActiveTracks() } satisfies WorkerOutboundMessage)
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
        modalOverlapFactor: classification.modalOverlapFactor,
        cumulativeGrowthDb: classification.cumulativeGrowthDb,
        frequencyBand: classification.frequencyBand,
        clusterCount: inheritedClusterCount,
      }

      state.advisories.set(advisoryId, advisory)
      if (!existingId) state.trackToAdvisoryId.set(track.id, advisoryId)

      self.postMessage({ type: 'advisory', advisory } satisfies WorkerOutboundMessage)
      self.postMessage({ type: 'tracksUpdate', tracks: state.trackManager.getActiveTracks() } satisfies WorkerOutboundMessage)
      break
    }

    case 'clearPeak': {
      const { binIndex, timestamp } = msg
      state.trackManager.clearTrack(binIndex, timestamp)
      state.trackManager.pruneInactiveTracks(timestamp)
      self.postMessage({ type: 'tracksUpdate', tracks: state.trackManager.getActiveTracks() } satisfies WorkerOutboundMessage)
      break
    }
  }
}

export {}
