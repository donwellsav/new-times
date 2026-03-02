// KillTheRing2 Audio Analyzer - Manages Web Audio API setup and analysis pipeline
// DSP post-processing (classification, EQ advisory) is offloaded to a Web Worker
// via AudioAnalyzerCallbacks.onPeakDetected / onPeakCleared wiring in useAudioAnalyzer.

import { FeedbackDetector } from '@/lib/dsp/feedbackDetector'
import type { 
  Advisory, 
  DetectedPeak,
  SpectrumData,
  TrackedPeak,
  DetectorSettings,
} from '@/types/advisory'
import { DEFAULT_SETTINGS } from '@/lib/dsp/constants'

export interface AudioAnalyzerCallbacks {
  onSpectrum?: (data: SpectrumData) => void
  /** Raw peak detected — route to DSP worker for classification */
  onPeakDetected?: (peak: DetectedPeak, spectrum: Float32Array, sampleRate: number, fftSize: number) => void
  /** Peak cleared — route to DSP worker */
  onPeakCleared?: (peak: { binIndex: number; frequencyHz: number; timestamp: number }) => void
  // Legacy callbacks kept for compatibility — now driven by worker results in useAudioAnalyzer
  onAdvisory?: (advisory: Advisory) => void
  onAdvisoryCleared?: (advisoryId: string) => void
  onTracksUpdate?: (tracks: TrackedPeak[]) => void
  onError?: (error: Error) => void
  onStateChange?: (isRunning: boolean) => void
}

export interface AudioAnalyzerState {
  isRunning: boolean
  hasPermission: boolean
  error: string | null
  noiseFloorDb: number | null
  sampleRate: number
  fftSize: number
  effectiveThresholdDb: number
}

export class AudioAnalyzer {
  private settings: DetectorSettings
  private callbacks: AudioAnalyzerCallbacks
  private detector: FeedbackDetector
  
  private lastSpectrumTime: number = 0
  private spectrumIntervalMs: number = 33 // ~30fps for spectrum display

  private _isRunning: boolean = false
  private _hasPermission: boolean = false
  private _error: string | null = null

  constructor(
    settings: Partial<DetectorSettings> = {},
    callbacks: AudioAnalyzerCallbacks = {}
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
    this.callbacks = callbacks

    this.detector = new FeedbackDetector({}, {
      onPeakDetected: (peak: DetectedPeak) => {
        // Route to worker via callback — spectrum is read from detector
        const spectrum = this.detector.getSpectrum()
        const state = this.detector.getState()
        if (spectrum) {
          this.callbacks.onPeakDetected?.(peak, spectrum, state.sampleRate, state.fftSize)
        }
      },
      onPeakCleared: (peak) => {
        this.callbacks.onPeakCleared?.(peak)
      },
      // Piggyback spectrum delivery onto the detector's own RAF tick.
      // This eliminates the duplicate RAF loop that was running at 30fps
      // on top of the detector's 50Hz loop — one RAF per frame, not two.
      onRafTick: (timestamp) => {
        if (timestamp - this.lastSpectrumTime >= this.spectrumIntervalMs) {
          this.lastSpectrumTime = timestamp
          const spectrum = this.detector.getSpectrum()
          const state = this.detector.getState()
          if (spectrum) {
            let peak = -100
            for (let i = 0; i < spectrum.length; i++) {
              if (spectrum[i] > peak) peak = spectrum[i]
            }
            this.callbacks.onSpectrum?.({
              freqDb: spectrum,
              power: new Float32Array(0),
              noiseFloorDb: state.noiseFloorDb,
              effectiveThresholdDb: state.effectiveThresholdDb,
              sampleRate: state.sampleRate,
              fftSize: state.fftSize,
              timestamp,
              peak,
            })
          }
        }
      },
    })

    // Apply initial settings via the mapping layer (DetectorSettings → AnalysisConfig)
    this.detector.updateSettings(this.settings)
  }

  // ==================== Public API ====================

  async start(): Promise<void> {
    if (this._isRunning) return

    try {
      await this.detector.start()
      this._isRunning = true
      this._hasPermission = true
      this._error = null
      this.lastSpectrumTime = 0
      this.callbacks.onStateChange?.(true)
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to start analyzer'
      this._hasPermission = false
      this.callbacks.onError?.(err instanceof Error ? err : new Error(this._error))
      throw err
    }
  }

  stop(options: { releaseMic?: boolean } = {}): void {
    this._isRunning = false
    this.detector.stop(options)
    this.callbacks.onStateChange?.(false)
  }

  updateSettings(settings: Partial<DetectorSettings>): void {
    Object.assign(this.settings, settings)
    this.detector.updateSettings(settings)
  }

  getState(): AudioAnalyzerState {
    const detectorState = this.detector.getState()
    return {
      isRunning: this._isRunning,
      hasPermission: this._hasPermission,
      error: this._error,
      noiseFloorDb: detectorState.noiseFloorDb,
      sampleRate: detectorState.sampleRate,
      fftSize: detectorState.fftSize,
      effectiveThresholdDb: detectorState.effectiveThresholdDb,
    }
  }

  getSpectrum(): Float32Array | null {
    return this.detector.getSpectrum()
  }

  // ==================== Private Methods ====================
}

/**
 * Factory function for creating an audio analyzer
 */
export function createAudioAnalyzer(
  settings?: Partial<DetectorSettings>,
  callbacks?: AudioAnalyzerCallbacks
): AudioAnalyzer {
  return new AudioAnalyzer(settings, callbacks)
}
