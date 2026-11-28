import battleCatalog from "./catalog.json" with { type: "json" };
import allyPresets from "./ally-presets.json" with { type: "json" };
import defaultRosterProfiles from "./rosterProfiles.json" with { type: "json" };
import defaultMounts from "../../data/rules/mounts.json" with { type: "json" };
import basicWeapons from "../../data/rules/basic-weapons.json" with { type: "json" };
import { createDialogue } from "./dialogue.mjs";
import { battleItemCount, battleItemSlots, battleItemsBySlot, battleLoad, carryKgPerStrength } from "./loadout.mjs";
import { adjacent, fieldRanks, fieldSideOf, rankOf } from "./grid.mjs";
import { attributeBenchmark } from "./attributes.mjs";
import { canFight, heavyWoundRatio, isHeavilyWounded, moraleLimit,
  settleMorale, startMorale, whiteFlag } from "./morale.mjs";
import { activeStatusValues, attackerHitStatuses, battleStatusId, battleStatusNames, canCounter, cannotDefend,
  controlledStatus, defenderHitStatuses, dodgeStatuses, forcedStatus, hasStatus, initiativeStatuses, roundDamage,
  skippedStatus, sourceStatuses, typedDamage } from "./statuses.mjs";

export const catalog = structuredClone({
  ...battleCatalog,weapons:{...battleCatalog.weapons,徒手:basicWeapons.unarmed},mounts:defaultMounts,
});
const enemySkills = {
  measured_strike:{name:"稳扎一击",hit:15,weapon:true},
  aimed_shot:{name:"瞄准射击",hit:20,weapon:true},
  second_wind:{name:"回气",healRatio:.25},
};
const roster = [
  ...allyPresets,
  {id:"garrick", name:"加里克", role:"劫掠者", side:"enemy", weapon:"长柄刀", body:"皮甲", head:"链甲头罩", row:"front", skills:["measured_strike"],
    additionalGear:[{slot:"accessory",label:"首饰",name:"胸针"},{slot:"feet",label:"鞋子",name:"长靴"}]},
  {id:"bren", name:"布伦", role:"斧手", side:"enemy", weapon:"手斧", body:"棉甲", head:"鼻翼盔", shield:"小圆盾", row:"front", skills:["second_wind"],
    additionalGear:[{slot:"wrists",label:"手腕",name:"手套"},{slot:"belt",label:"腰带",name:"腰带"}]},
  {id:"oswin", name:"奥斯温", role:"弩手", side:"enemy", weapon:"弩", body:"布衣", head:"布帽", row:"back", skills:["aimed_shot"],
    additionalGear:[{slot:"legs",label:"下身",name:"长裤"},{slot:"feet",label:"鞋子",name:"系带鞋"}]},
  {id:"herman", name:"赫尔曼", role:"骑兵", side:"enemy", weapon:"矛", body:"链甲", head:"锅盔", row:"back", mount:"horse",
    additionalGear:[{slot:"wrists",label:"手腕",name:"手套"},{slot:"feet",label:"鞋子",name:"长靴"}]},
];
const available = (unit) => unit?.hp > 0 && !unit.arenaWithdrawn;
const sideUnits = (state, side) => state.units.filter((unit) => unit.side === side && available(unit));
const active = (unit) => available(unit) && (unit.row === "front" || unit.row === "back");
const occupancy = (state, side, row) => state.units.filter(unit=>available(unit) && fieldSideOf(unit)===side && unit.row===row);
const columnOrder = [0,1,-1,2,-2];
const lanes = columnOrder.toSorted((a,b)=>a-b);
const deploymentRows = ["front","back","reserve"];
export const formationColumns = (width) => columnOrder.slice(0,width);
const capacity = (state, row) => row === "reserve" ? Infinity :
  Math.min(state.terrain[row],state.fieldColumns.length);
export const formationCapacity = (state,width,row) =>
  row === "reserve" || width === state.fieldColumns.length ? capacity(state,row) : width;
const other = (side) => side === "player" ? "enemy" : "player";
const order = (a, b) => a.position - b.position;
const figure = (part) => {
  const gear = typeof part === "string" ? catalog.armor[part] : part;
  const max = Math.round(gear?.durability ?? 0);
  return {name:gear?.name ?? "无",impactKind:gear?.impactKind,max,current:Math.max(0,Math.min(max,gear?.current ?? max)),attributeCap:gear?.attributeCap,blockBonus:gear?.blockBonus,initiative:gear?.initiative,campaignGear:gear?.campaignGear};
};
function bodyFigure(primary, extra) {
  const body = figure(primary);
  const layers = Object.entries(extra ?? {}).map(([slot,piece])=>[slot,figure(piece)]).filter(([,piece])=>piece.max > 0);
  if (!layers.length) return body;
  return {...body,name:body.max ? body.name : "附加护具",
    max:body.max+layers.reduce((sum,[,piece])=>sum+piece.max,0),
    current:body.current+layers.reduce((sum,[,piece])=>sum+piece.current,0),
    layers:{body,...Object.fromEntries(layers)}};
}

const armorParts = ({armor,shield}) => [
  ["head",armor.head],...Object.entries(armor.body.layers ?? {body:armor.body}),["off_hand",shield],
];

export function armorDurability(unit, includeIntact = false) {
  return Object.fromEntries(armorParts(unit).filter(([,piece])=>piece?.max > 0 && (includeIntact || piece.current < piece.max))
    .map(([slot,piece])=>[slot,piece.current]));
}

function wearArmor(layer, amount) {
  layer.current -= amount;
  for (const piece of Object.values(layer.layers ?? {})) {
    if (!amount) break;
    const loss = Math.min(piece.current,amount);
    piece.current -= loss;
    amount -= loss;
  }
}

const attributeNames = ["strength","dexterity","constitution","intelligence","perception","charisma"];
const defaultAttribute = 8;
const baseAccuracy = 70;
const hitFloor = 5;
const hitCeiling = 95;
const baseHeadChance = 10;
const baseBlock = 10;
const bubbleDuration = 1000;
const moralePercent = (unit) => Math.max(-moraleLimit,unit.morale) * 5;
const strengthDamagePercent = (unit) => (unit.attributes.strength-attributeBenchmark) * 2;
const hasAttack = unit => !unit.monster || unit.monster.hit !== undefined || hasStatus(unit,"polymorph");
const damageUsesStrength = (unit) => !unit.monster && !unit.weapon.magic;
const isMeleeFighter = (unit) => active(unit) && canFight(unit) && !skippedStatus(unit) &&
  hasAttack(unit) && attackSource(unit).weapon.range !== "远程";

function attackSource(unit) {
  if (!hasStatus(unit,"disarmed") && !hasStatus(unit,"polymorph")) return unit;
  const weapon = {headBonus:0,armorBonus:0,shieldBonus:0,...catalog.weapons.徒手};
  const source = {...unit,weapon};
  source.damage = damageUsesStrength(source) ? Math.round(weapon.damage*(100+strengthDamagePercent(source))/100) : weapon.damage;
  return source;
}

export function effectiveAttribute(unit,attribute) {
  const raw = unit.attributes[attribute];
  if (attribute !== "dexterity" && attribute !== "intelligence") return raw;
  const cap = Math.min(...Object.values(unit.armor).map(gear=>gear.attributeCap ?? Infinity));
  return Math.min(raw,attributeBenchmark+cap);
}

function initiativeParts(unit) {
  const statuses = activeStatusValues(unit,initiativeStatuses);
  if (unit.monster) return [["怪物先攻",unit.monster.initiative ?? 0,true],...statuses];
  const dexterity = effectiveAttribute(unit,"dexterity");
  const equipment = [["主手",unit.weapon],["头盔",unit.armor.head],["护甲",unit.armor.body],["盾牌",unit.shield]];
  return [
    ["敏捷（" + dexterity + " − " + attributeBenchmark + "）",dexterity - attributeBenchmark,true],
    ...equipment.filter(([,gear])=>gear?.initiative).map(([slot,gear])=>[slot + " · " + gear.name,gear.initiative]),
    ...statuses,
  ];
}

function updateHandStats(unit) {
  updateInitiative(unit);
  unit.damage = damageUsesStrength(unit) ?
    Math.round(unit.weapon.damage * (100 + strengthDamagePercent(unit)) / 100) : unit.weapon.damage;
}

function updateInitiative(unit) {
  unit.initiative = initiativeParts(unit).reduce((total,[,amount])=>total+amount,0);
}

function applyStartingAttributes(unit) {
  const {constitution,charisma} = unit.attributes;
  updateHandStats(unit);
  unit.maxHp = constitution * 10;
  unit.hp = unit.maxHp;
  unit.maxMagic = effectiveAttribute(unit,"intelligence") * 5;
  unit.magic = unit.profession === "法师" ? {current:unit.maxMagic,max:unit.maxMagic} : null;
  unit.discount = (charisma - attributeBenchmark) * 2;
}

function updateStamina(unit) {
  const {maximum,remaining} = unit.load ?? {};
  const freeLoadRatio = maximum > 0 ? Math.max(0,Math.min(1,remaining/maximum)) : 0;
  const max = Math.max(0,Math.round(unit.attributes.constitution*10*freeLoadRatio));
  const spent = unit.stamina ? unit.stamina.max-unit.stamina.current : 0;
  unit.stamina = {current:Math.max(0,max-spent),max};
}

export function replaceBattleEquipment(unit, gear) {
  unit.weapon = {headBonus:0,armorBonus:0,shieldBonus:0,...(gear.weapon ?? catalog.weapons.徒手)};
  unit.armor = {head:figure(gear.head),body:bodyFigure(gear.body,gear.extraBodyArmor)};
  unit.shield = gear.shield ? figure(gear.shield) : null;
  unit.load = gear.load;
  unit.items = gear.items ?? [];
  unit.handItems = gear.handItems;
  unit.lockedHands = gear.lockedHands;
  unit.additionalGear = gear.additionalGear;
  unit.profileResistances = gear.profileResistances;
  unit.resistances = gear.resistances ?? unit.resistances;
  if (gear.updateAttributes) {
    unit.attributes = gear.attributes;
    unit.attributeSources = gear.attributeSources;
  }
  updateHandStats(unit);
  unit.maxMagic = effectiveAttribute(unit,"intelligence") * 5;
  if (unit.magic) unit.magic = {current:Math.min(unit.magic.current,unit.maxMagic),max:unit.maxMagic};
  updateStamina(unit);
}

function alignSetupRow(state, side, row) {
  occupancy(state,side,row).sort(order).forEach((unit,index) => {
    unit.column = row === "reserve" ? null : state.fieldColumns[index];
  });
}

function vacantColumns(state,side,row) {
  const used = new Set(occupancy(state,side,row).map(unit=>unit.column));
  return state.fieldColumns.slice(0,capacity(state,row)).filter(column=>!used.has(column));
}

export function openColumn(state,side,row) {
  return vacantColumns(state,side,row)[0] ?? null;
}

function controllers(state,actor) {
  return sideUnits(state,other(actor.side)).filter(isMeleeFighter);
}

export function retreatProblem(state,actor) {
  if (!active(actor)) return "";
  if (hasStatus(actor,"restrained")) return "束缚期间无法移动或撤退。";
  const forced = forcedStatus(actor);
  if (forced) return battleStatusNames[forced]+"期间无法撤退。";
  return controlProblem(state,actor);
}

function controlProblem(state,actor) {
  if (actor.monster?.fly || hasStatus(actor,"smoke")) return "";
  const opponent = controllers(state,actor).find(unit=>adjacent(actor,unit));
  return opponent ? "位于"+opponent.name+"的控制区内，无法移动或撤退。" : "";
}

