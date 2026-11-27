import { catalog } from "./battle.mjs";
import { createBattleSession } from "./session.mjs";
import defaultMounts from "../../data/rules/mounts.json" with { type: "json" };

const weatherIds = ["clear", "cloudy", "lightRain", "heavyRain", "lightFog", "heavyFog", "wind", "lightSnow", "heavySnow", "darkness"];
const terrainIds = ["grass", "farmland", "wood", "denseForest", "hill", "mountain", "snowMountain", "stream", "river", "lake", "marsh", "steppe", "desert", "village", "mine", "cave"];
const weaponFields = {
  range:"range", damage:"damage", penetration:"penetration", headBonus:"head_bonus",
  armorBonus:"armor_bonus", shieldBonus:"shield_bonus", largeBonus:"large_bonus", initiative:"initiative",
};

function weaponUpdates(rule) {
  return Object.fromEntries(Object.entries(weaponFields).filter(([,key]) => rule[key] !== undefined)
    .map(([field,key]) => [field,rule[key]]));
}

function equipWeapon(piece, fallback) {
  if (!piece) return catalog.weapons[fallback];
  const base = catalog.weapons[piece.base] ?? catalog.weapons[fallback];
  const weapon = {...base,...weaponUpdates(piece.rule ?? {}),name:piece.name};
  if (!["短","长","远程"].includes(weapon.range) || weapon.damage === undefined) return undefined;
  return {...weapon,baseName:piece.base,twoHanded:piece.twoHanded,magic:base?.magic ?? piece.base === "法杖",penetration:weapon.penetration ?? 0,campaignGear:true};
}

function equipArmor(piece, shield = false) {
  if (!piece) return undefined;
  const base = catalog.armor[piece.base];
  const {durability = base?.durability, attribute_cap = base?.attributeCap, block_bonus, initiative = base?.initiative} = piece.rule ?? {};
  const blockBonus = block_bonus === undefined ? base?.blockBonus : block_bonus * 100;
  if (durability === undefined || (shield && blockBonus === undefined && !piece.rule?.category.includes("盾"))) return undefined;
  return {name:piece.name,impactKind:piece.impactKind,durability,current:piece.current,attributeCap:attribute_cap,blockBonus,initiative,campaignGear:true};
}

export function battleParticipantGear(unit) {
  if (unit.monster) return unit;
  const itemFor = item => {
    if (!item?.swap) return item;
    const {slot,gear} = item.swap;
    return {...item,swap:{slot,gear:slot === "main_hand" ? equipWeapon(gear) : equipArmor(gear,true)}};
  };
  return {
    ...unit,
    weapon:equipWeapon(unit.weapon,unit.weaponBase),
    head:equipArmor(unit.head),
    body:equipArmor(unit.body),
    shield:equipArmor(unit.shield,true),
    items:unit.items?.map(itemFor),
    handItems:Object.fromEntries(Object.entries(unit.handItems ?? {}).map(([slot,item])=>[slot,itemFor(item)])),
  };
}

export function applyBattleCatalog(weather, gear, mounts = defaultMounts, player, roster, encounterWeather, allies = [], ammo, partyMemberIds, enemies, encounter) {
  catalog.mounts = mounts;
  for (const [name,rule] of Object.entries(gear)) {
    if (rule?.weight_kg !== undefined) catalog.gearWeights[name] = rule.weight_kg;
  }
  battleSession.updateRoster(roster);
  for (const [i, item] of catalog.weather.entries()) {
    const key = `weather/${weatherIds[i]}`;
    item.name = weather[`${key}/name`];
    item.rangedHit = weather[`${key}/ranged`];
    item.magicHit = weather[`${key}/magic`];
  }
  for (const [i, item] of catalog.terrain.entries()) {
    const key = `terrain/${terrainIds[i]}`;
    item.name = weather[`${key}/name`];
    const rows = Math.max(1, Math.min(5, Math.round(weather[`${key}/lanes`])));
    item.front = item.back = rows;
    const values = Object.fromEntries(catalog.weather.map((condition, index) => [
      condition.id, weather[`${key}/${weatherIds[index]}`],
    ]));
    if (item.indoors) item.weatherWeights = { darkness: 100 };
    else if (Math.abs(Object.values(values).reduce((sum, value) => sum + value, 0) - 100) < 0.0001) item.weatherWeights = values;
  }
  for (const [name, weapon] of Object.entries(catalog.weapons)) {
    const rule = gear[name];
    if (!rule) continue;
    Object.assign(weapon,{largeBonus:0},weaponUpdates(rule));
  }
  for (const [name, armor] of Object.entries(catalog.armor)) {
    const rule = gear[name];
    if (!rule) continue;
    if (rule.durability !== undefined) armor.durability = rule.durability;
    if (rule.initiative !== undefined) armor.initiative = rule.initiative;
    if (rule.attribute_cap === undefined) delete armor.attributeCap;
    else armor.attributeCap = rule.attribute_cap;
    if (rule.block_bonus !== undefined) armor.blockBonus = rule.block_bonus * 100;
  }
  if (player) {
    battleSession.beginEncounter(battleParticipantGear(player),encounterWeather,allies.map(battleParticipantGear),ammo,partyMemberIds,enemies?.map(battleParticipantGear),encounter);
  } else if (battleSession.snapshot().phase === "setup") battleSession.submit({ type: "reset" });
}

export const battleSession = createBattleSession();

if (typeof window !== "undefined") {
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== "campfire-battle") return;
    const { weather, gear, mounts, player, roster, encounterWeather, allies, ammo, partyMemberIds, enemies, encounter } = event.data;
    applyBattleCatalog(weather, gear, mounts, player, roster, encounterWeather, allies, ammo, partyMemberIds, enemies, encounter);
  });
}
