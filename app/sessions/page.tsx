import Link from 'next/link'
import { listSessions } from '@/lib/db/sessions'
import { SessionsTable } from '@/components/kill-the-ring/SessionsTable'
import { Button } from '@/components/ui/button'
import { ArrowLeft, AlertCircle, WifiOff } from 'lucide-react'

export const metadata = {
  title: 'Session History — Kill The Ring',
  description: 'Review past analysis sessions and detected issues',
}

export default async function SessionsPage() {
  let sessions: Awaited<ReturnType<typeof listSessions>> = []
  let dbError = false
  let isOffline = false

  try {
    sessions = await listSessions(50)
  } catch (err) {
    dbError = true
    // Detect network-level failures (fetch failed, ENOTFOUND, etc.)
    const msg = err instanceof Error ? err.message.toLowerCase() : ''
    if (
      msg.includes('fetch failed') ||
      msg.includes('enotfound') ||
      msg.includes('network') ||
      msg.includes('econnrefused')
    ) {
      isOffline = true
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground hover:text-foreground p-0 h-auto">
          <Link href="/">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs">Back</span>
          </Link>
        </Button>
        <div className="flex items-center gap-2 border-l border-border/50 pl-3">
          <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.31-2.5-4.06v8.12c1.48-.75 2.5-2.29 2.5-4.06zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
          <div className="flex flex-col gap-0">
            <div className="leading-none">
              <span className="text-sm font-black tracking-tight text-foreground">KILL THE </span>
              <span className="text-base font-black tracking-tight text-primary">RING</span>
            </div>
            <span className="text-[7.5px] font-semibold tracking-widest text-muted-foreground uppercase">Session History</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 p-4 sm:p-6 max-w-5xl mx-auto w-full">
        {dbError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            {isOffline ? (
              <>
                <WifiOff className="w-8 h-8 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">You are offline</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Session history requires a network connection. The detector works fully offline — export your logs from Settings before closing.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href="/">Back to Detector</Link>
                </Button>
              </>
            ) : (
              <>
                <AlertCircle className="w-8 h-8 text-destructive/60" />
                <p className="text-sm font-medium text-foreground">Could not load sessions</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  The database is temporarily unavailable. Check your Neon connection and try again.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href="/sessions">Retry</Link>
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h1 className="text-lg font-semibold text-foreground text-balance">Session History</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sessions.length === 0
                    ? 'No sessions recorded yet. Start an analysis to begin capturing data.'
                    : `${sessions.length} session${sessions.length === 1 ? '' : 's'} recorded`}
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="flex-shrink-0">
                <Link href="/">New Session</Link>
              </Button>
            </div>
            <SessionsTable sessions={sessions} />
          </>
        )}
      </main>
    </div>
  )
}