export function movementOptions(state,actor,includePath = false) {
  if (!active(actor) || !canFight(actor) || skippedStatus(actor)) return {destinations:[],blockedReason:"该角色目前无法移动。"};
  const prevent = controlledStatus(actor) ?? (hasStatus(actor,"restrained") ? "restrained" : undefined);
  if (prevent) return {destinations:[],blockedReason:battleStatusNames[prevent]+"期间无法移动。"};
  if (actor.moved) return {destinations:[],blockedReason:"该角色本次行动已经移动，仍可攻击或采取其他行动。"};
  const blockedReason = controlProblem(state,actor);
  if (blockedReason) return {destinations:[],blockedReason};
  const enemies = actor.monster?.fly || hasStatus(actor,"smoke") ? [] : controllers(state,actor);
  const occupied = new Set(state.units.filter(active).map(unit=>rankOf(unit)+":"+unit.column));
  const destinations = [];
  const speed = actor.mount?.current > 0 && !hasStatus(actor,"polymorph") ? actor.mount.speed : actor.monster?.speed ?? actor.speed ?? 1;
  const maxSteps = Math.max(0,speed - Number(hasStatus(actor,"slow")));
  if (!maxSteps) return {destinations,blockedReason:"移动范围为 0 格。"};
  let frontier = [{rank:rankOf(actor),column:actor.column,path:[]}];
  for (let step=0; step<maxSteps && frontier.length; step++) {
    const next = [];
    for (const origin of frontier) {
      for (let rank=origin.rank-1; rank<=origin.rank+1; rank++) {
        const line = fieldRanks[rank];
        if (!line) continue;
        for (const column of state.fieldColumns.slice(0,capacity(state,line.row))) {
          const key = rank+":"+column;
          if (Math.abs(column-origin.column)>1 || occupied.has(key)) continue;
          occupied.add(key);
          const position = {...line,column};
          const controlled = enemies.some(enemy=>adjacent(position,enemy));
          const path = includePath ? [...origin.path,position] : origin.path;
          destinations.push({...position,controlled,...(includePath ? {path} : {})});
          if (!controlled) next.push({rank,column,path});
        }
      }
    }
    frontier = next;
  }
  return {destinations,blockedReason:destinations.length ? "" : "移动范围内没有可通行的空格。"};
}

const sameSpot = (a,b) => fieldSideOf(a) === fieldSideOf(b) && a.row === b.row && a.column === b.column;

export function note(state, text, kind = "info", speaker = "", detail) {
  const at = kind === "speech" ? detail.startsAt : Date.now();
  state.log.push({id:++state.serial, text, kind, speaker, detail, at});
}

const sourceFor = (state,unit,id) => state.units.find(source=>source.id===unit.statusSources?.[id] && active(source));
const orthogonal = (a,b) => Math.abs(rankOf(a)-rankOf(b)) + Math.abs(a.column-b.column) === 1;
export const controllingSide = (state,unit) => sourceFor(state,unit,"charmed")?.side ?? unit.side;

function endStatus(state,unit,id) {
  if (!hasStatus(unit,id)) return;
  delete unit.statuses[id];
  delete unit.statusSources[id];
  delete unit.statusGrace[id];
  delete unit.stances[id];
  if (id === "sleep") endStatus(state,unit,"nightmare");
  if (id === "haste" || id === "staggered") updateInitiative(unit);
  if (id !== "swallowed" || !unit.swallowedPosition) return;
  const position = unit.swallowedPosition;
  delete unit.swallowedPosition;
  if (!available(unit)) return;
  if (!state.units.some(other=>active(other) && sameSpot(position,other))) Object.assign(unit,position);
  else Object.assign(unit,{row:"reserve",fieldSide:unit.side,column:null});
  note(state,unit.name + (active(unit) ? "回到原阵位。" : "回到预备队。"),"status","",{actorId:unit.id});
}

export function applyBattleStatus(state,unit,name,turns,source) {
  const id = battleStatusId(name);
  if (!id || !Number.isSafeInteger(turns) || turns <= 0 || !available(unit) ||
      (id === "surprised" && state.round !== 1) || (id === "stunned" && hasStatus(unit,"unyielding")) ||
      (["poisoned","venom"].includes(id) && hasStatus(unit,"poisonImmunity")) ||
      (id === "nightmare" && !hasStatus(unit,"sleep")) ||
      (id === "stealth" && hasStatus(unit,"marked"))) return false;
  if (sourceStatuses.has(id)) {
    if (!source || source === unit || !active(source)) return false;
    if (id !== "painLink" && (source.side === unit.side) !== (id === "cover")) return false;
    unit.statusSources[id] = source.id;
  } else if (source && source !== unit && Object.hasOwn(roundDamage,id)) unit.statusSources[id] = source.id;
  if (id === "swallowed" && !hasStatus(unit,id)) {
    if (!active(unit)) return false;
    const {fieldSide,row,column} = unit;
    unit.swallowedPosition = {fieldSide,row,column};
    Object.assign(unit,{row:"swallowed",column:null});
    clearDepartedSources(state,unit);
  }
  unit.statuses[id] = Math.max(unit.statuses[id] ?? 0,id === "surprised" ? 1 : turns);
  if (unit.acted && !Object.hasOwn(roundDamage,id) && !["fear","corrosion","regeneration","surprised"].includes(id))
    unit.statusGrace[id] = state.round;
  if (id === "poisonImmunity") {
    endStatus(state,unit,"poisoned");
    endStatus(state,unit,"venom");
  }
  if (id === "marked") endStatus(state,unit,"stealth");
  if (id === "haste" || id === "staggered") updateInitiative(unit);
  return true;
}

export function forceBattleMove(state,unit,destination) {
  if (!active(unit) || hasStatus(unit,"unyielding") ||
      !fieldRanks.some(line=>line.fieldSide===destination.fieldSide && line.row===destination.row) ||
      !vacantColumns(state,destination.fieldSide,destination.row).includes(destination.column)) return false;
  Object.assign(unit,{fieldSide:destination.fieldSide,row:destination.row,column:destination.column});
  return true;
}

function clearDepartedSources(state,unit) {
  for (const target of state.units) {
    for (const [id,source] of Object.entries(target.statusSources)) {
      if (id === "painLink" && unit.row === "swallowed" && available(unit)) continue;
      if (sourceStatuses.has(id) && (source === unit.id || (target === unit && id === "painLink"))) endStatus(state,target,id);
    }
  }
}

function recordMorale(state,event) {
  settleMorale(state,event,(unit,reason,previous)=>{
    const {morale} = unit;
    const delta = morale-previous;
    const change = (delta > 0 ? "+" : "") + delta;
    const result = morale === whiteFlag ? "举起白旗" : previous === whiteFlag ? "恢复战斗意志" :
      "现为" + (morale > 0 ? "+" : "") + morale;
    note(state,unit.name + reason + "，士气 " + change + "，" + result + "。","morale","",{actorId:unit.id});
  },unit=>{
    endStatus(state,unit,"resolve");
    note(state,unit.name + "因坚定少降 1 级士气。","status","",{actorId:unit.id});
  });
}

export function say(state,unit,event,now=Date.now()) {
  if (state.dialogueEnabled === false) return;
  const entry = unit.dialogue.find(line=>line.event===event && !line.used);
  if (!entry) return;
  entry.used = true;
  const {text} = entry;
  const queue = state.speeches.filter(line=>line.expiresAt>now);
  const startsAt = Math.max(now,queue.at(-1)?.expiresAt ?? now);
  entry.spokenAt = startsAt;
  note(state,text,"speech",unit.name,{startsAt,actorId:unit.id});
  const speech = {id:state.serial,unitId:unit.id,name:unit.name,side:unit.side,text,startsAt,expiresAt:startsAt+bubbleDuration};
  state.speeches = [...queue,speech];
  state.rev++;
  return speech;
}

export function drawWeather(terrain, roll = Math.random) {
  const draw = terrain.indoors ? 0 : roll();
  let cutoff = 0;
  for (const weather of catalog.weather) {
    cutoff += terrain.weatherWeights[weather.id] ?? 0;
    if (draw < cutoff / 100) return weather;
  }
  throw new Error("地形天气概率配置无效");
}

function preferredDeployment(units, limit) {
  const rows = {front:[],back:[],reserve:[]};
  for (const unit of units) {
    const preferred = unit.preferred;
    const second = preferred === "front" ? "back" : "front";
    const row = [preferred,second].find(option => rows[option].length < limit(option)) ?? "reserve";
    rows[row].push(unit);
  }
  return rows;
}

export function standardFormation(state,width,side="player") {
  const rows = preferredDeployment(sideUnits(state,side).filter(unit=>!unit.tamed), row => formationCapacity(state,width,row));
  return Object.fromEntries(deploymentRows.map(row => [row,rows[row].toSorted(order).map(unit=>unit.id)]));
}

export function validFormation(state,width,formation,side="player") {
  if (!formation || !deploymentRows.every(row => Array.isArray(formation[row]) &&
      formation[row].length <= formationCapacity(state,width,row))) return false;
  const fielded = [...formation.front,...formation.back].filter(id => id !== null);
  const deployed = [...fielded,...formation.reserve.filter(id => id !== null)];
  const units = sideUnits(state,side);
  const ids = new Set(units.map(unit=>unit.id));
  const deployedIds = new Set(deployed);
  return fielded.length > 0 && deployedIds.size === deployed.length && deployed.every(id=>ids.has(id)) &&
    units.every(unit=>unit.tamed || deployedIds.has(unit.id));
}

function applyFormation(state,formation) {
  let position = 0;
  for (const row of deploymentRows) {
    formation[row].forEach((id,index) => {
      if (id === null) return;
      const unit = state.units.find(entry=>entry.id===id);
      Object.assign(unit,{row,fieldSide:unit.side,position:position++,column:row === "reserve" ? null : state.fieldColumns[index]});
    });
  }
}

function assignTerrain(state, terrainId, ground) {
  const terrain = catalog.terrain.find((item) => item.id === terrainId);
  if (!terrain) throw new Error("地形不存在");
  state.terrain = terrain;
  for (const unit of state.units) unit.terrainBonus = unit.favoredTerrains.includes(ground ?? terrain.ground) ? 5 : 0;
  state.fieldColumns = formationColumns(Math.max(terrain.front,terrain.back));
  for (const side of ["player","enemy"]) {
    const rows = preferredDeployment(sideUnits(state,side).filter(unit=>!unit.tamed), row => capacity(state,row));
    for (const row of deploymentRows) {
      for (const unit of rows[row]) Object.assign(unit,{row,fieldSide:unit.side});
      alignSetupRow(state,side,row);
    }
  }
}

export function createBattleUnit(character, position = 0) {
  const weapon = typeof character.weapon === "string" ? catalog.weapons[character.weapon] : character.weapon;
  const defaultWeapon = character.monster ? {name:"无基础攻击",range:"短",damage:0,penetration:0} : catalog.weapons.徒手;
  const mount = typeof character.mount === "string" ? catalog.mounts[character.mount] : character.mount;
  const unit = {
    id:character.id, name:character.name, role:character.role, side:character.side,
    ...(character.presetId ? {participantId:character.presetId} : {}),
    ...(character.noncombatant ? {noncombatant:true} : {}),
    ...(character.monster ? {monster:character.monster,attacksMade:0} : {}),
    ...(character.corpse ? {corpse:character.corpse} : {}),
    ...(character.tamed ? {tamed:true,emoji:character.emoji} : {}),
    level:character.level ?? 1, raceName:character.raceName, size:character.size ?? "中型", profession:character.profession ?? character.role,
    gender:character.gender, genderLabel:character.genderLabel, faceLabel:character.faceLabel, bodyLabel:character.bodyLabel,
    factionLabel:character.factionLabel, experience:character.experience,
    originName:character.originName, traits:character.traits ?? [], attributeSources:character.attributeSources,
    levelPoints:character.levelPoints, additionalGear:character.additionalGear ?? [],
    items:character.items ?? [], handItems:{...character.handItems}, lockedHands:character.lockedHands ?? [],
    skills:[...(character.skills ?? [])],
    portrait:character.portrait, profilePortrait:character.profilePortrait,
    portraitSprite:character.portraitSprite,
    portraitCropKey:character.portraitCropKey, portraitFraming:character.portraitFraming, portraitVersion:character.portraitVersion,
    profileResistances:character.profileResistances,
    resistances:character.resistances,
    speed:character.speed ?? 1, favoredTerrains:character.favoredTerrains ?? [],
    preferred:character.row, position, row:character.tamed ? "undeployed" : character.row, acted:false, moved:false, statuses:{}, morale:0,
    statusSources:{},statusGrace:{},stances:{},
    initialStatuses:character.initialStatuses,initialStatusSources:character.initialStatusSources,
    attributes:Object.fromEntries(attributeNames.map(name=>[name,character.attributes?.[name] ?? defaultAttribute])),
    dialogue:createDialogue(character.presetId ?? character.id),
    voiceProfile:character.gender === "female" || (character.presetId ?? character.id) === "vera" ? "female" : undefined,
    weapon:{headBonus:0,armorBonus:0,shieldBonus:0,...(weapon ?? defaultWeapon)},
    armor:{head:figure(character.head),body:bodyFigure(character.body,character.extraBodyArmor)},
    shield:character.shield ? figure(character.shield) : null,
    mount:mount ? {
      name:mount.name, size:mount.size ?? defaultMounts[character.mount]?.size ?? "中型",
      current:mount.maxHp, max:mount.maxHp, speed:mount.speed ?? 2,
      evade:mount.evade ?? 0, ...(mount.attack ? {attack:mount.attack} : {}), ...(mount.draft ? {draft:mount.draft} : {}),
    } : null,
  };
  applyStartingAttributes(unit);
  const equipment = [unit.weapon.name,unit.armor.head.name,unit.armor.body.name,unit.shield?.name,
    ...unit.additionalGear.map(item=>item.name)];
  unit.load = character.load ?? battleLoad(unit.attributes.strength,
    equipment.reduce((sum,name)=>sum+(catalog.gearWeights[name] ?? 0),0),
    unit.items.reduce((sum,item)=>sum+(item.weight ?? 0)*item.qty,0));
  updateStamina(unit);
  if (character.maxHp !== undefined) {
    unit.maxHp = character.maxHp;
    unit.hp = Math.max(0,Math.min(unit.maxHp,character.hp));
  }
  if (unit.magic && character.mana !== undefined) unit.magic.current = Math.min(unit.magic.max,character.mana);
  return unit;
}

