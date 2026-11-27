const fieldForTerrain = {
  grass:"grass", field:"farmland", steppe:"steppe", forest:"wood", denseforest:"denseForest",
  hill:"hill", mountain:"mountain", marsh:"marsh", desert:"desert",
  stream:"stream", river:"river", water:"lake",
};
const torchBlocked = new Set(["lightRain","heavyRain","lightFog","heavyFog"]);

const onMap = (map, x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < map.width && y >= 0 && y < map.height;
const indexAt = (map, x, y) => y * map.width + x;
const cellAt = (map, index) => ({ x:index % map.width, y:Math.floor(index / map.width) });
const neighbors = [[0,-1], [1,0], [0,1], [-1,0], [1,-1], [1,1], [-1,1], [-1,-1]];
const surfaceAt = (map, cell) => map.terrain[indexAt(map, cell.x, cell.y)];
export const isWaterway = terrain => terrain === "stream" || terrain === "river" || terrain === "water";
export const isImpassableTerrain = terrain => terrain === "wall" || terrain === "lava";
export function terrainAt(map, at) {
  const terrain = surfaceAt(map, at);
  return isWaterway(terrain) && map.shallows?.some(([x,y]) => x === at.x && y === at.y) ? "shallows" : terrain;
}
function roadBridgeAt(map, {x,y}) {
  if (!map.roads[indexAt(map, x, y)]) return undefined;
  return map.sites?.find(site => (site.type === "stone-bridge" || site.type === "mill-bridge") && site.x === x && site.y === y);
}

export const isRoadBridge = (map, at) => Boolean(roadBridgeAt(map, at));

const bridgeEnds = { north: [0,-1], east: [1,0], south: [0,1], west: [-1,0] };

function meetsUnpavedBank(map, bridge, bank) {
  const direction = bridge && bridgeEnds[bridge.unpavedEnd];
  if (!direction || bank.x !== bridge.x + direction[0] || bank.y !== bridge.y + direction[1]) return false;
  const terrain = surfaceAt(map, bank);
  return !isWaterway(terrain) && !isImpassableTerrain(terrain);
}
export const weatherStopsTorch = (weather) => torchBlocked.has(weather);

export function travelLevelFor(travel, terrain) {
  if (isImpassableTerrain(terrain)) return undefined;
  return travel.levels.find(level => level.terrains.includes(terrain));
}

export function movementHours(cost, terrain, travelers = []) {
  const hours = travelers.length
    ? Math.max(...travelers.map(({speed,terrains}) => cost / speed * (terrains.includes(terrain) ? .5 : 1)))
    : cost / 100;
  return Math.max(1,Math.round(hours * 60)) / 60;
}

export function terrainMovementHours(travel, terrain, travelers) {
  const level = travelLevelFor(travel, terrain);
  const cost = travel.costs?.[terrain] ?? (level && level.hours * 100);
  return cost === undefined ? undefined : movementHours(cost, terrain, travelers);
}

export function formatTravelDuration(hours) {
  const minutes = Math.round(hours * 60);
  const days = Math.floor(minutes / 1440);
  const wholeHours = Math.floor(minutes % 1440 / 60);
  const rest = minutes % 60;
  return [days && days + " 天", wholeHours && wholeHours + " 小时", rest && rest + " 分钟"].filter(Boolean).join(" ") || "0 分钟";
}

export function stepCost(map, from, to, travel, boat = false, favored = [], travelers = [{speed:100,terrains:favored}]) {
  if (!onMap(map,from.x,from.y) || !onMap(map,to.x,to.y)) return { error:"已到地图边缘" };
  const dx = Math.abs(to.x-from.x);
  const dy = Math.abs(to.y-from.y);
  if (dx > 1 || dy > 1 || dx+dy === 0) return { error:"每次移动一格" };
  const roadAt = (x, y) => map.roads[indexAt(map, x, y)];
  const diagonal = dx && dy;
  const terrain = terrainAt(map, to);
  const acrossX = surfaceAt(map,{x:to.x,y:from.y});
  const acrossY = surfaceAt(map,{x:from.x,y:to.y});
  const barrier = isImpassableTerrain(terrain) ? terrain
    : diagonal && [acrossX, acrossY].find(isImpassableTerrain);
  if (barrier === "lava") return { error:"岩浆挡路" };
  if (barrier === "wall") {
    return { error:map.kind === "underground" ? "岩壁挡路" : "城墙挡路" };
  }
  const connectedRoad = Boolean(roadAt(from.x, from.y) && roadAt(to.x, to.y) &&
    (!diagonal || roadAt(from.x, to.y) || roadAt(to.x, from.y)));
  const bridgeRoad = connectedRoad && !diagonal;
  const toBridge = !diagonal && isWaterway(terrain) ? roadBridgeAt(map, to) : undefined;
  const fromWater = isWaterway(terrainAt(map, from));
  const fromBridge = !diagonal && fromWater ? roadBridgeAt(map, from) : undefined;
  const sailing = isWaterway(terrain) && !(toBridge && (bridgeRoad || meetsUnpavedBank(map, toBridge, from)));
  const leavingWater = fromWater && !(fromBridge && (bridgeRoad || meetsUnpavedBank(map, fromBridge, to)));
  if (!boat && (sailing || leavingWater)) return { error:"这里需要乘船" };
  if (!boat && diagonal && isWaterway(acrossX) && isWaterway(acrossY)) return { error:"这里需要走桥或浅滩" };
  const onRoad = !sailing && terrain !== "shallows" && (connectedRoad || !!toBridge);
  const hours = terrainMovementHours(travel, onRoad ? "road" : terrain, travelers);
  return hours === undefined ? { error:"这里无法通行" } : { hours, onRoad, terrain };
}

export function townBarrierAt(map, {x,y}) {
  if (!onMap(map,x,y)) return "wall";
  const terrain = surfaceAt(map,{x,y});
  if (isImpassableTerrain(terrain)) return "wall";
  if (isWaterway(terrain)) return "water";
  const arena = map.regions.find(region => region.id === "town-arena");
  if (!arena) return undefined;
  const [left,top,right,bottom] = arena.bounds;
  if (x < left || x > right || y < top || y > bottom) return undefined;
  const entrance = y === bottom && x === Math.floor((left+right)/2);
  if (!entrance && (x === left || x === right || y === top || y === bottom)) return "wall";
}

export function townStep(map, {x,y}, dx, dy) {
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.max(Math.abs(dx),Math.abs(dy)) !== 1) return undefined;
  const next = {x:x+dx,y:y+dy};
  if (townBarrierAt(map,next)) return undefined;
  if (dx && dy && (townBarrierAt(map,{x:next.x,y}) || townBarrierAt(map,{x,y:next.y}))) return undefined;
  return next;
}

