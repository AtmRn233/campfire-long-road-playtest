const positive = {
  defend:"防御",dodge:"闪避",cover:"掩护",precision:"精准",blur:"朦胧",stoneSkin:"石肤",
  charge:"蓄力",haste:"加速",counter:"反击",regeneration:"再生",resolve:"坚定",unyielding:"不屈",
  poisonImmunity:"免毒",poisonedWeapon:"淬毒",smoke:"烟幕",stealth:"潜行",shieldWall:"盾阵",
};
const negative = {
  surprised:"措手不及",restrained:"束缚",taunted:"嘲讽",exposed:"破绽",dazzled:"目眩",staggered:"踉跄",
  burning:"燃烧",bleeding:"流血",poisoned:"中毒",venom:"剧毒",charmed:"魅惑",sleep:"睡眠",stunned:"昏倒",
  disarmed:"缴械",fear:"恐惧",weakness:"虚弱",frozen:"冻僵",corrosion:"腐蚀",wet:"潮湿",nightmare:"恶梦",
  painLink:"痛苦连结",suppressed:"压制",swallowed:"被吞噬",slow:"减速",prone:"倒地",suffocation:"缺氧",
  hallucination:"幻觉",confusion:"混乱",bloodlust:"嗜血",silence:"禁魔",polymorph:"变形",curse:"诅咒",marked:"标记",
};

export const battleStatusNames = {...positive,...negative};
export const isAdverseStatus = id => Object.hasOwn(negative,id);
const statusIds = new Map(Object.entries(battleStatusNames).map(([id,name])=>[name,id]));
statusIds.set("窒息","suffocation");
statusIds.set("溺水","suffocation");
export const battleStatusId = name => statusIds.get(name) ?? (Object.hasOwn(battleStatusNames,name) ? name : undefined);
export const hasStatus = (unit,id) => (unit?.statuses?.[id] ?? 0) > 0;
export const cannotDefend = unit => ["stunned","prone"].some(id=>hasStatus(unit,id));
export const skippedStatus = unit => ["surprised","stunned","prone","sleep"].find(id=>hasStatus(unit,id));
export const forcedStatus = unit => ["charmed","confusion","bloodlust","polymorph"].find(id=>hasStatus(unit,id));
export const controlledStatus = unit => ["charmed","confusion"].find(id=>hasStatus(unit,id));
export const canCounter = unit => !cannotDefend(unit) && !hasStatus(unit,"sleep") && !hasStatus(unit,"surprised") &&
  !forcedStatus(unit);
export const roundDamage = {
  burning:[15,"fire"],bleeding:[10],poisoned:[10,"poison"],venom:[30,"poison"],nightmare:[20,"psychic"],
  swallowed:[20],suffocation:[10],
};
export const sourceStatuses = new Set(["cover","taunted","charmed","painLink","swallowed"]);
export const initiativeStatuses = [["haste",5],["staggered",-5]];
export const attackerHitStatuses = [["precision",30],["dazzled",-30],["suppressed",-15],["hallucination",-20],["curse",-10]];
export const defenderHitStatuses = [["blur",-30],["smoke",-20]];
export const dodgeStatuses = [["exposed",-30],["suppressed",-15],["curse",-10]];
export const activeStatusValues = (unit,effects) => effects.filter(([id])=>hasStatus(unit,id))
  .map(([id,value])=>[battleStatusNames[id],value]);

export function typedDamage(unit,damage,type) {
  const affinity = type ? Number(unit.resistances?.[type]) || 0 : 0;
  const wet = hasStatus(unit,"wet") ? (type === "fire" ? -.5 : type === "cold" || type === "lightning" ? 1 : 0) : 0;
  if (affinity <= -1) return 0;
  if (affinity*wet < 0) return damage;
  return Math.floor(damage*(1+(wet || affinity)));
}
