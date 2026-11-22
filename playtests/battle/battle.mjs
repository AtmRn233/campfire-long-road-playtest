import battleCatalog from "./catalog.json" with { type: "json" };
import allyPresets from "./ally-presets.json" with { type: "json" };
import defaultRosterProfiles from "./rosterProfiles.json" with { type: "json" };
import defaultMounts from "../../data/rules/mounts.json" with { type: "json" };
import basicWeapons from "../../data/rules/basic-weapons.json" with { type: "json" };
import { createDialogue } from "./dialogue.mjs";
import { battleItemCount, battleItemSlots, battleItemsBySlot, battleLoad } from "./loadout.mjs";
import { adjacent, fieldRanks, fieldSideOf, rankOf } from "./grid.mjs";
import { assignLeaders, canFight, heavyWoundRatio, isHeavilyWounded, moraleLimit, nearby,
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
  {id:"garrick", name:"加里克", role:"劫掠首领", side:"enemy", weapon:"长柄刀", body:"皮甲", head:"链甲头罩", row:"front", skills:["measured_strike"],
    additionalGear:[{slot:"accessory",label:"首饰",name:"胸针"},{slot:"feet",label:"鞋子",name:"长靴"}]},
  {id:"bren", name:"布伦", role:"斧手", side:"enemy", weapon:"手斧", body:"棉甲", head:"鼻翼盔", shield:"小圆盾", row:"front", skills:["second_wind"],
    additionalGear:[{slot:"wrists",label:"手腕",name:"手套"},{slot:"belt",label:"腰带",name:"腰带"}]},
  {id:"oswin", name:"奥斯温", role:"弩手", side:"enemy", weapon:"弩", body:"布衣", head:"布帽", row:"back", skills:["aimed_shot"],
    additionalGear:[{slot:"legs",label:"下身",name:"长裤"},{slot:"feet",label:"鞋子",name:"系带鞋"}]},
  {id:"herman", name:"赫尔曼", role:"骑兵", side:"enemy", weapon:"矛", body:"链甲", head:"锅盔", row:"back", mount:"horse",
    additionalGear:[{slot:"wrists",label:"手腕",name:"手套"},{slot:"feet",label:"鞋子",name:"长靴"}]},
];
const backgrounds = {
  roland:"罗兰曾在山口替商队守夜。旧领主解散卫队后，他带着一把长剑投了佣兵团，仍习惯走在队伍最前面。",
  milo:"米洛是林边村的木匠之子。镇上征召时，他领到一根长矛，后来又用两个月的饷钱给自己换了面圆盾。",
  vera:"薇拉跟猎人学会在细雨里认足迹、在风里放箭。商路断了以后，她开始替佣兵团探路。",
  garrick:"加里克原是守山路的哨兵，后来带几个老伙计离了岗。他熟知鸦岭每条小径，通常让最沉得住气的人守后面。",
  bren:"布伦早年替河边的伐木场干活，手斧从那时就跟着他。他替加里克守前排，最擅长在狭窄的地方顶住人。",
  oswin:"奥斯温替边境守过多年城门，对弩弦的响声比对号令还熟。他绕到林间高处，找能看清阵线的位置。",
  herman:"赫尔曼曾是边境驿站的骑递，熟悉哪条林路能让马通过。驿站撤裁后，他带着留下的战马和旧矛加入了加里克的队伍。",
};

const sideUnits = (state, side) => state.units.filter((unit) => unit.side === side && unit.hp > 0);
const active = (unit) => unit.hp > 0 && unit.row !== "reserve";
const occupancy = (state, side, row) => state.units.filter(unit=>unit.hp>0 && fieldSideOf(unit)===side && unit.row===row);
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
  return {name:gear?.name ?? "无",max,current:Math.max(0,Math.min(max,gear?.current ?? max)),attributeCap:gear?.attributeCap,blockBonus:gear?.blockBonus,initiative:gear?.initiative};
};
const attributeNames = ["strength","dexterity","constitution","intelligence","perception","charisma"];
const baseAttribute = 8;
const baseAccuracy = 70;
const hitFloor = 5;
const hitCeiling = 95;
const baseHeadChance = 10;
const baseBlock = 10;
const bubbleDuration = 1000;
const moralePercent = (unit) => Math.max(-moraleLimit,unit.morale) * 5;
const strengthDamagePercent = (unit) => (unit.attributes.strength-baseAttribute) * 5;
const isMeleeFighter = (unit) => canFight(unit) && unit.weapon.range !== "远程";

