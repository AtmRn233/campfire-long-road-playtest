// 2026-11-23 用户确认的本地试听编号。来源及许可见 audio/selected/CREDITS.txt。
export const selectedBattleRecordings={
  block:{code:"S0430",url:"./audio/selected/S0430.wav",offset:.176},
  shieldBreak:{code:"S2205",url:"./audio/selected/S2205.wav",offset:.15},
  missOne:{code:"S0602",url:"./audio/selected/S0602.wav"},
  missTwo:{code:"S2224",url:"./audio/selected/S2224.wav"},
  bowLaunch:{code:"S0927",url:"./audio/selected/S0927.wav",offset:.096},
  crossbowLaunch:{code:"S0926",url:"./audio/selected/S0926.wav",offset:.040},
  throwLaunch:{code:"S0912",url:"./audio/selected/S0912.wav"},
  armorHit:{code:"S0667",url:"./audio/selected/S0667.wav"},
  bluntHit:{code:"S0633",url:"./audio/selected/S0633.wav",offset:.250},
  sharpHit:{code:"S0630",url:"./audio/selected/S0630.wav",offset:.176},
  fleshHit:{code:"S0644",url:"./audio/selected/S0644.wav",offset:.048},
  // 本轮远程试装，等待用户试听定稿。
  projectileSoft:{code:"S2478",url:"./audio/selected/S2478.wav"},
  projectileMetal:{code:"S2480",url:"./audio/selected/S2480.wav"},
  projectileMiss:{code:"S2482",url:"./audio/selected/S2482.wav"},
  crossbowMiss:{code:"S2483",url:"./audio/selected/S2483.wav",offset:.029},
};

// offset只跳过录音前导空白；保留原文件和已选声音本身。

function metalArmor(armor) {
  if(armor?.impactKind) return armor.impactKind==="metal";
  // 兼容旧快照；没有材质依据时不擅自播放金属鸣响。
  return /链甲|鎖子|锁子|鳞甲|鱗甲|扎甲|板甲|盔|金属|金屬/.test(armor?.name??"");
}

function physicalHitSound(weapon) {
  if(weapon?.magic) return undefined;
  // 使用原型名，避免物品改名和金属制钝器影响命中分类。
  const name=weapon?.baseName??weapon?.name??"";
  if(/徒手|拳|简易武器|簡易武器|棍|棒|锤|錘|枷|投石|石索/.test(name)) return "bluntHit";
  if(/刀|剑|劍|匕|斧|矛|枪|槍|叉|镰|鐮|弓|弩/.test(name)) return "sharpHit";
  return undefined;
}

export function selectedStrikeSounds(strike,weapon,target) {
  const events=[];
  const add=(name,delay=0)=>{
    if(!events.some(e=>e.name===name&&e.delay===delay)) events.push({name,delay});
  };
  const ranged=weapon?.range==="远程";
  const name=weapon?.baseName??weapon?.name??"";
  const projectile=ranged&&!weapon?.magic&&/[弓弩]|标枪|標槍|投斧|飞斧|飛斧|投石|石索/.test(name);
  const piercing=projectile&&/[弓弩]|标枪|標槍/.test(name);
  // 给已选发射声的主体留出空间，再播放一次接触或掠过。
  const impact=projectile ? .28 : ranged ? .16 : .105;
  // 魔法尚待用户定稿，暂沿用原来的施法声。近战出手不播放声音。
  if(weapon?.magic) add("magic");
  else if(ranged) add(/弩/.test(name)?"crossbowLaunch":/弓/.test(name)?"bowLaunch":"throwLaunch");
  // S2205 已含撞击与裂碎，破盾时替代普通盾挡，避免同一击叠加两次撞击。
  if(strike.outcome==="block") add(strike.guard?.broken?"shieldBreak":strike.guard||strike.zone==="shield"?"shield":"block",impact);
  else if(projectile) {
    if(strike.hit===false || ["miss","dodge"].includes(strike.outcome)) add(/弩/.test(name)?"crossbowMiss":"projectileMiss",impact);
    else {
      const metal=strike.blocked>0&&metalArmor(target?.armor?.[strike.zone]);
      add(metal ? piercing?"projectileMetal":"armorHit" : piercing?"projectileSoft":physicalHitSound(weapon)??"fleshHit",impact);
    }
  }
  else if(strike.hit===false || ["miss","dodge"].includes(strike.outcome)) {
    if(!ranged && !weapon?.magic) add(weapon?.twoHanded?"missTwo":"missOne",impact);
    else if(strike.outcome==="dodge") add("dodge",impact);
    else if(ranged && !weapon?.magic) add("arrowPass",impact-.035);
  } else {
    const physical=physicalHitSound(weapon);
    if(strike.blocked>0) add(metalArmor(target?.armor?.[strike.zone])?"armorHit":physical??"padded",impact);
    if(strike.hpLoss>0 || strike.mountLoss>0) add(physical??"fleshHit",impact);
  }
  return events;
}

export function selectedStrikeFeedback(strike,weapon,target,fallen=false) {
  const events=selectedStrikeSounds(strike,weapon,target);
  const impact=Math.max(0,...events.map(e=>e.delay));
  if(target&&strike.hpLoss>0&&(fallen||strike.hpLoss*10>=target.maxHp)&&strike.hit!==false&&!["miss","dodge","block"].includes(strike.outcome)) {
    const gender=["male","female"].includes(target.gender)?target.gender:target.voiceProfile==="female"||target.id==="vera"?"female":"male";
    events.push({name:gender+(fallen?"-death":"-hurt"),delay:impact+(fallen ? .12 : .08),volume:fallen ? .60 : .46});
  }
  if(fallen||strike.dismounted) events.push({name:"fall",delay:impact+.28});
  return events.sort((a,b)=>a.delay-b.delay);
}
