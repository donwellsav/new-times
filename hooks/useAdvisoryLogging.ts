import { useEffect, useRef } from 'react'
import { getEventLogger } from '@/lib/logging/eventLogger'
import { recordFeedbackFromAdvisory } from '@/lib/dsp/feedbackHistory'
import type { Advisory } from '@/types/advisory'

/**
 * Hook to automatically log detected advisories
 * Prevents duplicate logging of the same advisory
 * Also records to feedback history for repeat offender tracking
 */
export function useAdvisoryLogging(advisories: Advisory[]) {
  const loggedIdsRef = useRef(new Set<string>())
  const loggerRef = useRef(getEventLogger())

  useEffect(() => {
    advisories.forEach(advisory => {
      // Only log if we haven't logged this advisory ID before
      if (!loggedIdsRef.current.has(advisory.id)) {
        // Log to event logger
        loggerRef.current.logIssueDetected(advisory)
        
        // Record to feedback history for repeat offender tracking
        // Only record high-confidence feedback/ring events, not instruments or whistles
        if (
          advisory.confidence >= 0.6 &&
          (advisory.label === 'ACOUSTIC_FEEDBACK' || advisory.label === 'POSSIBLE_RING')
        ) {
          recordFeedbackFromAdvisory(advisory)
        }
        
        loggedIdsRef.current.add(advisory.id)
      }
    })

    // Clean up logged IDs for advisories that are no longer in the list
    const currentIds = new Set(advisories.map(a => a.id))
    const idsToRemove: string[] = []
    loggedIdsRef.current.forEach(id => {
      if (!currentIds.has(id)) {
        idsToRemove.push(id)
      }
    })
    idsToRemove.forEach(id => loggedIdsRef.current.delete(id))
  }, [advisories])
}
