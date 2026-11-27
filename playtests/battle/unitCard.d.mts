import type { CharacterProfile } from './characterSheet.mjs'

export function renderUnitCardContent(
  unit: CharacterProfile & { name: string; role?: string; morale?: number },
): string
