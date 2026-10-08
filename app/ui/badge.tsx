// app/ui/badge.tsx

const TONES = {
  gray: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200',
  amber: 'bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-200',
  purple: 'bg-purple-100 dark:bg-purple-900 text-purple-900 dark:text-purple-200',
  blue: 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-200',
  red: 'bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-200',
  green: 'bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-200'
} as const

/** Kleines Kennzeichen an einem Programmpunkt (Anker, Sichtbarkeit, Spur, Live-Zustand). */
export default function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`text-xs rounded px-1.5 py-0.5 ${TONES[tone]}`}>{children}</span>
}
