import type { CharacterProfile } from './characterSheet.mjs'

export interface BattleProfileUnit extends CharacterProfile {
  id: string
  statuses: Record<string, number>
  morale: number
}

export function createBattleUnit(character: object): BattleProfileUnit
export function battleProfileCombat(unit: BattleProfileUnit, weather?: object): Pick<CharacterProfile, 'profileHit' | 'dodge' | 'meleeBlock' | 'rangedBlock' | 'profileStatSources'>
