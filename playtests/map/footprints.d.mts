export function paintMapFootprints(
  ctx: CanvasRenderingContext2D,
  steps: readonly { x: number; y: number; angle: number; age: number }[],
  cellSize: number,
): void
