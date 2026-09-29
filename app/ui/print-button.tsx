'use client'

/** Öffnet den Druckdialog des Browsers. */
export default function PrintButton({ label = 'Drucken' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="bg-blue-600 text-white font-bold py-2 px-3 rounded hover:bg-blue-700">
      {label}
    </button>
  )
}
