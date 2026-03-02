'use client'

import dynamic from 'next/dynamic'

const KillTheRing = dynamic(
  () => import('@/components/kill-the-ring/KillTheRing').then((m) => m.KillTheRing),
  { ssr: false }
)

export function KillTheRingClient() {
  return <KillTheRing />
}
