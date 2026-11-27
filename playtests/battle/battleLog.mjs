const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

export const strikeLabels = {hit:"命中",miss:"失手",dodge:"闪避",block:"格挡"};
export const strikeLabel = ({outcome,hit}) => strikeLabels[outcome] ?? (hit === false ? strikeLabels.miss : strikeLabels.hit);

export function battleLogLines(entries,now = Date.now()) {
  return entries.filter(entry=>entry.at<=now).sort((a,b)=>a.at-b.at || a.id-b.id).map(({text,speaker,detail})=>{
    if (!detail?.accuracy) return speaker ? speaker + "：" + text : text;
    const losses = [
      detail.damage?.hpLoss > 0 && "扣除 " + detail.damage.hpLoss + " 点生命",
      detail.damage?.blocked > 0 && "护甲损失 " + detail.damage.blocked + " 点耐久",
      detail.guard?.blocked > 0 && "盾牌损失 " + detail.guard.blocked + " 点耐久",
      detail.mountDamage?.loss > 0 && "坐骑损失 " + detail.mountDamage.loss + " 点生命",
    ].filter(Boolean);
    return text + "，" + strikeLabel(detail) + (detail.hit === false ? "。" : "！") +
      (losses.length ? losses.join("，") + "。" : "");
  });
}

export function battleFaction(unit,partyIds) {
  if (unit.side === "enemy") return "enemy";
  return !partyIds || partyIds.has(unit.id) ? "player" : "ally";
}

export function createBattleLogLabels(escapeText) {
  const unitsById = new Map();
  let match;
  let names = new Map();
  let namePattern = null;

  function update(currentMatch,units,partyIds) {
    if (match !== currentMatch) {
      match = currentMatch;
      unitsById.clear();
    }
    for (const unit of units) {
      const faction = battleFaction(unit,partyIds);
      unitsById.set(unit.id,{name:unit.name,faction});
    }
    names = new Map();
    for (const {name,faction} of unitsById.values()) {
      if (name) names.set(name,names.has(name) && names.get(name) !== faction ? null : faction);
    }
    const alternatives = [...names.keys()].sort((a,b)=>b.length-a.length).map(escapePattern);
    namePattern = alternatives.length ? new RegExp(alternatives.join("|"),"g") : null;
  }

  function format(message,participants = []) {
    if (!namePattern) return escapeText(message);
    const orderedUnits = participants.map(id=>unitsById.get(id)).filter(Boolean);
    let cursor = 0;
    let html = "";
    for (const hit of message.matchAll(namePattern)) {
      const [name] = hit;
      const faction = orderedUnits[0]?.name === name ? orderedUnits.shift().faction : names.get(name);
      const label = escapeText(name);
      html += escapeText(message.slice(cursor,hit.index));
      html += faction ? '<span class="log-name ' + faction + '">' + label + '</span>' : label;
      cursor = hit.index + name.length;
    }
    return html + escapeText(message.slice(cursor));
  }

  return {update,format};
}
