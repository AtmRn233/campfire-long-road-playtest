(function () {
  'use strict';

  const { WIDTH, cellIndex, contains, isWater, roadMask, regionAt, regionHoverCells } = MapModel;
  const CELL = 48;
  const COLORS = {
    grass: ['#c4c492', '#bfc28c', '#c6c58f', '#c1c28e'],
    mountain: ['#a5a49a', '#aeaba1', '#a6a395', '#aaa99d'],
    field: ['#cbb383', '#d0b686', '#c8ad7d', '#ceb686'],
    water: ['#83a7ae', '#85a9af', '#86a9b0', '#84a8af'],
    marsh: ['#879782', '#829782', '#889d88', '#899884'],
    steppe: ['#c2b18b', '#c3b68e', '#c5b592', '#c2b58c'],
    desert: ['#d9b980', '#dcbf8b', '#dbbb83', '#dfc08a'],
    yard: ['#ad8d62','#b99a70','#b39367','#b19369'],
    cobble: ['#a49a86','#afa38f','#a99e89','#a99c85'],
    bank: ['#b5ac8b','#afa484','#aea07e','#b8ab85'],
    wall: ['#a79983','#ad9e86','#aa9d86','#a89a84']
  };
  const ART = {
    grass: ['grass-meadow'],
    forest: ['woodland-grove'],
    denseforest: ['woodland-dense'],
    hill: ['hill-green'],
    mountain: ['mountain-chain'],
    field: ['field'],
    marsh: ['marsh', 'marsh-pool'],
    steppe: ['steppe-sparse'],
    desert: ['sand-ripples'],
  };
  const ART_HEIGHT = { forest: 28, mountain: 28, desert: 9, steppe: 12 };
  const CAVE_COLORS = {
    wall: ['#302e39', '#36313c', '#3d3540', '#34313b'],
    underground: ['#897969', '#948071', '#8c7e6d', '#9a8978'],
    water: ['#587d8e', '#527787', '#648793', '#60808b'],
    lava: ['#ad3c24', '#b54726', '#c45428', '#a93d22'],
  };
  const DIRECTIONS = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
  const isChannel = (terrain) => terrain === 'stream' || terrain === 'river';
  const images = {};
  const labelFont = getComputedStyle(document.documentElement).fontFamily;
  const imageLoads = Object.entries(MapAssets).map(([key, src]) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('无法加载地图素材 ' + key));
    image.src = src;
    images[key] = image;
  }));
  const ready = Promise.all([
    ...imageLoads,
    document.fonts.load(`700 16px ${labelFont}`).catch(() => []),
  ]);

  function drawFit(ctx, asset, x, y, width, height) {
    const image = images[asset];
    if (!image?.naturalWidth) return false;
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
    return true;
  }

  function variationAt(x, y) {
    return ((x * 1013) ^ (y * 1597) ^ (x * y * 113)) >>> 0;
  }

  function terrainAt(map, x, y) {
    return contains(x, y, map) ? map.terrain[cellIndex(x, y)] : null;
  }

  function bankTerrain(map, x, y) {
    const surrounding = {};
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const terrain = terrainAt(map, x + dx, y + dy);
        if (!terrain || isWater(terrain)) continue;
        const lowBank = terrain === 'mountain' ? 'hill' :
          terrain === 'forest' || terrain === 'denseforest' ? 'grass' : terrain;
        surrounding[lowBank] = (surrounding[lowBank] || 0) + (dx && dy ? 1 : 2);
      }
    }
    return Object.keys(surrounding).reduce((best, terrain) => (
      surrounding[terrain] > (surrounding[best] || 0) ? terrain : best
    ), 'grass');
  }

  function paintTerrain(ctx, map) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const terrain = map.terrain[cellIndex(x, y)];
        const left = x * CELL;
        const top = y * CELL;
        const code = variationAt(x, y);
        if (terrain === 'lava') {
          paintLava(ctx, map, x, y, code);
          continue;
        }
        const surface = isWater(terrain) ? bankTerrain(map, x, y) : terrain;
        const caveColors = map.kind === 'underground' ? CAVE_COLORS[surface] : undefined;
        ctx.fillStyle = caveColors?.[code % 4] ?? COLORS[surface]?.[code % 4] ?? MapData.tiles[surface].color;
        ctx.fillRect(left, top, CELL, CELL);
        if (caveColors && !isWater(terrain)) {
          ctx.strokeStyle = terrain === 'wall' ? '#b3a19a21' : '#3a2d3550';
          ctx.lineWidth = terrain === 'wall' ? 1.8 : 1;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const x = left + (code + i * 13) % 40;
            const y = top + ((code >>> 5) + i * 17) % 44;
            ctx.moveTo(x, y);
            ctx.lineTo(x + 5, y - 2);
          }
          ctx.stroke();
        }
        if (map.kind === 'town' && (surface === 'yard' || surface === 'bank')) {
          ctx.fillStyle = '#85644540';
          for (let dot = 0; dot < 15; dot++) {
            const px = (code + dot*13) % 42 + 3;
            const py = ((code >>> 6) + dot*23) % 42 + 3;
            ctx.fillRect(left + px, top + py, 2, 1.2);
          }
        }
        if (isWater(terrain)) continue;
        if (map.kind === 'town' && (terrain === 'vegetables' || terrain === 'flowergarden')) {
          TownArt.paintPlot(ctx,left,top,CELL,terrain === 'flowergarden');
        }
        const options = ART[terrain];
        if (options) {
          if (terrain === 'steppe' && code % 6 < 2) continue;
          const width = terrain === 'forest' || terrain === 'grass' ? 46 : 44;
          const height = ART_HEIGHT[terrain] ?? 43;
          const asset = options[(code >>> 3) % options.length];
          ctx.globalAlpha = terrain === 'grass' ? .46 : terrain === 'steppe' ? .6 : .84;
          const artX = left + (CELL - width) / 2;
          const artY = top + (CELL - height) / 2;
          if (terrain === 'mountain' && images[asset]?.naturalWidth) {
            ctx.drawImage(images[asset], artX, artY, width, height);
          } else drawFit(ctx, asset, artX, artY, width, height);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function roundedTileCorners(map, x, y, isEdge, radius) {
    const [north, east, south, west] = DIRECTIONS.map(([dx, dy]) =>
      contains(x + dx, y + dy, map) && isEdge(terrainAt(map, x + dx, y + dy)));
    return [north && west, north && east, south && east, south && west].map(round => round ? radius : 0);
  }

  function paintLava(ctx, map, x, y, code) {
    const left = x * CELL;
    const top = y * CELL;
    ctx.fillStyle = CAVE_COLORS.wall[code % 4];
    ctx.fillRect(left, top, CELL, CELL);
    ctx.beginPath();
    ctx.roundRect(left, top, CELL, CELL, roundedTileCorners(map, x, y, tile => tile !== 'lava', 10));
    ctx.fillStyle = CAVE_COLORS.lava[code % 4];
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.lineCap = 'round';
    for (const [offset, color, width] of [[11, '#f5934b', 2.2], [28, '#732a29', 3.1], [35, '#e06f37', 1.7]]) {
      const h = top + offset + code % 7;
      const bend = (code >>> 7) % 8;
      ctx.beginPath();
      ctx.moveTo(left + 3, h + bend);
      ctx.bezierCurveTo(left + 18, h - 10, left + 23, h + 11, left + 43, h - bend);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLakeTile(ctx, map, x, y, code) {
    const left = x * CELL;
    const top = y * CELL;
    const coast = neighbor => map.kind === 'town' ? !isWater(neighbor) : neighbor !== 'water';
    ctx.fillStyle = (map.kind === 'underground' ? CAVE_COLORS.water : COLORS.water)[code % 4];
    ctx.beginPath();
    ctx.roundRect(left, top, CELL, CELL, roundedTileCorners(map, x, y, coast, 13));
    ctx.fill();
    if (code % 4 !== 0) return;
    ctx.strokeStyle = '#e1ebe16e';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(left + 9, top + 20);
    ctx.quadraticCurveTo(left + 16, top + 17, left + 23, top + 20);
    ctx.moveTo(left + 24, top + 29);
    ctx.quadraticCurveTo(left + 30, top + 26, left + 36, top + 28);
    ctx.stroke();
  }

  function paintChannels(ctx, map) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const reaches = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const terrain = terrainAt(map, x, y);
        if (!isChannel(terrain) || (map.kind === 'town' && terrain === 'stream')) continue;
        const legs = DIRECTIONS.filter(([dx, dy]) => isWater(terrainAt(map, x + dx, y + dy)) ||
          (terrain === 'river' && y === map.height - 1 && dy === 1));
        const cx = (x + .5) * CELL;
        const cy = (y + .5) * CELL;
        const width = terrain === 'stream' ? 7 : Math.min(20, 13 + Math.max(0, y - 10) * 1.15);
        const path = new Path2D();
        if (legs.length === 2) {
          const [[ax, ay], [bx, by]] = legs;
          path.moveTo(cx + ax * CELL / 2, cy + ay * CELL / 2);
          path.quadraticCurveTo(cx, cy, cx + bx * CELL / 2, cy + by * CELL / 2);
        } else {
          for (const [dx, dy] of legs.length ? legs : [[.18, 0]]) {
            path.moveTo(cx, cy);
            path.lineTo(cx + dx * CELL / 2, cy + dy * CELL / 2);
          }
        }
        reaches.push({ path, width });
      }
    }
    ctx.strokeStyle = '#60888a';
    for (const { path, width } of reaches) {
      ctx.lineWidth = width + 2.5;
      ctx.stroke(path);
    }
    ctx.strokeStyle = '#8dafb1';
    for (const { path, width } of reaches) {
      ctx.lineWidth = width;
      ctx.stroke(path);
    }
    ctx.restore();
  }

  function paintLakes(ctx, map) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const terrain = terrainAt(map,x,y);
        if (terrain === 'water' || (map.kind === 'town' && terrain === 'stream')) {
          drawLakeTile(ctx, map, x, y, variationAt(x, y));
        }
      }
    }
  }

  function paintShallows(ctx, map) {
    for (const [x, y] of map.shallows ?? []) {
      ctx.save();
      ctx.translate((x + .5) * CELL, (y + .5) * CELL);
      ctx.rotate(-.17);
      const wash = ctx.createRadialGradient(0, 0, 2, 0, 0, 18);
      wash.addColorStop(0, '#e4d4a0');
      wash.addColorStop(.52, '#dbc99aaa');
      wash.addColorStop(1, '#dbc99a00');
      ctx.fillStyle = wash;
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const [dx, dy, size] of [[-8, 2, 2.1], [-3, -3, 1.8], [1, 2, 2.5], [6, -1, 1.6], [10, 2, 1.2]]) {
        ctx.beginPath();
        ctx.ellipse(dx, dy, size, size * .65, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#887a59';
        ctx.fill();
        ctx.strokeStyle = '#f3e7b8';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function paintGrid(ctx, map) {
    ctx.strokeStyle = '#302c231f';
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    for (let x = 1; x < WIDTH; x++) {
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, map.height * CELL);
    }
    for (let y = 1; y < map.height; y++) {
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(WIDTH * CELL, y * CELL);
    }
    ctx.stroke();
  }

  function roadPath(map, x, y) {
    let mask = roadMask(map, x, y);
    if (x === 0) mask |= 8;
    if (x === WIDTH - 1) mask |= 2;
    if (y === 0) mask |= 1;
    if (y === map.height - 1) mask |= 4;
    const middleX = (x + .5) * CELL;
    const middleY = (y + .5) * CELL;
    const legs = DIRECTIONS.filter(([, , bit]) => mask & bit);
    const path = new Path2D();
    if (legs.length === 2) {
      const [[ax, ay], [bx, by]] = legs;
      path.moveTo(middleX + ax * CELL / 2, middleY + ay * CELL / 2);
      path.quadraticCurveTo(middleX, middleY, middleX + bx * CELL / 2, middleY + by * CELL / 2);
    } else {
      for (const [dx, dy] of legs) {
        path.moveTo(middleX, middleY);
        path.lineTo(middleX + dx * CELL / 2, middleY + dy * CELL / 2);
      }
      if (!legs.length) {
        path.moveTo(middleX - 2, middleY);
        path.lineTo(middleX + 2, middleY);
      }
    }
    return path;
  }

  function paintRoad(ctx, map, x, y) {
    const terrain = map.terrain[cellIndex(x, y)];
    const wet = isWater(terrain) || terrain === 'marsh';
    const path = roadPath(map, x, y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = wet ? '#575346' : '#8d7756';
    ctx.lineWidth = wet ? 13 : 10;
    ctx.stroke(path);
    ctx.strokeStyle = wet ? '#c8b493' : '#ddc095';
    ctx.lineWidth = wet ? 9 : 7;
    ctx.stroke(path);
    ctx.strokeStyle = wet ? '#816f53' : '#bc976c';
    ctx.lineWidth = .9;
    ctx.setLineDash(wet ? [2, 3] : [2, 9]);
    ctx.stroke(path);
    ctx.setLineDash([]);
  }

  let townPaving;
  function createTownPaving(ctx) {
    const tile = document.createElement('canvas');
    tile.width = 48;
    tile.height = 28;
    const stone = tile.getContext('2d');
    const shades = ['#b9b4a5', '#a7a393', '#c0baaa', '#b0aa9c'];
    stone.fillStyle = '#756f64';
    stone.fillRect(0, 0, tile.width, tile.height);
    const slabWidths = [11, 13, 12, 12];
    for (const [row, offset] of [0, 17, 4, 26].entries()) {
      let x = -offset;
      for (const [slab, width] of slabWidths.entries()) {
        stone.fillStyle = shades[(row + slab * 3) % shades.length];
        for (const left of [x, x + tile.width]) {
          stone.beginPath();
          stone.roundRect(left + .4, row * 7 + .5, width - .8, 6, 1);
          stone.fill();
        }
        x += width;
      }
    }
    return ctx.createPattern(tile, 'repeat');
  }

  function paintTownRoads(ctx, map) {
    const path = new Path2D();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (map.roads[cellIndex(x,y)]) path.addPath(roadPath(map,x,y));
      }
    }
    for (const keep of map.sites) {
      if (keep.type !== 'town-castle' || keep.y+keep.height >= map.height) continue;
      const entryRow = keep.y+keep.height;
      for (let x = keep.x; x < keep.x+keep.width; x++) {
        if (!map.roads[cellIndex(x,entryRow)]) continue;
        const roadX = (x+.5)*CELL;
        const facadeY = entryRow*CELL;
        path.moveTo(roadX,facadeY+CELL/2);
        path.quadraticCurveTo(roadX,facadeY,(keep.x+keep.width/2)*CELL,facadeY-CELL/8);
        break;
      }
    }
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = '#5d564b';
    ctx.lineWidth = 20;
    ctx.stroke(path);
    ctx.strokeStyle = townPaving ??= createTownPaving(ctx);
    ctx.lineWidth = 17;
    ctx.stroke(path);
    ctx.restore();
  }

  function paintSite(ctx, site, opacity = 1) {
    if (MapData.siteTypes[site.type].hideIcon) return;
    if (MapData.townSites.has(site.type)) {
      globalThis.TownArt?.paint(ctx, site, CELL, opacity);
      return;
    }
    const left = site.x * CELL;
    const top = site.y * CELL;
    const width = site.width * CELL;
    const height = site.height * CELL;
    ctx.save();
    ctx.globalAlpha = opacity;
    if (MapData.natural.has(site.type)) {
      ctx.strokeStyle = '#463b27';
      ctx.fillStyle = '#eee0ab';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(left + CELL / 2, top + CELL / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.shadowColor = '#3b2c2355';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 2;
      drawFit(ctx, MapData.siteTypes[site.type].asset, left + 2, top + 2, width - 4, height - 4);
    }
    ctx.restore();
  }

  function paintNames(ctx, map, showLabels, isKnown) {
    ctx.save();
    ctx.font = `700 16px ${labelFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#f6e7bd';
    ctx.lineWidth = 4;
    const placed = [];
    const sites = map.kind === 'town'
      ? [...map.sites].sort((a,b) => Number(b.name.length >= 5) - Number(a.name.length >= 5))
      : map.sites;
    for (const site of sites) {
      if (isKnown && !isKnown(site.x, site.y)) continue;
      const { hideLabel, settlement } = MapData.siteTypes[site.type];
      if (hideLabel) continue;
      if (!showLabels && site.type !== 'frontier-town') continue;
      const letters = Array.from(site.name);
      const multiline = map.kind === 'town' && letters.length >= 5;
      const suffix = ['补给铺', '验矿所', '存料库', '用品店', '物品店'].find(word => site.name.endsWith(word));
      const split = suffix ? letters.length-suffix.length : Math.ceil(letters.length/2);
      const lines = multiline ? [letters.slice(0,split).join(''), letters.slice(split).join('')] : [site.name];
      const lineStep = 14;
      const offset = multiline ? lineStep/2 : 0;
      const maxWidth = Math.min(Math.max(...lines.map(line => ctx.measureText(line).width)),168);
      const x = Math.max(maxWidth / 2 + 5, Math.min((site.x + site.width / 2) * CELL, WIDTH * CELL - maxWidth / 2 - 5));
      const below = Math.min((site.y + site.height) * CELL + 4 + offset, map.height * CELL - 11 - offset);
      const above = Math.max(10+offset,site.y*CELL-6-offset);
      const fits = y => y-offset >= 10 && placed.every(label =>
        Math.abs(label.y - y) >= 20 + label.offset + offset || Math.abs(label.x - x) >= (label.width + maxWidth)/2 + 5);
      const preferred = multiline ? above : below;
      const alternate = multiline ? below : above;
      const y = fits(preferred) || !fits(alternate) ? preferred : alternate;
      ctx.fillStyle = (site.residents?.length || settlement) ? '#8c3627' : '#2a2319';
      lines.forEach((line, index) => {
        const lineY = y-offset+index*lineStep;
        ctx.strokeText(line,x,lineY,maxWidth);
        ctx.fillText(line,x,lineY,maxWidth);
      });
      placed.push({ x, y, width: maxWidth, offset });
    }
    ctx.restore();
  }

  function visibleRegions(map, isKnown) {
    const groups = new Map(map.regions.map((region) => [region.id, { region, cells: [] }]));
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (isKnown && !isKnown(x, y)) continue;
        const region = regionAt(map, x, y);
        if (region) groups.get(region.id).cells.push({ x, y });
      }
    }
    return groups;
  }

  function paintRegionHover(ctx, map, cells) {
    if (!cells?.length) return;
    const indices = new Set(cells.map(({ x, y }) => cellIndex(x, y)));
    const has = (x, y) => contains(x, y, map) && indices.has(cellIndex(x, y));
    ctx.save();
    ctx.fillStyle = '#fff4be35';
    const border = new Path2D();
    for (const { x, y } of cells) {
      const left = x * CELL;
      const top = y * CELL;
      const right = left + CELL;
      const bottom = top + CELL;
      ctx.fillRect(left, top, CELL, CELL);
      if (!has(x, y - 1)) { border.moveTo(left, top); border.lineTo(right, top); }
      if (!has(x + 1, y)) { border.moveTo(right, top); border.lineTo(right, bottom); }
      if (!has(x, y + 1)) { border.moveTo(right, bottom); border.lineTo(left, bottom); }
      if (!has(x - 1, y)) { border.moveTo(left, bottom); border.lineTo(left, top); }
    }
    ctx.lineCap = 'square';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#635434';
    ctx.stroke(border);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff0ab';
    ctx.stroke(border);
    ctx.restore();
  }

  function paintRegionName(ctx, group) {
    if (!group?.cells.length) return;
    const { region, cells } = group;
    let target = region.label;
    if (!target || !cells.some(({ x, y }) => x === target[0] && y === target[1])) {
      const [centerX, centerY] = cells.reduce(([x, y], cell) => [x + cell.x, y + cell.y], [0, 0])
        .map((value) => value / cells.length);
      const distance = ({ x, y }) => (x - centerX) ** 2 + (y - centerY) ** 2;
      const nearest = cells.reduce((best, cell) => distance(cell) < distance(best) ? cell : best);
      target = [nearest.x, nearest.y];
    }

    ctx.save();
    const district = region.terrains.length === 0;
    ctx.font = `${district ? 800 : 700} 19px ${labelFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = Math.min(ctx.measureText(region.name).width, 190);
    const inset = width / 2 + 5;
    const x = Math.max(inset, Math.min((target[0] + .5) * CELL, WIDTH * CELL - inset));
    const y = (target[1] + .5) * CELL;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#eee4c4';
    ctx.fillStyle = district ? '#64452d' : '#33301f';
    ctx.strokeText(region.name, x, y, width);
    ctx.fillText(region.name, x, y, width);
    ctx.restore();
  }

  function paintFrame(ctx, box, invalid = false) {
    if (!box) return;
    const { x, y, width = 1, height = 1 } = box;
    ctx.save();
    ctx.strokeStyle = invalid ? '#9c472f' : '#534e30';
    ctx.lineWidth = 2;
    ctx.strokeRect(x * CELL + 1.5, y * CELL + 1.5, width * CELL - 3, height * CELL - 3);
    ctx.strokeStyle = invalid ? '#ffb49a' : '#f3e4a5';
    ctx.lineWidth = 1;
    ctx.strokeRect(x * CELL + 3, y * CELL + 3, width * CELL - 6, height * CELL - 6);
    ctx.restore();
  }

  function render(canvas, map, view = {}) {
    const ctx = canvas.getContext('2d');
    paintTerrain(ctx, map);
    paintChannels(ctx, map);
    paintLakes(ctx, map);
    paintShallows(ctx, map);
    if (view.grid && map.kind !== 'town') paintGrid(ctx, map);
    if (map.kind === 'town') {
      paintTownRoads(ctx, map);
      const arena = map.regions.find(region => region.id === 'town-arena');
      if (arena) TownArt.paintArena(ctx, arena.bounds, CELL);
      if (view.grid) paintGrid(ctx, map);
      TownArt.paintWalls(ctx, map, CELL);
    } else {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (map.roads[cellIndex(x, y)]) paintRoad(ctx, map, x, y);
        }
      }
    }
    const regions = view.regionNames === false ? new Map() : visibleRegions(map, view.isKnown);
    paintRegionHover(ctx, map, regionHoverCells(map, view.hoveredRegion));
    paintFrame(ctx, view.selected);
    for (const site of map.sites) paintSite(ctx, site, site.id === view.ghost?.id ? .35 : 1);
    for (const group of regions.values()) {
      const townDistrict = map.kind === 'town' && !group.region.terrains.length;
      if (!townDistrict) paintRegionName(ctx, group);
    }
    paintNames(ctx, map, view.labels, view.isKnown);
    if (view.ghost) {
      paintFrame(ctx, view.ghost, !view.valid);
      paintSite(ctx, view.ghost, .82);
    }
  }

  globalThis.MapRender = { ready, render, CELL };
}());
