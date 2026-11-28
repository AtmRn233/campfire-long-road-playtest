import { headshotCrop, portraitBackground, portraitSelectionKey, readPortraitCrop } from "./portraits.mjs";

const professionIcons = {
  战士:"⚔️",野蛮人:"🪓",武僧:"👊",游侠:"🏹",盗贼:"🗡️",圣骑士:"🛡️",牧师:"✝️",德鲁伊:"🌿",
  吟游诗人:"🎶",法师:"🪄",术士:"✨",契约术士:"📜",农夫:"🌾",牧人:"🐑",渔人:"🎣",采集人:"🧺",
  锻造师:"⚒️",木匠:"🪚",裁缝:"🪡",皮匠:"🧵",珠宝匠:"💎",炼金术士:"⚗️",医师:"🩹",厨师:"🍳",
  行旅向导:"🧭",行商:"💰",学士:"📚",观光客:"🎒",骑兵:"🐎",步兵:"🗡️",弩手:"🏹",斧手:"🪓",
};
const text = (value) => String(value).replace(/[&<>"']/g,(ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
export const whiteFlag = -4;
export const moraleLabel = (level) => level === whiteFlag ? "白旗，跳过行动" : level === 0 ? "普通" : (level > 0 ? "+" : "−") + Math.abs(level);
export const unitCardLevel = (unit) => {
  const value = Number(unit.level);
  const level = Number.isFinite(value) ? Math.max(1,Math.trunc(value)) : 1;
  return unit.monster ? Math.min(10,level) : level;
};

export function renderUnitHeadshot(name, source, key, className="face") {
  if (!source) return '<span class="' + className + ' portrait-placeholder" aria-hidden="true">' + text([...name][0] ?? "") + '</span>';
  const saved = key ? readPortraitCrop(portraitSelectionKey(key,source)) : undefined;
  const crop = headshotCrop(source,saved);
  if (!crop) return '<img class="' + className + '" src="' + text(source.url) + '" alt="">';
  const {size,position} = portraitBackground(source,crop);
  const url = 'url("' + source.url.replaceAll('"','%22') + '")';
  return '<span class="' + className + ' portrait-crop-asset" aria-hidden="true" style="background-image:' + text(url) +
    ';background-repeat:no-repeat;background-size:' + size.map(value=>value+"%").join(" ") +
    ';background-position:' + position.map(value=>value+"%").join(" ") + '"></span>';
}

export function renderUnitMeter(kind,label,value,capacity,trail="") {
  const current = Number(value);
  const max = Number(capacity);
  if (kind === "mount" && current === 0 && !trail) return "";
  return '<span class="meter ' + kind + '" data-empty="' + (current === 0) +
    '" aria-label="' + label + ' ' + current + '／' + max + '"><i>' + label +
    '</i><b><s style="width:' + (max ? 100 * current/max : 0) + '%"></s>' + trail + '</b><em>' + current + '</em></span>';
}

export function renderUnitCardContent(unit,{portrait, badges="", field=false, meterTrail, turn=""}={}) {
  const morale = unit.morale ?? 0;
  const tone = morale === whiteFlag ? "routed" : morale > 0 ? "raised" : morale < 0 ? "shaken" : "steady";
  const marker = morale === whiteFlag ? "🏳️" : '<i class="morale-eagle" aria-hidden="true"></i>'.repeat(Math.max(1,Math.abs(morale)));
  const profession = unit.profession || unit.role || "职业未定";
  const level = unitCardLevel(unit);
  const levelLabel = level + " 级";
  const meter = (kind,label,{current,max}) => renderUnitMeter(kind,label,current,max,meterTrail?.(kind,current,max));
  const gear = (unit.mount ? meter("mount","骑",unit.mount) : "") || (unit.shield ? meter("shield","盾",unit.shield) : "");
  const energy = unit.magic ? meter("magic","魔",unit.magic) :
    field ? meter("stamina","耐",unit.stamina ?? {current:0,max:0}) : "";
  const resources = meter("head","盔",unit.armor.head) + meter("body","甲",unit.armor.body) +
    meter("hp","血",{current:unit.hp,max:unit.maxHp}) + (field ? energy + gear : gear || energy);
  const face = portrait ?? renderUnitHeadshot(unit.name);
  return '<span class="card-portrait">' + face + badges + '</span><span class="card-data"><strong>' +
    text(unit.name) + '</strong>' + resources + '</span>' +
    '<span class="morale-mark ' + tone + '" role="img" aria-label="士气 ' + moraleLabel(morale) +
    '" title="士气 ' + moraleLabel(morale) + '">' + marker + '</span>' +
    '<span class="level-mark" data-level="' + level + '" role="img" aria-label="' + levelLabel + '" title="' + levelLabel + '">' + level + '</span>' +
    '<span class="profession-mark" role="img" aria-label="职业：' + text(profession) + '" title="' + text(profession) + '">' +
    (Object.hasOwn(professionIcons,profession) ? professionIcons[profession] : "👤") + '</span>' + turn;
}
