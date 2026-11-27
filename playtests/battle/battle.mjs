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

export const catalog = structuredClone({
  ...battleCatalog,weapons:{...battleCatalog.weapons,徒手:basicWeapons.unarmed},mounts:defaultMounts,
});
const enemySkills = {
  measured_strike:{name:"稳扎一击",hit:15},
  aimed_shot:{name:"瞄准射击",hit:20},
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
const available = (unit) => unit.hp > 0 && !unit.arenaWithdrawn;
const sideUnits = (state, side) => state.units.filter((unit) => unit.side === side && available(unit));
const active = (unit) => available(unit) && unit.row !== "reserve";
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
const hasAttack = (unit) => !unit.monster || unit.monster.hit !== undefined;
const damageUsesStrength = (unit) => !unit.monster && !unit.weapon.magic;
const isMeleeFighter = (unit) => canFight(unit) && hasAttack(unit) && unit.weapon.range !== "远程";

export function effectiveAttribute(unit,attribute) {
  const raw = unit.attributes[attribute];
  if (attribute !== "dexterity" && attribute !== "intelligence") return raw;
  const cap = Math.min(...Object.values(unit.armor).map(gear=>gear.attributeCap ?? Infinity));
  return Math.min(raw,attributeBenchmark+cap);
}

function initiativeParts(unit) {
  if (unit.monster) return [["怪物先攻",unit.monster.initiative,true]];
  const dexterity = effectiveAttribute(unit,"dexterity");
  const equipment = [["主手",unit.weapon],["头盔",unit.armor.head],["护甲",unit.armor.body],["盾牌",unit.shield]];
  return [
    ["敏捷（" + dexterity + " − " + attributeBenchmark + "）",dexterity - attributeBenchmark,true],
    ...equipment.filter(([,gear])=>gear?.initiative).map(([slot,gear])=>[slot + " · " + gear.name,gear.initiative]),
  ];
}

function updateHandStats(unit) {
  unit.initiative = initiativeParts(unit).reduce((total,[,amount])=>total+amount,0);
  unit.damage = damageUsesStrength(unit) ?
    Math.round(unit.weapon.damage * (100 + strengthDamagePercent(unit)) / 100) : unit.weapon.damage;
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
  unit.armor = {head:figure(gear.head),body:figure(gear.body)};
  unit.shield = gear.shield ? figure(gear.shield) : null;
  unit.load = gear.load;
  unit.items = gear.items ?? [];
  unit.handItems = gear.handItems;
  unit.lockedHands = gear.lockedHands;
  unit.additionalGear = gear.additionalGear;
  unit.profileResistances = gear.profileResistances;
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
  if (!active(actor) || actor.monster?.fly) return "";
  const opponent = controllers(state,actor).find(unit=>adjacent(actor,unit));
  return opponent ? "位于"+opponent.name+"的控制区内，无法移动或撤退。" : "";
}

export function movementOptions(state,actor) {
  if (!canFight(actor)) return {destinations:[],blockedReason:"该角色目前无法移动。"};
  if (actor.moved) return {destinations:[],blockedReason:"该角色本次行动已经移动，仍可攻击或采取其他行动。"};
  const blockedReason = retreatProblem(state,actor);
  if (blockedReason) return {destinations:[],blockedReason};
  const enemies = actor.monster?.fly ? [] : controllers(state,actor);
  const occupied = new Set(state.units.filter(active).map(unit=>rankOf(unit)+":"+unit.column));
  const destinations = [];
  const maxSteps = actor.monster?.speed ?? (actor.mount?.current > 0 ? 2 : 1);
  let frontier = [{rank:rankOf(actor),column:actor.column}];
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
          destinations.push({...position,controlled});
          if (!controlled) next.push({rank,column});
        }
      }
    }
    frontier = next;
  }
  return {destinations,blockedReason:destinations.length ? "" : "移动范围内没有可通行的空格。"};
}

export function note(state, text, kind = "info", speaker = "", detail) {
  const at = kind === "speech" ? detail.startsAt : Date.now();
  state.log.push({id:++state.serial, text, kind, speaker, detail, at});
}

