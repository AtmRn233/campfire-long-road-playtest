interface Point {
  x: number
  y: number
}

interface TerrainMap {
  width: number
  height: number
  terrain: readonly string[]
  shallows?: readonly (readonly number[])[]
}

interface TravelMap extends TerrainMap {
  roads: readonly boolean[]
  sites?: readonly (Point & { type: string })[]
}

interface TownMap extends TerrainMap {
  regions: readonly { id: string; bounds: readonly number[] }[]
}

interface TravelRules {
  localStepsPerMinute: number
}

export interface TravelProfile { speed: number; terrains: readonly string[] }
export function slowestTravelSpeed(travelers?: readonly TravelProfile[]): number
export function mapStepHours(rules: TravelRules, travelers?: readonly TravelProfile[]): number
export function terrainMovementHours(rules: TravelRules, terrain: string, travelers?: readonly TravelProfile[]): number | undefined
export function formatTravelDuration(hours: number): string
export function terrainAt(map: TerrainMap, at: Point): string
export function isWaterway(terrain: string): boolean
export function isImpassableTerrain(terrain: string): boolean
export function isRoadBridge(map: TravelMap, at: Point): boolean
export function townBarrierAt(map: TownMap, at: Point): 'wall' | 'water' | undefined
export function stepCost(
  map: TravelMap, from: Point, to: Point, rules: TravelRules, boat?: boolean, favored?: readonly string[], travelers?: readonly TravelProfile[],
): { hours: number; onRoad: boolean; terrain: string; error?: never } | { error: string; hours?: never }