export function createBattle(terrain = "woods", weatherId = "clear", supplies = [], player, rosterProfiles, allies = [], partyMemberIds = [], enemies, encounter, ground) {
  const weather = catalog.weather.find(item => item.id === weatherId);
  if (!weather) throw new Error("天气不存在");
  const participants = (encounter ? [] : roster.filter(character => character.side === "enemy" ? !enemies : !partyMemberIds.includes(character.id))).map(character => {
    const profile = rosterProfiles?.[character.id] ?? defaultRosterProfiles[character.id];
    return {...profile,...character,profession:profile.role};
  });
  for (const unit of player ? [player,...allies] : []) {
    participants.push({side:"player",row:unit.weapon?.range === "远程" ? "back" : "front",...unit});
  }
  for (const unit of enemies ?? []) {
    participants.push({side:"enemy",row:unit.mount || unit.weapon?.range === "远程" ? "back" : "front",...unit});
  }
  const state = {
    phase:"setup", round:1, winner:null, endReason:null, serial:0, rev:0, busy:false, log:[], speeches:[], lastStrike:null, pendingEnemyAttack:null, lanes, weather,
    fallen:[], settlement:null, report:null, supplies, usedItems:{}, itemSwaps:{}, restoredMana:{}, enemyFormationEnabled:Boolean(enemies?.length),
    experience:{}, usedBattleTools:{},
    damageStats:Object.fromEntries(participants.filter(unit=>unit.side==="player" && !unit.tamed).map(unit=>[unit.id,{name:unit.name,armor:0,hp:0,taken:0}])),
    units:participants.map(createBattleUnit),
    ...(encounter ? {encounter} : {}),
  };
  assignTerrain(state, terrain, ground);
  if (state.terrain.indoors) state.weather = drawWeather(state.terrain);
  return state;
}

export function reachable(state, actorId) {
  return attackOptions(state,actorId).targets;
}

function teamAmmoCost(state,actor) {
  if (state.ammoLeft === undefined || actor.side !== "player" || actor.tamed) return 0;
  const {weapon} = actor;
  const name = weapon.baseName ?? weapon.name;
  if (weapon.range !== "远程" || weapon.magic || /投石|石索/.test(name)) return 0;
  return /飞斧|投斧|标枪/.test(name) ? 3 : 1;
}

export function attackOptions(state, actorId) {
  const actor = state.units.find((unit) => unit.id === actorId);
  if (!actor || !active(actor) || !hasAttack(actor) || skippedStatus(actor)) return {targets:[]};
  const source = attackSource(actor);
  if (source.weapon.magic && hasStatus(actor,"silence")) return {targets:[],blockedReason:"禁魔期间无法施放魔法攻击。"};
  const cost = teamAmmoCost(state,source);
  if (cost && state.ammoLeft < cost) return {targets:[],
    blockedReason:cost === 1 ? "队伍弹药不足" : "队伍弹药不足，需要 " + cost + " 单位"};
  const ranged = source.weapon.range === "远程";
  const control = controlledStatus(actor);
  const eligible = target => active(target) && target !== actor &&
    (control === "confusion" || (target.side === actor.side) === (control === "charmed"));
  const hidden = target => ranged && !source.weapon.magic && target.side !== actor.side && hasStatus(target,"stealth");
  const close = control === "charmed" ? orthogonal : adjacent;
  const targets = state.units.filter(target=>eligible(target) && !hidden(target) && (ranged || close(actor,target)));
  const taunter = !control && sourceFor(state,actor,"taunted");
  if (taunter && targets.includes(taunter)) return {targets:[taunter],blockedReason:"受到嘲讽，只能攻击" + taunter.name + "。"};
  return {targets,
    blockedReason:ranged ? (targets.length ? "" : "当前没有可选目标。") : "近战只能攻击相邻格内的有效目标。"};
}

export function orderedActors(state, side) {
  return state.units.filter(unit=>active(unit) && !unit.acted && (!side || unit.side===side))
    .sort((a,b)=>b.initiative-a.initiative || Number(b.side==="player")-Number(a.side==="player") || order(a,b));
}

export function armorPenetrationReduction(durability) {
  return Math.floor(durability/50)*5;
}

function strikeBreakdown(damage, rate, armorBonus, layer, zone) {
  const baseRatio = Math.round(rate*100);
  const armorReduction = armorPenetrationReduction(layer.current);
  const ratio = Math.max(0,baseRatio-armorReduction);
  const direct = Math.round(damage*ratio/100);
  const armorDamage = damage-direct;
  const armorEfficiency = Math.round((1+armorBonus)*100);
  const armorImpact = Math.round(armorDamage*armorEfficiency/100);
  const blocked = Math.min(armorImpact,layer.current);
  let armorAbsorbed = 0;
  if (layer.current > 0) {
    // Find how much base damage is needed to reach the remaining durability after rounding.
    armorAbsorbed = armorImpact >= layer.current
      ? Math.ceil((layer.current*100-50)/armorEfficiency)
      : armorDamage;
  }
  const overflow = armorDamage-armorAbsorbed;
  const multiplier = zone === "head" ? 1.5 : 1;
  return {
    penetration:{baseRatio,armorReduction,ratio,direct,armorDamage},armorEfficiency,armorImpact,armorAbsorbed,
    blocked,overflow,multiplier,hpDamage:Math.round((direct+overflow)*multiplier),
  };
}

export function resolveStrike(target, damage, zone, rate = 0, armorBonus = 0) {
  const layer = target.armor[zone];
  const result = strikeBreakdown(damage,rate,armorBonus,layer,zone);
  wearArmor(layer,result.blocked);
  const afterStoneSkin = lifeDamage(target,result.hpDamage);
  const hpLoss = Math.min(target.hp,afterStoneSkin);
  target.hp -= hpLoss;
  return {...result,hpLoss,...(afterStoneSkin < result.hpDamage ? {stoneReduction:result.hpDamage-afterStoneSkin} : {})};
}

function lifeDamage(target,value) {
  return Math.max(0,value - (hasStatus(target,"stoneSkin") ? 20 : 0));
}

export function reinforcementOptions(state,side) {
  const columns = {front:[],back:vacantColumns(state,side,"back")};
  const units = columns.back.length ?
    occupancy(state,side,"reserve").filter(unit=>unit.morale!==whiteFlag).sort(order).map(unit=>unit.id) : [];
  return {units,columns};
}

function enterBattleExperience(state,unit) {
  if (unit.side === "player") state.experience[unit.id] ??= {acted:0,received:0,defeated:0};
}

function trackEffectiveStrike(state,actor,target) {
  if (actor.side === target.side) return;
  const source = state.experience[actor.id];
  const recipient = state.experience[target.id];
  if (source) source.acted++;
  if (recipient) recipient.received++;
}

function enterFromReserve(state,unit,row,column) {
  enterBattleExperience(state,unit);
  Object.assign(unit,{row,fieldSide:unit.side,column,acted:true});
  note(state,unit.name + "从预备队进入" + (row === "front" ? "前排" : "后排") + "。","info","",{actorId:unit.id});
  recordMorale(state,{reinforced:unit});
}

function reinforceSide(state,side) {
  const {units,columns} = reinforcementOptions(state,side);
  for (const id of units) {
    const unit = state.units.find(entry=>entry.id===id);
    if (unit.morale === whiteFlag || isHeavilyWounded(unit)) continue;
    if (!columns.back.length) break;
    enterFromReserve(state,unit,"back",columns.back.shift());
  }
}

function settlementEntry(unit,kind,persistent = false) {
  const {id,name,side,role,profession,portrait,profilePortrait,portraitSprite,portraitCropKey,portraitFraming,portraitVersion,
    weapon,armor,shield,mount,magic,stamina,morale,level,hp,maxHp} = unit;
  const monster = Boolean(unit.monster || unit.corpse);
  const protectionLabels = {head:"头盔",body:"护甲",off_hand:"盾牌"};
  const source = slot => persistent ? {source:{unit:id,slot}} : {};
  const items = [];
  if (!unit.monster) {
    if (!persistent || weapon.campaignGear) items.push({name:weapon.name,kind:"武器",...source("main_hand")});
    for (const [slot,gear] of armorParts(unit)) {
      if (gear?.max > 0 && (!persistent || gear.campaignGear)) {
        items.push({name:gear.name,kind:protectionLabels[slot] ?? "护甲",current:gear.current,max:gear.max,...source(slot)});
      }
    }
  }
  return {
    kind,card:structuredClone({id,name,side,role,profession,portrait,profilePortrait,portraitSprite,portraitCropKey,
      portraitFraming,portraitVersion,armor,shield,mount,magic,stamina,morale,level,hp,maxHp,emoji:unit.emoji,tamed:unit.tamed}),
    monster,body:unit.corpse ?? unit.monster?.corpse,items,looted:false,disposition:null,capturable:kind === "prisoner",
    ...(persistent ? {durability:armorDurability(unit,true)} : {}),
  };
}

export function pendingCorpseAction(entry) {
  if (entry?.kind !== "corpse" || entry.looted || entry.disposition) return;
  return "loot";
}

export const settlementItemKey = item => JSON.stringify([item.kind,item.name,item.current,item.max,
  ...(item.source ? [item.source.unit,item.source.slot] : []),...(item.harvested ? ["harvested"] : []),
  ...(item.recoveredTrap ? ["recoveredTrap"] : []),
  ...(item.corpse ? [item.corpse.unit] : [])]);

function stackItem(items,item,quantity=1) {
  const key = settlementItemKey(item);
  const existing = items.find(slot=>settlementItemKey(slot)===key);
  if (existing) existing.quantity += quantity;
  else items.push({...item,quantity});
}

export function settlementProblem(entry,command) {
  if (entry.disposition) return "该对象已处理";
  if (command === "pickup") return entry.kind === "corpse" ? "" : "只能携带尸体";
  if (command === "bury" || command === "discard") return entry.kind === "corpse" ? "" : "只能处理尸体";
  if (command === "loot" || command === "butcher") {
    if (entry.looted) return "已搜刮过该对象";
    if (entry.card.tamed) return "可带走、埋葬或留下阵亡魔物。";
    if (command === "butcher" && (!entry.monster || entry.kind !== "corpse")) return "此对象只能搜刮";
  } else if (entry.kind !== "prisoner") {
    return "只能对俘虏执行此操作";
  }
  if (command === "recruit" && entry.capturable === false) return "此对象无法带走";
  return "";
}

