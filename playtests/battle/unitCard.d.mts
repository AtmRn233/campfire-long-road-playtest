import type { CharacterProfile } from './characterSheet.mjs'
import type { PortraitSource } from './portraits.mjs'

export function renderUnitHeadshot(name: string, source?: PortraitSource, key?: string, className?: string): string
export function renderUnitCardContent(
  unit: CharacterProfile & { name: string; role?: string; morale?: number; monster?: boolean },
  options?: { portrait?: string },
): string
