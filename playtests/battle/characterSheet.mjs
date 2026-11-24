const attributes = [
  ["str","strength","力量"], ["dex","dexterity","敏捷"], ["con","constitution","体质"],
  ["int","intelligence","智力"], ["per","perception","感知"], ["cha","charisma","魅力"],
];
const originColumns = [
  ["base","基础"], ["race","种族"], ["origin","出身"], ["profession","职业"], ["traits","特质"],
];

export function characterProfileTop(profile) {
  const fallbackGender = profile.gender === "male" ? "男性" : profile.gender === "female" ? "女性" : profile.gender;
  return {
    identity: [
      ["种族",profile.raceName || "—"],
      ["性别",profile.genderLabel || fallbackGender || "未填写"],
      ["职业",profile.profession || "—"],
      ["体型",profile.bodyLabel || "—"],
      ["出身",profile.originName || "未选择"],
      ["阵营",profile.factionLabel || "未设定"],
    ],
    progress: [
      ["等级",profile.level === undefined ? "—" : profile.level + " 级"],
      ["当前经验",profile.experience ?? "—"],
    ],
  };
}

export function characterAttributeSheet(unit) {
  const sources = Object.values(unit.attributeSources ?? {});
  const columns = sources.some(row=>row.base !== undefined) ? [...originColumns] : [];
  if (sources.some(row=>row.initial !== undefined)) columns.push(["initial","初始"]);
  if (sources.length || unit.levelPoints) columns.push(["growth","等级加值"]);
  if (sources.some(row=>row.adjustment)) columns.push(["adjustment","其他修正"]);
  columns.push(["total","总和"]);
  if (attributes.some(([,key])=>unit.effectiveAttributes?.[key] !== undefined &&
    unit.effectiveAttributes[key] !== unit.attributes[key])) columns.push(["effective","生效"]);

  const [highest, secondHighest] = [...new Set(attributes.map(([,key])=>unit.attributes[key]).filter(Number.isFinite))]
    .sort((a,b)=>b-a);
  return {
    columns: columns.map(([key,label])=>({key,label,emphasis:key === "total" || key === "effective"})),
    rows: attributes.map(([id,key,label])=>{
      const total = unit.attributes[key];
      const source = unit.attributeSources?.[key];
      const values = {growth:unit.levelPoints?.[key],...source,total,effective:unit.effectiveAttributes?.[key] ?? total};
      const rank = total === undefined ? undefined : total === highest ? 1 : total === secondHighest ? 2 : undefined;
      return {id,label,total,rank,cells:columns.map(([column])=>{
        const value = values[column];
        const signed = column !== "base" && column !== "initial" && column !== "total" && column !== "effective";
        return value === undefined ? "—" : (signed && value > 0 ? "+" : "") + value;
      })};
    }),
  };
}

export function characterProfileData(unit) {
  const {identity,progress} = characterProfileTop(unit);
  const pairs = [
    ["抗性",unit.profileResistances?.join("、") || "—"], ["状态",unit.profileStatuses?.join("、") || "无"],
    ["特质",unit.traits?.join("、") || "无"], ["伤残","—"],
  ];
  const vitals = [
    ["士气",unit.profileMorale ?? "—"], ["先攻",unit.initiative ?? "—"],
    ["伤害",unit.damage ?? "—","damage"], ["命中",unit.profileHit === undefined ? "—" : unit.profileHit + "%","hit"],
    ["格挡率",unit.meleeBlock === undefined ? "—" : Math.max(unit.meleeBlock,unit.rangedBlock ?? 0) + "%","block"],
    ["闪避率",unit.dodge === undefined ? "—" : unit.dodge + "%","dodge"],
  ];
  return {identity,progress,pairs,vitals};
}

const escape = value => String(value).replace(/[&<>"']/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
export function characterProfileSections(unit, interactive=false) {
  const {identity,progress,pairs,vitals} = characterProfileData(unit);
  const table = (rows, kind) => '<dl class="profile-table ' + kind + '">' + rows.map(([label,value,stat])=>
    '<div' + (interactive && stat ? ' data-unit-stat="' + stat + '" tabindex="0" aria-describedby="unit-stat-details"' : '') +
    '><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>').join("") + '</dl>';
  const cells = [
    ["head","头盔",unit.armor.head], ["body","护甲",unit.armor.body],
    ["hp","血量",{current:unit.hp,max:unit.maxHp}], ["stamina","耐力",unit.stamina],
    ["shield","盾牌",unit.shield], ["magic","魔力",unit.magic], ["mount","坐骑血量",unit.mount], [],
  ];
  const resources = cells.map(([kind,label,part])=>{
    if (!part) return '<span aria-hidden="true"></span>';
    const {current,max} = part;
    const value = current + " / " + max;
    const width = max > 0 ? Math.min(100,Math.max(0,100 * current/max)) : 0;
    return '<span class="meter ' + kind + '" aria-label="' + label + ' ' + escape(value) + '">' +
      '<i>' + label + '</i><b><s style="width:' + width + '%"></s></b><em>' + escape(value) + '</em></span>';
  }).join("");
  return {
    facts:table(identity,"profile-identity") + table(progress,"profile-progress") + table(pairs,"profile-pairs"),
    vitals:table(vitals,"profile-vitals"),
    resources:'<section class="profile-table profile-resources unit-profile-resources" aria-label="战斗资源">' + resources + '</section>',
  };
}

export function renderCharacterProfileData(unit, interactive=false) {
  const {facts,vitals,resources} = characterProfileSections(unit,interactive);
  return facts + vitals + resources;
}
