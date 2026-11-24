interface Crop {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

export interface PortraitSource {
  url: string
  column: number
  row: number
  columns: number
  rows: number
  defaultCrop?: Crop
  revision?: number
}

export function portraitCropStorageKey(key: string): string
export function portraitSelectionKey(key: string, source: PortraitSource | undefined): string
export function readPortraitCrop(key: string): Crop | undefined
export function portraitSource(unit: {
  profilePortrait?: string | null
  portraitFraming?: 'knees'
  portraitVersion?: number
  portraitSprite?: { atlas: string | number; column: number; row: number; face?: readonly number[] }
}, fallback: string, artPath?: string): PortraitSource | undefined
export function portraitBackground(source: PortraitSource, crop: Crop): { size: number[]; position: number[] }
export function headshotCrop(source: PortraitSource | undefined, saved?: Crop): Crop | undefined
export function createPortraitViewer(dialog: HTMLDialogElement, render: () => void): {
  open(unit: { id: string; name: string; portraitCropKey?: string }, source: PortraitSource, editImmediately?: boolean): Promise<void>
}
