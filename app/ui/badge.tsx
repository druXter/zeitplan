// app/ui/badge.tsx

const TONES = {
  gray: 'bg-gray-100 text-gray-800',
  amber: 'bg-amber-100 text-amber-900',
  purple: 'bg-purple-100 text-purple-900',
  blue: 'bg-blue-100 text-blue-900',
  red: 'bg-red-100 text-red-900',
  green: 'bg-green-100 text-green-900'
} as const

/** Kleines Kennzeichen an einem Programmpunkt (Anker, Sichtbarkeit, Spur, Live-Zustand). */
export default function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`text-xs rounded px-1.5 py-0.5 ${TONES[tone]}`}>{children}</span>
}
