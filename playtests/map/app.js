import { fastestRoute, formatTravelDuration, isImpassableTerrain, isRoadBridge, isWaterway, sightRange, stepCost, terrainAt, terrainMovementHours, weatherStopsTorch } from "./movement.mjs";

const $ = id => document.getElementById(id);
const canvas = $("map");
const atlas = $("atlas");
const cellSize = MapRender.CELL;
const { keys, rememberStep, paintTrail, paintBanner, paintRoute, stepMs } = MapParty;
const trail = [];

let settings;
let visitor;
let selected;
let hovered;
let light;
let time = 0;
let route = null;
let timer;
const weatherKey = () => $("weather").value;
const favoredTerrains = () => settings.races.find(race => race.id === $("race").value)?.terrains ?? [];
const travelers = () => [{speed:settings.races.find(race => race.id === $("race").value)?.speed ?? 100,terrains:favoredTerrains()}];
const coords = cell => `X ${cell.x + 1} · Y ${cell.y + 1}`;
const equal = (a, b) => a.x === b.x && a.y === b.y;
const range = () => sightRange(settings.map, visitor, settings.weather, weatherKey(), light, time);
const visible = (cell, sight) => Math.max(Math.abs(cell.x-visitor.x), Math.abs(cell.y-visitor.y)) <= sight;
const restricted = cell => $("fog").checked && !visible(cell, range());

function revealTraveler(center = false) {
  const cellWidth = canvas.offsetWidth / settings.map.width;
  const x = canvas.offsetLeft + (visitor.x+.5)*cellWidth;
  const left = atlas.scrollLeft;
  if (center || x < left + cellWidth || x > left + atlas.clientWidth - cellWidth) {
    atlas.scrollLeft = x - atlas.clientWidth/2;
  }
}

function paint() {
  if (!settings) return;
  const { map } = settings;
  MapRender.render(canvas, map, {
    grid:$("grid").checked, labels:$("labels").checked,
    selected:restricted(selected) ? undefined : selected, hoveredRegion:hovered,
  });
  const ctx = canvas.getContext("2d");
  paintTrail(ctx,visitor,trail,cellSize);
  paintRoute(ctx,visitor,route?.steps,cellSize);
  if ($("fog").checked) {
    const sight = range();
    ctx.fillStyle = "#1a1814";
    for (let y=0; y<map.height; y++) for (let x=0; x<map.width; x++) {
      if (!visible({x,y},sight)) ctx.fillRect(x*cellSize,y*cellSize,cellSize,cellSize);
    }
  }
  paintBanner(ctx,visitor,cellSize);
}

function describe() {
  const { map, lore, travel } = settings;
  $("sight").textContent = `${range()} 格`;
  $("coordinates").textContent = coords(selected);
  const hidden = restricted(selected);
  const terrain = terrainAt(map, selected);
  const location = hidden ? undefined : MapModel.siteAt(map, selected.x, selected.y) ?? MapModel.regionAt(map, selected.x, selected.y);
  const name = travel.terrainNames[terrain] ?? MapData.tiles[terrain]?.name;
  const water = isWaterway(terrain);
  const road = !isImpassableTerrain(terrain) && terrain !== "shallows" && (!water || isRoadBridge(map,selected)) &&
    map.roads[MapModel.cellIndex(selected.x, selected.y)] && MapModel.roadMask(map, selected.x, selected.y);
  const favored = favoredTerrains();
  const hours = terrainMovementHours(travel, road ? "road" : terrain, travelers());
  const reason = water && !road ? "（乘船）" : road ? "（沿路）" : favored.includes(terrain) ? "（擅长）" : "";
  $("terrain").textContent = hidden ? "未看清" : name;
  $("movement").textContent = hidden ? "—" : hours === undefined ? "不可通行" : formatTravelDuration(hours) + reason;
  $("place").textContent = location?.name ?? (hidden ? "未探索" : name);
  $("lore").textContent = location ? lore[location.id] ?? "" : "";
  $("route-info").textContent = route?.steps.length ? formatTravelDuration(route.hours) : "—";
  $("stop").disabled = !timer;
  $("torch").disabled = weatherStopsTorch(weatherKey());
  $("extinguish").disabled = !light;
  const source = light?.kind === "torch" ? "火把" : "提灯";
  $("light").textContent = light ? `${source}剩余 ${formatTravelDuration(light.until-time)}` : "";
}

function draw() {
  if (!settings) return;
  paint();
  describe();
}

function walk(to) {
  const result = stepCost(settings.map, visitor, to, settings.travel, $("boat").checked, [], travelers());
  if (result.error) {
    $("notice").textContent = result.error;
    return null;
  }
  time += result.hours;
  const expired = light && light.until <= time;
  if (expired) light = undefined;
  rememberStep(trail,visitor,to);
  visitor = to;
  revealTraveler();
  $("notice").textContent = expired ? "光源燃尽" : "";
  return result;
}

