const sole = 'M -2 1 C -1 3 1 3 2.5 1 L 3 -3 C 3.2 -8 -2.8 -8 -3 -4 Z M -1.8 3.7 L 1.8 3.7 L 1.7 7.1 L -1.5 7.1 Z';
const opacity = [1, .8, .6, .4, .2];
let footprint;

export function paintMapFootprints(ctx, steps, cellSize) {
  if (!steps.length) return;
  footprint ??= new Path2D(sole);
  const scale = cellSize / 46;
  for (const step of [...steps].reverse()) {
    ctx.save();
    ctx.globalAlpha = opacity[step.age];
    ctx.translate((step.x + .5) * cellSize, (step.y + .5) * cellSize);
    ctx.rotate(step.angle);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#584334';
    ctx.strokeStyle = '#f4e5be';
    ctx.lineWidth = 1.15;
    ctx.translate(-4.6, 2.3);
    ctx.stroke(footprint);
    ctx.fill(footprint);
    ctx.translate(9.2, -4.6);
    ctx.scale(-1, 1);
    ctx.stroke(footprint);
    ctx.fill(footprint);
    ctx.restore();
  }
}
