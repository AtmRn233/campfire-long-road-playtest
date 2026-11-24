(function () {
  'use strict';

  const trim = '#4c3a30';
  const roofStyles = getComputedStyle(document.documentElement);

  function polygon(ctx, points, fill, outline = trim) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = .9;
      ctx.stroke();
    }
  }

  function lin(ctx, points, color, width = 1) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function house(ctx, roof, width, depth, offset = 0) {
    ctx.save();
    ctx.translate(offset, 0);
    const x = width / 2, y = depth / 2;
    polygon(ctx, [[-x,-y], [x-3,-y], [x+1,-y+6], [x+1,y+6], [-x,y+6]], '#c9a981');
    polygon(ctx, [[x-4,-y], [x+2,-y+4], [x+2,y+5], [x-4,y+7]], '#8c6d52');
    ctx.fillStyle = '#42352c';
    ctx.fillRect(-2, y+1, 4, 6);
    ctx.fillRect(-x+3, y+1, 3, 2.5);
    ctx.fillRect(x-8, y+1, 3, 2.5);
    polygon(ctx, [[-x-2,-y], [0,-y-5], [x+1,-y], [x+1,y-1], [0,y-6], [-x-2,y]], roof);
    polygon(ctx, [[0,-y-5], [x+1,-y], [x+1,y-1], [0,y-6]], '#412e3159', null);
    for (let dy=-y+4; dy<y-2; dy+=4) {
      lin(ctx, [[-x,dy],[0,dy-4],[x,dy]], '#35262c53', .7);
    }
    lin(ctx, [[0,-y-4],[0,y-6]], '#e9bf8b92', 1);
    ctx.restore();
  }

  function boardwalk(ctx) {
    polygon(ctx, [[-24,-12],[8,-12],[8,-7],[21,-7],[21,7],[8,7],[8,13],[-24,13]], '#a47a50');
    for (let x=-17;x<=18;x+=5) lin(ctx,[[x,x>7?-7:-12],[x,x>7?7:13]],'#624a35');
    for (const x of [-17, 5, 20]) {
      lin(ctx,[[x,-7],[x,-12]],trim,2);
      lin(ctx,[[x,8],[x,13]],trim,2);
    }
    polygon(ctx, [[6,15],[12,11],[20,12],[24,16],[20,20],[12,20]], '#6c513c');
    lin(ctx,[[10,16],[22,16]], '#c69c6a', 1.6);
  }

  function stall(ctx, roof) {
    polygon(ctx,[[-15,-5],[13,-5],[12,9],[-13,9]],'#b9925c');
    lin(ctx,[[-12,4],[-12,12]],trim,1.6);
    lin(ctx,[[11,4],[11,12]],trim,1.6);
    polygon(ctx,[[-16,-11],[14,-11],[18,1],[-19,1]],roof);
    for(const x of [-11,-2,7]) lin(ctx,[[x,-10],[x*1.2,1]],'#f4debd',2.3);
    ctx.fillStyle = '#ecd49b';
    for(const x of [-8,0,7]) ctx.fillRect(x,5,4,2);
  }

  function paintWalls(ctx, map, cell) {
    const { cellIndex, contains } = MapModel;
    const gates = new Set(map.sites.filter(site => ['town-gate','town-keep-gate'].includes(site.type))
      .map(site => cellIndex(site.x, site.y)));
    const wall = new Path2D();
    const stones = new Path2D();
    const half = cell / 2;
    const directions = [[1,0], [0,1], [-1,0], [0,-1], [1,1], [-1,1], [1,-1], [-1,-1]];
    const isMasonry = (x,y) => contains(x,y,map) &&
      (map.terrain[cellIndex(x,y)] === 'wall' || gates.has(cellIndex(x,y)));
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.terrain[cellIndex(x,y)] !== 'wall') continue;
        const cx = x * cell + half, cy = y * cell + half;
        let connected = false;
        for (const [dx,dy] of directions) {
          if (!isMasonry(x+dx,y+dy)) continue;
          if (dx && dy && (isMasonry(x+dx,y) || isMasonry(x,y+dy))) continue;
          connected = true;
          wall.moveTo(cx,cy);
          wall.lineTo(cx + dx*half,cy + dy*half);
          const length = Math.hypot(dx,dy);
          for (let d = 5; d < half*length; d += 9) {
            for (const edge of [-8, 6]) {
              stones.rect(cx + (dx*d - dy*edge)/length - 2, cy + (dy*d + dx*edge)/length - 2, 4, 4);
            }
          }
        }
        if (!connected) {
          wall.moveTo(cx-14,cy);
          wall.lineTo(cx+14,cy);
          for (let d = -9; d <= 9; d += 9) stones.rect(cx+d-2,cy-9,4,4);
        }
      }
    }
    ctx.save();
    ctx.lineCap = 'square';
    for (const [width,color] of [[24,'#665f53'],[19,'#8c8273'],[13,'#b8ad99']]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke(wall);
    }
    ctx.fillStyle = '#d7cbb3';
    ctx.strokeStyle = '#746c5e';
    ctx.lineWidth = .8;
    ctx.fill(stones);
    ctx.stroke(stones);
    ctx.restore();
  }

  function rampart(ctx, roof, width = 30, depth = 24) {
    const w = width / 2, d = depth / 2;
    polygon(ctx,[[-w,-d],[w,-d],[w,d+6],[-w,d+6]],'#8e8271');
    polygon(ctx,[[-w,-d],[w,-d],[w,d],[-w,d]],roof);
    lin(ctx,[[-w,d+3],[w,d+3]],'#625746');
    for (const y of [-d,d-5]) {
      for (let x = -w+1; x < w-3; x += 7) {
        polygon(ctx,[[x,y],[x+4,y],[x+4,y+5],[x,y+5]],'#d3c6ad','#706455');
      }
    }
    ctx.fillStyle = '#554d41';
    ctx.fillRect(-3,-3,6,8);
  }

  function gate(ctx, roof) {
    rampart(ctx,roof,29,12);
    polygon(ctx,[[-16,-6],[-9,-9],[9,-9],[16,-6],[16,7],[-16,7]],'#554f45');
    lin(ctx,[[-17,2],[17,2]],'#bbab8f',6);
    for (const y of [-16, 16]) {
      ctx.save();
      ctx.translate(0,y);
      rampart(ctx,roof,21,13);
      ctx.restore();
    }
  }

  function garden(ctx) {
    polygon(ctx,[[-17,-11],[17,-11],[17,11],[-17,11]],'#8b7351');
    for (const y of [-7,-1,5]) {
      lin(ctx,[[-13,y],[13,y]],'#575e36',3);
      for (const x of [-10,-3,4,11]) {
        lin(ctx,[[x-1,y+1],[x+1,y-1]],'#a6a665',2);
      }
    }
  }

  function nets(ctx) {
    polygon(ctx,[[-16,-8],[12,-8],[17,8],[-12,8]],'#ac9975');
    for (const x of [-12,-7,-2,3,8]) lin(ctx,[[x,-8],[x+5,8]],'#6c6860',.7);
    for (const y of [-5,-1,3,7]) lin(ctx,[[-15+y/3,y],[15+y/3,y]],'#6c6860',.7);
    lin(ctx,[[-16,-10],[-16,7]],trim,2);
    lin(ctx,[[13,-10],[13,7]],trim,2);
  }

  function yard(ctx, roof) {
    polygon(ctx,[[-15,-9],[14,-9],[17,9],[-16,9]],'#b29a76');
    for (const [x,y] of [[-11,0],[-2,-5],[6,2]]) {
      polygon(ctx,[[x,y],[x+7,y],[x+7,y+6],[x,y+6]],roof);
      lin(ctx,[[x+1,y+1],[x+6,y+5]],'#5a4330');
    }
  }

  function paintArena(ctx, bounds, cell) {
    const [left, top, right, bottom] = bounds;
    const radiusX = (right-left+1)*cell/2-9;
    const radiusY = (bottom-top+1)*cell/2-10;
    if (radiusX <= 0 || radiusY <= 0) return;
    ctx.save();
    ctx.translate((left+right+1)*cell/2, (top+bottom+1)*cell/2);
    ctx.beginPath();
    ctx.ellipse(0,0,radiusX,radiusY,0,0,2*Math.PI);
    ctx.fillStyle = '#c9a875';
    ctx.fill();
    for (const [inset, width, color] of [[0,8,'#66513c'],[1,4,'#ac8560'],[10,3,'#966d4e']]) {
      if (radiusX <= inset || radiusY <= inset) continue;
      ctx.beginPath();
      ctx.ellipse(0,0,radiusX-inset,radiusY-inset,0,.6*Math.PI,2.4*Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    for (let angle = .6*Math.PI; angle <= 2.4*Math.PI+.001; angle += .15*Math.PI) {
      const x = Math.cos(angle)*radiusX, y = Math.sin(angle)*radiusY;
      ctx.fillStyle = '#513d2d';
      ctx.fillRect(x-3,y-4,6,8);
      ctx.fillStyle = '#d2b182';
      ctx.fillRect(x-2,y-3,3,3);
    }
    ctx.restore();
  }

  function keep(ctx, roof, cell, width) {
    const side = cell*(width-1), middle = side/2;
    polygon(ctx,[[-14,-12],[middle-8,-12],[middle-4,-18],[side+7,-18],[side+14,-10],
      [side+12,11],[middle+2,11],[middle-5,17],[-15,17]],'#776d5f');
    house(ctx,roof,29,16,middle+3);
    rampart(ctx,'#c3b7a4',21,23);
    if (side) {
      ctx.translate(side,-5);
      rampart(ctx,'#ac9f8b',16,17);
      ctx.translate(-side,5);
    }
    polygon(ctx,[[middle-6,6],[middle-3,2],[middle+4,2],[middle+6,6],[middle+6,16],[middle-6,16]],'#4c3d34');
    lin(ctx,[[-3,-7],[-3,-23]],'#655546',1.1);
    polygon(ctx,[[-3,-23],[10,-22],[6,-16],[-3,-17]],'#893e3f');
  }

  function castleWing(ctx, roof, cell, width, kitchen) {
    if (width > 1) {
      const lowerWall = kitchen ? '#a38365' : '#af9d87';
      polygon(ctx,[[5,-9],[cell-3,-9],[cell-3,10],[5,10]],lowerWall);
      house(ctx,roof,31,19,cell);
    }
    house(ctx,roof,34,22);
    if (kitchen) {
      polygon(ctx,[[8,-8],[8,-20],[13,-20],[13,-8]],'#8b7063');
      lin(ctx,[[7,-20],[14,-20]],'#5d4940',2);
    } else {
      lin(ctx,[[-12,9],[12,9]],'#cbb396',1.4);
    }
  }

  function dungeon(ctx, stone) {
    polygon(ctx,[[-13,7],[-12,-6],[-7,-13],[7,-13],[12,-6],[13,7]],stone);
    polygon(ctx,[[-8,7],[-8,-5],[-4,-9],[4,-9],[8,-5],[8,7]],'#423a32');
    polygon(ctx,[[-8,1],[8,1],[12,13],[-12,13]],'#817561');
    for (const y of [4,8,12]) lin(ctx,[[-8-y/4,y],[8+y/4,y]],'#d0bea1');
  }

  function practiceYard(ctx, cell, width) {
    polygon(ctx,[[-17,-10],[17,-10],[17,11],[-17,11]],'#b89a6f');
    lin(ctx,[[-15,6],[14,6]],'#937553',.8);
    for (const x of [-10,7]) {
      lin(ctx,[[x,11],[x,-12]],'#513b29',2.4);
      lin(ctx,[[x-5,-3],[x+5,-3]],'#765135',2);
    }
    const offset = width > 1 ? cell : 0;
    ctx.translate(offset,-1);
    for (const x of [-9,8]) {
      lin(ctx,[[x-4,11],[x,0],[x+4,11]],'#684e37',1.5);
      ctx.beginPath();
      ctx.arc(x,-2,6,0,2*Math.PI);
      ctx.fillStyle = '#d5b67c';
      ctx.fill();
      ctx.strokeStyle = '#755440';
      ctx.stroke();
      ctx.fillStyle = '#944e3e';
      ctx.fillRect(x-1.5,-3.5,3,3);
    }
  }

  function storefront(ctx, roof, tavern) {
    house(ctx,roof,33,22);
    lin(ctx,[[13,0],[21,0],[21,4]], trim,1.4);
    polygon(ctx,[[16,3],[24,3],[24,11],[16,11]], tavern ? '#b7864d' : '#d0b987');
    if (tavern) {
      ctx.fillStyle = '#643b24';
      ctx.fillRect(18,5,4,5);
      lin(ctx,[[22,6],[24,6],[24,8],[22,8]],'#643b24');
    } else {
      lin(ctx,[[18,5],[22,5]],'#655139');
      lin(ctx,[[18,8],[22,8]],'#655139');
    }
  }

  function logs(ctx) {
    polygon(ctx,[[-16,-9],[12,-9],[18,8],[-14,9]], '#b39a76');
    for (const [x,y] of [[-12,-4],[-3,-4],[-8,2],[2,2]]) {
      lin(ctx,[[x,y],[x+11,y+5]],'#795037',5);
      lin(ctx,[[x,y],[x+10,y+5]],'#b9895c',2);
    }
  }

  function plantBed(ctx, flowers) {
    polygon(ctx,[[-17,-13],[16,-13],[18,12],[-17,13]],flowers ? '#879466' : '#a08560');
    for (const y of [-9,-3,3,9]) {
      lin(ctx,[[-14,y],[14,y]],flowers ? '#626e4a' : '#8a7048',2);
      for (const x of [-12,-6,0,6,12]) {
        ctx.fillStyle = flowers ? '#8eaa70' : '#556e44';
        ctx.fillRect(x-2,y-1,5,3);
        ctx.fillStyle = flowers ? (x%4 === 0 ? '#f0cc89' : '#c99085') : '#a8b477';
        ctx.fillRect(x,y-2,2,2);
      }
    }
  }

  function paintPlot(ctx, left, top, cell, flowers) {
    ctx.save();
    ctx.translate(left+cell/2,top+cell/2);
    plantBed(ctx,flowers);
    ctx.restore();
  }

  function graves(ctx) {
    polygon(ctx,[[-18,-11],[17,-11],[17,12],[-18,12]],'#99a181');
    for (const [x,y] of [[-12,-6],[1,-6],[9,4],[-5,5]]) {
      polygon(ctx,[[x-3,y+6],[x+3,y+6],[x+4,y+1],[x-3,y+1]],'#726e5d',null);
      lin(ctx,[[x,y-5],[x,y+3]],'#e1d7bf',2.3);
      lin(ctx,[[x-2,y-3],[x+2,y-3]],'#e1d7bf',1.8);
    }
  }

  function monument(ctx, stone) {
    polygon(ctx,[[-14,8],[-8,4],[9,4],[15,9],[10,14],[-10,14]],'#948571');
    polygon(ctx,[[-10,5],[-6,1],[7,1],[11,6],[7,10],[-7,10]],'#c4b59a');
    polygon(ctx,[[-5,5],[-4,-13],[1,-19],[5,-13],[6,5],[1,8]],stone);
    polygon(ctx,[[1,-19],[5,-13],[6,5],[1,8]],'#80715e');
    lin(ctx,[[-3,-7],[0,-8]],'#6e6051');
    lin(ctx,[[-3,-4],[0,-5]],'#6e6051');
  }

  function horsePen(ctx) {
    polygon(ctx,[[-17,-11],[16,-11],[16,12],[-17,12]],'#aa916b');
    for (const y of [-11,11]) lin(ctx,[[-17,y],[16,y]],'#79563b',2);
    for (const x of [-17,16]) lin(ctx,[[x,-13],[x,14]],'#6d4d37',2);
    for (const [x,y,color] of [[-9,-2,'#755141'],[4,3,'#ad9b88']]) {
      polygon(ctx,[[x-3,y-3],[x+3,y-3],[x+4,y-5],[x+7,y-4],[x+7,y],[x+4,y+1],[x+2,y+3],[x-3,y+3]],color);
      lin(ctx,[[x-2,y+3],[x-2,y+7]],trim,1.4);
      lin(ctx,[[x+2,y+2],[x+2,y+6]],trim,1.4);
    }
  }

  function paint(ctx, site, cell, opacity = 1) {
    const { form, roof: palette } = MapData.siteTypes[site.type];
    const roof = palette.startsWith('#') ? palette : roofStyles.getPropertyValue(`--town-roof-${palette}`).trim();
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.translate((site.x+.5)*cell,(site.y+.5)*cell);
    ctx.fillStyle = '#57463229';
    ctx.beginPath();
    ctx.ellipse(1,12,18,7,0,0,Math.PI*2);
    ctx.fill();
    if (form === 'bridge') {
      polygon(ctx,[[-20,-11],[20,-11],[20,11],[-20,11]],'#a89a82');
      lin(ctx,[[-20,-9],[20,-9]], '#554b3d',2);
      lin(ctx,[[-20,9],[20,9]], '#554b3d',2);
    } else if (form === 'well') {
      polygon(ctx,[[-10,-4],[7,-4],[12,3],[9,10],[-9,10],[-13,3]],'#bcb09a');
      polygon(ctx,[[-7,-1],[6,-1],[9,3],[7,6],[-8,6],[-10,3]],'#688b88');
    } else if (form === 'market') {
      stall(ctx,roof);
      if (site.width > 1) {
        ctx.translate(cell,0);
        stall(ctx,site.type === 'town-dock-market' ? '#736e86' : '#8f8451');
      }
    } else if (form === 'gate' || form === 'keep-gate') {
      if (form === 'keep-gate' || site.id === 'north-gate') ctx.rotate(Math.PI/2);
      gate(ctx,roof);
    }
    else if (form === 'rampart') rampart(ctx,roof);
    else if (form === 'garden') garden(ctx);
    else if (form === 'nets') nets(ctx);
    else if (form === 'yard') yard(ctx,roof);
    else if (form === 'monument') monument(ctx,roof);
    else if (form === 'castle') keep(ctx,roof,cell,site.width);
    else if (form === 'residence' || form === 'kitchen') castleWing(ctx,roof,cell,site.width,form === 'kitchen');
    else if (form === 'dungeon') dungeon(ctx,roof);
    else if (form === 'training') practiceYard(ctx,cell,site.width);
    else if (form === 'tavern' || form === 'storefront') storefront(ctx,roof,form === 'tavern');
    else if (form === 'logs') logs(ctx);
    else if (form === 'stables') {
      house(ctx,roof,32,19);
      if (site.width > 1) {
        ctx.translate(cell,0);
        horsePen(ctx);
      }
    } else if (form === 'graves' || form === 'flowerbed') {
      const paintLot = form === 'graves' ? graves : (context) => plantBed(context,true);
      paintLot(ctx);
      if (site.width > 1) {
        ctx.translate(cell,0);
        paintLot(ctx);
      }
    }
    else if (form === 'smelter' || form === 'sawmill') {
      house(ctx,roof,33,20);
      if (site.width > 1) ctx.translate(cell,0);
      else {
        ctx.translate(12,7);
        ctx.scale(.55,.55);
      }
      if (form === 'sawmill') logs(ctx);
      else {
        rampart(ctx,'#a68a72',23,17);
        polygon(ctx,[[-8,-7],[-7,-18],[5,-18],[7,-7]],'#6f5042');
        polygon(ctx,[[-7,-18],[5,-18],[5,-14],[-7,-14]],'#77503d');
        lin(ctx,[[-4,8],[3,8]],'#da8454',2.2);
      }
    }
    else if (form === 'quay') {
      boardwalk(ctx);
      if (site.width > 1) {
        ctx.translate(cell,0);
        ctx.scale(.95,.85);
        boardwalk(ctx);
      }
    } else if (form === 'inn') {
      if (site.height > 1) {
        house(ctx,roof,24,15);
        lin(ctx,[[-17,6],[-17,19],[17,19],[17,5]],'#65513a',1.5);
        ctx.translate(0,cell);
      }
      house(ctx,roof,34,23);
    } else {
      const size = form === 'house' ? 24 + (site.x * 3 + site.y) % 9 : form === 'tower' ? 23 : 34;
      house(ctx,roof,size,form === 'tower' ? 25 : 23);
      if ((form === 'warehouse' || form === 'hall' || form === 'chapel') && site.width > 1) {
        house(ctx,roof,34,23,cell);
      }
      if (form === 'chapel' || form === 'tower') {
        polygon(ctx, [[-12,-12],[-2,-12],[-2,1],[-12,1]], '#b5a98b');
        polygon(ctx, [[-15,-12],[-7,-22],[1,-12]], roof);
      }
      if (form === 'workshop') {
        ctx.fillStyle = '#654939';
        ctx.fillRect(11,-12,4,-7);
        lin(ctx,[[-12,13],[-6,11],[-3,13]],'#573a29',1.7);
      }
    }
    ctx.restore();
  }

  globalThis.TownArt = { paint, paintWalls, paintArena, paintPlot };
}());
