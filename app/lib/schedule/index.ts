// app/lib/schedule/index.ts

// Der Prognose-Kern (docs/KONZEPT.md Abschnitt 2 und 3): reine Funktionen ohne Datenbank und ohne Uhr -
// `now` ist immer Parameter. Server Actions laden Daten, rufen den Kern auf und speichern das Ergebnis;
// Regeln stehen nie in Actions oder Komponenten.
export * from './types'
export { project, isActive } from './project'
export { checkDependencies } from './dependencies'
export {
  applyChanges, insertAfter, shiftBlock, swapAdjacent, MAX_SHIFT_MIN, type InsertRefusal, type ShiftRefusal, type ShiftScope, type SwapRefusal
} from './plan-changes'
export { toGuestView, toProgramme, DEFAULT_GUEST_SETTINGS, type ProgrammeItem, type GuestItem, type GuestSettings, type GuestSourceItem, type GuestStatus, type GuestTrack, type GuestView, type GuestAlertMode } from './guest-view'
export {
  applyLiveCommand, applyLivePatches, autoEndAt, currentDelayMin, isRunning, isStarted, liveReference, nextInTrack, LIVE_LIMITS,
  type LiveCommand, type LivePatch, type LiveRefusal, type LiveResult
} from './live'
export { whatIf, type WhatIfConflict, type WhatIfRefusal, type WhatIfResult, type WhatIfRow, type WhatIfScenario } from './what-if'
