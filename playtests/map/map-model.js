(function () {
  'use strict';

  const WIDTH = 32;
  const HEIGHT = 21;
  const TERRAINS = ['grass', 'forest', 'denseforest', 'hill', 'mountain', 'field', 'stream', 'river', 'water',
    'marsh', 'steppe', 'desert', 'saltflat', 'yard', 'cobble', 'bank', 'wall', 'vegetables', 'flowergarden', 'underground', 'lava'];
  const isWater = (terrain) => terrain === 'stream' || terrain === 'river' || terrain === 'water';
  const DIRECTIONS = { north: 1, east: 2, south: 4, west: 8 };

  function contains(x, y, map) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < WIDTH && y < (map?.height ?? HEIGHT);
  }

  function cellIndex(x, y) {
    return y * WIDTH + x;
  }

  function createMap(height = HEIGHT) {
    return {
      width: WIDTH,
      height,
      terrain: Array(WIDTH * height).fill('grass'),
      roads: Array(WIDTH * height).fill(false),
      sites: [],
      regions: []
    };
  }

  function withinRegionBounds(region, x, y) {
    const [left, top, right, bottom] = region.bounds;
    return x >= left && x <= right && y >= top && y <= bottom;
  }

  function cellInRegion(region, x, y, terrain) {
    return (withinRegionBounds(region, x, y) && region.terrains.includes(terrain)) ||
      includesCell(region, x, y);
  }

  function includesCell(region, x, y) {
    return region.includedCells?.some(([col, row]) => x === col && y === row);
  }

  function townStreet(map, region, x, y) {
    return map.kind === 'town' && !region.terrains.length && map.roads[cellIndex(x, y)];
  }

  function regionAt(map, x, y) {
    if (!contains(x, y, map)) return undefined;
    const terrain = map.terrain[cellIndex(x, y)];
    return map.regions.find((region) => !townStreet(map, region, x, y) && cellInRegion(region, x, y, terrain));
  }

  function regionHoverCells(map, id) {
    const region = map.regions.find((area) => area.id === id);
    if (!region) return [];
    const cells = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (includesCell(region, x, y) && !townStreet(map, region, x, y)) {
          cells.push({ x, y });
          continue;
        }
        if (!withinRegionBounds(region, x, y)) continue;
        const match = regionAt(map, x, y);
        if (match && (match.id === id || match.id === region.overlapRegionId)) cells.push({ x, y });
      }
    }
    return cells;
  }

  function siteAt(map, x, y) {
    return map.sites.find((site) => x >= site.x && y >= site.y && x < site.x + site.width && y < site.y + site.height);
  }

  function canPlace(map, x, y, movingId, width = 1, height = 1) {
    if (![1, 2].includes(width) || ![1, 2].includes(height) ||
      width * height > (map.kind === 'town' ? 2 : 1) ||
      !contains(x, y, map) || !contains(x + width - 1, y + height - 1, map)) return false;
    return !map.sites.some(site => site.id !== movingId && x < site.x + site.width &&
      x + width > site.x && y < site.y + site.height && y + height > site.y);
  }

  function placeSite(map, type, x, y, id, name = type, description, width = 1, height = 1) {
    if (!canPlace(map, x, y, undefined, width, height) || map.sites.some((site) => site.id === id)) return null;
    const site = { id, type, name, x, y, width, height };
    if (description !== undefined) site.description = description;
    map.sites.push(site);
    return site;
  }

  function moveSite(map, id, x, y) {
    const site = map.sites.find((item) => item.id === id);
    if (!site || !canPlace(map, x, y, id, site.width, site.height)) return false;
    site.x = x;
    site.y = y;
    return true;
  }

  function traceCells(start, end) {
    let { x, y } = start;
    const horizontal = Math.abs(end.x - x);
    const vertical = Math.abs(end.y - y);
    const stepX = Math.sign(end.x - x);
    const stepY = Math.sign(end.y - y);
    let walkedX = 0;
    let walkedY = 0;
    const result = [{ x, y }];
    while (walkedX < horizontal || walkedY < vertical) {
      if (walkedX < horizontal && (
        walkedY === vertical || (2 * walkedX + 1) * vertical <= (2 * walkedY + 1) * horizontal
      )) {
        x += stepX;
        walkedX++;
      } else {
        y += stepY;
        walkedY++;
      }
      result.push({ x, y });
    }
    return result;
  }

  function roadMask(map, x, y) {
    const hasRoad = (col, row) => contains(col, row, map) && map.roads[cellIndex(col, row)];
    return (
      (hasRoad(x, y - 1) ? DIRECTIONS.north : 0) |
      (hasRoad(x + 1, y) ? DIRECTIONS.east : 0) |
      (hasRoad(x, y + 1) ? DIRECTIONS.south : 0) |
      (hasRoad(x - 1, y) ? DIRECTIONS.west : 0)
    );
  }

  function validateMap(input, knownTypes) {
    const validDescription = (value) => value === undefined ||
      (typeof value === 'string' && value.trim() && value.length <= 600);
    if (!input || input.width !== WIDTH || !Number.isInteger(input.height) || input.height < 1 || input.height > 24) {
      throw new Error('地图需要 32 列，行数为 1 到 24。');
    }
    const expectedSize = WIDTH * input.height;
    if (!Array.isArray(input.terrain) || input.terrain.length !== expectedSize ||
      !input.terrain.every((value) => TERRAINS.includes(value))) {
      throw new Error('地图地形数据不完整。');
    }
    if (!Array.isArray(input.roads) || input.roads.length !== expectedSize ||
      !input.roads.every((value) => typeof value === 'boolean') || !Array.isArray(input.sites)) {
      throw new Error('地图道路或地标数据不完整。');
    }
    const map = createMap(input.height);
    if (input.kind === 'town') {
      if (input.height !== HEIGHT) throw new Error('城镇小地图需要 32 列 × 21 行。');
      map.kind = input.kind;
    }
    if (input.kind === 'underground') map.kind = input.kind;
    map.terrain = [...input.terrain];
    map.roads = [...input.roads];
    if (input.shallows !== undefined) {
      if (!Array.isArray(input.shallows) || input.shallows.length > expectedSize ||
        !input.shallows.every((cell) => Array.isArray(cell) && cell.length === 2 &&
          contains(...cell, map) && isWater(map.terrain[cellIndex(...cell)]))) {
        throw new Error('浅滩必须标在溪流、河流或湖泊的格子里。');
      }
      if (input.shallows.length) map.shallows = input.shallows.map((cell) => [...cell]);
    }
    for (const site of input.sites) {
      if (!site || typeof site.id !== 'string' || !site.id.trim() || site.id.length > 96 ||
        typeof site.type !== 'string' || !site.type.trim() || (knownTypes && !knownTypes.has(site.type)) ||
        typeof site.name !== 'string' || !site.name.trim() || site.name.length > 36 ||
        !Number.isInteger(site.width) || !Number.isInteger(site.height) || !validDescription(site.description) ||
        !placeSite(map, site.type, site.x, site.y, site.id, site.name, site.description, site.width, site.height)) {
        throw new Error('地标无效、重叠或超出地图。');
      }
      if (site.residents !== undefined) {
        if (!Array.isArray(site.residents) || !site.residents.every(id => typeof id === 'string' && /^[a-z][a-zA-Z]*$/.test(id))) {
          throw new Error('常住种族数据无效。');
        }
        map.sites.at(-1).residents = [...new Set(site.residents)];
      }
    }
    if (input.regions !== undefined) {
      if (!Array.isArray(input.regions) || input.regions.length > expectedSize) throw new Error('地图区域数据无效。');
      for (const region of input.regions) {
        if (!region || typeof region.name !== 'string' || !region.name.trim() || region.name.length > 36 ||
            typeof region.id !== 'string' || !region.id.trim() || region.id.length > 96 ||
            map.regions.some((area) => area.id === region.id) ||
            !Array.isArray(region.bounds) || region.bounds.length !== 4 ||
            !Array.isArray(region.terrains) || (!region.terrains.length && !region.includedCells?.length) ||
            !validDescription(region.description) ||
            !region.terrains.every((terrain) => TERRAINS.includes(terrain))) {
          throw new Error('地图区域数据无效。');
        }
        const [left, top, right, bottom] = region.bounds;
        if (!contains(left, top, map) || !contains(right, bottom, map) || left > right || top > bottom ||
            (region.includedCells !== undefined && (!Array.isArray(region.includedCells) ||
              region.includedCells.length > expectedSize || !region.includedCells.every((cell) =>
                Array.isArray(cell) && cell.length === 2 && contains(...cell, map)))) ||
            (region.label !== undefined && (!Array.isArray(region.label) || region.label.length !== 2 ||
              !contains(...region.label, map) || !cellInRegion(region, ...region.label, region.terrains[0])))) {
          throw new Error('地图区域边界或地名坐标无效。');
        }
        const area = { id: region.id, name: region.name, bounds: [...region.bounds], terrains: [...region.terrains] };
        if (region.label) area.label = [...region.label];
        if (region.includedCells) area.includedCells = region.includedCells.map((cell) => [...cell]);
        if (region.description !== undefined) area.description = region.description;
        if (region.overlapRegionId !== undefined) {
          if (typeof region.overlapRegionId !== 'string' || region.overlapRegionId === area.id) {
            throw new Error('地图区域重叠范围无效。');
          }
          area.overlapRegionId = region.overlapRegionId;
        }
        map.regions.push(area);
      }
      for (const area of map.regions) {
        if (area.overlapRegionId !== undefined && !map.regions.some(({ id }) => id === area.overlapRegionId)) {
          throw new Error('地图区域重叠范围无效。');
        }
      }
    }
    return map;
  }

  function exportMap(map) {
    return JSON.stringify({
      version: 1,
      coordinateBase: 1,
      width: WIDTH,
      height: map.height,
      kind: map.kind,
      terrain: map.terrain,
      roads: map.roads,
      shallows: map.shallows?.map((cell) => cell.map((coordinate) => coordinate + 1)),
      sites: map.sites.map((site) => ({ ...site, x: site.x + 1, y: site.y + 1 })),
      regions: map.regions.map((region) => ({
        ...region, bounds: region.bounds.map((coordinate) => coordinate + 1),
        label: region.label?.map((coordinate) => coordinate + 1),
        includedCells: region.includedCells?.map((cell) => cell.map((coordinate) => coordinate + 1))
      }))
    }, null, 2);
  }

  function importMap(json, knownTypes) {
    const input = JSON.parse(json);
    if (!input || input.version !== 1 || input.coordinateBase !== 1 || !Array.isArray(input.sites)) {
      throw new Error('请选择本编辑器导出的地图 JSON。');
    }
    return validateMap({
      ...input,
      shallows: Array.isArray(input.shallows) ? input.shallows.map((cell) => (
        Array.isArray(cell) ? cell.map((coordinate) => Number.isInteger(coordinate) ? coordinate - 1 : NaN) : cell
      )) : input.shallows,
      regions: Array.isArray(input.regions) ? input.regions.map((region) => (
        region && {
          ...region,
          bounds: Array.isArray(region.bounds) ? region.bounds.map((coordinate) => Number.isInteger(coordinate) ? coordinate - 1 : NaN) : region.bounds,
          label: Array.isArray(region.label) ? region.label.map((coordinate) => Number.isInteger(coordinate) ? coordinate - 1 : NaN) : region.label,
          includedCells: Array.isArray(region.includedCells) ? region.includedCells.map((cell) => (
            Array.isArray(cell) ? cell.map((coordinate) => Number.isInteger(coordinate) ? coordinate - 1 : NaN) : cell
          )) : region.includedCells
        }
      )) : input.regions,
      sites: input.sites.map((site) => {
        if (!site || !Number.isInteger(site.x) || !Number.isInteger(site.y)) return null;
        const cell = { ...site, x: site.x - 1, y: site.y - 1 };
        if (site.type === 'frontier-town' && site.width === 2 && site.height === 2 &&
            contains(cell.x, cell.y, input) && contains(cell.x + 1, cell.y + 1, input)) {
          cell.width = 1;
          cell.height = 1;
        }
        return cell;
      })
    }, knownTypes);
  }

  const model = {
    WIDTH, HEIGHT, TERRAINS, DIRECTIONS, contains, cellIndex, createMap, isWater, siteAt, regionAt, regionHoverCells,
    canPlace, placeSite, moveSite, traceCells, roadMask, validateMap, exportMap, importMap
  };
  if (typeof module === 'object' && module.exports) module.exports = model;
  else globalThis.MapModel = model;
}());