export function effectiveAttribute(unit,attribute) {
  const raw = unit.attributes[attribute];
  if (attribute !== "dexterity" && attribute !== "intelligence") return raw;
  const cap = Math.min(...Object.values(unit.armor).map(gear=>gear.attributeCap ?? Infinity));
  return Math.min(raw,baseAttribute+cap);
}

function updateHandStats(unit) {
  const equipmentInitiative = [unit.weapon,unit.armor.head,unit.armor.body,unit.shield]
    .reduce((total,gear) => total+(gear?.initiative ?? 0),0);
  unit.initiative = effectiveAttribute(unit,"dexterity") - baseAttribute + equipmentInitiative;
  unit.damage = unit.weapon.magic ? unit.weapon.damage :
    Math.round(unit.weapon.damage * (100 + strengthDamagePercent(unit)) / 100);
}

function applyStartingAttributes(unit) {
  const {constitution,charisma} = unit.attributes;
  updateHandStats(unit);
  unit.maxHp = constitution * 10;
  unit.hp = unit.maxHp;
  unit.maxMagic = effectiveAttribute(unit,"intelligence") * 5;
  unit.magic = unit.profession === "法师" ? {current:unit.maxMagic,max:unit.maxMagic} : null;
  unit.discount = (charisma - baseAttribute) * 2;
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
  const opponent = controllers(state,actor).find(unit=>adjacent(actor,unit));
  return opponent ? "位于"+opponent.name+"的控制区内，无法移动或撤退。" : "";
}

