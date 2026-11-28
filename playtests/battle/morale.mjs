export const moraleLimit = 3;
export const whiteFlag = -4;
export const heavyWoundRatio = .3;

const sides = ["player","enemy"];
const opposite = side => side === "player" ? "enemy" : "player";
const onField = unit => unit.hp > 0 && !["reserve","undeployed","swallowed"].includes(unit.row);
export const canFight = unit => onField(unit) && unit.morale !== whiteFlag;
export const nearby = (a,b) => Math.abs(rankOf(a)-rankOf(b)) + Math.abs(a.column-b.column) === 1;
export const isHeavilyWounded = unit => unit.hp <= unit.maxHp*heavyWoundRatio;
const ownFront = unit => unit.row === "front" && fieldSideOf(unit) === unit.side;

export function startMorale(state) {
  state.moraleTracking = Object.fromEntries(sides.map(side=>{
    const field = state.units.filter(unit=>unit.side===side && onField(unit));
    return [side,{
      initialIds:field.map(unit=>unit.id),
      frontEligible:field.filter(ownFront).length>=2,
      milestones:new Set(), outnumberedByLoss:false,
    }];
  }));
}

function mark(team, key, condition) {
  if (!condition || team.milestones.has(key)) return false;
  team.milestones.add(key);
  return true;
}

const outnumbered = (ours,theirs) => ours > 0 && theirs >= ours*2;

export function settleMorale(state, event, report, useResolve) {
  const teams = state.moraleTracking;
  const roundEnd = event.roundEnd;
  let losses = (event.fallen ?? []).map(unit=>({unit,routed:false}));
  let changes = event.changes ?? [];
  if (event.actor && losses.length) {
    const actor = event.actor;
    const counterkill = isHeavilyWounded(actor);
    const doubleKill = losses.length >= 2;
    changes = [...changes,[actor,counterkill || doubleKill ? 2 : 1,
      doubleKill ? "一举击倒多名敌人" : counterkill ? "带伤反杀" : "击倒敌人"]];
    for (const ally of state.units.filter(unit=>unit.side===actor.side && onField(unit) && unit.morale===whiteFlag)) {
      changes.push([ally,1,"见队友击倒敌人"]);
    }
  }

  const routedInEvent = new Set();
  const original = new Map(state.units.map(unit=>[unit,unit.morale]));
  const selected = new Map();
  const outranks = (delta,current) => !current || Math.abs(delta)>Math.abs(current.delta) ||
    (Math.abs(delta)===Math.abs(current.delta) && delta<current.delta);
  while (changes.length || losses.length || event.reinforced || event.roundEnd) {
    const affected = new Map();
    const field = state.units.filter(onField);
    const fighters = field.filter(canFight);
    const count = side => fighters.filter(unit=>unit.side===side).length;
    const frontCount = side => fighters.filter(unit=>unit.side===side && ownFront(unit)).length;
    const propose = (unit,delta,reason) => {
      if (!onField(unit) || unit.monster?.morale === false || (delta>0 && routedInEvent.has(unit.id))) return;
      if (outranks(delta,affected.get(unit)) && outranks(delta,selected.get(unit))) affected.set(unit,{delta,reason});
    };
    const teamChange = (side,delta,reason) => {
      for (const unit of field.filter(unit=>unit.side===side)) propose(unit,delta,reason);
    };
    const swing = (side,amount,reason) => {
      teamChange(side,-amount,"因本方" + reason);
      teamChange(opposite(side),amount,"因敌方" + reason);
    };
    for (const change of changes) propose(...change);
    for (const {unit,routed} of losses) {
      for (const ally of field.filter(ally=>ally.side===unit.side && nearby(ally,unit))) {
        propose(ally,-1,"目睹邻近队友" + (routed ? "举起白旗" : "阵亡"));
      }
    }
    const fieldLosses = losses.filter(({unit,routed})=>unit.row!=="reserve" && (routed || unit.morale!==whiteFlag));
    for (const side of sides) {
      const team = teams[side];
      const theirs = opposite(side);
      const lost = fieldLosses.filter(({unit})=>unit.side===side);
      if (lost.length) {
        const unavailable = team.initialIds.filter(id=>!state.units.some(unit=>unit.id===id && unit.hp>0 && unit.morale!==whiteFlag)).length;
        if (mark(team,"halfLost",unavailable>=2 && unavailable*2>=team.initialIds.length)) swing(side,2,"减员过半");
        if (mark(team,"frontBroken",team.frontEligible && frontCount(side)===0 && lost.some(({unit})=>ownFront(unit)))) {
          swing(side,2,"前排崩溃");
        }
        const formerEnemyCount = count(theirs)+fieldLosses.filter(({unit})=>unit.side===theirs).length;
        if (!outnumbered(count(side)+lost.length,formerEnemyCount) && outnumbered(count(side),count(theirs))) {
          team.outnumberedByLoss = true;
        }
      }
      if (mark(team,"frontRecovered",event.reinforced?.side===side && event.reinforced.row==="front" &&
          team.milestones.has("frontBroken") && frontCount(side)>=2)) {
        teamChange(side,1,"因前排重新集结");
      }
      if (event.roundEnd && mark(team,"outnumbered",team.outnumberedByLoss && outnumbered(count(side),count(theirs)))) {
        teamChange(side,-1,"因减员陷入两倍兵力劣势");
      }
    }
    const newLosses = [];
    for (const [unit,change] of affected) {
      selected.set(unit,change);
      const resolve = change.delta < 0 && unit.statuses?.resolve > 0 && original.get(unit) > whiteFlag;
      const level = Math.max(whiteFlag,Math.min(moraleLimit,original.get(unit)+change.delta+Number(resolve)));
      if (level === unit.morale) continue;
      unit.morale = level;
      if (level === whiteFlag && !routedInEvent.has(unit.id)) {
        routedInEvent.add(unit.id);
        newLosses.push({unit,routed:true});
      }
    }
    losses = newLosses;
    changes = [];
    if (event.reinforced || event.roundEnd) event = {};
  }
  if (roundEnd) for (const side of sides) teams[side].outnumberedByLoss = false;
  for (const [unit,{reason,delta}] of selected) {
    if (delta < 0 && original.get(unit) > whiteFlag && unit.statuses?.resolve > 0) useResolve?.(unit);
    if (unit.morale !== original.get(unit)) report(unit,reason,original.get(unit));
  }
}
import { fieldSideOf, rankOf } from "./grid.mjs";