function settle(state,{command,target,all,description},roll) {
  const settlement = state.settlement;
  if (!settlement) throw new Error("战斗胜利后才能结算");
  if (settlement.left) throw new Error("队伍已经离开战场");
  const {entries,loot,inventory} = settlement;
  const harvest = [];
  const processEntry = (entry,kind) => {
    const result = settleEntry(state,entry,loot,kind,roll);
    if (result) {
      const check = {...result,target:entry.card.name};
      harvest.push(check);
      (settlement.harvestChecks ??= []).push(check);
      settlement.lastHarvest = harvest;
    }
  };
  if (command === "leave") {
    loot.length = 0;
    settlement.left = true;
    return;
  }
  if (command === "take") {
    const index = loot.findIndex(item=>item.id===target);
    if (all !== true && index < 0) throw new Error("这件战利品已不在原处");
    const picked = all === true ? loot.splice(0) : loot.splice(index,1);
    for (const {id,quantity,...item} of picked) stackItem(inventory,item,quantity);
    return;
  }
  if (command === "return") {
    const index = inventory.findIndex(item=>settlementItemKey(item)===target);
    if (index < 0) throw new Error("这件物品已不在队伍物资中");
    const [{quantity,...item}] = inventory.splice(index,1);
    if (item.corpse) {
      const entry = entries.find(entry=>entry.card.id===item.corpse.unit);
      if (entry?.disposition === "pickup") entry.disposition = null;
      return;
    }
    stackItem(loot,{...item,id:++state.serial},quantity);
    return;
  }
  if (command === "pickup") {
    const entry = entries.find(entry=>entry.card.id===target);
    if (!entry || all === true) throw new Error("请选择要携带的尸体");
    const problem = settlementProblem(entry,command);
    if (problem) throw new Error(problem);
    const body = entry.body ?? (entry.monster && entry.card.side === "enemy" ? state.encounter?.corpse : undefined);
    if (entry.monster && !body) throw new Error("缺少该怪物的体重资料");
    stackItem(inventory,{name:entry.card.name,kind:"尸体",corpse:{
      ...(body ?? {monsterId:"person:"+entry.card.id,weightKg:state.encounter?.humanCorpseWeightKg ?? 60}),
      unit:entry.card.id,
    }});
    entry.disposition = command;
    return;
  }
  if (command === "process" && all === true) {
    for (const entry of entries) {
      const pending = pendingCorpseAction(entry);
      if (pending) processEntry(entry,pending);
    }
    return;
  }
  if (command === "talk") throw new Error("对话暂未开放");
  if (!["loot","butcher","execute","recruit","bury","discard"].includes(command)) throw new Error("未知结算操作");
  if (command === "execute") {
    const text = typeof description === "string" ? description.trim().slice(0,600) : "";
    if (!text || all === true) throw new Error("请填写处决方式");
    const entry = entries.find(item=>item.card.id===target);
    if (!entry) throw new Error("找不到结算对象");
    const problem = settlementProblem(entry,command);
    if (problem) throw new Error(problem);
    entry.executed = text;
    entry.card.hp = 0;
    entry.kind = "corpse";
    return;
  }
  if (all === true) {
    if (command === "recruit") throw new Error("请选择一名要收押的俘虏");
    if (command === "bury" || command === "discard") throw new Error("请选择要处理的尸体");
    for (const entry of entries) {
      if (!settlementProblem(entry,command)) processEntry(entry,command);
    }
    return;
  }
  const entry = entries.find(item=>item.card.id===target);
  if (!entry) throw new Error("找不到结算对象");
  const problem = settlementProblem(entry,command);
  if (problem) throw new Error(problem);
  processEntry(entry,command);
}

function settleEntry(state,entry,loot,command,roll) {
  if (command === "loot" && entry.monster && entry.kind === "corpse" && entry.card.side === "enemy") {
    for (const item of entry.items) stackItem(loot,{...item,id:++state.serial});
    command = "butcher";
  }
  if (command === "loot") {
    for (const item of entry.items) stackItem(loot,{...item,id:++state.serial});
    const {armor,shield} = entry.card;
    armor.head.current = 0;
    wearArmor(armor.body,armor.body.current);
    if (shield) shield.current = 0;
    entry.looted = true;
  } else {
    entry.disposition = command;
    if (command === "execute" || command === "butcher") entry.card.hp = 0;
    if (command === "butcher" && entry.card.side === "enemy" && state.encounter?.wildMonster) return harvestMonster(state,entry,loot,roll);
  }
}

function harvestMonster(state,entry,loot,roll) {
  const rules = state.encounter.butcheryByMonsterId
    ? state.encounter.butcheryByMonsterId[entry.body?.monsterId ?? state.encounter.monsterProfileId]
    : state.encounter.butchery;
  if (!rules) return {drops:[]};
  const bonuses = state.units.filter(unit=>unit.side === "player" && unit.hp > 0 && Object.hasOwn(rules.bonuses,unit.id))
    .map(unit=>rules.bonuses[unit.id]);
  if (!bonuses.length) return {drops:[]};
  const bonus = Math.max(...bonuses);
  const rolled = Math.floor(roll()*rules.sides)+1;
  const score = bonus + rolled;
  const tier = rules.tiers.find(tier=>score >= tier.score);
  const drops = [];
  for (const {item:name,quantity,kind = "材料"} of rules.drops) {
    const qty = Math.floor(quantity*tier.percent/100);
    if (qty <= 0) continue;
    stackItem(loot,{name,kind,harvested:true,id:++state.serial},qty);
    drops.push({name,qty});
  }
  const difficulty = Number.isFinite(tier.score) ? tier.score : rules.tiers.at(-2)?.score;
  return {score,tier:tier.name,drops,check:{sides:rules.sides,rolled,bonus,difficulty}};
}

function finishBattle(state,side,reason) {
  state.winner = other(side);
  state.phase = "ended";
  if (state.autoBattle) state.autoBattle = false;
  state.endReason = reason;
  state.report = Object.entries(state.damageStats).map(([id,stats])=>({
    id,portrait:(state.units.find(unit=>unit.id===id) ?? state.fallen.find(entry=>entry.card.id===id)?.card)?.portrait,
    ...stats,fallen:state.fallen.some(entry=>entry.card.id===id),
  })).sort((a,b)=>(b.armor+b.hp)-(a.armor+a.hp));
  if (state.winner === "player" && !state.encounter?.arena) {
    const prisoners = reason === "surrender" ? sideUnits(state,side).map(unit=>settlementEntry(unit,"prisoner",state.encounter?.persistentSpoils)) : [];
    const loot = [];
    for (const name of state.encounter?.recoveredTraps ?? []) {
      if (typeof name === "string" && name) stackItem(loot,{name,kind:"陷阱",recoveredTrap:true,id:++state.serial});
    }
    state.settlement = {entries:[...state.fallen,...prisoners],loot,inventory:state.supplies,left:false};
  }
  const loser = side === "player" ? "我方" : "敌方";
  const result = {surrender:"全队举起白旗，溃败。",elimination:"全员阵亡。",withdrawal:"撤离战场。",arenaWithdrawal:"全员退出竞技。"};
  note(state,loser+result[reason]);
}

function startNextRound(state) {
  reinforceSide(state,"enemy");
  if (resolveDefeat(state)) return false;
  const emptySide = ["player","enemy"].find(side=>!sideUnits(state,side).some(unit=>active(unit) || hasStatus(unit,"swallowed")));
  if (emptySide) {
    finishBattle(state,emptySide,"withdrawal");
    return false;
  }
  state.round++;
  for (const unit of state.units) {
    Object.assign(unit,{acted:false,moved:false});
    endStatus(state,unit,"surprised");
  }
  for (const unit of state.units) if (unit.monster) unit.attacksMade = 0;
  note(state,"第 " + state.round + " 回合开始。");
  return true;
}

function resolveDefeat(state) {
  for (const side of ["player","enemy"]) {
    const survivors = sideUnits(state,side);
    if (state.encounter?.arena?.withdrawBelow && !survivors.length) {
      finishBattle(state,side,"arenaWithdrawal");
      return true;
    }
    const field = survivors.filter(active);
    if (!survivors.some(unit=>unit.morale!==whiteFlag) || (field.length && !field.some(canFight))) {
      finishBattle(state,side,survivors.length ? "surrender" : "elimination");
      return true;
    }
  }
  return false;
}

function statusLifeLoss(state,target,damage,id,source,type) {
  if (!available(target)) return;
  const linked = id === "painLink";
  const amount = linked ? damage : lifeDamage(target,typedDamage(target,damage,type));
  const hpLoss = Math.min(target.hp - Number(Boolean(state.encounter?.arena?.withdrawBelow)),amount);
  if (hpLoss <= 0) return;
  target.hp -= hpLoss;
  const received = state.damageStats[target.id];
  if (received) received.taken += hpLoss;
  const dealt = source && state.damageStats[source.id];
  if (dealt) dealt.hp += hpLoss;
  const name = battleStatusNames[id] ?? id;
  note(state,target.name + "因" + name + "失去 " + hpLoss + " 点生命。","status","",
    {actorId:source?.id,targetId:target.id,hpLoss});
  afterLifeLoss(state,target,hpLoss,{ignoreWake:id==="nightmare",linked});
  settleFallenOrWithdrawn(state,target,source);
}

function afterLifeLoss(state,target,loss,{ignoreWake = false,linked = false} = {}) {
  if (!loss) return;
  if (!ignoreWake && hasStatus(target,"sleep")) {
    endStatus(state,target,"sleep");
    note(state,target.name + "因受伤而醒来。","status","",{actorId:target.id});
  }
  endStatus(state,target,"stealth");
  if (linked) return;
  for (const unit of state.units) {
    if (hasStatus(unit,"painLink") && unit.statusSources.painLink === target.id)
      statusLifeLoss(state,unit,loss,"painLink");
  }
}

function settleRoundStatuses(state) {
  for (const unit of state.units.filter(unit=>unit.row !== "undeployed")) {
    if (!available(unit)) continue;
    for (const [id,[damage,type]] of Object.entries(roundDamage)) {
      if (hasStatus(unit,id)) statusLifeLoss(state,unit,damage,id,sourceFor(state,unit,id),type);
    }
    if (!available(unit)) continue;
    if (hasStatus(unit,"corrosion")) {
      const {head,body} = unit.armor;
      const headLoss = Math.min(20,head.current);
      const bodyLoss = Math.min(20,body.current);
      wearArmor(head,headLoss);
      wearArmor(body,bodyLoss);
      if (headLoss || bodyLoss) note(state,unit.name + "因腐蚀损失头甲 " + headLoss + "、身甲 " + bodyLoss + "。","status","",{actorId:unit.id});
    }
    if (hasStatus(unit,"fear")) recordMorale(state,{changes:[[unit,-1,"受恐惧影响"]]});
    if (hasStatus(unit,"regeneration")) {
      const health = Math.min(unit.maxHp-unit.hp,Math.round(unit.maxHp*.3));
      if (health > 0) {
        const wasHeavilyWounded = isHeavilyWounded(unit);
        unit.hp += health;
        note(state,unit.name + "因再生恢复 " + health + " 点生命。","status","",{actorId:unit.id});
        recoverMorale(state,unit,wasHeavilyWounded);
      }
    }
  }
  for (const unit of state.units) {
    for (const [id,turns] of Object.entries(unit.statuses)) {
      if (!hasStatus(unit,id) || unit.stances[id] || unit.statusGrace[id] === state.round) continue;
      if (turns <= 1) endStatus(state,unit,id);
      else unit.statuses[id] = turns - 1;
    }
  }
}

function initializeStatuses(state) {
  for (const unit of state.units) {
    const entries = Object.entries(unit.initialStatuses ?? {});
    const priority = name => ({poisonImmunity:0,unyielding:0,sleep:0,marked:0,swallowed:2})[battleStatusId(name)] ?? 1;
    entries.sort(([a],[b])=>priority(a)-priority(b));
    for (const [name,turns] of entries) {
      const sourceId = unit.initialStatusSources?.[name];
      const source = sourceId && (state.units.find(candidate=>candidate.id===sourceId)
        ?? state.units.find(candidate=>candidate.participantId===sourceId));
      if (applyBattleStatus(state,unit,name,turns,source)) {
        note(state,unit.name + "带着「" + battleStatusNames[battleStatusId(name)] + "」进入战斗。","status","",{actorId:unit.id});
      }
    }
    delete unit.initialStatuses;
    delete unit.initialStatusSources;
  }
}

function advance(state) {
  if (state.phase === "reinforcement") {
    if (!startNextRound(state)) return;
  }
  if (resolveDefeat(state)) return;
  for (;;) {
    let next = orderedActors(state)[0];
    if (!next) {
      settleRoundStatuses(state);
      recordMorale(state,{roundEnd:true});
      if (resolveDefeat(state)) return;
      if (reinforcementOptions(state,"player").units.length) {
        state.phase = "reinforcement";
        note(state,"第 " + state.round + " 回合结束，可派预备队入场。");
        return;
      }
      if (!startNextRound(state)) return;
      next = orderedActors(state)[0];
      if (!next) continue;
    }
    const condition = skippedStatus(next);
    for (const id of Object.keys(next.stances)) endStatus(state,next,id);
    if (condition) {
      next.acted = true;
      note(state,next.name + "因" + battleStatusNames[condition] + "，跳过本轮行动。","status","",{actorId:next.id});
      continue;
    }
    if (hasStatus(next,"charmed") && !reachable(state,next.id).length) {
      next.acted = true;
      note(state,next.name + "因魅惑没有可攻击的队友，跳过行动。","status","",{actorId:next.id});
      continue;
    }
    if (next.morale !== whiteFlag) {
      state.phase = controllingSide(state,next);
      return;
    }
    next.acted = true;
    note(state,next.name + "举着白旗愣在原地，跳过行动。","morale","",{actorId:next.id});
  }
}

