(function () {
  'use strict';

  const banner = new Path2D("M -6 -21 C 4 -26 12 -19 22 -22 L 16 -16 L 22 -11 C 12 -8 6 -15 -3 -11 Z");
  const pole = new Path2D("M 0 0 L -6.5 -22");
  const footprint = new Path2D("M -2 1 C -1 3 1 3 2.5 1 L 3 -3 C 3.2 -8 -2.8 -8 -3 -4 Z M -1.8 3.7 L 1.8 3.7 L 1.7 7.1 L -1.5 7.1 Z");
  const trailOpacity = [1, .8, .6, .4, .2];
  const sameCell = (a,b) => a.x === b.x && a.y === b.y;
  const keys = {
    ArrowUp:[0,-1], KeyW:[0,-1], Numpad8:[0,-1],
    ArrowDown:[0,1], KeyS:[0,1], Numpad2:[0,1],
    ArrowLeft:[-1,0], KeyA:[-1,0], Numpad4:[-1,0],
    ArrowRight:[1,0], KeyD:[1,0], Numpad6:[1,0],
    KeyQ:[-1,-1], Numpad7:[-1,-1], KeyE:[1,-1], Numpad9:[1,-1],
    KeyZ:[-1,1], Numpad1:[-1,1], KeyC:[1,1], Numpad3:[1,1],
  };

  function rememberStep(trail, from, to) {
    const angle = Math.atan2(to.y-from.y,to.x-from.x) + Math.PI/2;
    trail.unshift({ x:from.x, y:from.y, angle });
    if (trail.length > trailOpacity.length) trail.pop();
  }

  function paintTrail(ctx, visitor, trail, cellSize) {
    for (let index = trail.length - 1; index >= 0; index--) {
      const step = trail[index];
      if (sameCell(visitor, step) || trail.slice(0, index).some(recent => sameCell(recent, step))) continue;
      ctx.save();
      ctx.globalAlpha = trailOpacity[index];
      ctx.translate((step.x+.5)*cellSize, (step.y+.5)*cellSize);
      ctx.rotate(step.angle);
      ctx.fillStyle = "#584334";
      ctx.strokeStyle = "#f4e5be";
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

  function paintBanner(ctx, visitor, cellSize) {
    ctx.save();
    ctx.strokeStyle = "#c43b32";
    ctx.lineWidth = 3;
    ctx.strokeRect(visitor.x*cellSize+2,visitor.y*cellSize+2,cellSize-4,cellSize-4);
    ctx.translate((visitor.x+.5)*cellSize, (visitor.y+.5)*cellSize);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.ellipse(0, 0, 5.5, 3, 0, 0, Math.PI*2);
    ctx.fillStyle = "#2b2630";
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "#f7dfad";
    ctx.stroke();

    ctx.strokeStyle = "#302621";
    ctx.lineWidth = 4.5;
    ctx.stroke(pole);
    ctx.strokeStyle = "#d6ae70";
    ctx.lineWidth = 2;
    ctx.stroke(pole);

    const cloth = ctx.createLinearGradient(0, -23, 6, -10);
    cloth.addColorStop(0, "#3c65a9");
    cloth.addColorStop(.45, "#244b89");
    cloth.addColorStop(1, "#172c56");
    ctx.fillStyle = cloth;
    ctx.fill(banner);
    ctx.strokeStyle = "#202639";
    ctx.lineWidth = 3.5;
    ctx.stroke(banner);
    ctx.strokeStyle = "#e9d5ae";
    ctx.lineWidth = 1.45;
    ctx.stroke(banner);

    ctx.translate(6, -16.4);
    ctx.strokeStyle = "#fff0ce";
    ctx.lineWidth = 1.3;
    for (let loop = 0; loop < 3; loop++) {
      ctx.beginPath();
      ctx.ellipse(0, -1.65, 1.85, 3.35, 0, 0, Math.PI*2);
      ctx.stroke();
      ctx.rotate(2*Math.PI/3);
    }
    ctx.restore();
  }

  function paintRoute(ctx, visitor, steps, cellSize) {
    if (!steps?.length) return;
    const center = cell => [(cell.x+.5)*cellSize, (cell.y+.5)*cellSize];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(...center(visitor));
    for (const step of steps) ctx.lineTo(...center(step));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(132, 62, 30, .48)";
    ctx.stroke();
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = "#9a521e";
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = "#ffcc62";
    ctx.stroke();
    ctx.fillStyle = "#ffeb9e";
    ctx.strokeStyle = "#8a471e";
    ctx.lineWidth = 1.5;
    for (const step of steps.slice(0, -1)) {
      const [x, y] = center(step);
      ctx.beginPath();
      ctx.moveTo(x, y-4.5);
      ctx.lineTo(x+3.4, y);
      ctx.lineTo(x, y+4.5);
      ctx.lineTo(x-3.4, y);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    }

    const [x, y] = center(steps.at(-1));
    const [fromX, fromY] = center(steps.at(-2) ?? visitor);
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(y-fromY, x-fromX));
    const arrow = new Path2D("M 0 0 L -14 -7 L -10 0 L -14 7 Z");
    ctx.lineWidth = 2;
    ctx.stroke(arrow);
    ctx.fill(arrow);
    ctx.restore();
  }

  globalThis.MapParty = { keys, rememberStep, paintTrail, paintBanner, paintRoute, stepMs: 500 };
}());
