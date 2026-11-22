import { isImpassableTerrain, isRoadBridge, isWaterway, terrainAt, travelLevelFor } from './movement.mjs';

const get = (id) => document.getElementById(id);
const canvas = get('map');
const ctx = canvas.getContext('2d');
const { CELL, render } = MapRender;
const { contains, cellIndex, siteAt, regionAt, roadMask } = MapModel;
let map, lore, travel, favored, party, partyIcon, selected, hovered, hoveredSite;
let frame = 0;

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
  ctx.translate(center - size / 2, center - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = '#2a1a08';
  ctx.fill(partyIcon);
  ctx.restore();
}

function draw() {
  if (!map || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render(canvas, map, {
      grid: get('grid').checked, labels: get('labels').checked,
      selected: siteAt(map, selected.x, selected.y) ?? selected, hoveredRegion: hovered?.id,
    });
    paintParty();
  });
}

function inspect(point = selected) {
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
    const level = travelLevelFor(travel, road ? 'road' : terrain, favored);
    get('movement').textContent = level
      ? `${level.label}${isWaterway(terrain) && !road ? '（乘船）' : ''}` : '不可通行';
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
  const point = pointAt(event);
  const { x, y } = point;
  const site = siteAt(map, x, y);
  if (site !== hoveredSite) {
    hoveredSite = site;
    inspect(site ? point : selected);
  }
  const next = regionAt(map, x, y);
  if (next === hovered) return;
  hovered = next;
  get('region').textContent = hovered?.name ?? '';
  draw();
});
canvas.addEventListener('pointerleave', () => {
  hovered = undefined;
  hoveredSite = undefined;
  get('region').textContent = '';
  inspect();
});
canvas.addEventListener('click', (event) => {
  const point = pointAt(event);
  if (!contains(point.x, point.y, map)) return;
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
      ({ map, lore, travel, favored } = data);
      party = data.party;
      selected = data.party ?? map.sites.find(site => site.id === 'frontier-town' || site.id === 'lake-stairs') ?? {x:0,y:0};
      hovered = hoveredSite = undefined;
      get('region').textContent = '';
      get('map-layers').hidden = !data.layer;
      for (const button of get('map-layers').querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.layer === data.layer));
      }
      partyIcon = new Path2D(data.partyIcon);
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
  } else if (map?.kind === 'town' && data?.type === 'campfire-atlas-party') {
    party = data.party;
    draw();
  }
});
