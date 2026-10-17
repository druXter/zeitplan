'use client'

import { buttonClass } from './kit'

/** Öffnet den Druckdialog des Browsers. */
export default function PrintButton({ label = 'Drucken' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass('primary')}>
      {label}
    </button>
  )
}