function pauseTrip() {
  clearInterval(timer);
  timer = undefined;
}

function planRoute(cell) {
  pauseTrip();
  selected = cell;
  route = fastestRoute(settings.map, visitor, selected, settings.travel, $("boat").checked, [], travelers());
  $("notice").textContent = route ? "" : "没有可通行的路线";
  draw();
}

function followRoute() {
  if (!route?.steps.length || timer) return;
  $("notice").textContent = "正在沿路线行走";
  timer = setInterval(() => {
    const result = walk(route.steps[0]);
    if (!result) {
      pauseTrip();
      route = null;
    } else {
      route.steps.shift();
      route.hours -= result.hours;
      if (!route.steps.length) {
        pauseTrip();
        $("notice").textContent = $("notice").textContent ? "已抵达，光源燃尽" : "已抵达";
      }
    }
    draw();
  }, stepMs);
  draw();
}

function halt() {
  if (!timer) return;
  pauseTrip();
  $("notice").textContent = "已停止行走";
  draw();
}

function begin() {
  pauseTrip();
  route = null;
  trail.length = 0;
  const landmark = settings.map.sites.find(site => site.type === "frontier-town");
  visitor = selected = { x:landmark.x, y:landmark.y };
  hovered = undefined;
  $("notice").textContent = "";
  time = 0;
  light = undefined;
  draw();
  revealTraveler(true);
}

function startLight(kind) {
  if (!settings) return;
  if (kind === "torch" && weatherStopsTorch(weatherKey())) return;
  light = { kind, until:time + settings.lighting[kind]/60 };
  $("notice").textContent = "";
  draw();
}

function pointerCell(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x:Math.floor((event.clientX-rect.left)*settings.map.width/rect.width),
    y:Math.floor((event.clientY-rect.top)*settings.map.height/rect.height),
  };
}
canvas.addEventListener("click", event => {
  if (!settings) return;
  const cell = pointerCell(event);
  if (MapModel.contains(cell.x, cell.y, settings.map)) planRoute(cell);
});
canvas.addEventListener("dblclick", event => {
  if (!settings) return;
  const cell = pointerCell(event);
  if (equal(cell, selected)) followRoute();
});
canvas.addEventListener("pointermove", event => {
  if (!settings) return;
  const cell = pointerCell(event);
  const next = MapModel.contains(cell.x,cell.y,settings.map) && !restricted(cell) ? MapModel.regionAt(settings.map, cell.x, cell.y)?.id : undefined;
  if (next === hovered) return;
  hovered = next;
  paint();
});
canvas.addEventListener("pointerleave", () => {
  hovered = undefined;
  paint();
});
document.addEventListener("keydown", event => {
  if (!settings || event.ctrlKey || event.altKey || event.metaKey ||
      event.target.closest?.("input:not([type=checkbox]), select, textarea, [contenteditable]")) return;
  if (event.code === "Numpad5" || event.key === "Escape") {
    halt();
    return;
  }
  const step = keys[event.code];
  if (!step) return;
  event.preventDefault();
  pauseTrip();
  route = null;
  walk({ x:visitor.x+step[0], y:visitor.y+step[1] });
  selected = visitor;
  draw();
});
for (const key of ["grid","labels","fog","weather"]) $(key).addEventListener("change", draw);
$("fit-map").addEventListener("change", () => { if (settings) revealTraveler(true); });
window.addEventListener("resize", () => { if (settings) revealTraveler(); });
for (const key of ["boat", "race"]) $(key).addEventListener("change", () => { if (settings) planRoute(selected); });
$("stop").addEventListener("click", halt);
$("reset").addEventListener("click", () => { if (settings) begin(); });
$("torch").addEventListener("click", () => startLight("torch"));
$("lamp").addEventListener("click", () => startLight("lamp"));
$("extinguish").addEventListener("click", () => { light = undefined; draw(); });

window.addEventListener("message", async event => {
  if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== "campfire-map") return;
  try {
    await MapRender.ready;
    settings = event.data;
    canvas.width = settings.map.width * cellSize;
    canvas.height = settings.map.height * cellSize;
    document.documentElement.style.setProperty("--atlas-ratio", settings.map.width / settings.map.height);
    const options = Object.entries(settings.weather)
      .filter(([key]) => key.startsWith("weather/") && key.endsWith("/name"))
      .map(([key, value]) => new Option(value, key.split("/")[1]));
    $("weather").replaceChildren(...options);
    $("race").replaceChildren(...settings.races.map(race => new Option(race.name, race.id)));
    begin();
    canvas.focus({ preventScroll:true });
  } catch (error) {
    $("notice").textContent = error.message;
  }
});