export function fastestRoute(map, from, to, travel, boat = false, favored = [], travelers) {
  const route = findGridRoute(map,from,to,(here,next) =>
    stepCost(map,here,next,travel,boat,favored,travelers).hours ?? Infinity);
  return route && { steps:route.steps, hours:route.cost };
}

export function findLocalRoute(map, from, to, canStep) {
  return findGridRoute(map,from,to,(here,next) => {
    if (!canStep(here,next)) return Infinity;
    const weight = map.roads[indexAt(map,next.x,next.y)] ? 2 : 1;
    return 1/weight;
  });
}

export function findGridRoute(map, from, to, costForStep) {
  if (!onMap(map, from.x, from.y) || !onMap(map, to.x, to.y)) return null;
  const start = indexAt(map, from.x, from.y);
  const goal = indexAt(map, to.x, to.y);
  const costs = Array(map.width * map.height).fill(Infinity);
  const previous = [];
  const pending = new Set([start]);
  costs[start] = 0;

  while (pending.size) {
    let current = -1;
    for (const index of pending) {
      if (current === -1 || costs[index] < costs[current]) current = index;
    }
    if (current === goal) {
      const steps = [];
      for (let index = goal; index !== start; index = previous[index]) steps.push(cellAt(map, index));
      return { steps:steps.reverse(), cost:costs[goal] };
    }
    pending.delete(current);
    const here = cellAt(map, current);
    for (const [dx, dy] of neighbors) {
      const next = { x:here.x+dx, y:here.y+dy };
      const step = costForStep(here,next);
      if (!Number.isFinite(step)) continue;
      const index = indexAt(map, next.x, next.y);
      const cost = costs[current] + step;
      if (cost >= costs[index]) continue;
      costs[index] = cost;
      previous[index] = current;
      pending.add(index);
    }
  }
  return null;
}

export function sightRange(map, cell, weatherRules, weather, light, time) {
  const lit = light && light.until > time && (light.kind !== "torch" || !weatherStopsTorch(weather));
  if (weather === "darkness") return lit ? 1 : 0;
  const scene = fieldForTerrain[surfaceAt(map, cell)];
  return Math.min(weatherRules[`weather/${weather}/sight`], weatherRules[`terrain/${scene}/sight`]);
}
