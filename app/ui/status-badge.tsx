// app/ui/status-badge.tsx
import type { EventStatus } from '@prisma/client'
import { STATUS_LABELS } from '../lib/events/settings'

const STYLE: Record<EventStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PUBLISHED: 'bg-green-100 text-green-800',
  LIVE: 'bg-red-100 text-red-800',
  ENDED: 'bg-amber-100 text-amber-900',
  ARCHIVED: 'bg-gray-200 text-gray-700'
}

export default function StatusBadge({ status }: { status: EventStatus }) {
  return <span className={`text-xs font-normal rounded px-1.5 py-0.5 ${STYLE[status]}`}>{STATUS_LABELS[status]}</span>
}