export function assertActor(state, actorId, side, allowControlled = false) {
  const actor = state.units.find((unit) => unit.id === actorId);
  if (state.phase !== side || !active(actor) || controllingSide(state,actor) !== side ||
      actor.acted || actor.morale === whiteFlag || skippedStatus(actor)) {
    throw new Error("该角色现在无法行动");
  }
  const next = orderedActors(state)[0];
  if (next !== actor) throw new Error("现在轮到" + next.name + "行动");
  const control = controlledStatus(actor);
  if (!allowControlled && control && !(control === "charmed" && side === "player"))
    throw new Error("该角色正在受状态控制。");
  return actor;
}

export function assertAttack(state, actorId, targetId, side) {
  const actor = assertActor(state,actorId,side);
  const {targets,blockedReason} = attackOptions(state,actorId);
  const target = targets.find(unit=>unit.id===targetId);
  if (!target) throw new Error(blockedReason || "当前站位无法攻击这个目标");
  return {actor,target};
}

export function wakeTargets(state,actor) {
  if (!active(actor) || !statusAllowsItems(actor)) return [];
  return sideUnits(state,actor.side).filter(unit=>active(unit) && hasStatus(unit,"sleep") && orthogonal(actor,unit));
}

export function canPassRestrictedTurn(state,actor) {
  return Boolean(forcedStatus(actor)) && !controlledStatus(actor) &&
    !attackOptions(state,actor.id).targets.length && !movementOptions(state,actor).destinations.length;
}

function movementBreaksFreeze(state,actor) {
  if (!hasStatus(actor,"frozen")) return false;
  endStatus(state,actor,"frozen");
  actor.acted = true;
  note(state,actor.name + "用本轮行动解除冻僵，留在原地。","status","",{actorId:actor.id});
  advance(state);
  return true;
}

const intactShield = (unit) => unit.shield?.current > 0 ? unit.shield : null;
const limitHit = (chance) => Math.max(hitFloor,Math.min(hitCeiling,chance));

export function dodgeAfterAction(dodge) {
  return Math.max(20,dodge*2);
}

export function defenseFor(unit,state) {
  const targetDexterity = effectiveAttribute(unit,"dexterity");
  const rawTargetDexterity = unit.attributes.dexterity;
  const mounted = unit.mount?.current > 0;
  const shield = mounted ? null : intactShield(unit);
  const attributeDodge = mounted ? unit.mount.evade ?? 0 : unit.monster?.evade ?? Math.max(0,(targetDexterity-attributeBenchmark)*2);
  const moraleDodge = moralePercent(unit);
  const baseDodge = Math.max(0,attributeDodge + moraleDodge);
  const activeDodge = hasStatus(unit,"dodge") ? dodgeAfterAction(baseDodge)-baseDodge : 0;
  const terrainDodge = unit.terrainBonus ?? 0;
  const dodgeModifiers = activeStatusValues(unit,dodgeStatuses);
  const disabled = cannotDefend(unit);
  const shieldBonus = shield?.blockBonus ?? 0;
  const guarding = !mounted && hasStatus(unit,"defend");
  const shieldWall = !disabled && shield && hasStatus(unit,"shieldWall") && state?.units.some(ally=>
    ally !== unit && active(ally) && ally.side === unit.side && rankOf(ally) === rankOf(unit) &&
    Math.abs(ally.column-unit.column)===1 && intactShield(ally) && !(ally.mount?.current > 0) &&
    hasStatus(ally,"shieldWall")) ? 10 : 0;
  const baseBlockRate = mounted ? 0 : baseBlock;
  const block = (baseBlockRate + shieldBonus) * (guarding ? 2 : 1) + shieldWall;
  const meleeBlock = disabled || (!guarding && (!hasAttack(unit) || attackSource(unit).weapon.range === "远程")) ? 0 : block;
  const rangedBlock = !disabled && shield ? block : 0;
  return {targetDexterity,rawTargetDexterity,attributeDodge,baseDodge,moraleDodge,activeDodge,terrainDodge,baseBlock:baseBlockRate,shieldBonus,guarding,meleeBlock,rangedBlock,
    shieldWall,dodgeModifiers,disabled,
    ...(mounted ? {dodgeSource:"坐骑基础闪避"} : unit.monster ? {dodgeSource:"目标基础闪避"} : {}),
    dodge:disabled ? 0 : Math.max(0,baseDodge + activeDodge + terrainDodge + dodgeModifiers.reduce((sum,[,value])=>sum+value,0))};
}

function flankingBonus(state, actor, target) {
  if (!state || !isMeleeFighter(actor) || !adjacent(actor,target)) return 0;
  const threatens = unit => reachable(state,unit.id).some(enemy=>enemy.id===target.id);
  return 5 * state.units.filter(ally=>
    ally.id!==actor.id && ally.side===actor.side && isMeleeFighter(ally) && threatens(ally)).length;
}

function isFlankingHit(state,actor,target) {
  if (actor.weapon.range === "远程" || rankOf(actor)!==rankOf(target) || Math.abs(actor.column-target.column)!==1) return false;
  const forward = rankOf(target) + (target.side === "player" ? -1 : 1);
  return state.units.some(unit=>unit.side!==target.side && canFight(unit) &&
    rankOf(unit)===forward && Math.abs(unit.column-target.column)<=1);
}

export function accuracyFor(actor, target, weather, state, skill) {
  actor = attackSource(actor);
  const ranged = actor.weapon.range === "远程";
  const attackAttribute = ranged ? "dexterity" : "strength";
  const rawScore = actor.attributes[attackAttribute];
  const score = effectiveAttribute(actor,attackAttribute);
  const base = actor.monster ? actor.monster.hit ?? (hasStatus(actor,"polymorph") ? baseAccuracy : 0) : baseAccuracy;
  const adjustment = actor.monster ? 0 : (score - attributeBenchmark) * 2;
  const mount = target.mount?.current > 0 ? target.mount : null;
  const weaponMatchup = actor.weapon.range === "长" && target.weapon.range === "短" ? 5 : 0;
  const targetSize = mount ? mount.size : target.size;
  const largeBonus = (actor.monster || actor.weapon.range === "长") && targetSize === "大型" ? Math.round((actor.weapon.largeBonus ?? 0)*100) : 0;
  const flankingHit = flankingBonus(state,actor,target);
  const moraleHit = moralePercent(actor);
  const terrainHit = actor.terrainBonus ?? 0;
  const weatherHit = (actor.weapon.magic ? weather?.magicHit : ranged ? weather?.rangedHit : 0) ?? 0;
  const defense = defenseFor(target,state);
  const block = ranged ? defense.rangedBlock : defense.meleeBlock;
  const skillHit = skill?.hit ?? 0;
  const attackerModifiers = activeStatusValues(actor,attackerHitStatuses);
  const hitModifiers = [...attackerModifiers,...activeStatusValues(target,defenderHitStatuses.filter(([id])=>id!=="smoke" || ranged))];
  const statusHit = hitModifiers.reduce((sum,[,value])=>sum+value,0);
  const offense = base + adjustment + weaponMatchup + largeBonus + flankingHit + moraleHit + terrainHit + weatherHit + skillHit + statusHit;
  const afterDodge = offense - defense.dodge;
  const chance = limitHit(afterDodge - block);
  const dodgeLimit = limitHit(Math.max(offense,afterDodge));
  const blockLimit = Math.max(chance,dodgeLimit - Math.max(0,defense.dodge));
  return {base, attribute:ranged ? "敏捷" : "力量", score, rawScore, adjustment, weaponMatchup, largeBonus, flankingHit, moraleHit,
    terrainHit, weatherHit, weatherName:weather?.name ?? null, ...defense, block, skillHit, statusHit, hitModifiers, attackerModifiers,
    chance, blockLimit, dodgeLimit};
}

export function battleProfileCombat(unit, weather, state) {
  const a = accuracyFor(unit,unit,weather,state);
  const source = attackSource(unit);
  const profileHit = a.base + a.adjustment + a.moraleHit + a.terrainHit + a.weatherHit +
    a.attackerModifiers.reduce((sum,[,value])=>sum+value,0);
  const block = Math.max(a.meleeBlock,a.rangedBlock);
  const activeBlock = a.guarding ? a.baseBlock + a.shieldBonus : 0;
  const mounted = unit.mount?.current > 0;
  const rawDodge = mounted ? a.attributeDodge : unit.monster?.evade ?? Math.max(0,(a.rawTargetDexterity-attributeBenchmark)*2);
  const strength = damageUsesStrength(source) ? strengthDamagePercent(source) : 0;
  const normalDamage = attackDamage(source);
  const signed = (value,unit) => (value > 0 ? "+" : "") + value + unit;
  const contributions = (entries,suffix="%") => entries.filter(([,value,required])=>value || required)
    .sort((a,b)=>b[1]-a[1]).map(([label,value])=>[label,signed(value,suffix)]);
  return {
    dodge:a.dodge, meleeBlock:a.meleeBlock, rangedBlock:a.rangedBlock, profileHit,damage:normalDamage,
    profileStatSources:{
      initiative:{title:"先攻来源",rows:contributions(initiativeParts(unit),""),total:"合计先攻 " + unit.initiative},
      block:{title:"格挡来源",rows:contributions([
        ["基础格挡",a.baseBlock,true],["盾牌 · " + (unit.shield?.name ?? "无"),a.shieldBonus],
        ["主动防御",activeBlock],["盾阵",a.shieldWall],
        ["格挡限制",block-a.baseBlock-a.shieldBonus-activeBlock-a.shieldWall],
      ]), total:"合计格挡率 " + block + "%",
      note:"对近战 " + a.meleeBlock + "% · 对远程 " + a.rangedBlock + "%" +
        (unit.weapon.range === "远程" ? "；持远程武器不能格挡近战" : "") +
        (mounted ? "；骑手的盾牌不参与坐骑格挡" : !intactShield(unit) ? "；无完好盾牌不能格挡远程" : "")},
      dodge:{title:"闪避来源",rows:contributions([
        [mounted ? "坐骑基础闪避" : unit.monster ? "基础闪避" : "敏捷（" + a.rawTargetDexterity + "）",rawDodge,true],
        ["装备敏捷上限（有效敏捷 " + a.targetDexterity + "）",a.attributeDodge-rawDodge],
        ["士气",a.moraleDodge],["总闪避最低 0%",a.baseDodge-a.attributeDodge-a.moraleDodge],
        ["主动闪避",a.activeDodge],["优势地形",a.terrainDodge],...a.dodgeModifiers,
      ]),total:"合计闪避率 " + a.dodge + "%"},
      damage:{title:"伤害来源",rows:[
        ["武器 · " + source.weapon.name,String(source.weapon.damage)],
        ...(damageUsesStrength(source) ? [["力量 " + unit.attributes.strength + "（" + signed(strength,"%") + "）",
          signed(source.damage-source.weapon.damage,"")]] : []),
        ...contributions(activeStatusValues(unit,[["charge",30],["weakness",-30]])),
      ],total:"实际攻击伤害 " + normalDamage,
      note:"命中后按目标和命中部位结算，护甲、格挡等会影响最终扣血。"},
      hit:{title:"命中来源",rows:contributions([
        ["基础命中",a.base,true],[a.attribute + "（" + a.score + "）",a.adjustment,!unit.monster],
        ["士气",a.moraleHit],["优势地形",a.terrainHit],["天气" + (a.weatherName ? " · " + a.weatherName : ""),a.weatherHit],
        ...a.attackerModifiers,
      ]),total:"合计命中 " + profileHit + "%",
      note:"对具体目标的命中率还受其闪避、格挡及战场情况影响。"},
    },
  };
}

function rollPercent(roll) {
  return Math.floor(roll() * 100) + 1;
}

const noteStrike = (state,summary,detail) => note(state,summary,detail.name ? "skill" : "strike","",detail);
const shieldImpact = (actor,damage) => damage + Math.round(damage * actor.weapon.shieldBonus);
const headChance = (actor) => baseHeadChance + Math.round(actor.weapon.headBonus * 100);
const healingAmount = (actor,skill) => Math.min(actor.maxHp - actor.hp,Math.round(actor.maxHp*skill.healRatio));

function attackDamage(source,skill) {
  const percent = skill ? 100 : 100 + 30*Number(hasStatus(source,"charge")) - 30*Number(hasStatus(source,"weakness"));
  return Math.max(0,Math.round(source.damage*percent/100));
}

export function restorationTargets(state,actor,item) {
  if (!item.restore || item.qty <= 0) return [];
  return sideUnits(state,actor.side).filter(unit=>active(unit) && (item.restore.resource === "hp"
    ? unit.hp < unit.maxHp
    : unit.magic && unit.magic.current < unit.magic.max));
}

