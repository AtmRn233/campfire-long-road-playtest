import { formatTravelDuration, isImpassableTerrain, isRoadBridge, isWaterway, terrainAt, terrainMovementHours } from './movement.mjs';
import { paintMapFootprints } from './footprints.mjs';

const get = (id) => document.getElementById(id);
const canvas = get('map');
const ctx = canvas.getContext('2d');
const { CELL, render } = MapRender;
const { contains, cellIndex, siteAt, regionAt, roadMask } = MapModel;
let map, lore, travel, travelers, party, visibility, selected, hovered, hoveredSite;
let teams = [];
let footprints = [];
let frame = 0;

function cellVisibility(x, y) {
  return visibility[y * map.width + x] ?? 'unexplored';
}

function isKnown(x, y) {
  return contains(x, y, map) && cellVisibility(x, y) !== 'unexplored';
}

function paintParty() {
  if (!party) return;
  const left = party.x * CELL;
  const top = party.y * CELL;
  const center = CELL / 2;
  const radius = CELL * .35;
  const size = CELL * .49;
  ctx.save();
  ctx.translate(left, top);
  ctx.strokeStyle = '#c43b32';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, CELL - 4, CELL - 4);
  const gold = ctx.createRadialGradient(center, center, radius * .3, center, center, radius);
  gold.addColorStop(0, '#f0d083');
  gold.addColorStop(1, '#b8862a');
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, 2 * Math.PI);
  ctx.fill();
  ctx.font = size + 'px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('👤', center, center);
  ctx.restore();
}

