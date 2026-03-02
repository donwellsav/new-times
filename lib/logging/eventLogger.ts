import type { Advisory } from '@/types/advisory'

export type LogEventType = 'issue_detected' | 'analysis_started' | 'analysis_stopped' | 'settings_changed' | 'export'

export interface LogEntry {
  id: string
  timestamp: number
  type: LogEventType
  data: Record<string, unknown>
}

export interface FeedbackIssueLog extends LogEntry {
  type: 'issue_detected'
  data: {
    issueId: string
    frequency: number
    amplitude: number
    severity: string
    classification: string
    qFactor: number
    bandwidth: number
    growthRate: number
  }
}

export class EventLogger {
  private logs: LogEntry[] = []
  private listeners: ((logs: LogEntry[]) => void)[] = []
  private maxLogs = 1000 // Prevent memory bloat

  addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): LogEntry {
    const logEntry: LogEntry = {
      ...entry,
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    }

    this.logs.push(logEntry)
    
    // Keep only recent logs to prevent memory bloat
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs)
    }

    this.notifyListeners()
    return logEntry
  }

  logIssueDetected(advisory: Advisory): LogEntry {
    return this.addLog({
      type: 'issue_detected',
      data: {
        issueId: advisory.id,
        frequency: advisory.trueFrequencyHz,
        amplitude: advisory.trueAmplitudeDb,
        severity: advisory.severity,
        classification: advisory.label,
        qFactor: advisory.qEstimate,
        bandwidth: advisory.bandwidthHz,
        growthRate: advisory.velocityDbPerSec,
      },
    })
  }

  logAnalysisStarted(settings: Record<string, unknown>): LogEntry {
    return this.addLog({
      type: 'analysis_started',
      data: settings,
    })
  }

  logAnalysisStopped(): LogEntry {
    return this.addLog({
      type: 'analysis_stopped',
      data: {
        reason: 'user',
      },
    })
  }

  logSettingsChanged(changes: Record<string, unknown>): LogEntry {
    return this.addLog({
      type: 'settings_changed',
      data: changes,
    })
  }

  logExport(format: 'csv' | 'json' | 'text' | 'pdf', itemCount: number): LogEntry {
    return this.addLog({
      type: 'export',
      data: {
        format,
        itemCount,
      },
    })
  }

  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  getLogsFiltered(type?: LogEventType): LogEntry[] {
    if (!type) return [...this.logs]
    return this.logs.filter(log => log.type === type)
  }

  clearLogs(): void {
    this.logs = []
    this.notifyListeners()
  }

  subscribe(listener: (logs: LogEntry[]) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener([...this.logs]))
  }

  // Export methods
  exportAsJSON(): string {
    return JSON.stringify(this.logs, null, 2)
  }

  exportAsCSV(): string {
    if (this.logs.length === 0) return 'No logs to export'

    const headers = ['Timestamp', 'Type', 'Details']
    const rows = this.logs.map(log => {
      const date = new Date(log.timestamp).toLocaleString()
      const type = log.type
      const details = JSON.stringify(log.data)
      return [date, type, details]
    })

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n')

    return csvContent
  }

  exportAsText(): string {
    if (this.logs.length === 0) return 'No logs to export'

    const lines = [
      '='.repeat(80),
      'Kill The Ring - Event Log Export',
      `Exported: ${new Date().toLocaleString()}`,
      `Total Events: ${this.logs.length}`,
      '='.repeat(80),
      '',
    ]

    this.logs.forEach(log => {
      const date = new Date(log.timestamp).toLocaleString()
      lines.push(`[${date}] ${log.type.toUpperCase()}`)
      
      if (log.type === 'issue_detected') {
        const data = log.data as FeedbackIssueLog['data']
        lines.push(`  Frequency: ${data.frequency.toFixed(1)} Hz`)
        lines.push(`  Amplitude: ${data.amplitude.toFixed(1)} dB`)
        lines.push(`  Severity: ${data.severity}`)
        lines.push(`  Classification: ${data.classification}`)
        lines.push(`  Q Factor: ${data.qFactor.toFixed(2)}`)
        lines.push(`  Bandwidth: ${data.bandwidth.toFixed(1)} Hz`)
        lines.push(`  Growth Rate: ${data.growthRate.toFixed(2)} dB/s`)
      } else {
        Object.entries(log.data).forEach(([key, value]) => {
          lines.push(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
        })
      }
      
      lines.push('')
    })

    return lines.join('\n')
  }

  // Get statistics
  getStats() {
    const issueLogs = this.getLogsFiltered('issue_detected') as FeedbackIssueLog[]
    if (issueLogs.length === 0) {
      return {
        totalEvents: 0,
        issuesDetected: 0,
        sessionDuration: 0,
        avgFrequency: 0,
        avgAmplitude: 0,
        severities: {} as Record<string, number>,
      }
    }

    const frequencies = issueLogs.map(log => log.data.frequency)
    const amplitudes = issueLogs.map(log => log.data.amplitude)
    const severities = issueLogs.reduce((acc, log) => {
      acc[log.data.severity] = (acc[log.data.severity] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const startTime = this.logs[0]?.timestamp ?? 0
    const endTime = this.logs[this.logs.length - 1]?.timestamp ?? 0
    const sessionDuration = endTime - startTime

    return {
      totalEvents: this.logs.length,
      issuesDetected: issueLogs.length,
      sessionDuration,
      avgFrequency: frequencies.reduce((a, b) => a + b, 0) / frequencies.length,
      avgAmplitude: amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length,
      severities,
    }
  }
}

// Singleton instance
let loggerInstance: EventLogger | null = null

export function getEventLogger(): EventLogger {
  if (!loggerInstance) {
    loggerInstance = new EventLogger()
  }
  return loggerInstance
}
