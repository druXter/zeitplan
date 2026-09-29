// app/ui/pending-button.tsx
'use client'

import { useFormStatus } from 'react-dom'

/**
 * Absende-Knopf, der sich während des Absendens sperrt - gegen doppeltes Tippen im Trubel. name/value gehen wie
 * bei einem normalen Knopf mit (mehrere Knöpfe in einem Formular, z. B. +5/+10/+15). Die Aktionen selbst sind
 * trotzdem idempotent; das hier spart nur unnötige Anfragen.
 */
export default function PendingButton({ children, className = '', name, value, ariaLabel }: {
  children: React.ReactNode
  className?: string
  name?: string
  value?: string
  ariaLabel?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" name={name} value={value} aria-label={ariaLabel} disabled={pending} className={`disabled:opacity-50 ${className}`}>
      {children}
    </button>
  )
}