function paintTeams() {
  const groups = new Map();
  for (const team of teams) {
    if (cellVisibility(team.x, team.y) !== 'visible') continue;
    const key = cellIndex(team.x, team.y);
    const group = groups.get(key);
    if (group) group.push(team);
    else groups.set(key, [team]);
  }
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (const group of groups.values()) {
    const rows = Math.ceil(group.length / 2);
    const size = Math.min(21, Math.floor((CELL - 4) / rows), Math.floor((CELL - (group.some(team => team.engagedWith) ? 11 : 3)) / (group.length > 1 ? 2 : 1)));
    const pitch = size + 1;
    for (const [index, team] of group.entries()) {
      const row = Math.floor(index / 2);
      const columns = Math.min(2, group.length - row * 2);
      const left = group[row * 2];
      const right = group[row * 2 + 1];
      const clash = right && left.engagedWith === right.id;
      const gap = clash ? 9 : 1;
      const x = (team.x + .5) * CELL - (columns * size + (columns - 1) * gap) / 2 + (index % 2) * (size + gap);
      const y = (team.y + .5) * CELL - (rows * pitch - 1) / 2 + row * pitch;
      ctx.fillStyle = team.field;
      ctx.strokeStyle = team.trim;
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, size, size);
      ctx.strokeRect(x + .5, y + .5, size - 1, size - 1);
      ctx.fillStyle = '#fff0ce';
      ctx.font = `${Math.floor(size * .78)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.fillText(team.emoji, x + size / 2, y + size / 2);
      if (clash && index % 2 === 0) {
        ctx.font = '8px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx.fillText('⚔️', x + size + gap / 2, y + size / 2);
      }
    }
  }
  ctx.restore();
}

function inspectTeams(point) {
  const panel = get('teams');
  const shown = point && isKnown(point.x, point.y) && cellVisibility(point.x, point.y) === 'visible'
    ? teams.filter(team => team.x === point.x && team.y === point.y) : [];
  panel.hidden = !shown.length;
  panel.replaceChildren(...shown.map(team => {
    const entry = document.createElement('div');
    const name = document.createElement('strong');
    const status = document.createElement('small');
    name.textContent = `${team.emblem} ${team.name} ${team.size}人`;
    status.textContent = team.status;
    entry.append(name, status);
    return entry;
  }));
}

function draw() {
  if (!map || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const site = selected && siteAt(map, selected.x, selected.y);
    render(canvas, map, {
      grid: get('grid').checked, labels: get('labels').checked,
      selected: site && isKnown(site.x, site.y) ? site : selected, hoveredRegion: hovered?.id, isKnown,
    });
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const state = cellVisibility(x, y);
        if (state === 'visible') continue;
        ctx.fillStyle = state === 'remembered' ? 'rgba(0, 0, 0, .28)' : '#000';
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    paintMapFootprints(ctx, footprints.filter(step =>
      isKnown(step.x, step.y) && !(party?.x === step.x && party?.y === step.y)), CELL);
    paintParty();
    paintTeams();
  });
}

function inspect(point = selected) {
  if (!point || !isKnown(point.x, point.y)) {
    get('place').textContent = '未探索';
    for (const id of ['coordinates', 'terrain', 'lore', 'movement']) get(id).textContent = '';
    draw();
    return;
  }
  const { x, y } = point;
  const town = map.kind === 'town';
  const site = siteAt(map, x, y);
  const region = regionAt(map, x, y);
  const place = site ?? region;
  const terrain = terrainAt(map, point);
  const road = !isImpassableTerrain(terrain) && map.roads[cellIndex(x, y)] && (town ||
    (terrain !== 'shallows' && (!isWaterway(terrain) || isRoadBridge(map, point)) && roadMask(map, x, y)));
  const terrainName = road ? '道路' : map.kind === 'underground' && terrain === 'wall' ? '岩壁'
    : travel.terrainNames[terrain] ?? MapData.tiles[terrain]?.name;
  get('place').textContent = place?.name ?? terrainName;
  get('coordinates').textContent = `X ${x + 1} · Y ${y + 1}`;
  get('terrain').textContent = terrainName;
  get('lore').textContent = place?.description ?? lore[place?.id] ?? (site ? MapData.siteTypes[site.type]?.description : MapLore[region?.id]) ?? '';
  if (!town) {
    const hours = terrainMovementHours(travel, road ? 'road' : terrain, travelers);
    get('movement').textContent = hours === undefined ? '不可通行'
      : formatTravelDuration(hours) + (isWaterway(terrain) && !road ? '（乘船）' : '');
  }
  draw();
}

function pointAt(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor((event.clientX - rect.left) / rect.width * map.width),
    y: Math.floor((event.clientY - rect.top) / rect.height * map.height),
  };
}

canvas.addEventListener('pointermove', (event) => {
  if (!map) return;
  const point = pointAt(event);
  inspectTeams(point);
  const { x, y } = point;
  const known = isKnown(x, y);
  const site = known ? siteAt(map, x, y) : undefined;
  if (site !== hoveredSite) {
    hoveredSite = site;
    inspect(site ? point : selected);
  }
  const next = known ? regionAt(map, x, y) : undefined;
  if (next === hovered) return;
  hovered = next;
  get('region').textContent = hovered?.name ?? '';
  draw();
});
canvas.addEventListener('pointerleave', () => {
  if (!map) return;
  hovered = undefined;
  hoveredSite = undefined;
  inspectTeams();
  get('region').textContent = '';
  inspect();
});
canvas.addEventListener('click', (event) => {
  if (!map) return;
  const point = pointAt(event);
  if (!isKnown(point.x, point.y)) return;
  canvas.focus({ preventScroll: true });
  selected = point;
  inspect();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.parent.postMessage({ type: 'campfire-atlas-close' }, location.origin);
});
get('grid').addEventListener('change', draw);
get('labels').addEventListener('change', draw);
get('map-layers').addEventListener('click', event => {
  const layer = event.target.closest('[data-layer]')?.dataset.layer;
  if (layer) window.parent.postMessage({ type: 'campfire-atlas-layer', layer }, location.origin);
});

window.addEventListener('message', async (event) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  const data = event.data;
  if (data?.type === 'campfire-atlas-open') {
    try {
      await MapRender.ready;
      ({ map, lore, travel, travelers, visibility } = data);
      teams = Array.isArray(data.teams) ? data.teams : [];
      footprints = Array.isArray(data.footprints) ? data.footprints : [];
      inspectTeams();
      party = data.party;
      const firstKnown = visibility.findIndex(state => state !== 'unexplored');
      selected = party ?? (firstKnown < 0 ? undefined : { x: firstKnown % map.width, y: Math.floor(firstKnown / map.width) });
      hovered = hoveredSite = undefined;
      get('region').textContent = '';
      get('map-layers').hidden = !data.layer;
      for (const button of get('map-layers').querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.layer === data.layer));
      }
      canvas.width = map.width * CELL;
      canvas.height = map.height * CELL;
      canvas.setAttribute('aria-label', data.title + '地图');
      get('difficulty').hidden = map.kind === 'town';
      document.querySelector('.map-view').hidden = false;
      inspect();
      get('status').hidden = true;
      canvas.focus({ preventScroll: true });
    } catch {
      document.querySelector('.map-view').hidden = true;
      get('status').textContent = '无法载入地图。';
    }
  }
});