const itemKey = item => item.key ?? item.name;
const statusAllowsItems = unit => !forcedStatus(unit);
const canUseMagic = unit => !hasStatus(unit,"silence") && !hasStatus(unit,"polymorph");
const canUseSkill = (unit,skill) => !forcedStatus(unit) &&
  (!skill.weapon || !hasStatus(unit,"disarmed")) && (!skill.magic || canUseMagic(unit));
const matchesEnemyKind = (unit,kind) => !kind || unit.monster?.kind === kind ||
  (kind === "undead" && unit.raceName === "不死生物");

export function battleItemOptions(state,actor,item) {
  const rule = item.battleUse;
  const all = rule?.target === "allies" || rule?.target === "enemies";
  let reason = "";
  if (item.qty <= 0 || (!item.restore && !rule)) return {targets:[],all,reason};
  if (!statusAllowsItems(actor)) reason = "当前状态无法使用道具。";
  else if (item.magic && !canUseMagic(actor)) reason = "禁魔期间无法施法。";
  else if (rule?.once_per_battle && state.usedBattleTools?.[actor.id]?.includes(itemKey(item))) reason = "本场战斗已经用过。";
  if (reason) return {targets:[],all,reason};
  const healing = new Set(restorationTargets(state,actor,item));
  if (!rule) return {targets:[...healing],all,reason};
  const targets = state.units.filter(unit=>{
    if (!active(unit)) return false;
    if (rule.target !== "anyone" && (unit.side === actor.side) !== (rule.target === "ally" || rule.target === "allies")) return false;
    return healing.has(unit) || (rule.cleanse ?? []).some(name=>hasStatus(unit,battleStatusId(name))) || Boolean(rule.apply)
      || (rule.damage && matchesEnemyKind(unit,rule.damage.enemy_kind));
  });
  return {targets,all,reason};
}

function rollRestoration(dice,roll) {
  const match = /^(\d{0,2})d(\d{1,3})([+-]\d{1,3})?$/.exec(dice);
  if (!match) throw new Error("无效的药剂恢复骰");
  const count = Number(match[1]) || 1;
  const sides = Math.max(1,Number(match[2]));
  let total = Number(match[3] ?? 0);
  for (let i=0;i<count;i++) total += Math.floor(roll()*sides)+1;
  return Math.max(0,total);
}

function recoverMorale(state,unit,wasHeavilyWounded) {
  if (wasHeavilyWounded && !isHeavilyWounded(unit) && !unit.recoveredMorale) {
    unit.recoveredMorale = true;
    recordMorale(state,{changes:[[unit,1,"治疗后脱离重伤"]]});
  }
}

function useBattleItem(state,request,roll) {
  const actor = assertActor(state,request.actor,"player");
  const item = actor.items.find(entry=>itemKey(entry)===request.item && !entry.trap);
  if (!item || item.qty <= 0) throw new Error("没有可用的随身道具");
  const {targets,all,reason} = battleItemOptions(state,actor,item);
  const recipients = all ? targets : targets.filter(unit=>unit.id===request.target);
  if (!recipients.length) throw new Error(reason || "没有符合条件的使用对象。");
  const rule = item.battleUse;
  const healable = new Set(restorationTargets(state,actor,item));
  let restored = false;
  for (const intended of recipients) {
    const target = !all && rule?.damage ? coveredTarget(state,actor,intended) : intended;
    if (healable.has(target)) {
      restoreBattleItem(state,actor,target,item,roll);
      restored = true;
    }
    for (const name of rule?.cleanse ?? []) {
      const id = battleStatusId(name);
      if (!hasStatus(target,id)) continue;
      endStatus(state,target,id);
      note(state,target.name + "解除「" + battleStatusNames[id] + "」。","status","",{actorId:target.id});
    }
    if (rule?.damage && matchesEnemyKind(target,rule.damage.enemy_kind))
      statusLifeLoss(state,target,rule.damage.amount,item.name,actor,rule.damage.type);
    if (rule?.apply && applyBattleStatus(state,target,rule.apply.status,rule.apply.turns,actor)) {
      note(state,target.name + "获得「" + battleStatusNames[battleStatusId(rule.apply.status)] + "」。","status","",{actorId:target.id});
    }
  }
  if (!restored)
    note(state,actor.name + "使用了「" + item.name + "」。","item","",{actorId:actor.id});
  if (rule?.once_per_battle) (state.usedBattleTools[actor.id] ??= []).push(itemKey(item));
  if (item.reusable || rule?.once_per_battle) actor.acted = true;
  else spendBattleItem(state,actor,item);
}

function restoreBattleItem(state,actor,target,item,roll) {
  const recovered = rollRestoration(item.restore.dice,roll);
  const health = item.restore.resource === "hp";
  const wasHeavilyWounded = health && isHeavilyWounded(target);
  const amount = health ? Math.min(target.maxHp-target.hp,recovered)
    : Math.min(target.magic.max-target.magic.current,recovered);
  if (health) {
    target.hp += amount;
    const contribution = state.experience[actor.id];
    if (amount > 0 && contribution) contribution.acted++;
  }
  else {
    target.magic = {...target.magic,current:target.magic.current+amount};
    state.restoredMana[target.id] = target.magic.current;
  }
  const recipient = actor === target ? "自己" : target.name;
  note(state,actor.name + "给" + recipient + "使用了「" + item.name + "」，恢复 " + amount +
    " 点" + (health ? "生命" : "魔力") + "。","item","",{actorId:actor.id,targetId:actor === target ? undefined : target.id});
  recoverMorale(state,target,wasHeavilyWounded);
}

function spendBattleItem(state,actor,item) {
  const used = state.usedItems[actor.id] ??= [];
  used.push(item.key ?? item.name);
  actor.items = actor.items.map(entry=>entry===item ? {...entry,qty:entry.qty-1} : entry)
    .filter(entry=>entry.qty>0);
  const itemWeight = actor.items.reduce((sum,entry)=>sum+(entry.weight ?? 0)*entry.qty,0);
  actor.load = battleLoad(actor.load.maximum/carryKgPerStrength,actor.load.equipped,itemWeight);
  updateStamina(actor);
  actor.acted = true;
}

export function battleSwapProblem(unit, item) {
  if (!statusAllowsItems(unit)) return "当前状态无法更换装备。";
  const swap = item?.swap;
  if (!swap?.gear || !["main_hand","off_hand"].includes(swap.slot)) return "此道具不能换上";
  if (swap.slot === "off_hand" && swap.gear.durability > 0 && swap.gear.current <= 0) return "装备已损坏，无法装备";
  if (unit.lockedHands.includes(swap.slot) || (unit.handItems[swap.slot] && !unit.handItems[swap.slot].swap?.gear)) {
    return "这一格的装备无法卸下";
  }
  if (swap.slot === "main_hand" && swap.gear.twoHanded && unit.shield) return "副手有盾牌，无法换上双手武器";
  if (swap.slot === "off_hand" && unit.weapon.twoHanded) return "双手武器占用副手";
  return "";
}

function swapCarriedGear(state, request) {
  const actor = assertActor(state,request.actor,"player");
  const item = battleItemsBySlot(actor.items)[request.slot];
  const problem = battleSwapProblem(actor,item);
  if (problem) throw new Error(problem);
  const {slot,gear} = item.swap;
  const previous = actor.handItems[slot];
  const shieldCurrent = slot === "off_hand" ? actor.shield?.current : undefined;
  const swaps = state.itemSwaps[actor.id] ??= [];
  swaps.push({slot:request.slot,...(shieldCurrent !== undefined ? {shieldCurrent} : {})});
  actor.items = actor.items.filter(entry=>entry !== item);
  if (previous) {
    const stored = shieldCurrent === undefined ? previous.swap.gear : {...previous.swap.gear,current:shieldCurrent};
    actor.items.push({...previous,slot:request.slot,swap:{slot,gear:stored}});
  }
  actor.handItems[slot] = item;
  if (slot === "main_hand") actor.weapon = {headBonus:0,armorBonus:0,shieldBonus:0,...gear};
  else actor.shield = figure(gear);
  const oldWeight = previous?.weight ?? 0;
  const weightDelta = item.weight - oldWeight;
  actor.load = battleLoad(actor.load.maximum/carryKgPerStrength,actor.load.equipped+weightDelta,actor.load.items-weightDelta);
  updateStamina(actor);
  updateHandStats(actor);
  actor.acted = true;
  note(state,actor.name + "换上了「" + item.name + "」。","item","",{actorId:actor.id});
}

function strikeMount(state,actor,target,detail,summary,flanked) {
  const mount = target.mount;
  const before = mount.current;
  const {attack} = detail.damageCheck;
  const loss = Math.min(before,attack);
  mount.current -= loss;
  const dismounted = mount.current === 0;
  detail.mountDamage = {name:mount.name,before,loss,after:mount.current,dismounted};
  Object.assign(state.lastStrike,{zone:"mount",mountLoss:loss,dismounted});
  noteStrike(state,summary,detail);
  if (dismounted) {
    target.role = "步兵";
    note(state,target.name + "的" + mount.name + "倒下，在原地改为步战。","info","",{actorId:target.id});
    say(state,target,"dismount");
  }
  if (dismounted || flanked) recordMorale(state,{changes:[
    [target,-Number(dismounted)-Number(flanked),[dismounted && "坠马受惊",flanked && "遭侧翼夹击"].filter(Boolean).join("并")],
    ...(dismounted ? [[actor,1,"击落敌方坐骑"]] : []),
  ]});
}

function mountAttackSource(rider,target) {
  const mount = rider.mount;
  if (!(mount?.current > 0) || !mount.attack || !active(target) || !canFight(rider) || forcedStatus(rider)) return;
  const {hit,weapon} = mount.attack;
  if (weapon.range !== "远程" && !adjacent(rider,target)) return;
  return {...rider,name:mount.name,monster:{hit},terrainBonus:0,damage:weapon.damage,statuses:{},
    weapon:{headBonus:0,armorBonus:0,shieldBonus:0,...weapon}};
}

function coveredTarget(state,actor,target) {
  const guard = sourceFor(state,target,"cover");
  if (actor.side === target.side || !guard) return target;
  note(state,guard.name + "为" + target.name + "接下了攻击。","status","",{actorId:guard.id,targetId:target.id});
  return guard;
}

function spendAmmo(state,actor) {
  const cost = teamAmmoCost(state,actor);
  if (cost) {
    state.ammoLeft -= cost;
    state.ammoSpent += cost;
  }
}

function canCounterAttack(state,target,actor) {
  const source = attackSource(target);
  const cost = teamAmmoCost(state,source);
  return hasStatus(target,"counter") && canFight(target) && hasAttack(target) && canCounter(target) &&
    (!source.weapon.magic || canUseMagic(target)) && (!cost || state.ammoLeft >= cost) &&
    (source.weapon.range === "远程" || adjacent(target,actor));
}

