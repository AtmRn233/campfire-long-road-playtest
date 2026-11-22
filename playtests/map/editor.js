import { findLocalRoute, townStep } from './movement.mjs';

function openEditor(publishedMap, townMap, underground, preview) {
  'use strict';

  const model = MapModel;
  const { tiles, siteTypes, townSites, natural, retired } = MapData;
  const types = new Set(Object.keys(siteTypes));
  const get = (id) => document.getElementById(id);
  const canvas = get('atlas');
  const palette = get('palette');
  const nameInput = get('site-name');
  const undoButton = get('undo');
  const gridToggle = get('show-grid');
  const labelToggle = get('show-labels');
  const presets = { region: publishedMap, town: townMap, underground };
  const drafts = { region: 'campfire-stonebank-editor-v1', town: 'campfire-stonebank-town-editor-v1', underground: 'campfire-stonebank-underground-editor-v1' };
  const histories = { region: [], town: [], underground: [] };
  let activeMap = preview ? 'town' : 'region';
  let history = histories[activeMap];
  const townButton = get('open-town');
  const undergroundButton = get('open-underground');
  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  const toolNotes = {
    terrain: '选地形或道路，再点击或拖动涂刷。再点一次素材可退出涂刷。',
    site: '点击地标阅读设定，也可以拖动地标或从素材库添加。'
  };
  let map = loadMap();
  function initialSelection() {
    if (activeMap === 'town') {
      const landmark = map.sites.find(site => site.id === (preview ? 'fruit-stall' : 'dock-market'));
      return landmark ? { x: landmark.x, y: landmark.y } : { x: 15, y: 10 };
    }
    const home = map.sites.find(site => site.id === (activeMap === 'underground' ? 'lake-stairs' : 'frontier-town'));
    return home ? { x: home.x, y: home.y } : { x: 0, y: 0 };
  }
  let selection = initialSelection();
  let visitor = { ...selection };
  const trail = [];
  let townRoute = [];
  let walkTimer;
  let mode = 'site';
  let terrainBrush = null;
  let siteBrush = null;
  let dragType = null;
  let pointer = null;
  let ghost = null;
  let hoveredRegion = null;
  let frame = 0;

  function loadMap() {
    if (preview) return structuredClone(presets.town);
    try {
      const saved = localStorage.getItem(drafts[activeMap]);
      if (saved) return model.importMap(saved, types);
    } catch {
      get('notice').textContent = '本地记录无法读取，已载入初始地图。';
    }
    return structuredClone(presets[activeMap]);
  }

  const mapName = () => ({ town: '石岸镇', region: '交界地', underground: '幽暗地域' })[activeMap];
  const terrainName = id => activeMap === 'underground' && id === 'wall' ? '岩壁'
    : activeMap === 'town' && id === 'water' ? '河水' : tiles[id].name;

  function coordinate(cell) {
    return 'X ' + String(cell.x + 1).padStart(2, '0') + ' · Y ' + String(cell.y + 1).padStart(2, '0');
  }

  function axes(id, length) {
    const axis = get(id);
    axis.replaceChildren();
    return Array.from({ length }, (_, index) => {
      const tick = document.createElement('span');
      tick.textContent = String(index + 1);
      axis.append(tick);
      return tick;
    });
  }
  const columns = axes('axis-x', model.WIDTH);
  let rows = [];

  function fitMap() {
    get('map-name').textContent = mapName();
    canvas.setAttribute('aria-label', map.width + ' 列 ' + map.height + ' 行的' + mapName() + '地图');
    if (rows.length === map.height) return;
    rows = axes('axis-y', map.height);
    get('axis-y').style.setProperty('--rows', map.height);
    get('map-size').textContent = map.width + ' × ' + map.height + ' 格';
    canvas.width = map.width * MapRender.CELL;
    canvas.height = map.height * MapRender.CELL;
    canvas.closest('.atlas-frame').style.setProperty('--atlas-ratio', map.width / map.height);
    if (!model.contains(selection.x, selection.y, map)) selection = { x: 0, y: 0 };
  }

  function redraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const site = model.siteAt(map, selection.x, selection.y);
      MapRender.render(canvas, map, {
        grid: gridToggle.checked,
        labels: labelToggle.checked,
        selected: site || selection,
        hoveredRegion,
        ghost,
        valid: !ghost || model.canPlace(map, ghost.x, ghost.y, ghost.id, ghost.width, ghost.height)
      });
      if (preview) {
        const ctx = canvas.getContext('2d');
        MapParty.paintTrail(ctx, visitor, trail, MapRender.CELL);
        MapParty.paintRoute(ctx, visitor, townRoute, MapRender.CELL);
        MapParty.paintBanner(ctx, visitor, MapRender.CELL);
      }
    });
  }

  function hoverRegion(cell) {
    const region = cell && !pointer && !dragType ? model.regionAt(map, cell.x, cell.y) : null;
    const next = region?.id ?? null;
    if (next === hoveredRegion) return;
    hoveredRegion = next;
    redraw();
  }

  function showCursor(cell) {
    get('cursor-coordinate').textContent = coordinate(cell);
    columns.forEach((tick, index) => tick.classList.toggle('active', index === cell.x));
    rows.forEach((tick, index) => tick.classList.toggle('active', index === cell.y));
  }

  function inspect() {
    fitMap();
    const site = model.siteAt(map, selection.x, selection.y);
    const index = model.cellIndex(selection.x, selection.y);
    get('coordinates').textContent = coordinate(selection);
    get('site-fields').hidden = preview || !site;
    get('delete-site').hidden = preview || !site;
    nameInput.value = site?.name || '';
    const terrain = map.terrain[index];
    const description = [terrainName(terrain)];
    if (map.shallows?.some(([x, y]) => x === selection.x && y === selection.y)) description.push('浅滩');
    const area = model.regionAt(map, selection.x, selection.y);
    if (area) description.push(area.name);
    if (site) description.push(site.width + '×' + site.height + (activeMap === 'town' ? ' 格建筑' : ' 格地标'));
    if (map.roads[index]) description.push('道路');
    get('tile-description').textContent = description.join(' · ');
    const place = site || area;
    const lore = place?.description || (site ? siteTypes[site.type]?.description : MapLore[area?.id]);
    get('place-lore').hidden = !place;
    get('place-lore-name').textContent = place?.name || '';
    get('place-lore-text').textContent = lore || '';
    showCursor(selection);
    redraw();
  }

  function status(text) {
    get('notice').textContent = text;
  }

  function stopTownWalk() {
    clearInterval(walkTimer);
    walkTimer = undefined;
  }

  function advanceTownVisitor(next) {
    MapParty.rememberStep(trail,visitor,next);
    visitor = next;
  }

  function planTownRoute() {
    stopTownWalk();
    const plan = findLocalRoute(map,visitor,selection,(from,to) =>
      townStep(map,from,to.x-from.x,to.y-from.y));
    townRoute = plan?.steps ?? [];
    status(plan ? '' : '没有可通行的路线。');
    inspect();
  }

  function save() {
    try {
      localStorage.setItem(drafts[activeMap], model.exportMap(map));
    } catch {
      status('当前浏览器无法保存草稿，可通过导出 JSON 保存。');
    }
  }

  function commit(before, message) {
    if (model.exportMap(map) === model.exportMap(before)) return;
    history.push(before);
    if (history.length > 40) history.shift();
    undoButton.disabled = false;
    status(message || '');
    save();
  }

  function undo() {
    if (pointer || !history.length) return;
    map = history.pop();
    undoButton.disabled = history.length === 0;
    status('已撤销上一步。');
    save();
    inspect();
  }

  function swatch(value, name, asset, variation, color) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.dataset.value = value;
    const active = mode === 'terrain' ? terrainBrush : siteBrush;
    button.setAttribute('aria-pressed', String(value === active));
    const art = document.createElement('span');
    art.className = 'swatch-art ' + variation;
    if (color) art.style.backgroundColor = color;
    const uri = MapAssets[asset];
    if (uri) {
      const sprite = new Image();
      sprite.src = uri;
      sprite.alt = '';
      sprite.draggable = false;
      art.append(sprite);
    } else if (variation === 'building') {
      const sample = document.createElement('canvas');
      const { width, height } = siteTypes[value];
      sample.width = width * MapRender.CELL;
      sample.height = height * MapRender.CELL;
      TownArt.paint(sample.getContext('2d'), { type: value, x: 0, y: 0, width, height }, MapRender.CELL);
      art.append(sample);
    } else if (variation === 'erase') art.textContent = '×';
    else if (variation !== 'road') art.textContent = '≋';
    button.append(art, document.createTextNode(name));
    if (mode === 'site') button.draggable = true;
    palette.append(button);
  }

  function updateSwatches() {
    const selected = mode === 'terrain' ? terrainBrush : siteBrush;
    for (const button of palette.children) {
      button.setAttribute('aria-pressed', String(button.dataset.value === selected));
    }
  }

  function setMode(next) {
    mode = next;
    terrainBrush = null;
    siteBrush = null;
    ghost = null;
    modeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    modeButtons.find(button => button.dataset.mode === 'site').textContent = activeMap === 'town' ? '建筑' : '地标';
    palette.replaceChildren();
    if (mode === 'terrain') {
      swatch('draw-road', '铺设道路', null, 'road');
      swatch('erase-road', '擦除道路', null, 'erase');
      for (const [id, tile] of Object.entries(tiles)) {
        const undergroundOnly = id === 'underground' || id === 'lava';
        if (activeMap === 'underground' && !undergroundOnly && id !== 'wall' && id !== 'water') continue;
        if (activeMap === 'region' && ['yard', 'cobble', 'bank', 'wall', 'vegetables', 'flowergarden'].includes(id)) continue;
        if (activeMap !== 'underground' && undergroundOnly) continue;
        swatch(id, terrainName(id), tile.asset, tile.asset ? '' : 'natural', tile.color);
      }
    } else {
      for (const [id, site] of Object.entries(siteTypes)) {
        if (natural.has(id) || retired.has(id)) continue;
        if (townSites.has(id) !== (activeMap === 'town')) continue;
        swatch(id, site.name, site.asset, townSites.has(id) ? 'building' : '');
      }
    }
    get('tool-hint').textContent = toolNotes[mode];
    redraw();
  }

  function cellAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * model.WIDTH / rect.width);
    const y = Math.floor((event.clientY - rect.top) * map.height / rect.height);
    return model.contains(x, y, map) ? { x, y } : null;
  }

  function paint(from, to) {
    if (mode === 'terrain' && !terrainBrush) return;
    const cells = model.traceCells(from, to);
    for (const cell of cells) {
      const index = model.cellIndex(cell.x, cell.y);
      if (terrainBrush === 'draw-road' || terrainBrush === 'erase-road') {
        map.roads[index] = terrainBrush === 'draw-road';
      } else {
        map.terrain[index] = terrainBrush;
        if (map.shallows && !model.isWater(terrainBrush)) {
          map.shallows = map.shallows.filter(([x, y]) => x !== cell.x || y !== cell.y);
          if (!map.shallows.length) delete map.shallows;
        }
      }
    }
    selection = to;
    inspect();
  }

  function addSite(type, cell) {
    if (!siteTypes[type] || natural.has(type) || retired.has(type)) return;
    const before = structuredClone(map);
    const suffix = typeof crypto.randomUUID === 'function' ?
      crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const id = type + '-' + suffix;
    const { name, description, width = 1, height = 1 } = siteTypes[type];
    if (!model.placeSite(map, type, cell.x, cell.y, id, name, description, width, height)) {
      status('该地标会重叠或超出边界。');
      return;
    }
    selection = cell;
    siteBrush = null;
    updateSwatches();
    commit(before, '已放置 ' + siteTypes[type].name + '。');
    inspect();
  }

  function placementGhost(type, cell) {
    const { width = 1, height = 1 } = siteTypes[type];
    ghost = { ...cell, type, width, height };
  }

  modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  palette.addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    const value = button.dataset.value;
    if (mode === 'site') siteBrush = siteBrush === value ? null : value;
    else terrainBrush = terrainBrush === value ? null : value;
    status('');
    updateSwatches();
  });
  palette.addEventListener('dragstart', (event) => {
    const button = event.target.closest('button[draggable="true"]');
    if (!button) return;
    dragType = button.dataset.value;
    hoverRegion(null);
    event.dataTransfer.setData('text/plain', dragType);
    event.dataTransfer.effectAllowed = 'copy';
  });
  palette.addEventListener('dragend', () => {
    dragType = null;
    ghost = null;
    redraw();
  });
  canvas.addEventListener('dragover', (event) => {
    const cell = cellAt(event);
    if (!dragType || !cell) return;
    event.preventDefault();
    placementGhost(dragType, cell);
    event.dataTransfer.dropEffect = model.canPlace(map, cell.x, cell.y, undefined, ghost.width, ghost.height) ? 'copy' : 'none';
    showCursor(cell);
    redraw();
  });
  canvas.addEventListener('dragleave', () => {
    ghost = null;
    redraw();
  });
  canvas.addEventListener('drop', (event) => {
    event.preventDefault();
    const cell = cellAt(event);
    if (dragType && cell) addSite(dragType, cell);
    dragType = null;
    ghost = null;
    redraw();
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointer) return;
    const cell = cellAt(event);
    if (!cell) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    selection = cell;
    if (preview) {
      planTownRoute();
      return;
    }
    if (mode === 'site' && siteBrush) {
      addSite(siteBrush, cell);
      inspect();
      return;
    }
    const site = mode === 'site' ? model.siteAt(map, cell.x, cell.y) : null;
    if ((mode === 'site' && !site) || (mode === 'terrain' && !terrainBrush)) {
      inspect();
      return;
    }
    pointer = {
      id: event.pointerId,
      before: structuredClone(map),
      last: cell,
      site, offsetX: site ? cell.x - site.x : 0, offsetY: site ? cell.y - site.y : 0,
    };
    canvas.setPointerCapture(event.pointerId);
    hoverRegion(null);
    if (site) inspect();
    else paint(cell, cell);
  });

  canvas.addEventListener('dblclick', () => {
    if (!preview || !townRoute.length || walkTimer !== undefined) return;
    status('正在沿路线行走。');
    walkTimer = setInterval(() => {
      advanceTownVisitor(townRoute.shift());
      if (!townRoute.length) {
        stopTownWalk();
        status('已抵达。');
      }
      redraw();
    }, MapParty.stepMs);
  });

  canvas.addEventListener('pointermove', (event) => {
    const cell = cellAt(event);
    hoverRegion(cell);
    if (!cell) {
      if (ghost) { ghost = null; redraw(); }
      return;
    }
    showCursor(cell);
    if (!pointer) {
      if (siteBrush) {
        placementGhost(siteBrush, cell);
        redraw();
      }
      return;
    }
    if (pointer.id !== event.pointerId) return;
    if (cell.x === pointer.last.x && cell.y === pointer.last.y) return;
    if (pointer.site) {
      ghost = { ...pointer.site, x: cell.x - pointer.offsetX, y: cell.y - pointer.offsetY };
      redraw();
    } else paint(pointer.last, cell);
    pointer.last = cell;
  });

  function finishPointer(event, canceled = false) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const gesture = pointer;
    const next = cellAt(event);
    pointer = null;
    ghost = null;
    if (canceled) {
      map = gesture.before;
    } else if (gesture.site && next) {
      if (model.moveSite(map, gesture.site.id, next.x - gesture.offsetX, next.y - gesture.offsetY)) {
        selection = next;
        commit(gesture.before);
      } else status('地标会重叠或超出边界，已留在原处。');
    } else {
      if (next && (next.x !== gesture.last.x || next.y !== gesture.last.y)) paint(gesture.last, next);
      if (!gesture.site) commit(gesture.before);
    }
    hoverRegion(next);
    inspect();
  }
  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', (event) => finishPointer(event, true));
  canvas.addEventListener('lostpointercapture', (event) => finishPointer(event, true));
  canvas.addEventListener('pointerleave', () => {
    hoverRegion(null);
    if (!pointer && ghost) { ghost = null; redraw(); }
  });

  canvas.addEventListener('keydown', (event) => {
    if (preview) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.code === 'Numpad5' || event.key === 'Escape') {
        if (!townRoute.length) return;
        event.preventDefault();
        stopTownWalk();
        townRoute = [];
        status('');
        redraw();
        return;
      }
      const step = MapParty.keys[event.code];
      if (!step) return;
      event.preventDefault();
      stopTownWalk();
      townRoute = [];
      const next = townStep(map,visitor,...step);
      if (!next) {
        status('前方无法通行。');
        redraw();
        return;
      }
      advanceTownVisitor(next);
      selection = next;
      status('');
      inspect();
      return;
    }
    const deltas = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (deltas[event.key]) {
      event.preventDefault();
      const [dx, dy] = deltas[event.key];
      const x = selection.x + dx;
      const y = selection.y + dy;
      if (model.contains(x, y, map)) { selection = { x, y }; inspect(); }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (mode === 'site') {
        if (siteBrush) addSite(siteBrush, selection);
      } else if (terrainBrush) {
        const before = structuredClone(map);
        paint(selection, selection);
        commit(before);
      }
    } else if (event.key === 'Escape') {
      terrainBrush = null;
      siteBrush = null;
      ghost = null;
      updateSwatches();
      redraw();
    }
  });

  nameInput.addEventListener('change', () => {
    const site = model.siteAt(map, selection.x, selection.y);
    if (!site) return;
    const next = nameInput.value.trim();
    if (!next) { nameInput.value = site.name; return; }
    const before = structuredClone(map);
    site.name = next;
    commit(before);
    inspect();
  });
  get('delete-site').addEventListener('click', () => {
    const site = model.siteAt(map, selection.x, selection.y);
    if (!site) return;
    const before = structuredClone(map);
    map.sites = map.sites.filter((item) => item.id !== site.id);
    commit(before, '已移除 ' + site.name + '。');
    inspect();
  });

  function download(file, name) {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  get('json').addEventListener('click', () => {
    download(new Blob([model.exportMap(map)], { type: 'application/json' }), mapName() + '-地图.json');
  });
  get('png').addEventListener('click', () => {
    const output = document.createElement('canvas');
    output.width = canvas.width;
    output.height = canvas.height;
    MapRender.render(output, map, { grid: gridToggle.checked, labels: labelToggle.checked });
    output.toBlob((file) => {
      if (file) download(file, mapName() + '-网格地图.png');
      else status('PNG 导出失败。');
    }, 'image/png');
  });
  get('import').addEventListener('click', () => get('file').click());
  function openMap(next, message) {
    const before = map;
    map = next;
    selection = initialSelection();
    terrainBrush = null;
    siteBrush = null;
    ghost = null;
    updateSwatches();
    commit(before, message);
    inspect();
  }

  get('new-preset').addEventListener('click', () => {
    if (pointer) return;
    openMap(structuredClone(presets[activeMap]), '已载入新版底图，可以撤销。');
  });
  get('file').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file) return;
    try {
      const imported = model.importMap(await file.text(), types);
      switchMap(imported.kind === 'town' ? 'town' : 'region');
      openMap(imported, '地图已导入。');
    } catch (error) {
      status(error instanceof SyntaxError ? '这个文件不是有效的地图 JSON。' : error.message);
    }
  });
  undoButton.addEventListener('click', undo);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && event.target !== nameInput) {
      event.preventDefault();
      undo();
    }
  });
  gridToggle.addEventListener('change', redraw);
  labelToggle.addEventListener('change', redraw);
  function switchMap(next) {
    if (activeMap === next || pointer) return;
    activeMap = next;
    history = histories[next];
    map = loadMap();
    selection = initialSelection();
    hoveredRegion = null;
    townButton.textContent = next === 'town' ? '返回区域' : '小地图';
    townButton.setAttribute('aria-pressed', String(next === 'town'));
    undergroundButton.textContent = next === 'underground' ? '返回地表' : '地下';
    undergroundButton.setAttribute('aria-pressed', String(next === 'underground'));
    undoButton.disabled = history.length === 0;
    status('');
    setMode('site');
    inspect();
  }
  get('open-town').addEventListener('click', () => switchMap(activeMap === 'town' ? 'region' : 'town'));
  undergroundButton.hidden = !underground || Boolean(preview);
  undergroundButton.addEventListener('click', () => switchMap(activeMap === 'underground' ? 'region' : 'underground'));
  document.body.classList.toggle('town-preview', Boolean(preview));
  if (preview) get('tool-hint').textContent = '单击查看地标和规划路线，双击出发，也可用方向键移动。';
  else setMode('site');
  inspect();
  MapRender.ready.then(() => {
    redraw();
    if (preview) canvas.focus({ preventScroll: true });
  }).catch((error) => status(error.message));
}

function loadPreset(event) {
  if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'campfire-map-editor') return;
  window.removeEventListener('message', loadPreset);
  openEditor(event.data.map, event.data.town, event.data.underground, event.data.preview);
}
window.addEventListener('message', loadPreset);
