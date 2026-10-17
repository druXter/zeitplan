// app/ui/badge.tsx
import { Badge, type Tone } from './kit'

/** Kleines Kennzeichen an einem Programmpunkt (Anker, Sichtbarkeit, Spur, Live-Zustand) - der Badge aus app/ui/kit.tsx. */
export default function LegacyBadge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: Tone }) {
  return <Badge tone={tone}>{children}</Badge>
}
