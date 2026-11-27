import recordings from "./audio/monsters/manifest.json" with {type:"json"};

export const monsterHitRecordings=recordings;

export function monsterHitSound(target) {
  if(!target?.monster) return undefined;
  const kind=target.monster.kind??target.raceName??target.role;
  const normalized=kind==="龙类"?"龙":kind==="精类"?"妖精":kind;
  return recordings[normalized]?.name;
}