function attack(state, actor, target, roll, skill, {source = attackSource(actor),mountedFollowUp = false,countering = false} = {}) {
  endStatus(state,actor,"stealth");
  target = coveredTarget(state,actor,target);
  if (!countering && canCounterAttack(state,target,actor)) {
    note(state,target.name + "先对" + actor.name + "发动反击。","status","",{actorId:target.id,targetId:actor.id});
    spendAmmo(state,attackSource(target));
    attack(state,target,actor,roll,undefined,{countering:true});
    if (!active(actor)) return target;
  }
  const adjustedDamage = attackDamage(source,skill);
  const strength = damageUsesStrength(source) ? strengthDamagePercent(source) : 0;
  const rolled = rollPercent(roll);
  const forced = rolled <= hitFloor ? "hit" : rolled > hitCeiling ? "miss" : null;
  const accuracy = {...accuracyFor(source,target,state.weather,state,skill),roll:rolled,forced};
  const hit = rolled <= accuracy.chance;
  const outcome = hit ? "hit" : rolled <= accuracy.blockLimit ? "block" : rolled <= accuracy.dodgeLimit ? "dodge" : "miss";
  const largeBonus = accuracy.largeBonus;
  const untypedAttack = Math.round(adjustedDamage*(100+largeBonus)/100);
  const damageCheck = {
    weaponDamage:source.weapon.damage, strength:damageUsesStrength(source) ? source.attributes.strength : null,
    strengthPercent:strength, baseAdjustedDamage:source.damage, adjustedDamage, untypedAttack,
    damageModifiers:skill ? [] : activeStatusValues(source,[["charge",30],["weakness",-30]]),
    largeBonus, attack:typedDamage(target,untypedAttack,source.weapon.damageType),
  };
  const detail = {
    hit,outcome,actor:source.name,target:target.name,actorId:actor.id,targetId:target.id,weapon:source.weapon.name,accuracy,damageCheck,damage:null,
    mountDamage:null,...(skill ? {name:skill.name} : {}),
  };
  if (!countering) actor.acted = true;
  state.lastStrike = {id:++state.serial, actor:actor.id, target:target.id, row:target.row, hit,outcome, at:Date.now()};
  const summary = mountedFollowUp ? actor.name + "的" + source.name + "追击" + target.name
    : actor.name + (skill ? "对" + target.name + "使用了技能「" + skill.name + "」" : "攻击" + target.name);
  if (!hit) {
    const shield = outcome === "block" ? intactShield(target) : null;
    if (shield) {
      const before = shield.current;
      const impact = shieldImpact(source,damageCheck.attack);
      const bonus = impact - damageCheck.attack;
      const blocked = Math.min(before,impact);
      shield.current -= blocked;
      if (blocked > 0) trackEffectiveStrike(state,actor,target);
      detail.guard = {shield:shield.name,before,blocked,after:shield.current,bonus,impact,
        bonusRate:Math.round(source.weapon.shieldBonus * 100),broken:shield.current === 0};
      Object.assign(state.lastStrike,{zone:"shield",guard:detail.guard});
    }
    noteStrike(state,summary,detail);
    if (outcome === "miss" && !mountedFollowUp) say(state,actor,"miss");
    if (detail.guard?.broken) {
      say(state,target,"shieldBreak");
      recordMorale(state,{changes:[[target,-1,"盾牌破碎"],[actor,1,"打碎敌方盾牌"]]});
    }
    return target;
  }
  const flanked = isFlankingHit(state,source,target);
  if (target.mount?.current > 0) {
    strikeMount(state,actor,target,detail,summary,flanked);
    if (!mountedFollowUp) say(state,actor,"hit");
    return target;
  }

  const weaponBonus = Math.round(source.weapon.headBonus * 100);
  const location = {base:baseHeadChance, weaponBonus, chance:headChance(source), roll:rollPercent(roll)};
  const zone = location.roll <= location.chance ? "head" : "body";
  const armor = target.armor[zone];
  const armorBefore = armor.current;
  const hpBefore = target.hp;
  const strikeDamage = damageCheck.attack;
  const result = resolveStrike(target,strikeDamage,zone,source.weapon.penetration,source.weapon.armorBonus);
  const withdrawBelow = state.encounter?.arena?.withdrawBelow;
  if (withdrawBelow && target.hp === 0) {
    target.hp = 1;
    result.hpLoss = hpBefore - target.hp;
  }
  const {penetration,blocked,hpLoss} = result;
  if (blocked > 0 || hpLoss > 0) trackEffectiveStrike(state,actor,target);
  const dealt = state.damageStats[actor.id];
  if (dealt) {
    dealt.armor += blocked;
    dealt.hp += hpLoss;
  }
  const received = state.damageStats[target.id];
  if (received) received.taken += blocked + hpLoss;
  detail.damage = {
    location,zone,...result,armor:armor.layers ? "身甲" : armor.name,armorBefore,
    armorAfter:armor.current,hpBefore,hpAfter:target.hp,
  };
  Object.assign(state.lastStrike,{zone,damage:strikeDamage,penetration,blocked,hpLoss});
  noteStrike(state,summary,detail);
  if (!mountedFollowUp) say(state,actor,"hit");
  afterLifeLoss(state,target,hpLoss);
  if (hpLoss > 0 && hasStatus(actor,"poisonedWeapon") && !mountedFollowUp && source.weapon.name !== "徒手") {
    endStatus(state,actor,"poisonedWeapon");
    if (applyBattleStatus(state,target,"poisoned",2,actor))
      note(state,target.name + "被淬毒武器击中，陷入中毒。","status","",{actorId:actor.id,targetId:target.id});
  }
  if (settleFallenOrWithdrawn(state,target,actor)) {
    if (target.arenaWithdrawn) state.lastStrike.arenaWithdrawn = true;
  } else {
    const changes = [];
    if (hpLoss > 0) {
      const threshold = target.maxHp*heavyWoundRatio;
      const heavy = target.hp <= threshold && hpBefore > threshold;
      say(state,target,heavy ? "heavy" : "light");
      if (heavy) {
        const severe = hpLoss>=target.maxHp*.4;
        changes.push([target,severe ? -2 : -1,severe ? "遭受致命重创" : "陷入重伤"],[actor,1,"重创敌人"]);
      }
    }
    if (flanked) {
      const injury = changes.find(([unit])=>unit===target);
      if (injury) { injury[1]--; injury[2]+="并遭侧翼夹击"; }
      else changes.push([target,-1,"遭侧翼夹击"]);
    }
    if (changes.length) recordMorale(state,{changes});
  }
  return target;
}

function settleFallenOrWithdrawn(state,target,actor) {
  const below = state.encounter?.arena?.withdrawBelow;
  if (below && active(target) && target.hp < target.maxHp*below) {
    Object.assign(target,{arenaWithdrawn:true,row:"reserve",column:null});
    clearDepartedSources(state,target);
    note(state,target.name + "生命低于 " + below * 100 + "%，退出竞技。","info","",{actorId:target.id});
  } else if (target.hp === 0) {
    removeFallen(state,target,actor);
  } else return false;
  const contribution = actor && state.experience[actor.id];
  if (contribution && target.side !== actor.side) contribution.defeated++;
  return true;
}

function removeFallen(state,target,actor) {
  state.fallen.push(settlementEntry(target,"corpse",state.encounter?.persistentSpoils));
  say(state,target,"fall");
  state.units = state.units.filter(unit=>unit!==target);
  clearDepartedSources(state,target);
  note(state,target.name + "阵亡离场。","info","",{actorId:target.id});
  recordMorale(state,{actor:actor?.side !== target.side ? actor : undefined,fallen:[target]});
  for (const ally of sideUnits(state,target.side)) {
    if (active(ally)) say(state,ally,"allyFall");
  }
}

export function action(state, request, roll = Math.random) {
  const {type} = request;
  if (type === "settle") {
    settle(state,request,roll);
  } else if (["terrain","deploy","start","encounterExit"].includes(type)) {
    if (state.phase !== "setup") throw new Error("布阵已结束");
    if (type === "terrain" && request.terrain !== state.terrain.id) {
      assignTerrain(state, request.terrain);
      state.weather = drawWeather(state.terrain,roll);
    }
    if (type === "deploy") {
      const unit = state.units.find((entry) => entry.id === request.actor && entry.side === "player");
      if (!unit || unit.tamed || !["front","back","reserve"].includes(request.row)) throw new Error("站位无效");
      if (unit.row !== request.row && occupancy(state,"player",request.row).length >= capacity(state,request.row)) throw new Error("这一排已满");
      const prior = unit.row;
      unit.row = request.row;
      unit.position = Math.max(...state.units.map((entry) => entry.position)) + 1;
      alignSetupRow(state,"player",prior);
      alignSetupRow(state,"player",unit.row);
    }
    if (type === "start") {
      const width = state.fieldColumns.length;
      const {formation,enemyFormation} = request;
      if (formation !== undefined && !validFormation(state,width,formation))
        throw new Error("阵型无效，请检查各排人数与宽度。");
      if (enemyFormation !== undefined && (!state.enemyFormationEnabled || !validFormation(state,width,enemyFormation,"enemy")))
        throw new Error("无法应用敌方阵型，请检查上场队员与宽度。");
      const deployed = new Set(formation && deploymentRows.flatMap(row=>formation[row]));
      const fighters = state.units.filter(unit=>(!state.encounter || !unit.noncombatant) && (!unit.tamed || deployed.has(unit.id)));
      if (state.encounter && !fighters.some(unit=>unit.side === "enemy" && unit.hp>0)) throw new Error("对方没有战斗人员");
      const roster = fighters.filter(unit=>unit.hp>0 && (state.enemyFormationEnabled || unit.side==="player"));
      for (const unit of roster) {
        if (battleItemCount(unit.items)>battleItemSlots) throw new Error(`${unit.name}的道具栏超过 ${battleItemSlots} 件，请先调整随身道具。`);
        if (unit.load.remaining<0) throw new Error(unit.name+"已超出个人最大负重，请先调整装备或物品。");
      }
      if (formation !== undefined) applyFormation(state,formation);
      if (enemyFormation !== undefined) applyFormation(state,enemyFormation);
      if (!sideUnits(state,"player").some(active)) throw new Error("至少安排一名士兵上阵");
      if (state.encounter && state.units.some(unit=>unit.noncombatant)) {
        state.units = fighters;
        applyFormation(state,standardFormation(state,width,"enemy"));
      }
      state.units = fighters;
      for (const unit of fighters) {
        if (unit.tamed) state.damageStats[unit.id] = {name:unit.name,emoji:unit.emoji,armor:0,hp:0,taken:0};
      }
      for (const unit of state.units.filter(active)) {
        enterBattleExperience(state,unit);
        if (unit.side === "enemy" && unit.monster && state.encounter?.enemySurprised) applyBattleStatus(state,unit,"surprised",1);
      }
      initializeStatuses(state);
      startMorale(state);
      advance(state);
    }
    if (type === "encounterExit") {
      if (!["retreat","surrender"].includes(request.decision)) throw new Error("无效的遭遇选择");
      if (request.decision === "retreat" && state.encounter?.hostile === false) state.peacefulExit = true;
      finishBattle(state,"player",request.decision === "retreat" ? "withdrawal" : "surrender");
    }
  } else if (type === "reinforce" || type === "finishReinforcement") {
    if (state.phase !== "reinforcement") throw new Error("只能在回合末安排预备队");
    if (type === "reinforce") {
      const {units,columns} = reinforcementOptions(state,"player");
      if (!units.includes(request.actor)) throw new Error("请选择一名我方预备队角色");
      if (request.row !== "back" || !columns.back.includes(request.column)) {
        throw new Error("请选择我方后排的空位");
      }
      enterFromReserve(state,state.units.find(unit=>unit.id===request.actor),request.row,request.column);
    }
    if (type === "finishReinforcement" && state.autoBattle) reinforceSide(state,"player");
    if (type === "finishReinforcement" || !reinforcementOptions(state,"player").units.length) advance(state);
  } else if (type === "retreat" || type === "enemyRetreat") {
    const actor = assertActor(state,request.actor,type === "retreat" ? "player" : "enemy");
    const problem = retreatProblem(state,actor);
    if (problem) throw new Error(problem);
    if (!movementBreaksFreeze(state,actor)) {
      Object.assign(actor,{row:"reserve",fieldSide:actor.side,column:null,acted:true});
      clearDepartedSources(state,actor);
      note(state,actor.name + "撤回预备队。","info","",{actorId:actor.id});
      advance(state);
    }
  } else if (type === "move" || type === "enemyMove") {
    const actor = assertActor(state,request.actor,type === "move" ? "player" : "enemy");
    const {destinations,blockedReason} = movementOptions(state,actor);
    const destination = destinations.find(spot=>sameSpot(spot,request));
    if (!destination) {
      throw new Error(blockedReason || "请选择移动范围内可通行的空格。");
    }
    if (!movementBreaksFreeze(state,actor)) {
      const {fieldSide,row,column} = destination;
      Object.assign(actor,{fieldSide,row,column,moved:true});
      const line = (fieldSide === "player" ? "我方" : "敌方") + (row === "front" ? "前排" : "后排");
      note(state,actor.name+"移动到"+line+"。","info","",{actorId:actor.id});
      recordMorale(state,{reinforced:actor});
    }
  } else if (type === "placeTrap") {
    throw new Error("只能在探索中布设陷阱。");
  } else if (type === "item") {
    useBattleItem(state,request,roll);
    advance(state);
  } else if (type === "swapItem") {
    swapCarriedGear(state,request);
    advance(state);
  } else if (type === "wake") {
    const actor = assertActor(state,request.actor,state.phase);
    const target = wakeTargets(state,actor).find(unit=>unit.id===request.target);
    if (!target) throw new Error("只能唤醒同列或同排相邻的睡眠队友。");
    endStatus(state,target,"sleep");
    actor.acted = true;
    note(state,actor.name + "唤醒了" + target.name + "。","status","",{actorId:actor.id,targetId:target.id});
    advance(state);
  } else if (type === "statusAction") {
    const actor = assertActor(state,request.actor,state.phase,true);
    const condition = controlledStatus(actor);
    if (!condition) throw new Error("该角色的行动未受控制。");
    const targets = reachable(state,actor.id);
    const target = condition === "confusion" ? targets[Math.floor(roll()*targets.length)] : targets.find(canFight) ?? targets[0];
    actor.acted = true;
    note(state,actor.name + "因" + battleStatusNames[condition] +
      (target ? "攻击" + target.name + "。" : "没有可攻击的目标，跳过行动。"),
      "status","",{actorId:actor.id,targetId:target?.id});
    if (target) {
      spendAmmo(state,attackSource(actor));
      attack(state,actor,target,roll);
    }
    advance(state);
  } else if (type === "passRestrictedTurn") {
    const actor = assertActor(state,request.actor,state.phase);
    if (!canPassRestrictedTurn(state,actor)) throw new Error("当前仍可移动或攻击。");
    actor.acted = true;
    note(state,actor.name + "因" + battleStatusNames[forcedStatus(actor)] + "无法采取有效行动，跳过行动。","status","",{actorId:actor.id});
    advance(state);
  } else if (["attack","enemyAttack","enemySkill","playerSkill"].includes(type)) {
    const side = type === "attack" || type === "playerSkill" ? "player" : "enemy";
    const actor = assertActor(state,request.actor,side);
    const usesSkill = type === "enemySkill" || type === "playerSkill";
    const skill = usesSkill && actor.skills.includes(request.skill) ? enemySkills[request.skill] : undefined;
    if (usesSkill && !skill) throw new Error("该技能现在无法使用");
    if (usesSkill && !canUseSkill(actor,skill)) throw new Error("当前状态无法使用该技能。");
    if (skill?.healRatio) {
      const healing = healingAmount(actor,skill);
      if (!healing) throw new Error("生命值已满");
      const wasHeavilyWounded = isHeavilyWounded(actor);
      actor.hp += healing;
      actor.acted = true;
      note(state,actor.name + "使用了技能「" + skill.name + "」，回复 " + healing + " 点血量。","skill","",{actorId:actor.id});
      recoverMorale(state,actor,wasHeavilyWounded);
    } else {
      const {target} = assertAttack(state,request.actor,request.target,side);
      spendAmmo(state,attackSource(actor));
      const struck = attack(state,actor,target,roll,skill);
      const followUp = active(actor) && mountAttackSource(actor,struck);
      if (followUp) attack(state,actor,struck,roll,undefined,{source:followUp,mountedFollowUp:true});
      if (actor.monster && !forcedStatus(actor) && ++actor.attacksMade < actor.monster.attacksPerAction && canFight(actor) &&
          reachable(state,actor.id).some(canFight)) {
        actor.acted = false;
        state.rev++;
        return;
      }
    }
    if (skill) actor.skills = actor.skills.filter(id=>id!==request.skill);
    advance(state);
  } else if (type === "monsterPass") {
    const actor = assertActor(state,request.actor,state.phase);
    if (!actor.monster) throw new Error("只有怪物可以这样结束行动。");
    actor.acted = true;
    note(state,actor.name + "够不着敌人，结束行动。","info","",{actorId:actor.id});
    advance(state);
  } else if (type === "dodge" || type === "enemyDodge") {
    const actor = assertActor(state,request.actor,type === "dodge" ? "player" : "enemy");
    if (forcedStatus(actor)) throw new Error("当前状态无法主动闪避。");
    actor.acted = true;
    actor.statuses.dodge = Math.max(1,actor.statuses.dodge ?? 0);
    if (actor.statuses.dodge === 1) actor.stances.dodge = true;
    note(state,actor.name + "开始“闪避”。","dodge","",{actorId:actor.id,actor:actor.name});
    advance(state);
  } else if (type === "defend" || type === "enemyDefend") {
    const actor = assertActor(state,request.actor,type === "defend" ? "player" : "enemy");
    if (forcedStatus(actor)) throw new Error("当前状态无法主动防御。");
    actor.acted = true;
    actor.statuses.defend = Math.max(1,actor.statuses.defend ?? 0);
    if (actor.statuses.defend === 1) actor.stances.defend = true;
    note(state,actor.name + "开始“防御”。","guard","",{actorId:actor.id,actor:actor.name});
    say(state,actor,"guard");
    advance(state);
  } else {
    throw new Error("未知操作");
  }
  state.rev++;
}

