import { accuracyFor, action, armorDurability, assertAttack, attackOptions, catalog, chooseBattleAction, createBattle, defenseFor, drawWeather, effectiveAttribute, movementOptions, openColumn, orderedActors, reinforcementOptions, replaceBattleEquipment, retreatProblem, say } from "./battle.mjs";
import { battleLogLines } from "./battleLog.mjs";
import { controlledStatus } from "./statuses.mjs";

export function createBattleSession({delay=650,roll=Math.random,terrainRoll=Math.random,weatherRoll=Math.random}={}) {
  const supplies = [];
  let rosterProfiles;
  let dialogueEnabled = true;
  const newBattle = () => {
    const terrain = catalog.terrain[Math.floor(terrainRoll() * catalog.terrain.length)];
    return {...createBattle(terrain.id,drawWeather(terrain,weatherRoll).id,supplies,undefined,rosterProfiles),dialogueEnabled};
  };
  let state;
  let match = 0;
  let botTimer;
  let finishPendingAttack;
  let encounterMembers;
  let encounterStarted = false;
  const snapshot = () => {
    state ??= newBattle();
    const now = Date.now();
    const {fallen,damageStats,supplies,moraleTracking,usedItems,itemSwaps,restoredMana,experience,...publicState} = state;
    const {weather} = state;
    const attacks = state.units.map(unit=>[unit,attackOptions(state,unit.id)]);
    const victory = state.winner === "player";
    const trackExperience = encounterMembers && (victory || state.endReason !== "withdrawal");
    return {
      ...publicState,weathers:catalog.weather,log:state.log.slice(),speeches:state.speeches.filter(line=>line.expiresAt>now),match,terrains:catalog.terrain,
      units:state.units.filter(unit=>!unit.arenaWithdrawn).map(unit=>{
        const {dodge,meleeBlock,rangedBlock} = defenseFor(unit,state);
        const counts = trackExperience && experience[unit.id];
        return {...unit,statuses:{...unit.statuses},dodge,meleeBlock,rangedBlock,
          ...(counts ? {battleExperience:{counts:{...counts},victory}} : {}),
          effectiveAttributes:{dexterity:effectiveAttribute(unit,"dexterity"),intelligence:effectiveAttribute(unit,"intelligence")}};
      }),
      order:["ended","reinforcement"].includes(state.phase) ? [] : orderedActors(state).map(unit=>unit.id),
      deployColumns:state.phase === "setup" ?
        Object.fromEntries(["front","back"].map(row=>[row,openColumn(state,"player",row)])) : null,
      reinforcements:state.phase === "reinforcement" ? reinforcementOptions(state,"player") : null,
      attackTargets:Object.fromEntries(attacks.map(([unit,options])=>[unit.id,options.targets.map(target=>target.id)])),
      attackBlocked:Object.fromEntries(attacks.map(([unit,options])=>[unit.id,options.blockedReason ?? ""])),
      hitChances:Object.fromEntries(attacks.map(([unit,options])=>[unit.id,
        Object.fromEntries(options.targets.map(target=>[target.id,accuracyFor(unit,target,weather,state).chance]))])),
      movement:Object.fromEntries(state.units.filter(unit=>unit.side==="player").map(unit=>[
        unit.id,{...movementOptions(state,unit),retreatBlocked:retreatProblem(state,unit)},
      ])),
    };
  };

  function queueAttack(request) {
    const side = request.type === "attack" || request.type === "playerSkill" ? "player" : "enemy";
    const {actor} = assertAttack(state,request.actor,request.target,side);
    const game = state;
    const speech = say(game,actor,"ready");
    if (!speech) {
      action(game,request,roll);
      queueBot();
      return;
    }
    game.busy = true;
    if (side === "enemy") {
      game.pendingEnemyAttack = {actor:actor.id,target:request.target,startsAt:speech.startsAt,expiresAt:speech.expiresAt};
    }
    function finishAttack() {
      if (state !== game || finishPendingAttack !== finishAttack) return;
      const remaining = speech.expiresAt-Date.now();
      if (game.dialogueEnabled && remaining > 0) {
        setTimeout(finishAttack,remaining);
        return;
      }
      finishPendingAttack = undefined;
      game.busy = false;
      game.pendingEnemyAttack = null;
      action(game,request,roll);
      queueBot();
    }
    finishPendingAttack = finishAttack;
    finishAttack();
  }

  function setDialogue(enabled) {
    dialogueEnabled = enabled;
    if (!state || state.dialogueEnabled === enabled) return;
    state.dialogueEnabled = enabled;
    if (!enabled) {
      const now = Date.now();
      state.speeches = [];
      state.log = state.log.filter(entry=>entry.kind !== "speech" || entry.detail.startsAt <= now);
      for (const unit of state.units) {
        for (const line of unit.dialogue.filter(entry=>entry.spokenAt > now)) {
          line.used = false;
          delete line.spokenAt;
        }
      }
      finishPendingAttack?.();
    }
    state.rev++;
  }

  function queueBot() {
    clearTimeout(botTimer);
    const forced = state.phase === "player" && controlledStatus(orderedActors(state)[0]) === "confusion";
    if (state.busy || (state.phase !== "enemy" &&
      !forced && !(state.autoBattle && ["player","reinforcement"].includes(state.phase)))) return;
    const game = state;
    botTimer = setTimeout(() => {
      if (state !== game) return;
      const move = game.phase === "reinforcement" ? {type:"finishReinforcement"} : chooseBattleAction(game);
      if (move?.target && ["attack","enemyAttack","playerSkill","enemySkill"].includes(move.type)) queueAttack(move);
      else if (move) {
        action(game,move,roll);
        queueBot();
      }
    },delay);
  }

  function submit(request) {
    if (encounterMembers && ["reset","terrain"].includes(request.type)) throw new Error("遭遇战不能更换战场");
    if (!encounterMembers && request.type === "encounterExit") throw new Error("当前没有地图遭遇");
    if (request.type !== "reset") state ??= newBattle();
    if (request.type === "reset") {
      state = newBattle();
      finishPendingAttack = undefined;
      match++;
    } else if (request.type === "autoBattle") {
      if (state.phase === "setup" || state.phase === "ended") return snapshot();
      state.autoBattle = Boolean(request.enabled);
      state.rev++;
    } else if (state.busy) {
      throw new Error("当前动作正在结算");
    } else if (state.autoBattle) {
      throw new Error("请先关闭自动战斗。");
    } else if (request.type === "attack") {
      queueAttack(request);
    } else {
      action(state,request,request.type === "terrain" ? weatherRoll : roll);
      if (encounterMembers && request.type === "start") encounterStarted = true;
    }
    queueBot();
    return snapshot();
  }

  function beginEncounter(player, weatherId, allies = [], ammo, partyMemberIds = allies.map(unit => unit.id), enemies, encounter, terrain) {
    if (encounterMembers) return;
    const members = allies.map(unit => ({...unit,presetId:unit.id,id:"ally-" + encodeURIComponent(unit.id)}));
    state = createBattle(terrain?.id ?? "clearing",weatherId,supplies,{...player,presetId:player.id,id:"pc"},rosterProfiles,members,partyMemberIds,enemies,encounter,terrain?.ground);
    if (Number.isSafeInteger(ammo) && ammo >= 0) Object.assign(state,{ ammoLeft:ammo, ammoSpent:0 });
    encounterMembers = [[player.id,"pc"],...allies.flatMap((unit,i)=>unit.tamed ? [] : [[unit.id,members[i].id]])];
    if (encounter?.arena?.mode === "sparring") {
      for (const opponent of enemies ?? []) encounterMembers.push([opponent.id,opponent.id]);
    }
    state.dialogueEnabled = dialogueEnabled;
    finishPendingAttack = undefined;
    match++;
  }

  function updateRoster(profiles) {
    rosterProfiles = profiles;
  }

  function equipment(id) {
    const unit = state?.units.find(unit=>unit.id === id);
    if (!unit) return null;
    return {
      unit, revision:state.rev, busy:state.busy,
      locked:unit.side !== "player" || unit.tamed || state.phase !== "setup" || ["training","sparring"].includes(state.encounter?.arena?.mode),
      usedItems:state.usedItems[id] ?? [], itemSwaps:state.itemSwaps[id] ?? [],
    };
  }

  function changeEquipment(id, revision, gear) {
    const current = equipment(id);
    if (!current || current.locked) throw new Error("这名角色的装备已锁定。");
    if (revision !== current.revision || current.busy) throw new Error("战斗状态已更新，请稍后再试。");
    replaceBattleEquipment(current.unit,gear);
    delete state.usedItems[id];
    delete state.itemSwaps[id];
    state.rev++;
    return snapshot();
  }

  function result() {
    if (!encounterMembers || state.phase !== "ended") return null;
    const outcome = state.winner === "player" ? "victory" : state.endReason === "withdrawal" ? "retreat" : "defeat";
    const hp = Object.fromEntries(encounterMembers.map(([member,unit])=>[member,state.units.find(entry=>entry.id===unit)?.hp ?? 0]));
    const durability = Object.fromEntries(encounterMembers.flatMap(([member,unit])=>{
      const fallen = state.fallen.find(entry=>entry.card.id===unit);
      if (fallen?.durability) return [[member,fallen.durability]];
      const entry = state.units.find(entry=>entry.id===unit) ?? fallen?.card;
      if (!entry) return [];
      const slots = armorDurability(entry);
      return Object.keys(slots).length ? [[member,slots]] : [];
    }));
    const usedItems = Object.fromEntries(encounterMembers.filter(([,unit])=>state.usedItems[unit])
      .map(([member,unit])=>[member,state.usedItems[unit]]));
    const itemSwaps = Object.fromEntries(encounterMembers.filter(([,unit])=>state.itemSwaps[unit])
      .map(([member,unit])=>[member,state.itemSwaps[unit]]));
    const mana = Object.fromEntries(encounterMembers.filter(([,unit])=>state.restoredMana[unit] !== undefined)
      .map(([member,unit])=>[member,state.restoredMana[unit]]));
    const experience = outcome === "retreat" ? {} : Object.fromEntries(encounterMembers.filter(([,unit])=>state.experience[unit])
      .map(([member,unit])=>[member,{...state.experience[unit]}]));
    const settlement = state.encounter?.persistentSpoils && state.settlement?.left ? state.settlement : null;
    const materials = settlement?.inventory.filter(item=>item.harvested).map(item=>({name:item.name,qty:item.quantity}));
    const corpses = settlement?.inventory.flatMap(item=>item.corpse ? [item.corpse.unit] : []);
    const trapLoot = state.settlement?.left ? state.settlement.inventory.filter(item=>item.recoveredTrap) : [];
    const traps = [];
    const remainingTraps = new Map(trapLoot.map(item=>[item.name,item.quantity]));
    for (const name of state.encounter?.recoveredTraps ?? []) {
      const quantity = remainingTraps.get(name) ?? 0;
      if (quantity > 0) {
        traps.push(name);
        remainingTraps.set(name,quantity-1);
      }
    }
    const spoils = (settlement || traps.length > 0) && {
      ...(materials?.length ? {materials} : {}),
      ...(corpses?.length ? {corpses} : {}),
      ...(traps.length ? {traps} : {}),
      items:settlement?.inventory.flatMap(item=>item.source ? [{...item.source,current:item.current}] : []) ?? [],
      prisoners:(settlement?.entries ?? []).filter(entry=>entry.executed || entry.kind==="prisoner" && entry.disposition==="recruit")
        .map(entry=>({unit:entry.card.id,name:entry.card.name,outcome:entry.disposition === "recruit" ? "capture" : "execute",
          hp:entry.card.hp,durability:entry.durability,...(entry.executed ? {description:entry.executed} : {})})),
    };
    const fallenTamed = state.fallen.filter(entry=>entry.card.tamed).map(entry=>entry.card.id);
    return {outcome,hp,...(encounterStarted ? {battleLog:battleLogLines(state.log)} : {}),
      ...(fallenTamed.length ? {fallenTamed} : {}),
      ...(spoils ? {spoils} : {}),
      ...(state.peacefulExit ? {peacefulExit:true} : {}),...(Object.keys(experience).length ? {experience} : {}),
      ...(Object.keys(durability).length ? {durability} : {}),
      ...(Object.keys(usedItems).length ? {usedItems} : {}),...(Object.keys(itemSwaps).length ? {itemSwaps} : {}),
      ...(Object.keys(mana).length ? {mana} : {})};
  }

  return { snapshot, submit, beginEncounter, updateRoster, setDialogue, result, equipment, changeEquipment };
}
