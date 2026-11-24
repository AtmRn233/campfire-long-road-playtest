const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

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