function forecastAttack(state, actor, target, skill) {
  const {chance,blockLimit,largeBonus} = accuracyFor(actor,target,state.weather,state,skill);
  actor = attackSource(actor);
  const hit = chance / 100;
  const damage = typedDamage(target,Math.round(attackDamage(actor,skill)*(100+largeBonus)/100),actor.weapon.damageType);
  const shield = intactShield(target);
  const shieldDamage = shield ? Math.min(shield.current,shieldImpact(actor,damage)) : 0;
  const shieldValue = shieldDamage * .20 + (shieldDamage > 0 && shieldDamage === shield.current ? 8 : 0);
  const block = (blockLimit - chance) / 100;
  if (target.mount?.current > 0) {
    const loss = Math.min(damage,target.mount.current);
    const mountValue = hit * (loss * .45 + (loss === target.mount.current ? 15 : 0));
    return {offense:mountValue+block*shieldValue,pressure:mountValue+block*shieldDamage*.1,defeat:0};
  }
  const head = Math.max(0,Math.min(100,headChance(actor))) / 100;
  let health = 0, armor = 0, defeat = 0;
  for (const [zone,probability] of [["head",hit*head],["body",hit*(1-head)]]) {
    const {hpDamage,blocked} = strikeBreakdown(damage,actor.weapon.penetration,actor.weapon.armorBonus,target.armor[zone],zone);
    const life = lifeDamage(target,hpDamage);
    health += probability*Math.min(target.hp,life);
    armor += probability*blocked;
    if (life >= target.hp) defeat += probability;
  }
  return {
    offense:health + armor*.3 + block*shieldValue + defeat*(target.morale === whiteFlag ? 8 : 30),
    pressure:health + armor*.15 + block*shieldDamage*.1 + defeat*target.maxHp*.75,
    defeat,
  };
}

function upcomingOpponents(state, actor, pending) {
  const nextRound = orderedActors({...state,
    units:state.units.map(unit=>({...unit,acted:false}))});
  const beforeNextTurn = nextRound.slice(0,nextRound.findIndex(unit=>unit.id===actor.id));
  return [...pending.slice(1),...beforeNextTurn]
    .filter(unit=>unit.side!==actor.side && unit.morale!==whiteFlag);
}

function pressureFrom(state, actor, target) {
  const options = reachable(state,actor.id);
  if (!options.some(unit=>unit.id===target.id)) return 0;
  const exposure = options.length === 1 ? 1 : .55;
  return exposure*forecastAttack(state,actor,target).pressure;
}

const expectedPressure = (state,target,opponents) => opponents.reduce((sum,actor)=>sum+pressureFrom(state,actor,target),0);

const tacticalActions = {
  player:{retreat:"retreat",attack:"attack",skill:"playerSkill",defend:"defend",dodge:"dodge",move:"move"},
  enemy:{retreat:"enemyRetreat",attack:"enemyAttack",skill:"enemySkill",defend:"enemyDefend",dodge:"enemyDodge",move:"enemyMove"},
};

export function chooseEnemy(state) {
  return state.phase === "enemy" ? chooseBattleAction(state) : null;
}

function closestEnemyDistance(unit,targets) {
  return Math.min(...targets.map(target=>
    Math.max(Math.abs(rankOf(unit)-rankOf(target)),Math.abs(unit.column-target.column))));
}

function chooseMonsterAction(state,actor,actions) {
  const targets = reachable(state,actor.id);
  const target = targets.find(canFight) ?? targets[0];
  if (target) return {type:actions.attack,actor:actor.id,target:target.id};

  const enemies = sideUnits(state,other(actor.side)).filter(active);
  let distance = closestEnemyDistance(actor,enemies);
  let advanceTo;
  for (const spot of movementOptions(state,actor).destinations) {
    const remaining = closestEnemyDistance(spot,enemies);
    if (remaining >= distance) continue;
    advanceTo = spot;
    distance = remaining;
  }
  if (advanceTo) {
    const {fieldSide,row,column} = advanceTo;
    return {type:actions.move,actor:actor.id,fieldSide,row,column};
  }
  return {type:"monsterPass",actor:actor.id};
}

function chooseRestrictedAction(state,actor,actions) {
  const targets = reachable(state,actor.id);
  const target = targets.find(canFight) ?? targets[0];
  if (target) return {type:actions.attack,actor:actor.id,target:target.id};
  const opponents = sideUnits(state,other(actor.side)).filter(active);
  const destination = movementOptions(state,actor).destinations
    .sort((a,b)=>closestEnemyDistance(a,opponents)-closestEnemyDistance(b,opponents))[0];
  if (destination) return {type:actions.move,actor:actor.id,...destination};
  return {type:"passRestrictedTurn",actor:actor.id};
}

export function chooseBattleAction(state) {
  const actions = tacticalActions[state.phase];
  if (!actions) return null;
  const pending = orderedActors(state);
  const actor = pending[0];
  if (!actor) return null;
  if (controlledStatus(actor)) return {type:"statusAction",actor:actor.id};
  if (forcedStatus(actor)) return chooseRestrictedAction(state,actor,actions);
  if (actor.monster) return chooseMonsterAction(state,actor,actions);

  const {id,hp,maxHp} = actor;
  const hasFightingAlly = sideUnits(state,actor.side).some(unit=>unit!==actor && canFight(unit));
  if (!actor.attacksMade && hp <= maxHp*heavyWoundRatio && !retreatProblem(state,actor) && hasFightingAlly) {
    return {type:actions.retreat,actor:id};
  }

  const opponents = upcomingOpponents(state,actor,pending);
  const pressure = expectedPressure(state,actor,opponents);
  const urgency = 1.1 + (1-hp/maxHp)*.9;
  let best, bestValue = -Infinity;
  const consider = (type,value,options) => {
    if (value <= bestValue) return;
    bestValue = value;
    best = {type,actor:id,...options};
  };
  const targets = reachable(state,id);
  const valueOfAttack = (target,skill) => {
    const {offense,defeat} = forecastAttack(state,actor,target,skill);
    // Removing a threat before its turn can be safer than spending the turn guarding.
    const threat = opponents.filter(unit=>unit.id===target.id).length;
    return offense + defeat*threat*pressureFrom(state,target,actor)*urgency;
  };
  for (const target of targets) consider(actions.attack,valueOfAttack(target),{target:target.id});
  if (actor.attacksMade && best) return best;
  for (const skillId of actor.skills) {
    const skill = enemySkills[skillId];
    if (!skill || !canUseSkill(actor,skill)) continue;
    if (skill.healRatio) {
      if (!hasFightingAlly && targets.length) continue;
      const healing = healingAmount(actor,skill);
      if (healing > 0) {
        const safer = pressure - expectedPressure(state,{...actor,hp:hp+healing},opponents);
        consider(actions.skill,healing+Math.max(0,safer)*urgency*.5-6,{skill:skillId});
      }
    } else {
      for (const target of targets) {
        consider(actions.skill,valueOfAttack(target,skill) - 6,{skill:skillId,target:target.id});
      }
    }
  }
  const considerDefense = () => {
    consider(actions.defend,(pressure-expectedPressure(state,{...actor,statuses:{...actor.statuses,defend:1}},opponents))*urgency);
    consider(actions.dodge,(pressure-expectedPressure(state,{...actor,statuses:{...actor.statuses,dodge:1}},opponents))*urgency);
  };
  if (hasFightingAlly) considerDefense();

  if (!targets.length) {
    const targetsAhead = sideUnits(state,other(actor.side)).filter(active);
    const distance = unit=>closestEnemyDistance(unit,targetsAhead);
    const before = distance(actor);
    for (const {fieldSide,row,column} of movementOptions(state,actor).destinations) {
      const moved = {...actor,fieldSide,row,column};
      const projection = {...state,units:state.units.map(unit=>unit===actor ? moved : unit)};
      const nextAttack = Math.max(0,...reachable(projection,id).map(target=>forecastAttack(projection,moved,target).offense));
      const remaining = distance(moved);
      const approaching = remaining < before;
      if (!hasFightingAlly && !approaching && !nextAttack) continue;
      const nextPressure = expectedPressure(projection,moved,opponents);
      const approach = approaching ? (before-remaining)*actor.damage*.35 : 0;
      const value = (pressure-nextPressure)*urgency + nextAttack*.45 + approach;
      consider(actions.move,approaching && pressure===0 ? Math.max(1,value) : value,{fieldSide,row,column});
    }
  }
  if (!best) considerDefense();
  return best;
}