export function movementOptions(state,actor) {
  if (!canFight(actor)) return {destinations:[],blockedReason:"该角色目前无法移动。"};
  const blockedReason = retreatProblem(state,actor);
  if (blockedReason) return {destinations:[],blockedReason};
  const enemies = controllers(state,actor);
  const occupied = new Set(state.units.filter(active).map(unit=>rankOf(unit)+":"+unit.column));
  const destinations = [];
  const maxSteps = actor.mount?.current > 0 ? 2 : 1;
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
  settleMorale(state,event,(unit,reason)=>{
    const {morale} = unit;
    const level = morale === whiteFlag ? "举起白旗" : "士气 " + (morale > 0 ? "+" : "") + morale;
    note(state,unit.name + reason + "，" + level + "。","morale");
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
  note(state,text,"speech",unit.name,{startsAt});
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

export function createBattle(terrain = "woods", weatherId = "clear", supplies = [], player, rosterProfiles, allies = [], partyMemberIds = [], enemies) {
  const weather = catalog.weather.find(item => item.id === weatherId);
  if (!weather) throw new Error("天气不存在");
  const participants = roster.filter(character => character.side === "enemy" ? !enemies : !partyMemberIds.includes(character.id)).map(character => {
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
    phase:"setup", round:1, winner:null, endReason:null, serial:0, rev:0, busy:false, log:[], speeches:[], lastStrike:null, pendingEnemyAttack:null, lastSide:null, lanes, weather,
    fallen:[], settlement:null, report:null, supplies, usedItems:{}, itemSwaps:{}, restoredMana:{}, enemyFormationEnabled:Boolean(enemies?.length),
    damageStats:Object.fromEntries(participants.filter(unit=>unit.side==="player").map(unit=>[unit.id,{name:unit.name,armor:0,hp:0,taken:0}])),
    units:participants.map((character, position) => {
      const weapon = typeof character.weapon === "string" ? catalog.weapons[character.weapon] : character.weapon;
      const mount = catalog.mounts[character.mount];
      const unit = {
        id:character.id, name:character.name, role:character.role, side:character.side,
        level:character.level ?? 1, raceName:character.raceName, size:character.size ?? "中型", profession:character.profession ?? character.role,
        originName:character.originName, traits:character.traits ?? [], attributeSources:character.attributeSources,
        levelPoints:character.levelPoints, additionalGear:character.additionalGear ?? [],
        items:character.items ?? [], handItems:{...character.handItems}, lockedHands:character.lockedHands ?? [],
        skills:[...(character.skills ?? [])],
        bio:character.bio ?? backgrounds[character.id], portrait:character.portrait, profilePortrait:character.profilePortrait,
        portraitSprite:character.portraitSprite,
        portraitCropKey:character.portraitCropKey,
        profileResistances:character.profileResistances,
        preferred:character.row, position, row:character.row, acted:false, statuses:{}, morale:0,
        attributes:Object.fromEntries(attributeNames.map(name=>[name,character.attributes?.[name] ?? baseAttribute])),
        dialogue:createDialogue(character.presetId ?? character.id),
        voiceProfile:character.gender === "female" || (character.presetId ?? character.id) === "vera" ? "female" : undefined,
        weapon:{headBonus:0,armorBonus:0,shieldBonus:0,...(weapon ?? catalog.weapons.徒手)},
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
      if (character.maxHp !== undefined) {
        unit.maxHp = character.maxHp;
        unit.hp = Math.max(0,Math.min(unit.maxHp,character.hp));
      }
      if (unit.magic && character.mana !== undefined) unit.magic.current = Math.min(unit.magic.max,character.mana);
      return unit;
    }),
  };
  assignTerrain(state, terrain);
  assignLeaders(state.units);
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
  if (!actor || !active(actor)) return {targets:[]};
  const cost = teamAmmoCost(state,actor);
  if (cost && state.ammoLeft < cost) return {targets:[],
    blockedReason:cost === 1 ? "队伍弹药不足" : "队伍弹药不足，需要 " + cost + " 单位"};
  const enemies = sideUnits(state,other(actor.side)).filter(active);
  if (actor.weapon.range === "远程") return {targets:enemies};
  return {targets:enemies.filter(target=>adjacent(actor,target)),blockedReason:"近战只能攻击相邻格内的敌人，直向和斜向都算。"};
}

export function orderedActors(state, side) {
  const pending = (side) => sideUnits(state,side).filter((unit)=>active(unit) && !unit.acted)
    .sort((a,b)=>b.initiative-a.initiative || order(a,b));
  if (side) return pending(side);
  const ours = pending("player"), theirs = pending("enemy");
  const result = [];
  let sideToAct = state.lastSide ? other(state.lastSide) :
    ((ours[0]?.initiative ?? -Infinity) >= (theirs[0]?.initiative ?? -Infinity) ? "player" : "enemy");
  while (ours.length || theirs.length) {
    const preferred = sideToAct === "player" ? ours : theirs;
    const alternate = sideToAct === "player" ? theirs : ours;
    const next = (preferred.length ? preferred : alternate).shift();
    result.push(next);
    sideToAct = other(next.side);
  }
  return result;
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
  const multiplier = zone === "head" ? 2 : 1;
  return {
    penetration:{baseRatio,armorReduction,ratio,direct,armorDamage},armorEfficiency,armorImpact,armorAbsorbed,
    blocked,overflow,multiplier,hpDamage:(direct+overflow)*multiplier,
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
  const columns = Object.fromEntries(["front","back"].map(row=>[
    row,occupancy(state,side,row).length < capacity(state,row) ? vacantColumns(state,side,row) : [],
  ]));
  const units = (columns.front.length || columns.back.length) ?
    occupancy(state,side,"reserve").filter(unit=>unit.morale!==whiteFlag).sort(order).map(unit=>unit.id) : [];
  return {units,columns};
}

function enterFromReserve(state,unit,row,column) {
  Object.assign(unit,{row,fieldSide:unit.side,column,acted:true});
  note(state,unit.name + "从预备队进入" + (row === "front" ? "前排" : "后排") + "。");
  recordMorale(state,{reinforced:unit});
}

function reinforceEnemy(state) {
  const {units,columns} = reinforcementOptions(state,"enemy");
  for (const id of units) {
    const unit = state.units.find(entry=>entry.id===id);
    if (unit.morale === whiteFlag || isHeavilyWounded(unit)) continue;
    const row = [unit.preferred,unit.preferred === "front" ? "back" : "front"]
      .find(rank=>columns[rank].length);
    if (!row) break;
    enterFromReserve(state,unit,row,columns[row].shift());
  }
}

function settlementEntry(unit,kind) {
  const {id,name,side,role,profession,portrait,weapon,armor,shield,mount,magic,morale,leader,hp,maxHp,acted} = unit;
  const items = [{name:weapon.name,kind:"武器"}];
  for (const [type,gear] of [["头盔",armor.head],["护甲",armor.body],["盾牌",shield]]) {
    if (gear?.current > 0) items.push({name:gear.name,kind:type,current:gear.current,max:gear.max});
  }
  return {
    kind,card:structuredClone({id,name,side,role,profession,portrait,armor,shield,mount,magic,morale,leader,hp,maxHp,acted}),
    items,looted:false,disposition:null,
  };
}

function stackItem(items,item,quantity=1) {
  const existing = items.find(slot=>slot.name===item.name && slot.kind===item.kind &&
    slot.current===item.current && slot.max===item.max);
  if (existing) existing.quantity += quantity;
  else items.push({...item,quantity});
}

function settlementProblem(entry,command) {
  if (entry.disposition) return "该对象已处理";
  if (command === "loot") {
    if (entry.kind !== "corpse") return "只能搜刮阵亡者";
    if (entry.looted) return "已搜刮过该对象";
  } else if (entry.kind !== "prisoner") {
    return "只能对俘虏执行此操作";
  }
  return "";
}

function settle(state,{command,target,all}) {
  const settlement = state.settlement;
  if (!settlement) throw new Error("战斗胜利后才能结算");
  if (settlement.left) throw new Error("队伍已经离开战场");
  const {entries,loot,inventory} = settlement;
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
    const index = inventory.findIndex(item=>JSON.stringify([item.kind,item.name,item.current,item.max])===target);
    if (index < 0) throw new Error("这件物品已不在队伍物资中");
    const [{quantity,...item}] = inventory.splice(index,1);
    stackItem(loot,{...item,id:++state.serial},quantity);
    return;
  }
  if (command === "talk") throw new Error("对话暂未开放");
  if (!["loot","execute","recruit"].includes(command)) throw new Error("未知结算操作");
  if (all === true) {
    if (command === "recruit") throw new Error("请选择一名俘虏招降");
    for (const entry of entries) {
      if (!settlementProblem(entry,command)) settleEntry(state,entry,loot,command);
    }
    return;
  }
  const entry = entries.find(item=>item.card.id===target);
  if (!entry) throw new Error("找不到结算对象");
  const problem = settlementProblem(entry,command);
  if (problem) throw new Error(problem);
  settleEntry(state,entry,loot,command);
}

function settleEntry(state,entry,loot,command) {
  if (command === "loot") {
    for (const item of entry.items) stackItem(loot,{...item,id:++state.serial});
    const {armor,shield} = entry.card;
    armor.head.current = 0;
    armor.body.current = 0;
    if (shield) shield.current = 0;
    entry.looted = true;
  } else {
    entry.disposition = command;
    if (command === "execute") entry.card.hp = 0;
  }
}

function finishBattle(state,side,reason) {
  state.winner = other(side);
  state.phase = "ended";
  state.endReason = reason;
  state.report = Object.entries(state.damageStats).map(([id,stats])=>({
    id,portrait:(state.units.find(unit=>unit.id===id) ?? state.fallen.find(entry=>entry.card.id===id)?.card)?.portrait,
    ...stats,fallen:state.fallen.some(entry=>entry.card.id===id),
  })).sort((a,b)=>(b.armor+b.hp)-(a.armor+a.hp));
  if (state.winner === "player") {
    const prisoners = reason === "surrender" ? sideUnits(state,side).map(unit=>settlementEntry(unit,"prisoner")) : [];
    state.settlement = {entries:[...state.fallen,...prisoners],loot:[],inventory:state.supplies,left:false};
  }
  const loser = side === "player" ? "我方" : "敌方";
  const result = {surrender:"全队举起白旗，溃败。",elimination:"全员阵亡。",withdrawal:"撤离战场。"};
  note(state,loser+result[reason]);
}

function startNextRound(state) {
  reinforceEnemy(state);
  if (resolveDefeat(state)) return false;
  const emptySide = ["player","enemy"].find(side=>!sideUnits(state,side).some(active));
  if (emptySide) {
    finishBattle(state,emptySide,"withdrawal");
    return false;
  }
  state.round++;
  for (const unit of state.units) unit.acted = false;
  note(state,"第 " + state.round + " 回合开始。");
  return true;
}

function finishRoundMorale(state) {
  const fighters = state.units.filter(canFight);
  const melee = fighters.filter(isMeleeFighter).map(unit=>[unit,reachable(state,unit.id)]);
  const changes = [];
  for (const unit of state.units) {
    const threats = canFight(unit) ? melee.filter(([,targets])=>targets.includes(unit)).map(([opponent])=>opponent) : [];
    const flankers = threats.filter(opponent=>Math.abs(opponent.column-unit.column)===1);
    const bothWings = flankers.some(opponent=>opponent.column<unit.column) &&
      flankers.some(opponent=>opponent.column>unit.column);
    const forward = rankOf(unit) + (unit.side === "player" ? -1 : 1);
    const pinned = flankers.length > 0 && threats.some(opponent=>opponent.column===unit.column && rankOf(opponent)===forward);
    const isolated = bothWings && pinned &&
      !fighters.some(ally=>ally.side===unit.side && nearby(ally,unit));
    const pressure = isolated ? 2 : bothWings || pinned ? 1 : 0;
    if (pressure > (unit.flankPressure ?? 0)) {
      changes.push([unit,-pressure,isolated ? "陷入两翼包夹" : "陷入侧翼夹击"]);
    }
    unit.flankPressure = pressure;
  }
  recordMorale(state,{changes});
  recordMorale(state,{roundEnd:true});
}

function resolveDefeat(state) {
  for (const side of ["player","enemy"]) {
    const survivors = sideUnits(state,side);
    if (!survivors.some(unit=>unit.morale!==whiteFlag)) {
      finishBattle(state,side,survivors.length ? "surrender" : "elimination");
      return true;
    }
  }
  return false;
}

function advance(state) {
  const starting = state.phase === "setup";
  if (state.phase === "reinforcement") {
    if (!startNextRound(state)) return;
  } else if (!starting) {
    state.lastSide = state.phase;
  }
  if (resolveDefeat(state)) return;
  if (starting) note(state,state.terrain.name + "开战。");
  for (;;) {
    let next = orderedActors(state)[0];
    if (!next) {
      finishRoundMorale(state);
      if (resolveDefeat(state)) return;
      if (reinforcementOptions(state,"player").units.length) {
        state.phase = "reinforcement";
        note(state,"第 " + state.round + " 回合结束，可派预备队入场。");
        return;
      }
      if (!startNextRound(state)) return;
      next = orderedActors(state)[0];
    }
    for (const [id,turns] of Object.entries(next.statuses)) {
      if (turns <= 1) delete next.statuses[id];
      else next.statuses[id] = turns - 1;
    }
    if (next.morale !== whiteFlag) {
      state.phase = next.side;
      if (starting) note(state,next.name + "先行动。");
      return;
    }
    next.acted = true;
    state.lastSide = next.side;
    note(state,next.name + "举着白旗愣在原地，跳过行动。","morale");
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
  const attributeDodge = Math.max(0,(targetDexterity-baseAttribute)*5);
  const moraleDodge = moralePercent(unit);
  const baseDodge = attributeDodge + moraleDodge;
  const activeDodge = unit.statuses.dodge > 0 ? dodgeAfterAction(baseDodge)-baseDodge : 0;
  const shieldBonus = shield?.blockBonus ?? 0;
  const guarding = unit.statuses.defend > 0;
  const block = (baseBlock + shieldBonus) * (guarding ? 2 : 1);
  const meleeBlock = unit.weapon.range === "远程" ? 0 : block;
  const rangedBlock = shield ? block : 0;
  return {targetDexterity,rawTargetDexterity,moraleDodge,activeDodge,baseBlock,shieldBonus,guarding,meleeBlock,rangedBlock,
    dodge:baseDodge + activeDodge};
}

function flankingBonus(state, actor, target) {
  if (!state || !isMeleeFighter(actor)) return 0;
  const threatens = unit => reachable(state,unit.id).some(enemy=>enemy.id===target.id);
  if (!threatens(actor)) return 0;
  return 5 * state.units.filter(ally=>
    ally.id!==actor.id && ally.side===actor.side && isMeleeFighter(ally) && threatens(ally)).length;
}

export function accuracyFor(actor, target, weather, state, skill) {
  const ranged = actor.weapon.range === "远程";
  const attackAttribute = ranged ? "dexterity" : "strength";
  const rawScore = actor.attributes[attackAttribute];
  const score = effectiveAttribute(actor,attackAttribute);
  const adjustment = (score - baseAttribute) * 5;
  const weaponMatchup = actor.weapon.range === "长" && target.weapon.range === "短" ? 10 : 0;
  const targetSize = target.mount?.current > 0 ? target.mount.size : target.size;
  const largeBonus = actor.weapon.range === "长" && targetSize === "大型" ? Math.round((actor.weapon.largeBonus ?? 0)*100) : 0;
  const flankingHit = flankingBonus(state,actor,target);
  const moraleHit = moralePercent(actor);
  const weatherHit = (actor.weapon.magic ? weather?.magicHit : ranged ? weather?.rangedHit : 0) ?? 0;
  const defense = defenseFor(target);
  const block = ranged ? defense.rangedBlock : defense.meleeBlock;
  const skillHit = skill?.hit ?? 0;
  const offense = baseAccuracy + adjustment + weaponMatchup + largeBonus + flankingHit + moraleHit + weatherHit + skillHit;
  const afterDodge = offense - defense.dodge;
  const chance = limitHit(afterDodge - block);
  const dodgeLimit = limitHit(Math.max(offense,afterDodge));
  const blockLimit = Math.max(chance,dodgeLimit - Math.max(0,defense.dodge));
  return {base:baseAccuracy, attribute:ranged ? "敏捷" : "力量", score, rawScore, adjustment, weaponMatchup, largeBonus, flankingHit, moraleHit,
    weatherHit, weatherName:weather?.name ?? null, ...defense, block, skillHit, chance, blockLimit, dodgeLimit};
}

function rollPercent(roll) {
  return Math.floor(roll() * 100) + 1;
}

const noteStrike = (state,summary,detail) => note(state,summary,detail.name ? "skill" : "strike","",detail);
const shieldImpact = (actor) => actor.damage + Math.round(actor.damage * actor.weapon.shieldBonus);
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
  if (health) target.hp += amount;
  else {
    target.magic = {...target.magic,current:target.magic.current+amount};
    state.restoredMana[target.id] = target.magic.current;
  }
  const used = state.usedItems[actor.id] ??= [];
  used.push(item.key ?? item.name);
  actor.items = actor.items.map(entry=>entry===item ? {...entry,qty:entry.qty-1} : entry)
    .filter(entry=>entry.qty>0);
  const itemWeight = actor.items.reduce((sum,entry)=>sum+(entry.weight ?? 0)*entry.qty,0);
  actor.load = battleLoad(actor.load.maximum/5,actor.load.equipped,itemWeight);
  actor.acted = true;
  const recipient = actor === target ? "自己" : target.name;
  note(state,actor.name + "给" + recipient + "使用了「" + item.name + "」，恢复 " + amount +
    " 点" + (health ? "生命" : "魔力") + "。","item");
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
  actor.load = battleLoad(actor.load.maximum/5,actor.load.equipped+weightDelta,actor.load.items-weightDelta);
  updateHandStats(actor);
  actor.acted = true;
  note(state,actor.name + "换上了「" + item.name + "」。","item");
}

function strikeMount(state,actor,target,detail,summary) {
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
    note(state,target.name + "的战马倒下，在原地改为步战。");
    say(state,target,"dismount");
    recordMorale(state,{changes:[[target,-1,"坠马受惊"],[actor,1,"击落敌方坐骑"]]});
  }
}

function attack(state, actor, target, roll, skill) {
  const rolled = rollPercent(roll);
  const forced = rolled <= hitFloor ? "hit" : rolled > hitCeiling ? "miss" : null;
  const accuracy = {...accuracyFor(actor,target,state.weather,state,skill),roll:rolled,forced};
  const hit = rolled <= accuracy.chance;
  const outcome = hit ? "hit" : rolled <= accuracy.blockLimit ? "block" : rolled <= accuracy.dodgeLimit ? "dodge" : "miss";
  const largeBonus = hit ? accuracy.largeBonus : 0;
  const damageCheck = {
    weaponDamage:actor.weapon.damage, strength:actor.weapon.magic ? null : actor.attributes.strength,
    strengthPercent:actor.weapon.magic ? 0 : strengthDamagePercent(actor), adjustedDamage:actor.damage,
    largeBonus, attack:actor.damage+largeBonus,
  };
  const detail = {
    hit,outcome,actor:actor.name,target:target.name,weapon:actor.weapon.name,accuracy,damageCheck,damage:null,
    mountDamage:null,...(skill ? {name:skill.name} : {}),
  };
  actor.acted = true;
  state.lastStrike = {id:++state.serial, actor:actor.id, target:target.id, row:target.row, hit,outcome, at:Date.now()};
  const summary = actor.name + (skill ? "对" + target.name + "使用了技能「" + skill.name + "」" : "攻击" + target.name);
  if (!hit) {
    const shield = outcome === "block" ? intactShield(target) : null;
    if (shield) {
      const before = shield.current;
      const impact = shieldImpact(actor);
      const bonus = impact - actor.damage;
      const blocked = Math.min(before,impact);
      shield.current -= blocked;
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
  if (target.mount?.current > 0) {
    strikeMount(state,actor,target,detail,summary);
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
  const {penetration,blocked,hpLoss} = result;
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
  if (target.hp === 0) {
    state.fallen.push(settlementEntry(target,"corpse"));
    say(state,target,"fall");
    state.units = state.units.filter(unit=>unit!==target);
    note(state,target.name + "阵亡离场。");
    recordMorale(state,{actor,fallen:[target]});
    for (const ally of sideUnits(state,target.side)) {
      if (active(ally)) say(state,ally,"allyFall");
    }
  } else if (hpLoss > 0) {
    const threshold = target.maxHp*heavyWoundRatio;
    const heavy = target.hp <= threshold && hpBefore > threshold;
    say(state,target,heavy ? "heavy" : "light");
    if (heavy) {
      const severe = hpLoss>=target.maxHp*.4;
      recordMorale(state,{changes:[[target,severe ? -2 : -1,severe ? "遭受致命重创" : "陷入重伤"],
        [actor,1,"重创敌人"]]});
    }
  }
}

export function action(state, request, roll = Math.random) {
  const {type} = request;
  if (type === "settle") {
    settle(state,request);
  } else if (["terrain","deploy","start","encounterExit"].includes(type)) {
    if (state.phase !== "setup") throw new Error("布阵已结束");
    if (type === "terrain" && request.terrain !== state.terrain.id) {
      assignTerrain(state, request.terrain);
      assignLeaders(state.units);
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
      assignLeaders(state.units);
    }
    if (type === "start") {
      const roster = state.enemyFormationEnabled ? state.units.filter(unit=>unit.hp>0) : sideUnits(state,"player");
      for (const unit of roster) {
        if (battleItemCount(unit.items)>battleItemSlots) throw new Error(unit.name+"的道具栏超过三件，请先调整随身道具。");
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
      assignLeaders(state.units);
      startMorale(state);
      advance(state);
    }
    if (type === "encounterExit") {
      if (!["retreat","surrender"].includes(request.decision)) throw new Error("无效的遭遇选择");
      finishBattle(state,"player",request.decision === "retreat" ? "withdrawal" : "surrender");
    }
  } else if (type === "reinforce" || type === "finishReinforcement") {
    if (state.phase !== "reinforcement") throw new Error("只能在回合末安排预备队");
    if (type === "reinforce") {
      const {units,columns} = reinforcementOptions(state,"player");
      if (!units.includes(request.actor)) throw new Error("请选择一名我方预备队角色");
      if (!["front","back"].includes(request.row) || !columns[request.row].includes(request.column)) {
        throw new Error("请选择我方阵线的空位");
      }
      enterFromReserve(state,state.units.find(unit=>unit.id===request.actor),request.row,request.column);
    }
    if (type === "finishReinforcement" || !reinforcementOptions(state,"player").units.length) advance(state);
  } else if (type === "retreat" || type === "enemyRetreat") {
    const actor = assertActor(state,request.actor,type === "retreat" ? "player" : "enemy");
    const problem = retreatProblem(state,actor);
    if (problem) throw new Error(problem);
    Object.assign(actor,{row:"reserve",fieldSide:actor.side,column:null,acted:true,statuses:{}});
    note(state,actor.name + "撤回预备队。");
    advance(state);
  } else if (type === "move" || type === "enemyMove") {
    const actor = assertActor(state,request.actor,type === "move" ? "player" : "enemy");
    const {fieldSide,row,column} = request;
    const {destinations,blockedReason} = movementOptions(state,actor);
    if (!destinations.some(spot=>spot.fieldSide===fieldSide && spot.row===row && spot.column===column)) {
      throw new Error(blockedReason || "请选择移动范围内可通行的空格。");
    }
    Object.assign(actor,{fieldSide,row,column,acted:true});
    const line = (fieldSide === "player" ? "我方" : "敌方") + (row === "front" ? "前排" : "后排");
    note(state,actor.name+"移动到"+line+"。");
    advance(state);
  } else if (type === "item") {
    useRestoration(state,request,roll);
    advance(state);
  } else if (type === "swapItem") {
    swapCarriedGear(state,request);
    advance(state);
  } else if (type === "attack" || type === "enemyAttack" || type === "enemySkill") {
    const side = type === "attack" ? "player" : "enemy";
    const actor = assertActor(state,request.actor,side);
    const skill = type === "enemySkill" && actor.skills.includes(request.skill) ? enemySkills[request.skill] : undefined;
    if (type === "enemySkill" && !skill) throw new Error("该技能现在无法使用");
    if (skill?.healRatio) {
      const healing = healingAmount(actor,skill);
      if (!healing) throw new Error("生命值已满");
      const wasHeavilyWounded = isHeavilyWounded(actor);
      actor.hp += healing;
      actor.acted = true;
      note(state,actor.name + "使用了技能「" + skill.name + "」，回复 " + healing + " 点血量。","skill");
      recoverMorale(state,actor,wasHeavilyWounded);
    } else {
      const {target} = assertAttack(state,request.actor,request.target,side);
      const cost = teamAmmoCost(state,actor);
      if (cost) {
        state.ammoLeft -= cost;
        state.ammoSpent += cost;
      }
      attack(state,actor,target,roll,skill);
    }
    if (skill) actor.skills = actor.skills.filter(id=>id!==request.skill);
    advance(state);
  } else if (type === "dodge" || type === "enemyDodge") {
    const actor = assertActor(state,request.actor,type === "dodge" ? "player" : "enemy");
    actor.acted = true;
    actor.statuses.dodge = 1;
    note(state,actor.name + "进入闪避，当前闪避 " + defenseFor(actor).dodge + "%。");
    advance(state);
  } else if (type === "defend" || type === "enemyDefend") {
    const actor = assertActor(state,request.actor,type === "defend" ? "player" : "enemy");
    actor.acted = true;
    actor.statuses.defend = 1;
    const posture = intactShield(actor) ? "举盾防御" : "进入防御";
    const {meleeBlock,rangedBlock} = defenseFor(actor);
    note(state,actor.name + posture + "，对近战格挡 " + meleeBlock + "%，对远程格挡 " + rangedBlock + "%。","guard");
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
  const damage = actor.damage + largeBonus;
  const shield = intactShield(target);
  const shieldDamage = shield ? Math.min(shield.current,shieldImpact(actor)) : 0;
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
  const nextRound = orderedActors({...state,lastSide:pending.at(-1).side,
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

export function chooseEnemy(state) {
  if (state.phase !== "enemy") return null;
  const pending = orderedActors(state);
  const actor = pending[0];
  if (!actor) return null;
  const {id,hp,maxHp} = actor;
  if (hp <= maxHp*heavyWoundRatio && !retreatProblem(state,actor) &&
      sideUnits(state,actor.side).some(unit=>unit!==actor && active(unit) && unit.morale!==whiteFlag)) {
    return {type:"enemyRetreat",actor:id};
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
  for (const target of targets) consider("enemyAttack",valueOfAttack(target),{target:target.id});
  for (const skillId of actor.skills) {
    const skill = enemySkills[skillId];
    if (skill.healRatio) {
      const healing = healingAmount(actor,skill);
      if (healing > 0) {
        const safer = pressure - expectedPressure(state,{...actor,hp:hp+healing},opponents);
        consider("enemySkill",healing+Math.max(0,safer)*urgency*.5-6,{skill:skillId});
      }
    } else {
      for (const target of targets) {
        consider("enemySkill",valueOfAttack(target,skill) - 6,{skill:skillId,target:target.id});
      }
    }
  }
  consider("enemyDefend",(pressure-expectedPressure(state,{...actor,statuses:{...actor.statuses,defend:1}},opponents))*urgency);
  consider("enemyDodge",(pressure-expectedPressure(state,{...actor,statuses:{...actor.statuses,dodge:1}},opponents))*urgency);

  if (!targets.length) {
    const targetsAhead = sideUnits(state,other(actor.side)).filter(active);
    const distance = unit=>Math.min(...targetsAhead.map(target=>
      Math.max(Math.abs(rankOf(unit)-rankOf(target)),Math.abs(unit.column-target.column))));
    const before = distance(actor);
    for (const {fieldSide,row,column} of movementOptions(state,actor).destinations) {
      const moved = {...actor,fieldSide,row,column};
      const projection = {...state,units:state.units.map(unit=>unit===actor ? moved : unit)};
      const nextPressure = expectedPressure(projection,moved,opponents);
      const nextAttack = Math.max(0,...reachable(projection,id).map(target=>forecastAttack(projection,moved,target).offense));
      const remaining = distance(moved);
      const approaching = remaining < before;
      const approach = approaching ? (before-remaining)*actor.damage*.35 : 0;
      const value = (pressure-nextPressure)*urgency + nextAttack*.45 + approach;
      consider("enemyMove",approaching && pressure===0 ? Math.max(1,value) : value,{fieldSide,row,column});
    }
  }
  return best;
}
