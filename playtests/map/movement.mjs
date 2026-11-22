const fieldForTerrain = {
  grass:"grass", field:"farmland", steppe:"steppe", forest:"wood", denseforest:"denseForest",
  hill:"hill", mountain:"mountain", marsh:"marsh", desert:"desert", saltflat:"saltFlat",
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
export const isRoadBridge = (map, {x,y}) => Boolean(map.roads[indexAt(map, x, y)] &&
  map.sites?.some(site => (site.type === "stone-bridge" || site.type === "mill-bridge") && site.x === x && site.y === y));
export const weatherStopsTorch = (weather) => torchBlocked.has(weather);

export function travelLevelFor(travel, terrain, favored = []) {
  if (isImpassableTerrain(terrain)) return undefined;
  const familiar = favored.includes(terrain);
  return travel.levels.find(level => familiar ? level.id === "easy" : level.terrains.includes(terrain));
}

export function stepCost(map, from, to, travel, boat = false, favored = []) {
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
  const sailing = isWaterway(terrain) && !(bridgeRoad && isRoadBridge(map, to));
  const leavingWater = isWaterway(terrainAt(map, from)) && !(bridgeRoad && isRoadBridge(map, from));
  if (!boat && (sailing || leavingWater)) return { error:"这里需要乘船" };
  if (!boat && diagonal && isWaterway(acrossX) && isWaterway(acrossY)) return { error:"这里需要走桥或浅滩" };
  const onRoad = !sailing && terrain !== "shallows" && connectedRoad;
  const level = travelLevelFor(travel, onRoad ? "road" : terrain, favored);
  return level ? { hours:level.hours, onRoad, terrain } : { error:"这里无法通行" };
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

export function fastestRoute(map, from, to, travel, boat = false, favored = []) {
  const route = findGridRoute(map,from,to,(here,next) =>
    stepCost(map,here,next,travel,boat,favored).hours ?? Infinity);
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
