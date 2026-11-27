type AttributeId = 'str' | 'dex' | 'con' | 'int' | 'per' | 'cha'
type Scores = Partial<Record<string, number>>

export function characterProfileTop(profile: {
  gender?: string
  genderLabel?: string
  faceLabel?: string
  bodyLabel?: string
  raceName?: string
  originName?: string
  profession?: string
  factionLabel?: string
  level?: number
  experience?: string
}): {
  identity: [label: string, value: string][]
  progress: [label: string, value: string][]
}

export function characterAttributeSheet(unit: {
  attributes: Scores
  attributeSources?: Record<string, Scores>
  effectiveAttributes?: Scores
  levelPoints?: Scores
}): {
  columns: { key: string; label: string; emphasis: boolean }[]
  rows: { id: AttributeId; label: string; total: number; rank?: 1 | 2; cells: string[] }[]
}

export interface ProfileMeter { current: number; max: number }
export interface CharacterProfile {
  gender?: string; genderLabel?: string; faceLabel?: string; bodyLabel?: string; raceName?: string; originName?: string
  profession?: string; factionLabel?: string; level?: number; experience?: string
  profileResistances?: string[]; profileStatuses?: string[]; traits?: string[]
  profileStatSources?: Partial<Record<ProfileStat, ProfileStatSource>>
  profileMorale?: string; initiative?: number; damage?: number; profileHit?: number
  meleeBlock?: number; rangedBlock?: number; dodge?: number
  hp: number; maxHp: number; armor: { head: ProfileMeter; body: ProfileMeter }
  stamina?: ProfileMeter; shield?: ProfileMeter | null; magic?: ProfileMeter | null; mount?: ProfileMeter | null
}

export type ProfileStat = 'initiative' | 'block' | 'dodge' | 'damage' | 'hit'
export interface ProfileStatSource { title: string; rows: [string, string][]; total: string; note?: string }
export function characterProfileData(unit: CharacterProfile): {
  identity: [label: string, value: string][]
  progress: [label: string, value: string][]
  pairs: [label: string, value: string][]
  vitals: [label: string, value: number | string, stat?: ProfileStat][]
}
export function characterProfileSections(unit: CharacterProfile, interactive?: boolean): { facts: string; vitals: string; resources: string }
export function renderCharacterProfileData(unit: CharacterProfile, interactive?: boolean): string