function recordMorale(state,event) {
  settleMorale(state,event,(unit,reason,previous)=>{
    const {morale} = unit;
    const delta = morale-previous;
    const change = (delta > 0 ? "+" : "") + delta;
    const result = morale === whiteFlag ? "举起白旗" : previous === whiteFlag ? "恢复战斗意志" :
      "现为" + (morale > 0 ? "+" : "") + morale;
    note(state,unit.name + reason + "，士气 " + change + "，" + result + "。","morale","",{actorId:unit.id});
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
  const rows = preferredDeployment(sideUnits(state,side), row => formationCapacity(state,width,row));
  return Object.fromEntries(deploymentRows.map(row => [row,rows[row].toSorted(order).map(unit=>unit.id)]));
}

export function validFormation(state,width,formation,side="player") {
  if (!formation || !deploymentRows.every(row => Array.isArray(formation[row]) &&
      formation[row].length <= formationCapacity(state,width,row))) return false;
  const fielded = [...formation.front,...formation.back].filter(id => id !== null);
  const deployed = [...fielded,...formation.reserve.filter(id => id !== null)];
  const units = sideUnits(state,side);
  return fielded.length > 0 && deployed.length === units.length &&
    new Set(deployed).size === units.length && units.every(unit => deployed.includes(unit.id));
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

function assignTerrain(state, terrainId) {
  const terrain = catalog.terrain.find((item) => item.id === terrainId);
  if (!terrain) throw new Error("地形不存在");
  state.terrain = terrain;
  state.fieldColumns = formationColumns(Math.max(terrain.front,terrain.back));
  for (const side of ["player","enemy"]) {
    const rows = preferredDeployment(sideUnits(state,side), row => capacity(state,row));
    for (const row of deploymentRows) {
      for (const unit of rows[row]) Object.assign(unit,{row,fieldSide:unit.side});
      alignSetupRow(state,side,row);
    }
  }
}

export function createBattleUnit(character, position = 0) {
  const weapon = typeof character.weapon === "string" ? catalog.weapons[character.weapon] : character.weapon;
  const defaultWeapon = character.monster ? {name:"无基础攻击",range:"短",damage:0,penetration:0} : catalog.weapons.徒手;
  const mount = catalog.mounts[character.mount];
  const unit = {
    id:character.id, name:character.name, role:character.role, side:character.side,
    ...(character.noncombatant ? {noncombatant:true} : {}),
    ...(character.monster ? {monster:character.monster,attacksMade:0} : {}),
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
    preferred:character.row, position, row:character.row, acted:false, moved:false, statuses:{}, morale:0,
    attributes:Object.fromEntries(attributeNames.map(name=>[name,character.attributes?.[name] ?? defaultAttribute])),
    dialogue:createDialogue(character.presetId ?? character.id),
    voiceProfile:character.gender === "female" || (character.presetId ?? character.id) === "vera" ? "female" : undefined,
    weapon:{headBonus:0,armorBonus:0,shieldBonus:0,...(weapon ?? defaultWeapon)},
    armor:{head:figure(character.head),body:figure(character.body)},
    shield:character.shield ? figure(character.shield) : null,
    mount:mount ? {
      name:mount.name, size:mount.size ?? defaultMounts[character.mount]?.size ?? "中型",
      current:mount.maxHp, max:mount.maxHp, ...(mount.draft ? {draft:mount.draft} : {}),
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

export function createBattle(terrain = "woods", weatherId = "clear", supplies = [], player, rosterProfiles, allies = [], partyMemberIds = [], enemies, encounter) {
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
    experience:{},
    damageStats:Object.fromEntries(participants.filter(unit=>unit.side==="player").map(unit=>[unit.id,{name:unit.name,armor:0,hp:0,taken:0}])),
    units:participants.map(createBattleUnit),
    ...(encounter ? {encounter} : {}),
  };
  assignTerrain(state, terrain);
  if (state.terrain.indoors) state.weather = drawWeather(state.terrain);
  return state;
}

export function reachable(state, actorId) {
  return attackOptions(state,actorId).targets;
}

function teamAmmoCost(state,actor) {
  if (state.ammoLeft === undefined || actor.side !== "player") return 0;
  const {weapon} = actor;
  const name = weapon.baseName ?? weapon.name;
  if (weapon.range !== "远程" || weapon.magic || /投石|石索/.test(name)) return 0;
  return /飞斧|投斧|标枪/.test(name) ? 3 : 1;
}

export function attackOptions(state, actorId) {
  const actor = state.units.find((unit) => unit.id === actorId);
  if (!actor || !active(actor) || !hasAttack(actor)) return {targets:[]};
  const cost = teamAmmoCost(state,actor);
  if (cost && state.ammoLeft < cost) return {targets:[],
    blockedReason:cost === 1 ? "队伍弹药不足" : "队伍弹药不足，需要 " + cost + " 单位"};
  const enemies = sideUnits(state,other(actor.side)).filter(active);
  if (actor.weapon.range === "远程") return {targets:enemies};
  return {targets:enemies.filter(target=>adjacent(actor,target)),blockedReason:"近战只能攻击相邻格内的敌人，直向和斜向都算。"};
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
  layer.current -= result.blocked;
  const hpLoss = Math.min(target.hp,result.hpDamage);
  target.hp -= hpLoss;
  return {...result,hpLoss};
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
  const monster = Boolean(unit.monster);
  const protection = [["head","头盔",armor.head],["body","护甲",armor.body],["off_hand","盾牌",shield]];
  const source = slot => persistent ? {source:{unit:id,slot}} : {};
  const items = [];
  if (!monster) {
    if (!persistent || weapon.campaignGear) items.push({name:weapon.name,kind:"武器",...source("main_hand")});
    for (const [slot,type,gear] of protection) {
      if (gear?.current > 0 && (!persistent || gear.campaignGear)) {
        items.push({name:gear.name,kind:type,current:gear.current,max:gear.max,...source(slot)});
      }
    }
  }
  return {
    kind,card:structuredClone({id,name,side,role,profession,portrait,profilePortrait,portraitSprite,portraitCropKey,
      portraitFraming,portraitVersion,armor,shield,mount,magic,stamina,morale,level,hp,maxHp}),
    monster,items,looted:false,disposition:null,capturable:!monster,
    ...(persistent ? {
      durability:Object.fromEntries(protection.filter(([, , gear])=>gear?.max > 0).map(([slot, , gear])=>[slot,gear.current]))} : {}),
  };
}

export function pendingCorpseAction(entry) {
  if (entry?.kind !== "corpse" || entry.looted || entry.disposition) return;
  return entry.monster ? "butcher" : "loot";
}

export const settlementItemKey = item => JSON.stringify([item.kind,item.name,item.current,item.max,
  ...(item.source ? [item.source.unit,item.source.slot] : []),...(item.harvested ? ["harvested"] : [])]);

function stackItem(items,item,quantity=1) {
  const key = settlementItemKey(item);
  const existing = items.find(slot=>settlementItemKey(slot)===key);
  if (existing) existing.quantity += quantity;
  else items.push({...item,quantity});
}

export function settlementProblem(entry,command) {
  if (entry.disposition) return "该对象已处理";
  if (command === "loot" || command === "butcher") {
    if (entry.looted) return "已搜刮过该对象";
    if ((command === "butcher") !== entry.monster) return entry.monster ? "怪物只能屠宰" : "此对象只能搜刮";
  } else if (entry.kind !== "prisoner") {
    return "只能对俘虏执行此操作";
  }
  if (command === "execute" && entry.monster) return "怪物只能屠宰";
  if (command === "recruit" && entry.capturable === false) return "此对象无法带走";
  return "";
}

function settle(state,{command,target,all},roll) {
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
    stackItem(loot,{...item,id:++state.serial},quantity);
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
  if (!["loot","butcher","execute","recruit"].includes(command)) throw new Error("未知结算操作");
  if (all === true) {
    if (command === "recruit") throw new Error("请选择一名要收押的俘虏");
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
  if (command === "loot") {
    for (const item of entry.items) stackItem(loot,{...item,id:++state.serial});
    const {armor,shield} = entry.card;
    armor.head.current = 0;
    armor.body.current = 0;
    if (shield) shield.current = 0;
    entry.looted = true;
  } else {
    entry.disposition = command;
    if (command === "execute" || command === "butcher") entry.card.hp = 0;
    if (command === "butcher" && state.encounter?.wildMonster) return harvestMonster(state,loot,roll);
  }
}

function harvestMonster(state,loot,roll) {
  const rules = state.encounter.butchery;
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
    state.settlement = {entries:[...state.fallen,...prisoners],loot:[],inventory:state.supplies,left:false};
  }
  const loser = side === "player" ? "我方" : "敌方";
  const result = {surrender:"全队举起白旗，溃败。",elimination:"全员阵亡。",withdrawal:"撤离战场。",arenaWithdrawal:"全员退出竞技。"};
  note(state,loser+result[reason]);
}

function startNextRound(state) {
  reinforceSide(state,"enemy");
  if (resolveDefeat(state)) return false;
  const emptySide = ["player","enemy"].find(side=>!sideUnits(state,side).some(active));
  if (emptySide) {
    finishBattle(state,emptySide,"withdrawal");
    return false;
  }
  state.round++;
  for (const unit of state.units) {
    Object.assign(unit,{acted:false,moved:false});
    delete unit.statuses.surprised;
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

function advance(state) {
  if (state.phase === "reinforcement") {
    if (!startNextRound(state)) return;
  }
  if (resolveDefeat(state)) return;
  for (;;) {
    let next = orderedActors(state)[0];
    if (!next) {
      recordMorale(state,{roundEnd:true});
      if (resolveDefeat(state)) return;
      if (reinforcementOptions(state,"player").units.length) {
        state.phase = "reinforcement";
        note(state,"第 " + state.round + " 回合结束，可派预备队入场。");
        return;
      }
      if (!startNextRound(state)) return;
      next = orderedActors(state)[0];
    }
    if (next.statuses.surprised > 0) {
      next.acted = true;
      note(state,next.name + "措手不及，跳过本轮行动。","info","",{actorId:next.id});
      continue;
    }
    for (const [id,turns] of Object.entries(next.statuses)) {
      if (turns <= 1) delete next.statuses[id];
      else next.statuses[id] = turns - 1;
    }
    if (next.morale !== whiteFlag) {
      state.phase = next.side;
      return;
    }
    next.acted = true;
    note(state,next.name + "举着白旗愣在原地，跳过行动。","morale","",{actorId:next.id});
  }
}

export function assertActor(state, actorId, side) {
  const actor = state.units.find((unit) => unit.id === actorId);
  if (state.phase !== side || actor?.side !== side || !active(actor) || actor.acted || actor.morale === whiteFlag) {
    throw new Error("该角色现在无法行动");
  }
  const next = orderedActors(state)[0];
  if (next !== actor) throw new Error("现在轮到" + next.name + "行动");
  return actor;
}

export function assertAttack(state, actorId, targetId, side) {
  const actor = assertActor(state,actorId,side);
  const {targets,blockedReason} = attackOptions(state,actorId);
  const target = targets.find(unit=>unit.id===targetId);
  if (!target) throw new Error(blockedReason || "当前站位无法攻击这个目标");
  return {actor,target};
}

const intactShield = (unit) => unit.shield?.current > 0 ? unit.shield : null;
const limitHit = (chance) => Math.max(hitFloor,Math.min(hitCeiling,chance));

export function dodgeAfterAction(dodge) {
  return Math.max(20,dodge*2);
}

export function defenseFor(unit) {
  const targetDexterity = effectiveAttribute(unit,"dexterity");
  const rawTargetDexterity = unit.attributes.dexterity;
  const shield = intactShield(unit);
  const attributeDodge = unit.monster?.evade ?? Math.max(0,(targetDexterity-attributeBenchmark)*2);
  const moraleDodge = moralePercent(unit);
  const baseDodge = Math.max(0,attributeDodge + moraleDodge);
  const activeDodge = unit.statuses.dodge > 0 ? dodgeAfterAction(baseDodge)-baseDodge : 0;
  const shieldBonus = shield?.blockBonus ?? 0;
  const guarding = unit.statuses.defend > 0;
  const block = (baseBlock + shieldBonus) * (guarding ? 2 : 1);
  const meleeBlock = !hasAttack(unit) || unit.weapon.range === "远程" ? 0 : block;
  const rangedBlock = shield ? block : 0;
  return {targetDexterity,rawTargetDexterity,attributeDodge,baseDodge,moraleDodge,activeDodge,baseBlock,shieldBonus,guarding,meleeBlock,rangedBlock,
    ...(unit.monster ? {dodgeSource:"目标基础闪避"} : {}),
    dodge:baseDodge + activeDodge};
}

function flankingBonus(state, actor, target) {
  if (!state || !isMeleeFighter(actor)) return 0;
  const threatens = unit => reachable(state,unit.id).some(enemy=>enemy.id===target.id);
  if (!threatens(actor)) return 0;
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
  const ranged = actor.weapon.range === "远程";
  const attackAttribute = ranged ? "dexterity" : "strength";
  const rawScore = actor.attributes[attackAttribute];
  const score = effectiveAttribute(actor,attackAttribute);
  const base = actor.monster ? actor.monster.hit ?? 0 : baseAccuracy;
  const adjustment = actor.monster ? 0 : (score - attributeBenchmark) * 2;
  const weaponMatchup = actor.weapon.range === "长" && target.weapon.range === "短" ? 5 : 0;
  const targetSize = target.mount?.current > 0 ? target.mount.size : target.size;
  const largeBonus = (actor.monster || actor.weapon.range === "长") && targetSize === "大型" ? Math.round((actor.weapon.largeBonus ?? 0)*100) : 0;
  const flankingHit = flankingBonus(state,actor,target);
  const moraleHit = moralePercent(actor);
  const weatherHit = (actor.weapon.magic ? weather?.magicHit : ranged ? weather?.rangedHit : 0) ?? 0;
  const defense = defenseFor(target);
  const block = ranged ? defense.rangedBlock : defense.meleeBlock;
  const skillHit = skill?.hit ?? 0;
  const offense = base + adjustment + weaponMatchup + largeBonus + flankingHit + moraleHit + weatherHit + skillHit;
  const afterDodge = offense - defense.dodge;
  const chance = limitHit(afterDodge - block);
  const dodgeLimit = limitHit(Math.max(offense,afterDodge));
  const blockLimit = Math.max(chance,dodgeLimit - Math.max(0,defense.dodge));
  return {base, attribute:ranged ? "敏捷" : "力量", score, rawScore, adjustment, weaponMatchup, largeBonus, flankingHit, moraleHit,
    weatherHit, weatherName:weather?.name ?? null, ...defense, block, skillHit, chance, blockLimit, dodgeLimit};
}

export function battleProfileCombat(unit, weather) {
  const a = accuracyFor(unit,unit,weather);
  const profileHit = a.base + a.adjustment + a.moraleHit + a.weatherHit;
  const block = Math.max(a.meleeBlock,a.rangedBlock);
  const activeBlock = a.guarding ? a.baseBlock + a.shieldBonus : 0;
  const rawDodge = unit.monster?.evade ?? Math.max(0,(a.rawTargetDexterity-attributeBenchmark)*2);
  const strength = damageUsesStrength(unit) ? strengthDamagePercent(unit) : 0;
  const signed = (value,unit) => (value > 0 ? "+" : "") + value + unit;
  const contributions = (entries,suffix="%") => entries.filter(([,value,required])=>value || required)
    .sort((a,b)=>b[1]-a[1]).map(([label,value])=>[label,signed(value,suffix)]);
  return {
    dodge:a.dodge, meleeBlock:a.meleeBlock, rangedBlock:a.rangedBlock, profileHit,
    profileStatSources:{
      initiative:{title:"先攻来源",rows:contributions(initiativeParts(unit),""),total:"合计先攻 " + unit.initiative},
      block:{title:"格挡来源",rows:contributions([
        ["基础格挡",a.baseBlock,true],["盾牌 · " + (unit.shield?.name ?? "无"),a.shieldBonus],
        ["主动防御",activeBlock],["武器与盾牌格挡限制",block-a.baseBlock-a.shieldBonus-activeBlock],
      ]), total:"合计格挡率 " + block + "%",
      note:"对近战 " + a.meleeBlock + "% · 对远程 " + a.rangedBlock + "%" +
        (unit.weapon.range === "远程" ? "；持远程武器不能格挡近战" : "") +
        (!intactShield(unit) ? "；无完好盾牌不能格挡远程" : "")},
      dodge:{title:"闪避来源",rows:contributions([
        [unit.monster ? "基础闪避" : "敏捷（" + a.rawTargetDexterity + "）",rawDodge,true],
        ["装备敏捷上限（有效敏捷 " + a.targetDexterity + "）",a.attributeDodge-rawDodge],
        ["士气",a.moraleDodge],["总闪避最低 0%",a.baseDodge-a.attributeDodge-a.moraleDodge],
        ["主动闪避",a.activeDodge],
      ]),total:"合计闪避率 " + a.dodge + "%"},
      damage:{title:"伤害来源",rows:[
        ["武器 · " + unit.weapon.name,String(unit.weapon.damage)],
        ...(damageUsesStrength(unit) ? [["力量 " + unit.attributes.strength + "（" + signed(strength,"%") + "）",
          signed(unit.damage-unit.weapon.damage,"")]] : []),
      ],total:"实际攻击伤害 " + unit.damage,
      note:"命中后按目标和命中部位结算，护甲、格挡等会影响最终扣血。"},
      hit:{title:"命中来源",rows:contributions([
        ["基础命中",a.base,true],[a.attribute + "（" + a.score + "）",a.adjustment,!unit.monster],
        ["士气",a.moraleHit],["天气" + (a.weatherName ? " · " + a.weatherName : ""),a.weatherHit],
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

export function restorationTargets(state,actor,item) {
  if (!item.restore || item.qty <= 0) return [];
  return sideUnits(state,actor.side).filter(unit=>active(unit) && (item.restore.resource === "hp"
    ? unit.hp < unit.maxHp
    : unit.magic && unit.magic.current < unit.magic.max));
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

function useRestoration(state,request,roll) {
  const actor = assertActor(state,request.actor,"player");
  const item = actor.items.find(entry=>(entry.key ?? entry.name)===request.item);
  if (!item?.restore || item.qty <= 0) throw new Error("没有可用的随身药剂");
  const target = restorationTargets(state,actor,item).find(unit=>unit.id===request.target);
  if (!target) throw new Error("无法对该角色使用这瓶药剂");
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
  const used = state.usedItems[actor.id] ??= [];
  used.push(item.key ?? item.name);
  actor.items = actor.items.map(entry=>entry===item ? {...entry,qty:entry.qty-1} : entry)
    .filter(entry=>entry.qty>0);
  const itemWeight = actor.items.reduce((sum,entry)=>sum+(entry.weight ?? 0)*entry.qty,0);
  actor.load = battleLoad(actor.load.maximum/carryKgPerStrength,actor.load.equipped,itemWeight);
  updateStamina(actor);
  actor.acted = true;
  const recipient = actor === target ? "自己" : target.name;
  note(state,actor.name + "给" + recipient + "使用了「" + item.name + "」，恢复 " + amount +
    " 点" + (health ? "生命" : "魔力") + "。","item","",{actorId:actor.id,targetId:actor === target ? undefined : target.id});
  recoverMorale(state,target,wasHeavilyWounded);
}

export function battleSwapProblem(unit, item) {
  const swap = item?.swap;
  if (!swap?.gear || !["main_hand","off_hand"].includes(swap.slot)) return "此道具不能换上";
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
    note(state,target.name + "的战马倒下，在原地改为步战。","info","",{actorId:target.id});
    say(state,target,"dismount");
  }
  if (dismounted || flanked) recordMorale(state,{changes:[
    [target,-Number(dismounted)-Number(flanked),[dismounted && "坠马受惊",flanked && "遭侧翼夹击"].filter(Boolean).join("并")],
    ...(dismounted ? [[actor,1,"击落敌方坐骑"]] : []),
  ]});
}

function attack(state, actor, target, roll, skill) {
  const rolled = rollPercent(roll);
  const forced = rolled <= hitFloor ? "hit" : rolled > hitCeiling ? "miss" : null;
  const accuracy = {...accuracyFor(actor,target,state.weather,state,skill),roll:rolled,forced};
  const hit = rolled <= accuracy.chance;
  const outcome = hit ? "hit" : rolled <= accuracy.blockLimit ? "block" : rolled <= accuracy.dodgeLimit ? "dodge" : "miss";
  const largeBonus = accuracy.largeBonus;
  const damageCheck = {
    weaponDamage:actor.weapon.damage, strength:damageUsesStrength(actor) ? actor.attributes.strength : null,
    strengthPercent:damageUsesStrength(actor) ? strengthDamagePercent(actor) : 0, adjustedDamage:actor.damage,
    largeBonus, attack:Math.round(actor.damage*(100+largeBonus)/100),
  };
  const detail = {
    hit,outcome,actor:actor.name,target:target.name,actorId:actor.id,targetId:target.id,weapon:actor.weapon.name,accuracy,damageCheck,damage:null,
    mountDamage:null,...(skill ? {name:skill.name} : {}),
  };
  actor.acted = true;
  state.lastStrike = {id:++state.serial, actor:actor.id, target:target.id, row:target.row, hit,outcome, at:Date.now()};
  const summary = actor.name + (skill ? "对" + target.name + "使用了技能「" + skill.name + "」" : "攻击" + target.name);
  if (!hit) {
    const shield = outcome === "block" ? intactShield(target) : null;
    if (shield) {
      const before = shield.current;
      const impact = shieldImpact(actor,damageCheck.attack);
      const bonus = impact - damageCheck.attack;
      const blocked = Math.min(before,impact);
      shield.current -= blocked;
      if (blocked > 0) trackEffectiveStrike(state,actor,target);
      detail.guard = {shield:shield.name,before,blocked,after:shield.current,bonus,impact,
        bonusRate:Math.round(actor.weapon.shieldBonus * 100),broken:shield.current === 0};
      Object.assign(state.lastStrike,{zone:"shield",guard:detail.guard});
    }
    noteStrike(state,summary,detail);
    if (outcome === "miss") say(state,actor,"miss");
    if (detail.guard?.broken) {
      say(state,target,"shieldBreak");
      recordMorale(state,{changes:[[target,-1,"盾牌破碎"],[actor,1,"打碎敌方盾牌"]]});
    }
    return;
  }
  const flanked = isFlankingHit(state,actor,target);
  if (target.mount?.current > 0) {
    strikeMount(state,actor,target,detail,summary,flanked);
    say(state,actor,"hit");
    return;
  }

  const weaponBonus = Math.round(actor.weapon.headBonus * 100);
  const location = {base:baseHeadChance, weaponBonus, chance:headChance(actor), roll:rollPercent(roll)};
  const zone = location.roll <= location.chance ? "head" : "body";
  const armor = target.armor[zone];
  const armorBefore = armor.current;
  const hpBefore = target.hp;
  const strikeDamage = damageCheck.attack;
  const result = resolveStrike(target,strikeDamage,zone,actor.weapon.penetration,actor.weapon.armorBonus);
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
    location,zone,...result,armor:armor.name,armorBefore,
    armorAfter:armor.current,hpBefore,hpAfter:target.hp,
  };
  Object.assign(state.lastStrike,{zone,damage:strikeDamage,penetration,blocked,hpLoss});
  noteStrike(state,summary,detail);
  say(state,actor,"hit");
  if (withdrawBelow && target.hp < target.maxHp * withdrawBelow) {
    const contribution = state.experience[actor.id];
    if (contribution && target.side !== actor.side) contribution.defeated++;
    Object.assign(target,{arenaWithdrawn:true,row:"reserve",column:null});
    state.lastStrike.arenaWithdrawn = true;
    note(state,target.name + "生命低于 " + withdrawBelow * 100 + "%，退出竞技。","info","",{actorId:target.id});
  } else if (target.hp === 0) {
    const contribution = state.experience[actor.id];
    if (contribution && target.side !== actor.side) contribution.defeated++;
    state.fallen.push(settlementEntry(target,"corpse",state.encounter?.persistentSpoils));
    say(state,target,"fall");
    state.units = state.units.filter(unit=>unit!==target);
    note(state,target.name + "阵亡离场。","info","",{actorId:target.id});
    recordMorale(state,{actor,fallen:[target]});
    for (const ally of sideUnits(state,target.side)) {
      if (active(ally)) say(state,ally,"allyFall");
    }
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
      if (!unit || !["front","back","reserve"].includes(request.row)) throw new Error("站位无效");
      if (unit.row !== request.row && occupancy(state,"player",request.row).length >= capacity(state,request.row)) throw new Error("这一排已满");
      const prior = unit.row;
      unit.row = request.row;
      unit.position = Math.max(...state.units.map((entry) => entry.position)) + 1;
      alignSetupRow(state,"player",prior);
      alignSetupRow(state,"player",unit.row);
    }
    if (type === "start") {
      const fighters = state.encounter ? state.units.filter(unit=>!unit.noncombatant) : state.units;
      if (state.encounter && !fighters.some(unit=>unit.side === "enemy" && unit.hp>0)) throw new Error("对方没有战斗人员");
      const roster = state.enemyFormationEnabled ? fighters.filter(unit=>unit.hp>0) : sideUnits(state,"player");
      for (const unit of roster) {
        if (battleItemCount(unit.items)>battleItemSlots) throw new Error(`${unit.name}的道具栏超过 ${battleItemSlots} 件，请先调整随身道具。`);
        if (unit.load.remaining<0) throw new Error(unit.name+"已超出个人最大负重，请先调整装备或物品。");
      }
      const width = state.fieldColumns.length;
      const {formation,enemyFormation} = request;
      if (formation !== undefined && !validFormation(state,width,formation))
        throw new Error("阵型无效，请检查各排人数与宽度。");
      if (enemyFormation !== undefined && (!state.enemyFormationEnabled || !validFormation(state,width,enemyFormation,"enemy")))
        throw new Error("无法应用敌方阵型，请检查上场队员与宽度。");
      if (formation !== undefined) applyFormation(state,formation);
      if (enemyFormation !== undefined) applyFormation(state,enemyFormation);
      if (!sideUnits(state,"player").some(active)) throw new Error("至少安排一名士兵上阵");
      if (fighters.length !== state.units.length) {
        state.units = fighters;
        applyFormation(state,standardFormation(state,width,"enemy"));
      }
      for (const unit of state.units.filter(active)) {
        enterBattleExperience(state,unit);
        if (unit.side === "enemy" && unit.monster && state.encounter?.enemySurprised) unit.statuses.surprised = 1;
      }
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
    Object.assign(actor,{row:"reserve",fieldSide:actor.side,column:null,acted:true,statuses:{}});
    note(state,actor.name + "撤回预备队。","info","",{actorId:actor.id});
    advance(state);
  } else if (type === "move" || type === "enemyMove") {
    const actor = assertActor(state,request.actor,type === "move" ? "player" : "enemy");
    const {fieldSide,row,column} = request;
    const {destinations,blockedReason} = movementOptions(state,actor);
    if (!destinations.some(spot=>spot.fieldSide===fieldSide && spot.row===row && spot.column===column)) {
      throw new Error(blockedReason || "请选择移动范围内可通行的空格。");
    }
    Object.assign(actor,{fieldSide,row,column,moved:true});
    const line = (fieldSide === "player" ? "我方" : "敌方") + (row === "front" ? "前排" : "后排");
    note(state,actor.name+"移动到"+line+"。","info","",{actorId:actor.id});
    recordMorale(state,{reinforced:actor});
  } else if (type === "item") {
    useRestoration(state,request,roll);
    advance(state);
  } else if (type === "swapItem") {
    swapCarriedGear(state,request);
    advance(state);
  } else if (["attack","enemyAttack","enemySkill","playerSkill"].includes(type)) {
    const side = type === "attack" || type === "playerSkill" ? "player" : "enemy";
    const actor = assertActor(state,request.actor,side);
    const usesSkill = type === "enemySkill" || type === "playerSkill";
    const skill = usesSkill && actor.skills.includes(request.skill) ? enemySkills[request.skill] : undefined;
    if (usesSkill && !skill) throw new Error("该技能现在无法使用");
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
      const cost = teamAmmoCost(state,actor);
      if (cost) {
        state.ammoLeft -= cost;
        state.ammoSpent += cost;
      }
      attack(state,actor,target,roll,skill);
      if (actor.monster && ++actor.attacksMade < actor.monster.attacksPerAction && canFight(actor) &&
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
    actor.acted = true;
    actor.statuses.dodge = 1;
    note(state,actor.name + "开始“闪避”。","dodge","",{actorId:actor.id,actor:actor.name});
    advance(state);
  } else if (type === "defend" || type === "enemyDefend") {
    const actor = assertActor(state,request.actor,type === "defend" ? "player" : "enemy");
    actor.acted = true;
    actor.statuses.defend = 1;
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
  const hit = chance / 100;
  const damage = Math.round(actor.damage*(100+largeBonus)/100);
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
    health += probability*Math.min(target.hp,hpDamage);
    armor += probability*blocked;
    if (hpDamage >= target.hp) defeat += probability;
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

export function chooseBattleAction(state) {
  const actions = tacticalActions[state.phase];
  if (!actions) return null;
  const pending = orderedActors(state);
  const actor = pending[0];
  if (!actor) return null;
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
    if (!skill) continue;
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
