import { battleSession } from "./client.mjs?v=battle-help";
import { weatherParticles } from "../weatherVisual.mjs";
import { armorPenetrationReduction, battleSwapProblem, dodgeAfterAction, restorationTargets } from "./battle.mjs";
import { fieldSideOf } from "./grid.mjs";
import { battleItemLabels, battleItemsBySlot } from "./loadout.mjs";
import { createOpeningScreen } from "./opening.mjs";
import { createPortraitViewer, portraitBackground, portraitSource } from "./portraits.mjs";

const $ = (id) => document.getElementById(id);
const colors = {gold:"#ffe0a0", dull:"#baa48a", hostile:"#ff947d"};
const names = {front:"前排",back:"后排",reserve:"预备队"};
const professionIcons = {
  战士:"⚔️",野蛮人:"🪓",武僧:"👊",游侠:"🏹",盗贼:"🗡️",圣骑士:"🛡️",牧师:"✝️",德鲁伊:"🌿",
  吟游诗人:"🎶",法师:"🪄",术士:"✨",契约术士:"📜",农夫:"🌾",牧人:"🐑",渔人:"🎣",采集人:"🧺",
  锻造师:"⚒️",木匠:"🪚",裁缝:"🪡",皮匠:"🧵",珠宝匠:"💎",炼金术士:"⚗️",医师:"🩹",厨师:"🍳",
  行旅向导:"🧭",行商:"💰",学士:"📚",观光客:"🎒",骑兵:"🐎",步兵:"🗡️",弩手:"🏹",斧手:"🪓",
};
const embedded = window.parent !== window;
const frontier = embedded && new URLSearchParams(location.search).get("mode") === "frontier";
const phases = {setup:"布阵阶段",player:"我方行动",enemy:"敌方行动",reinforcement:"补位阶段",ended:"战斗结算"};
document.body.classList.toggle("embedded",embedded);
$("reset-battle").hidden = frontier;
$("battle-layout").hidden = frontier;
const attributeLabels = {
  strength:"力量",dexterity:"敏捷",constitution:"体质",intelligence:"智力",perception:"感知",charisma:"魅力",
};
const strikeLabels = {hit:"命中",miss:"失手",dodge:"闪避",block:"格挡"};
const eventLabels = {
  ready:"进攻前",hit:"命中",miss:strikeLabels.miss,light:"轻伤",heavy:"重伤",allyFall:"队友阵亡",fall:"阵亡",
  guard:"防御",shieldBreak:"盾牌破碎",dismount:"坠马",
};
const strikeLabel = ({outcome,hit}) => strikeLabels[outcome] ?? (hit === false ? strikeLabels.miss : strikeLabels.hit);
let state;
let battleId;
let lastAmmoSpent = 0;
let formationKey;
let selected = "roland";
let inspectionTarget;
let reinforcementUnit;
let aiming = false;
let moving = false;
let pointer;
let sending = false;
let lastStrike;
let bubbleTimer;
let bannerTimer;
let victoryTimer;
let settlementSelection;
let logVersion;
let orderVersion;
let detailAnchor;
let detailCloseTimer;
let reachAnchor;
let inspectedUnit;
let inspectedTrigger;
let inspectedTab = "profile";
const meterHistory = new Map();
const meterLossDuration = 1250;

const text = (value) => String(value).replace(/[&<>"']/g,(ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
const opening = frontier && createOpeningScreen({
  text,renderCard:(unit,slot)=>renderCard(unit,undefined,undefined,true,slot),send,
});
const signedPercent = (value) => (value > 0 ? "+" : "") + value + "%";
const byId = (id) => state.units.find((unit) => unit.id === id);
const portraitPath = unit => unit.portrait === null ? "" : "./art/" + (unit.portrait ?? unit.id) + ".webp";
const portraitViewer = createPortraitViewer($("portrait-dialog"),()=>{
  $("unit-dialog").close();
  render();
});
function portraitImage(unit,className="",source=portraitPath(unit),useSprite=true) {
  if (useSprite && unit.portraitSprite) {
    const {atlas,column,row} = unit.portraitSprite;
    return '<span class="' + className + ' portrait-sprite" aria-hidden="true" style="--portrait-image:url(./art/test-portraits-' +
      atlas + '.png);--portrait-position:' + (column*50) + '% ' + (row*100) + '%"></span>';
  }
  return source ? '<img class="' + className + '" src="' + text(source) + '" alt="">' :
    '<span class="' + className + ' portrait-placeholder" aria-hidden="true">' + text([...unit.name][0] ?? "") + '</span>';
}

function cardPortrait(unit) {
  const source = portraitSource(unit,portraitPath(unit));
  const crop = source && (portraitViewer.savedCrop(unit) ?? source.defaultCrop);
  if (!crop) return portraitImage(unit,"face",unit.profilePortrait ?? portraitPath(unit),!unit.profilePortrait);
  const {size,position} = portraitBackground(source,crop);
  const url = 'url("' + source.url.replaceAll('"','%22') + '")';
  return '<span class="face portrait-crop-asset" aria-hidden="true" style="background-image:' + text(url) +
    ';background-size:' + size.map(value=>value+"%").join(" ") +
    ';background-position:' + position.map(value=>value+"%").join(" ") + '"></span>';
}
const whiteFlag = -4;
const battleStatusNames = {defend:"防御",dodge:"闪避"};
const moraleLabel = (level) => level === whiteFlag ? "白旗，跳过行动" : level === 0 ? "普通" : (level > 0 ? "+" : "−") + Math.abs(level);
const rowUnits = (side,row) => state.units.filter(unit=>fieldSideOf(unit) === side && unit.row === row).sort((a,b) => a.position-b.position);
const gridColumn = (column) => state.lanes.indexOf(column) + 1;
const canAct = (unit) => unit?.side === "player" && unit.morale !== whiteFlag && unit.row !== "reserve" && !unit.acted &&
  state.phase === "player" && !state.busy && state.order?.[0] === unit.id;
const targetValid = (unit, target) => canAct(unit) && state.attackTargets?.[unit.id]?.includes(target.id);
const reachReason = () => state.attackBlocked?.[selected] || "目标不在攻击范围内。";

const noise = (from,to,duration,level,offset=0,attack=.005) => ({wave:"noise",from,to,duration,level,offset,attack});
const tone = (from,to,duration,level,offset=0,wave="sine") => ({wave,from,to,duration,level,offset,attack:.004});
const battleCues = {
  magic:[noise(530,2400,.21,.29,0,.052),tone(150,234,.15,.09),noise(1690,660,.15,.12,.10,.028)],
  start:[tone(117,78,.30,.16),noise(510,165,.22,.14)],
  round:[tone(115,61,.13,.13),noise(470,146,.12,.12)],
  victory:[tone(262,262,.25,.16,0,"triangle"),tone(330,330,.28,.15,.11),tone(392,392,.5,.18,.23)],
  defeat:[tone(233,218,.28,.15),tone(174,156,.33,.16,.13),tone(116,98,.52,.21,.27,"triangle")],
};

const battleSoundKey = "battle-sound-muted";
const battleDialogueKey = "battle-dialogue-muted";
const paddedArmor = new Set(["布衣","棉甲","皮甲","布帽","皮帽"]);
const recordedSounds = new Map();
const recordedLevels = {
  swing:.32,axe:.40,thrust:.36,bow:.55,crossbow:.55,arrowPass:.32,dodge:.29,
  plate:.70,padded:.62,parry:.65,shield:.72,flesh:.60,break:.47,fall:.45,step:.25,
};
const injuryVoiceLevels = {light:.42,heavy:.53,death:.60};
let soundEnabled = true;
let dialogueEnabled = true;
try {
  soundEnabled = localStorage.getItem(battleSoundKey) !== "1";
  dialogueEnabled = localStorage.getItem(battleDialogueKey) !== "1";
} catch {}
let audioContext;
let audioOutput;
let noiseBuffer;

async function unlockBattleAudio() {
  if (!soundEnabled || !window.AudioContext || ($("battle-layout").hidden && $("encounter-screen").hidden)) return;
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
      audioOutput = audioContext.createGain();
      audioOutput.gain.value = .38;
      audioOutput.connect(audioContext.destination);
      noiseBuffer = audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i=0;i<samples.length;i++) samples[i] = Math.random()*2-1;
      const recordings = JSON.parse($("battle-impact-audio").textContent);
      for (const [name,variants] of Object.entries(recordings)) {
        const decoded = variants.map(encoded=>{
          const file = Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));
          return audioContext.decodeAudioData(file.buffer);
        });
        Promise.all(decoded).then(buffers=>recordedSounds.set(name,{buffers,next:0})).catch(()=>{});
      }
    }
    if (audioContext.state !== "running") await audioContext.resume();
  } catch {}
}

function playBattleSound(name,delay=0,volume=1) {
  if (!soundEnabled || audioContext?.state !== "running") return;
  const recording = recordedSounds.get(name);
  if (recording) {
    const sample = audioContext.createBufferSource();
    sample.buffer = recording.buffers[recording.next];
    recording.next = (recording.next+1) % recording.buffers.length;
    sample.playbackRate.value = .985 + Math.random()*.03;
    const gain = audioContext.createGain();
    gain.gain.value = (recordedLevels[name] ?? 1)*volume;
    sample.connect(gain).connect(audioOutput);
    sample.start(audioContext.currentTime+delay);
    return;
  }
  for (const layer of battleCues[name] ?? []) {
    const start = audioContext.currentTime + delay + layer.offset;
    const end = start + layer.duration;
    const envelope = audioContext.createGain();
    envelope.gain.setValueAtTime(.0001,start);
    envelope.gain.exponentialRampToValueAtTime(layer.level*volume,start+layer.attack);
    envelope.gain.exponentialRampToValueAtTime(.0001,end);
    envelope.connect(audioOutput);
    let source;
    if (layer.wave === "noise") {
      source = audioContext.createBufferSource();
      source.buffer = noiseBuffer;
      const band = audioContext.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = .7;
      band.frequency.setValueAtTime(layer.from,start);
      band.frequency.exponentialRampToValueAtTime(layer.to,end);
      source.connect(band).connect(envelope);
      source.start(start,Math.random()*.4);
    } else {
      source = audioContext.createOscillator();
      source.type = layer.wave;
      source.frequency.setValueAtTime(layer.from,start);
      source.frequency.exponentialRampToValueAtTime(layer.to,end);
      source.connect(envelope);
      source.start(start);
    }
    source.stop(end);
  }
}

function playStrikeSounds(strike,weapon,target,fallen) {
  const ranged = weapon?.range === "远程";
  const attacks = {手斧:"axe",矛:"thrust",弓:"bow",弩:"crossbow"};
  const attack = weapon?.magic ? "magic" : attacks[weapon?.name] ?? "swing";
  const impact = ranged ? .16 : .105;
  playBattleSound(attack);
  if (strike.outcome === "block") playBattleSound(strike.guard ? "shield" : "parry",impact);
  else if (strike.outcome === "dodge") playBattleSound("dodge",impact);
  else if (strike.hit === false) {
    if (ranged && !weapon?.magic) playBattleSound("arrowPass",impact-.035);
  }
  else if (strike.blocked) {
    const armor = target?.armor[strike.zone]?.name;
    playBattleSound(paddedArmor.has(armor) ? "padded" : "plate",impact);
  } else playBattleSound("flesh",impact);
  if (target && strike.hpLoss > 0) {
    const profile = target.voiceProfile ?? (target.id === "vera" ? "female" : "male");
    const threshold = target.maxHp*.3;
    const heavy = target.hp>threshold && target.hp-strike.hpLoss<=threshold;
    const injury = fallen ? "death" : heavy ? "heavy" : "light";
    playBattleSound(profile+"-"+injury,impact+.035,injuryVoiceLevels[injury]);
  }
  if (strike.guard?.broken) playBattleSound("break",impact+.09);
  if (fallen || strike.dismounted) playBattleSound("fall",impact+.19);
}

function refreshSoundButton() {
  const button = $("battle-sound");
  button.setAttribute("aria-pressed",String(soundEnabled));
  button.textContent = soundEnabled ? "音效开" : "音效关";
}

refreshSoundButton();
function refreshDialogueButton() {
  const button = $("battle-dialogue");
  button.setAttribute("aria-pressed",String(dialogueEnabled));
  button.textContent = dialogueEnabled ? "对话开" : "对话关";
}
refreshDialogueButton();
battleSession.setDialogue(dialogueEnabled);
$("battle-dialogue").addEventListener("click",() => {
  dialogueEnabled = !dialogueEnabled;
  refreshDialogueButton();
  try { localStorage.setItem(battleDialogueKey,dialogueEnabled ? "0" : "1"); } catch {}
  battleSession.setDialogue(dialogueEnabled);
  if (state) receive(battleSession.snapshot());
});
for (const event of ["pointerdown","keydown"]) document.addEventListener(event,unlockBattleAudio);
$("battle-sound").addEventListener("click",async () => {
  soundEnabled = !soundEnabled;
  refreshSoundButton();
  try { localStorage.setItem(battleSoundKey,soundEnabled ? "0" : "1"); } catch {}
  if (audioOutput) audioOutput.gain.setValueAtTime(soundEnabled ? .38 : 0,audioContext.currentTime);
  if (soundEnabled) {
    await unlockBattleAudio();
    playBattleSound("shield",0,.24);
  }
});

function setNotice(message="") {
  $("notice").textContent = message;
}

async function send(payload) {
  if (sending) return;
  sending = true;
  setNotice();
  try {
    receive(battleSession.submit(payload));
    if (["move","retreat","reinforce"].includes(payload.type)) {
      playBattleSound("step");
      playBattleSound("step",.15);
    }
  } catch (error) {
    setNotice(error.message || "暂时无法提交操作。");
  } finally {
    sending = false;
  }
}

async function sync() {
  try {
    receive(battleSession.snapshot());
  } catch {
    if (!state) setNotice("正在连接战场…");
  } finally {
    setTimeout(sync,300);
  }
}

function receive(next) {
  if (state && (next.match < state.match || (next.match === state.match && next.rev <= state.rev))) return;
  const previous = state;
  if (!previous) {
    setNotice();
    if (frontier) selected = "pc";
  }
  const strike = next.lastStrike;
  const freshStrike = previous && strike && strike.id !== lastStrike && Date.now() - strike.at < 2100;
  const fallen = freshStrike && !next.units.some(unit=>unit.id===strike.target);
  const departedPoint = fallen ? cardPoint(strike.target) : null;
  if (previous && next.match !== previous.match) {
    selected = "roland";
    aiming = false;
    moving = false;
    lastStrike = null;
    meterHistory.clear();
    clearTimeout(victoryTimer);
    settlementSelection = null;
    if ($("leave-dialog").open) $("leave-dialog").close();
    $("victory-screen").hidden = true;
    $("battle-layout").hidden = false;
    $("effects").replaceChildren();
  }
  state = next;
  if (previous?.match !== state.match || previous?.order[0] !== state.order[0] || !byId(inspectionTarget)) {
    inspectionTarget = null;
  }
  if (previous?.match !== state.match || !state.reinforcements?.units.includes(reinforcementUnit)) {
    reinforcementUnit = null;
  }
  if (state.phase === "player" && selected !== state.order[0]) {
    selected = state.order[0];
    aiming = moving = false;
  }
  if (!canAct(byId(selected))) aiming = moving = false;
  if (byId(selected)?.moved) moving = false;
  if (frontier && previous?.phase === "setup" && state.phase === "ended") {
    reportToolbar();
    return reportFrontierResult();
  }
  render();
  const moraleChanged = showMoraleChanges(previous);
  if (state.phase === "ended" && (previous?.phase !== "ended" || previous?.match !== state.match)) {
    const result = state.winner === "player" ? "我方获胜" : "敌方获胜";
    const ending = {surrender:"全队溃败 · ",withdrawal:"撤离战场 · "};
    showBattleBanner((ending[state.endReason] ?? "") + result);
    if (previous) {
      playBattleSound(state.winner === "player" ? "victory" : "defeat",freshStrike ? .54 : 0);
      victoryTimer = setTimeout(openBattleReport,moraleChanged ? 2100 : 850);
    }
    else openBattleReport();
  } else if (state.phase === "setup") {
    showBattleBanner("");
  } else if (previous?.phase === "setup" || previous?.round !== state.round) {
    showBattleBanner("第 " + state.round + " 回合",1400);
    if (previous) playBattleSound(previous.phase === "setup" ? "start" : "round",freshStrike ? .4 : 0);
  }
  if (previous?.match === state.match && state.log.some(entry=>entry.kind === "guard" && entry.id>previous.serial)) {
    playBattleSound("shield",0,.30);
  }
  if (freshStrike) {
    const weapon = previous.units.find(unit=>unit.id===strike.actor)?.weapon;
    const target = previous.units.find(unit=>unit.id===strike.target);
    playStrikeSounds(strike,weapon,target,fallen);
    showStrike(strike,departedPoint);
  }
  lastStrike = strike?.id;
}

function meterLoss(owner,kind,current,max) {
  if (!owner) return "";
  const key = owner + "/" + kind;
  const prior = meterHistory.get(key);
  const now = performance.now();
  if (!prior || prior.current !== current || prior.max !== max) {
    const loss = prior?.max === max && prior.current > current ? prior.current - current : 0;
    meterHistory.set(key,{current,max,loss,started:now});
  }
  const {loss,started} = meterHistory.get(key);
  const elapsed = now - started;
  if (!loss || !max || elapsed >= meterLossDuration || matchMedia("(prefers-reduced-motion: reduce)").matches) return "";
  return '<span class="meter-loss" aria-hidden="true" style="left:' + (100 * current/max) +
    '%;width:' + (100 * loss/max) + '%;animation-duration:' + meterLossDuration +
    'ms;animation-delay:-' + elapsed + 'ms"></span>';
}

function meter(kind, label, current, max, status="", owner) {
  const trail = meterLoss(owner,kind,current,max);
  if (kind === "mount" && current === 0 && !trail) return "";
  return '<span class="meter ' + kind + '" data-empty="' + (current === 0) +
    '" aria-label="' + label + ' ' + current + '／' + max + (status ? '，' + status : '') + '"><i>' + label +
    '</i><b><s style="width:' + (max ? 100 * current/max : 0) + '%"></s>' + trail + '</b><em>' + current + '</em>' +
    (status ? '<span class="meter-status">' + status + '</span>' : '') + '</span>';
}

function renderCard(unit,column,entry,preview=false,formationSlot) {
  const inBattle = column !== undefined;
  const fighting = inBattle && state.phase !== "setup";
  const target = inBattle && aiming && targetValid(byId(selected),unit);
  const blocked = inBattle && aiming && unit.side === "enemy" && !target;
  const highlighted = !preview && unit.id === (inBattle ? (state.phase === "setup" ? selected : state.order[0]) : settlementSelection);
  const classes = ["card",unit.side];
  if (fighting || formationSlot) classes.push("battle-card");
  if (unit.leader) classes.push("leader-card");
  if (highlighted) classes.push("selected");
  if (target) classes.push("target");
  if (blocked) classes.push("out-of-range");
  const lootStatus = entry?.kind === "corpse" ? (entry.looted ? "已搜刮" : "未搜刮") : "";
  const treatmentStatus = entry?.disposition ? "已" + settlementLabels[entry.disposition] : "";
  const statuses = fighting && state.phase !== "ended" ? Object.entries(unit.statuses) : [];
  const badges = statuses.map(([id,turns])=>({name:battleStatusNames[id],turns}));
  const describeBadge = ({name,turns}) => name + "，剩余 " + turns + " 回合";
  const description = [lootStatus,treatmentStatus,...badges.map(describeBadge)].filter(Boolean).join("，");
  if (statuses.some(([id])=>id==="defend")) classes.push("guarding");
  if (statuses.some(([id])=>id==="dodge")) classes.push("evading");
  const morale = unit.morale;
  const tone = morale === whiteFlag ? "routed" : morale > 0 ? "raised" : morale < 0 ? "shaken" : "steady";
  const marker = morale === whiteFlag ? "🏳️" : '<i class="morale-eagle" aria-hidden="true"></i>'.repeat(Math.max(1,Math.abs(morale)));
  const profession = unit.profession || unit.role || "职业未定";
  const cardMeter = (kind,label,part,tag) => meter(kind,label,part.current,part.max,tag,inBattle ? unit.id : undefined);
  const resource = (unit.mount ? cardMeter("mount","骑",unit.mount) : "") ||
    (unit.shield ? cardMeter("shield","盾",unit.shield) : unit.magic ? cardMeter("magic","魔",unit.magic) : "");
  const placement = formationSlot ? "" : inBattle ? ' data-card="' + unit.id + '" style="grid-column:' + column + '"' :
    (preview ? ' data-encounter-unit="' : ' data-spoils-card="') + unit.id + '"';
  const details = 'data-details="' + unit.id + '" aria-haspopup="dialog"';
  const selection = formationSlot ?
    'data-opening-row="' + formationSlot.row + '" data-opening-index="' + formationSlot.index +
    '" data-opening-id="' + text(unit.id) + '" draggable="true"' :
    preview ? details : inBattle ? 'data-unit="' + unit.id + '"' : 'data-settlement-entry="' + unit.id + '"';
  const menu = inBattle ? details + ' title="人物详情"' :
    selection + ' title="结算操作"';
  const menuButton = fighting || preview ? "" : '<button type="button" class="unit-menu" ' + menu + ' aria-label="' +
    text(unit.name + (inBattle ? "详情" : "结算操作")) + '"><i></i><i></i><i></i></button>';
  return '<div class="' + classes.join(" ") + '"' + placement + '>' +
    '<button type="button" class="card-select" ' + selection + ' aria-label="' +
    text(formationSlot ? formationSlot.label + " · " + unit.name : unit.name) + '"' +
    (preview && !formationSlot ? '' : ' aria-pressed="' + highlighted + '"') +
    (description ? ' aria-description="' + text(description) + '"' : '') +
    (blocked || target ? ' aria-describedby="reach-details"' : "") + '>' +
    '<span class="card-portrait">' + cardPortrait(unit) +
    (badges.length ? '<span class="portrait-statuses">' + badges.map(badge=>
      '<span class="portrait-status" title="' + text(describeBadge(badge)) + '">' +
      text(badge.name) + '<b>' + badge.turns + '</b></span>').join("") + '</span>' : "") +
    '</span><span class="card-data"><strong>' + text(unit.name) + '</strong>' +
    cardMeter("head","盔",unit.armor.head) + cardMeter("body","甲",unit.armor.body,lootStatus) +
    cardMeter("hp","血",{current:unit.hp,max:unit.maxHp},treatmentStatus) + resource +
    '</span>' +
    '<span class="morale-mark ' + tone + '" role="img" aria-label="士气 ' + moraleLabel(morale) +
    '" title="士气 ' + moraleLabel(morale) + '">' + marker + '</span>' +
    (unit.leader ? '<span class="leader-mark" role="img" aria-label="首领" title="首领">👑</span>' : '') +
    '<span class="profession-mark" role="img" aria-label="职业：' + text(profession) + '" title="' + text(profession) + '">' +
    (Object.hasOwn(professionIcons,profession) ? professionIcons[profession] : "👤") + '</span></button>' + menuButton +
    (inBattle && unit.acted ? '<span class="card-state">已行动</span>' : "") + '</div>';
}

function canDeploy(side,row) {
  const unit = byId(selected);
  const cap = state.terrain[row];
  return state.phase === "setup" && side === "player" && unit?.side === side && unit.row !== row &&
    (cap == null || rowUnits(side,row).length < cap);
}

function renderRank(side,row) {
  const units = rowUnits(side,row);
  const max = state.terrain[row];
  const position = units.length + " / " + max + " 人";
  let content = units.map(unit=>renderCard(unit,gridColumn(unit.column))).join("");
  if (canDeploy(side,row)) {
    content += '<button type="button" class="slot" style="grid-column:' + gridColumn(state.deployColumns[row]) +
      '" data-deploy="' + row + '" aria-label="移入' + names[row] + '">＋<span>移入' + names[row] + '</span></button>';
  }
  const moves = moving ? state.movement[selected]?.destinations.filter(spot=>spot.fieldSide===side && spot.row===row) ?? [] : [];
  const reinforcements = reinforcementUnit && side === "player" ? state.reinforcements.columns[row] : [];
  if (state.phase !== "setup") content += state.fieldColumns.slice(0,max).filter(column=>
    !units.some(unit=>unit.column===column) && !moves.some(spot=>spot.column===column) && !reinforcements.includes(column)
  ).map(column=>'<span class="field-cell" aria-hidden="true" style="grid-column:' + gridColumn(column) + '"></span>').join("");
  content += moves.map(({column,controlled})=>{
    const slot = gridColumn(column);
    const target = (side === "player" ? "我方" : "敌方") + names[row] + "第 " + slot + " 格";
    return '<button type="button" class="slot move-slot' + (controlled ? ' controlled' : '') + '" style="grid-column:' + slot +
      '" data-move-column="' + column + '" aria-label="移到' + target + (controlled ? '，进入控制区' : '') +
      '">' + (controlled ? "进入控制区" : "移到此处") + '</button>';
  }).join("");
  if (reinforcementUnit && side === "player") {
    content += reinforcements.map(column=>{
      const slot = gridColumn(column);
      return '<button type="button" class="slot move-slot" style="grid-column:' + slot +
        '" data-reinforce-row="' + row + '" data-reinforce-column="' + column +
        '" aria-label="补入' + names[row] + '第 ' + slot + ' 格">补入此处</button>';
    }).join("");
  }
  return '<div class="rank ' + side + '" data-field-side="' + side + '" data-field-row="' + row +
    '"><div class="rank-label"><b>' + names[row] + '</b><small>' + position + '</small></div><div class="cards">' +
    (content || '<span class="empty-line">空位</span>') + '</div></div>';
}

function renderRoutes() {
  return '<div class="battle-routes" aria-label="战场分区"><div class="route-grid">' +
    '<span style="grid-column:1 / span 2">左翼</span><span style="grid-column:3">中路</span>' +
    '<span style="grid-column:4 / span 2">右翼</span></div></div>';
}

function renderBoard() {
  closeReachDetails();
  $("ranks").innerHTML = renderRank("enemy","back") + renderRank("enemy","front") +
    renderRoutes() + renderRank("player","front") + renderRank("player","back");
  $("closed-lanes").innerHTML = state.lanes.filter(column=>!state.fieldColumns.includes(column)).map(column=>
    '<div class="closed-lane" style="grid-column:' + gridColumn(column) + ';grid-row:1"><span>不可通行</span></div>').join("");
  const ours = rowUnits("player","reserve");
  const theirs = rowUnits("enemy","reserve");
  const reserves = (units) => units.map((unit) => {
    const active = unit.id === (reinforcementUnit ?? selected);
    return '<span class="reserve-entry"><button class="reserve-unit' + (active ? " selected" : "") +
    '" data-unit="' + unit.id + '" aria-pressed="' + active + '"' +
    (state.reinforcements && !state.reinforcements.units.includes(unit.id) ? " disabled" : "") +
    '>' + text(unit.name) +
    '</button><button class="reserve-details" data-details="' + unit.id + '" aria-haspopup="dialog" aria-label="' +
    text(unit.name + "详情") + '">' + (state.phase === "setup" ? "☰" : "信息") + '</button></span>';
  }).join("");
  const moveToReserve = canDeploy("player","reserve")
    ? '<button type="button" class="quiet" data-deploy="reserve">移入预备队</button>' : "";
  $("enemy-reserves").innerHTML = reserves(theirs);
  $("player-reserves").innerHTML = reserves(ours) + moveToReserve;
  drawArrow();
}

function positionActionMenu() {
  const menu = $("unit-actions");
  const unit = byId(inspectionTarget ?? selected);
  const infoOnly = Boolean(inspectionTarget);
  const anchor = document.querySelector('[data-card="' + unit?.id + '"]');
  if (["setup","ended"].includes(state.phase) || (!infoOnly && (state.phase !== "player" || state.order[0] !== selected))) {
    menu.hidden = true;
    return;
  }
  menu.dataset.infoOnly = String(infoOnly);
  menu.setAttribute("aria-label",unit.name + (infoOnly ? "的信息菜单" : "的操作"));
  positionCardMenu(menu,anchor);
}

function positionCardMenu(menu,anchor,viewport) {
  const rect = anchor?.getBoundingClientRect();
  if (!rect || rect.bottom <= Math.max(0,viewport?.top ?? 0) ||
      rect.top >= Math.min(window.innerHeight,viewport?.bottom ?? window.innerHeight)) {
    menu.hidden = true;
    return;
  }
  menu.hidden = false;
  const gap = 7, width = menu.offsetWidth, height = menu.offsetHeight;
  const edge = document.documentElement.clientWidth-gap;
  let leftEdge = gap, rightEdge = edge;
  for (const peer of anchor.parentElement.children) {
    if (peer === anchor || !peer.matches(".card,.slot,.reserve-unit")) continue;
    const other = peer.getBoundingClientRect();
    if (other.right <= rect.left) leftEdge = Math.max(leftEdge,other.right);
    if (other.left >= rect.right) rightEdge = Math.min(rightEdge,other.left);
  }
  const rightSpace = rightEdge-rect.right;
  const leftSpace = rect.left-leftEdge;
  const fitsRight = rect.right+gap+width <= edge;
  const fitsLeft = rect.left-gap-width >= gap;
  const opensRight = fitsRight && (rightSpace >= width+gap || leftSpace < width+gap || !fitsLeft);
  const left = opensRight ? rect.right+gap : rect.left-gap-width;
  menu.style.left = Math.max(gap,Math.min(left,edge-width)) + "px";
  menu.style.top = Math.max(gap,Math.min(rect.top+(rect.height-height)/2,window.innerHeight-height-gap)) + "px";
}

function renderControls() {
  const unit = byId(selected);
  const setup = state.phase === "setup";
  $("battle-phase").textContent = phases[state.phase];
  $("start-battle").hidden = !setup;
  $("restart-battle").hidden = frontier || state.phase !== "ended";
  $("reinforcement-actions").hidden = state.phase !== "reinforcement";
  if (state.reinforcements) {
    $("reinforcement-hint").textContent = reinforcementUnit ? byId(reinforcementUnit).name + " · 选择我方后排空位" : "回合末补位 · 预备队仅进入我方后排";
    $("finish-reinforcement").textContent = state.units.some(unit=>unit.side === "player" && unit.row !== "reserve")
      ? "结束补位" : "撤离战场";
  }
  const permitted = canAct(unit);
  const attack = $("aim-action");
  const defend = $("defend-action");
  const dodge = $("dodge-action");
  const move = $("move-action");
  const retreat = $("retreat-action");
  const explanation = setup ? "布阵结束后才能行动。" : state.busy ? "正在结算当前行动。" :
    unit?.side === "enemy" ? "敌方角色由系统控制。" : unit?.acted ? "该角色本轮已行动。" : "还没轮到该角色。";
  attack.disabled = defend.disabled = dodge.disabled = !permitted;
  move.disabled = !permitted || !state.movement[selected]?.destinations.length;
  attack.title = permitted ? "" : explanation;
  dodge.title = unit ? "闪避 " + unit.dodge + "% → " + dodgeAfterAction(unit.dodge) + "%" : "";
  defend.title = unit ? "格挡 " + blockDisplay(unit) : "";
  move.title = permitted ? (state.movement[selected].blockedReason || "") : explanation;
  const retreatBlocked = state.movement[selected]?.retreatBlocked;
  retreat.disabled = !permitted || Boolean(retreatBlocked);
  retreat.title = permitted ? (retreatBlocked || "消耗本轮行动，撤回预备队。") : explanation;
  attack.textContent = aiming ? "取消瞄准" : "攻击";
  attack.setAttribute("aria-pressed",String(aiming));
  move.textContent = moving ? "取消移动" : "移动";
  move.setAttribute("aria-pressed",String(moving));
  positionActionMenu();
}

function unitFacts(rows, modifier = "") {
  return '<dl class="unit-facts ' + modifier + '">' + rows.map(([label,value]) =>
    '<div><dt>' + text(label) + '</dt><dd>' + text(value || "—") + '</dd></div>').join("") + '</dl>';
}

const fraction = ({current,max}) => current + " / " + max;

function blockDisplay({meleeBlock,rangedBlock}) {
  const percent = value => value + "%" + (value ? " → " + (value*2) + "%" : "");
  return meleeBlock === rangedBlock ? percent(meleeBlock) : "近战 " + percent(meleeBlock) + " · 远程 " + percent(rangedBlock);
}

function showProfile(unit) {
  const original = portraitImage(unit,"unit-profile-portrait",unit.profilePortrait ?? portraitPath(unit),!unit.profilePortrait);
  const source = portraitSource(unit,portraitPath(unit));
  $("unit-view").innerHTML = '<div class="unit-profile">' +
    '<div class="unit-profile-art">' + (source ?
      '<button type="button" class="portrait-preview" data-portrait-view aria-label="查看原始立绘">' +
      original + '</button>' : original) + '</div>' +
    '<div class="unit-profile-data">' + unitFacts([
      ["种族",unit.raceName],
      ["出身",unit.originName || "未选择"],
      ["职业",unit.profession],
    ],"unit-profile-identity") + unitFacts([
      ["抗性",unit.profileResistances?.join("、")],
      ["状态",null],
      ["特质",unit.traits.join("、") || "无"],
    ]) + unitFacts([
      ["血量",unit.hp + " / " + unit.maxHp],
      ["士气",moraleLabel(unit.morale)],
      ["先攻",String(unit.initiative)],
      ["格挡率",Math.max(unit.meleeBlock,unit.rangedBlock) + "%"],
      ["闪避率",unit.dodge + "%"],
      ...(unit.magic ? [["魔力",fraction(unit.magic)]] : []),
    ],"unit-profile-vitals") + '</div></div>';
}

function showAttributes(unit) {
  const attributes = Object.entries(attributeLabels);
  const breakdown = Object.values(unit.attributeSources ?? {});
  const columns = breakdown.some(row=>row.base !== undefined) ?
    [["base","基础"],["race","种族"],["origin","出身"],["profession","职业"],["traits","特质"]] : [];
  if (breakdown.some(row=>row.initial !== undefined)) columns.push(["initial","初始"]);
  if (breakdown.length || unit.levelPoints) columns.push(["growth","升级"]);
  if (breakdown.some(row=>row.adjustment)) columns.push(["adjustment","其他修正"]);
  columns.push(["total","总值"]);
  if (attributes.some(([name]) => (unit.effectiveAttributes[name] ?? unit.attributes[name]) !== unit.attributes[name])) {
    columns.push(["effective","生效"]);
  }
  $("unit-view").innerHTML = '<table class="attribute-sources"><thead><tr><th scope="col">属性</th>' +
    columns.map(([,label])=>'<th scope="col">' + label + '</th>').join("") + '</tr></thead><tbody>' +
    attributes.map(([name,label])=>{
      const raw = unit.attributes[name];
      const values = {
        growth:unit.levelPoints?.[name], ...unit.attributeSources?.[name],
        total:raw, effective:unit.effectiveAttributes[name] ?? raw,
      };
      return '<tr><th scope="row">' + label + '</th>' + columns.map(([key]) => {
        const value = values[key];
        const signed = key !== "base" && key !== "initial" && key !== "total" && key !== "effective";
        return '<td>' + (signed && value > 0 ? "+" : "") + text(value ?? "—") + '</td>';
      }).join("") + '</tr>';
    }).join("") + '</tbody></table>';
}

function showEquipment(unit) {
  const weapon = unit.weapon;
  const armorPieces = [
    ["头盔",unit.armor.head,true],
    ["护甲",unit.armor.body,true],
    ...(unit.shield ? [["盾牌",unit.shield,false]] : []),
  ];
  const wearables = unit.additionalGear.filter(item => item.slot !== "off_hand" || !unit.shield);
  const cells = (values) => values.map(value => '<td>' + text(value ?? "—") + '</td>').join("");
  const identityColumns = '<colgroup><col class="equipment-slot"><col class="equipment-name"></colgroup>';
  const identityHeaders = '<th scope="col">部位</th><th scope="col">名称</th>';
  const reduction = (durability) => armorPenetrationReduction(durability) + "%";
  const armorRows = armorPieces.map(([label,part,reducesPenetration]) => {
    const equipped = part.name !== "无";
    const stats = equipped ? [
      part.max, reducesPenetration ? reduction(part.max) : undefined,
      part.current, reducesPenetration ? reduction(part.current) : undefined,
    ] : [undefined,undefined,undefined,undefined];
    return '<tr><th scope="row">' + text(label) + '</th><td>' +
      text(equipped ? part.name : "未装备") + '</td>' + cells(stats) + '</tr>';
  }).join("");
  $("unit-view").innerHTML =
    '<table class="unit-equipment equipment-weapon" aria-label="武器">' + identityColumns +
    '<colgroup class="equipment-panel" span="6"></colgroup><colgroup class="equipment-actual"></colgroup>' +
    '<thead><tr>' + identityHeaders + '<th scope="col">伤害</th><th scope="col">穿甲</th>' +
    '<th scope="col">破甲</th><th scope="col">爆头</th><th scope="col">距离</th>' +
    '<th scope="col">反大</th><th scope="col" class="equipment-current">实际伤害</th></tr></thead>' +
    '<tbody><tr><th scope="row">武器</th><td>' + text(weapon.name) + '</td>' +
    cells([weapon.damage,Math.round((weapon.penetration ?? 0)*100) + "%",
      signedPercent(Math.round(weapon.armorBonus*100)),signedPercent(Math.round(weapon.headBonus*100)),
      weapon.range,Math.round((weapon.largeBonus ?? 0)*100) + "%",unit.damage]) + '</tr></tbody></table>' +
    '<table class="unit-equipment equipment-armor" aria-label="护甲与其他装备">' + identityColumns +
    '<colgroup class="equipment-panel" span="2"></colgroup><colgroup class="equipment-actual" span="2"></colgroup>' +
    '<thead><tr>' + identityHeaders + '<th scope="col">耐久</th><th scope="col">减穿</th>' +
    '<th scope="col" class="equipment-current">当前耐久</th><th scope="col" class="equipment-current">当前减穿</th>' +
    '</tr></thead><tbody>' + armorRows + '</tbody></table>' +
    (wearables.length ? '<table class="unit-equipment equipment-wear" aria-label="服装">' + identityColumns +
      '<thead><tr>' + identityHeaders + '</tr></thead><tbody>' +
      wearables.map(item => '<tr><th scope="row">服装</th>' + cells([item.name]) + '</tr>').join("") +
      '</tbody></table>' : "");
}

function showDialogue(unit) {
  const now = Date.now();
  $("unit-view").innerHTML = Object.entries(eventLabels).map(([event,label]) => {
    const lines = unit.dialogue.filter(line=>line.event===event);
    if (!lines.length) return "";
    return '<section class="dialogue-group"><h3>' + label + '</h3><ul>' + lines.map(line=>
      '<li>' + (line.used && line.spokenAt<=now ? '<s title="已说过">' + text(line.text) + '</s>' : text(line.text)) + '</li>').join("") +
      '</ul></section>';
  }).join("");
}

function showMount({mount}) {
  const {draft} = mount;
  $("unit-view").innerHTML = unitFacts([
    ["坐骑",mount.name],["体型",mount.size],
    ["血量",fraction(mount)],["状态",mount.current > 0 ? "可骑乘" : "已坠马"],
  ],"unit-mount-stats") + (draft ? '<h3 class="unit-mount-heading">参数草案</h3>' + unitFacts([
    ["护甲类型",draft.armorType],["披甲",draft.armorName],
    ["马铠耐久",String(draft.armorDurability)],["闪避修正",signedPercent(draft.dodgeModifier)],
    ["先攻修正",draft.initiativeModifier > 0 ? "+" + draft.initiativeModifier : String(draft.initiativeModifier)],
    ["骑乘载货",draft.ridingLoad + " 千克"],["专职驮货",draft.packLoad + " 千克"],
  ],"unit-mount-stats") + unitFacts([
    ["擅长地形",draft.favoredTerrains],["受限地形",draft.difficultTerrains],
  ],"unit-mount-terrain") : "");
}

const kilos = new Intl.NumberFormat("zh-CN",{maximumFractionDigits:3});
const weightLabel = value => kilos.format(value) + " 千克";

function showItems(unit) {
  const {maximum,equipped,items,remaining} = unit.load;
  const carried = battleItemsBySlot(unit.items);
  const slots = battleItemLabels.map((label,index)=>[label,carried[index]?.name ?? "空"]);
  const swaps = canAct(unit) ? carried.map((item,index)=>{
    if (!item?.swap?.gear) return "";
    const problem = battleSwapProblem(unit,item);
    return '<div class="use-potion swap-item"><span>' + text(battleItemLabels[index] + " · " + item.name) +
      (problem ? '<small>' + text(problem) + '</small>' : '') + '</span><button type="button" data-swap-item="' +
      index + '"' + (problem ? ' disabled' : '') + '>换上</button></div>';
  }).join("") : "";
  const potions = canAct(unit) ? unit.items.filter(item=>item.restore).map(item=>{
    const {resource,dice,icon} = item.restore;
    const targets = restorationTargets(state,unit,item);
    const label = resource === "hp" ? "生命" : "魔力";
    const options = targets.map(target=>{
      const value = resource === "hp" ? target.hp + " / " + target.maxHp : fraction(target.magic);
      return '<option value="' + text(target.id) + '"' + (target.id === unit.id ? ' selected' : '') + '>' +
        text(target.name + " · " + value) + '</option>';
    }).join("");
    const name = item.name + " ×" + item.qty;
    return '<form class="use-potion" data-use-potion="' + text(item.key ?? item.name) + '">' +
      '<span><span aria-hidden="true">' + text(icon ?? "🧪") + '</span> ' + text(name) +
      '<small>恢复 ' + text(dice) + ' 点' + label + '</small></span>' +
      '<select name="recipient" aria-label="' + text(item.name + "使用对象") + '"' +
      (targets.length ? '' : ' disabled') + '>' + (options || '<option>无可用对象</option>') + '</select>' +
      '<button type="submit"' + (targets.length ? '' : ' disabled') + '>使用</button></form>';
  }).join("") : "";
  $("unit-view").innerHTML = '<div class="unit-items-view">' + unitFacts([
    ["最大负重",weightLabel(maximum)],["装备负重",weightLabel(equipped)],
    ["物品负重",weightLabel(items)],["剩余负重",weightLabel(remaining)],
  ],"unit-carried") + unitFacts(slots,"unit-carried") +
    (potions || swaps ? '<div class="battle-potions">' + potions + swaps + '<small>使用道具或换上备用装备都会结束本轮行动。</small></div>' : '') + '</div>';
}

function updateUnitDetails() {
  const unit = byId(inspectedUnit);
  if (!unit) {
    $("unit-dialog").close();
    return;
  }
  $("unit-heading").textContent = unit.name;
  const level = $("unit-level");
  level.textContent = unit.level;
  level.title = "等级 " + unit.level;
  $("unit-mount").disabled = !unit.mount;
  if (!unit.mount && inspectedTab === "mount") inspectedTab = "profile";
  for (const tab of $("unit-dialog").querySelectorAll("[data-unit-tab]")) {
    const active = tab.dataset.unitTab === inspectedTab;
    tab.setAttribute("aria-selected",String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active) $("unit-view").setAttribute("aria-labelledby",tab.id);
  }
  if (inspectedTab === "profile") {
    showProfile(unit);
  } else if (inspectedTab === "attributes") {
    showAttributes(unit);
  } else if (inspectedTab === "dialogue") {
    showDialogue(unit);
  } else if (inspectedTab === "background") {
    $("unit-view").textContent = unit.bio;
  } else if (inspectedTab === "equipment") {
    showEquipment(unit);
  } else if (inspectedTab === "mount") {
    showMount(unit);
  } else {
    showItems(unit);
  }
}

function showUnitDetails(id, tab = "profile") {
  inspectedUnit = id;
  inspectedTab = tab;
  inspectedTrigger = document.activeElement;
  updateUnitDetails();
  $("unit-dialog").showModal();
  $("unit-view").scrollTop = 0;
  $("unit-dialog").querySelector('[aria-selected="true"]').focus();
}

function renderLog() {
  const now = Date.now();
  const entries = state.log.filter(entry=>entry.at<=now).sort((a,b)=>a.at-b.at || a.id-b.id);
  const version = state.match + ":" + (entries.at(-1)?.id ?? 0) + ":" + entries.length;
  if (version === logVersion) return;
  const log = $("log");
  const sameMatch = logVersion?.startsWith(state.match + ":");
  const scrollTop = log.scrollTop;
  const follow = !sameMatch || log.scrollHeight - log.clientHeight - scrollTop <= 4;
  if (!sameMatch) closeAttackDetails();
  logVersion = version;
  const openedAttack = detailAnchor?.dataset.attack;
  log.innerHTML = entries.length ? entries.map((event) => {
    const {detail} = event;
    const actionType = event.kind === "skill" ? "技能" : event.kind === "item" ? "道具" : "";
    const summary = actionType && detail?.accuracy && detail.actor && detail.name ?
      detail.actor + (detail.target ? "对" + detail.target : "") + "使用了" + actionType + "「" + detail.name + "」" : event.text;
    if ((event.kind === "strike" || actionType) && detail?.accuracy) {
      const hit = detail.hit !== false;
      return '<li class="attack-log ' + (hit ? "hit" : "miss") + '">' +
        '<div class="attack-record"><span>' + text(summary) + '，</span>' +
        '<button type="button" class="attack-result" data-attack="' + event.id + '" aria-controls="attack-details" aria-expanded="false">' +
        strikeLabel(detail) + '</button>' + (hit ? '！' : '。') + '</div></li>';
    }
    return '<li class="' + (event.kind === "speech" ? "speech-log" : event.kind) + '">' +
      (event.speaker ? '<b>' + text(event.speaker) + '</b>　' : "") + text(summary) + (summary !== event.text ? "。" : "") + '</li>';
  }).join("") : '<li>布阵完成后开始战斗。</li>';
  log.scrollTop = follow ? log.scrollHeight : scrollTop;
  if (openedAttack) {
    const anchor = log.querySelector('[data-attack="' + openedAttack + '"]');
    if (anchor) {
      detailAnchor = anchor;
      anchor.setAttribute("aria-expanded","true");
      refreshAttackDetailsPosition();
    } else closeAttackDetails();
  }
}

function closeAttackDetails() {
  clearTimeout(detailCloseTimer);
  $("attack-details").hidden = true;
  detailAnchor?.setAttribute("aria-expanded","false");
  detailAnchor = null;
}

function queueCloseAttackDetails(nextTarget) {
  const panel = $("attack-details");
  if (nextTarget instanceof Node && (panel.contains(nextTarget) || detailAnchor?.contains(nextTarget))) return;
  clearTimeout(detailCloseTimer);
  detailCloseTimer = setTimeout(()=>{
    if (!panel.matches(":hover,:focus-within") && !detailAnchor?.matches(":hover,:focus-visible")) closeAttackDetails();
  },220);
}

function rollSlices(accuracy) {
  const {chance} = accuracy;
  const blockLimit = accuracy.blockLimit ?? chance;
  const dodgeLimit = accuracy.dodgeLimit ?? blockLimit;
  return [
    {id:"hit",label:"保底命中",from:0,to:5,fixed:true},
    {id:"hit",label:"普通命中",from:5,to:chance},
    {id:"block",label:"格挡",from:chance,to:blockLimit},
    {id:"dodge",label:"闪避",from:blockLimit,to:dodgeLimit},
    {id:"miss",label:"失手",from:dodgeLimit,to:95},
    {id:"miss",label:"保底失手",from:95,to:100,fixed:true},
  ];
}

function rollAxis(accuracy) {
  const totals = new Map();
  const segments = rollSlices(accuracy).filter(({from,to})=>to>from).map(({id,label,from,to,fixed})=>{
    totals.set(id,(totals.get(id) ?? 0) + to-from);
    return '<span class="roll-segment tone-' + id + (fixed ? ' forced' : '') + '"' +
      (id !== "miss" ? ' data-roll-section="' + id + '"' : '') +
      ' style="--part:' + (to-from) + '%" title="' + label + ' ' + (from+1) + '–' + to + ' 点"></span>';
  }).join("");
  const keys = Array.from(totals,([id,percentage])=>{
    const label = '<i aria-hidden="true"></i>' + strikeLabels[id] + ' <b>' + percentage + '%</b>';
    const attributes = ' class="roll-key tone-' + id + '"';
    return id === "miss" ? '<span' + attributes + '>' + label + '</span>' :
      '<button type="button"' + attributes + ' data-roll-section="' + id + '" aria-pressed="false">' + label + '</button>';
  }).join("");
  return '<div class="roll-axis" style="--roll:' + accuracy.roll + '%"><div class="roll-count">投掷 <b>' +
    accuracy.roll + '</b></div><div class="roll-track" aria-hidden="true">' + segments + '<i class="roll-pointer"></i></div>' +
    '<div class="roll-scale" aria-hidden="true"><span>0</span><span>100</span></div>' +
    '<div class="roll-legend" aria-label="判定区间">' + keys + '</div></div>';
}

function sumOfTerms(terms,unit = "%") {
  return terms.filter(([,value])=>value).map(([label,value],index)=>
    (value < 0 ? (index ? " − " : "− ") : (index ? " + " : "")) + label + " " + Math.abs(value) + unit
  ).join("");
}

function equationLines(lines) {
  return lines.map(([expression,result])=>'<p>' + text(expression) +
    (result === undefined ? "" : ' <b>= ' + text(result) + '</b>') + '</p>').join("");
}

function detailSection(tone,title,lines,extra = "") {
  return '<section class="combat-detail tone-' + tone + '"><h3>' + text(title) + '</h3><div>' +
    equationLines(lines) + extra + '</div></section>';
}

function accuracyPanels(accuracy,skillName) {
  const factors = [[accuracy.attribute,accuracy.adjustment],["寸长寸强",accuracy.weaponMatchup],["反大",accuracy.largeBonus],
    ["夹击",accuracy.flankingHit],[skillName ? "技能「" + skillName + "」" : "技能命中",accuracy.skillHit],
    ["攻击者士气",accuracy.moraleHit],["天气" + (accuracy.weatherName ? "·" + accuracy.weatherName : ""),accuracy.weatherHit],
    ["目标闪避",-accuracy.dodge],["目标格挡",-accuracy.block]].sort((a,b)=>
      Number(b[1]>0)-Number(a[1]>0) || Math.abs(b[1] ?? 0)-Math.abs(a[1] ?? 0));
  const raw = factors.reduce((total,[,value])=>total + (value || 0),accuracy.base);
  const equation = sumOfTerms([["基础",accuracy.base],...factors]);
  const lines = raw === accuracy.chance ? [[equation,"合计命中率 " + accuracy.chance + "%"]] :
    [[equation,"原始命中率 " + raw + "%"],["应用 5%–95% 上下限","合计命中率 " + accuracy.chance + "%"]];
  const subpanel = (id,equation,total,extra=[]) => '<div class="roll-subpanel tone-' + id + '" data-roll-panel="' + id +
    '" hidden>' + equationLines([[equation,total],...extra]) + '</div>';
  const activeDodge = accuracy.activeDodge ?? 0;
  const attributeDodge = accuracy.attributeDodge ?? accuracy.dodge-accuracy.moraleDodge-activeDodge;
  const rawDodge = attributeDodge + accuracy.moraleDodge;
  const dodgeLines = [];
  if (rawDodge<0) dodgeLines.push(["应用最低 0%","基础闪避 0%"]);
  if (activeDodge) dodgeLines.push(["基础闪避 " + Math.max(0,rawDodge) + "% + 主动闪避 " + activeDodge + "%",
    "合计闪避修正 " + accuracy.dodge + "%"]);
  const dodge = accuracy.dodgeLimit > accuracy.blockLimit ? subpanel("dodge",
    sumOfTerms([["目标敏捷",attributeDodge],["目标士气",accuracy.moraleDodge]]) || "0%",
    (rawDodge<0 ? "修正合计 " + rawDodge : activeDodge ? "基础闪避 " + rawDodge : "合计闪避修正 " + accuracy.dodge) + "%",dodgeLines) : "";
  const baseBlock = accuracy.baseBlock ?? 0;
  const shieldBonus = accuracy.shieldBonus ?? 0;
  const block = accuracy.blockLimit > accuracy.chance ? subpanel("block",
    sumOfTerms([["基础格挡",baseBlock],["盾牌加成",shieldBonus],["主动防御",accuracy.guarding ? baseBlock+shieldBonus : 0]]),
    "合计格挡修正 " + accuracy.block + "%") : "";
  return detailSection("hit","命中率",lines,block + dodge);
}

function attackDamagePanel({weaponDamage,strengthPercent,adjustedDamage,largeBonus,attack}) {
  const source = "武器 " + weaponDamage;
  const lines = strengthPercent ? [[source + " × 力量 " + (100+strengthPercent) + "%",String(adjustedDamage)]] : [[source]];
  if (largeBonus) lines.push([adjustedDamage + " × 反大 " + (100+largeBonus) + "%",String(attack)]);
  return detailSection("damage","攻击伤害",lines);
}

function damagePanels(detail) {
  const {damage,guard,mountDamage,damageCheck} = detail;
  if (!damage && !guard && !mountDamage) return "";
  const calculation = attackDamagePanel(damageCheck);
  if (guard) {
    const lines = guard.bonusRate ? [["攻击 " + damageCheck.attack + " × 破盾效率 " + (100+guard.bonusRate) + "%",String(guard.impact)]] : [];
    lines.push([guard.impact > guard.before ? guard.shield + "剩余耐久 " + guard.before + "，实际扣盾 " + guard.blocked :
      guard.shield + "实际扣盾 " + guard.blocked]);
    if (guard.broken) lines.push(["盾牌破碎"]);
    return calculation + detailSection("block","盾牌伤害",lines);
  }
  if (mountDamage) {
    const lines = [[mountDamage.name + (damageCheck.attack > mountDamage.before ? "剩余血量 " + mountDamage.before + "，" : "，") +
      "实际扣除坐骑血量 " + mountDamage.loss]];
    if (mountDamage.dismounted) lines.push(["坐骑倒下，骑手落马"]);
    return calculation + detailSection("health","坐骑伤害",lines);
  }
  const {base,weaponBonus,chance,roll} = damage.location;
  const head = damage.zone === "head";
  const location = detailSection("damage","爆头率",[
    [sumOfTerms([["基础爆头",base],["武器",weaponBonus]]),"合计爆头率 " + chance + "%"],
    ["部位骰 " + roll + "，" + (head ? "爆头" : "未爆头")]
  ]);
  const {penetration} = damage;
  const armorLines = [];
  if (penetration.armorReduction && penetration.baseRatio) {
    const rawPenetration = penetration.baseRatio - penetration.armorReduction;
    armorLines.push(["武器穿甲 " + penetration.baseRatio + "% − 护甲减穿 " + penetration.armorReduction + "%",
      rawPenetration < 0 ? "−" + Math.abs(rawPenetration) + "%" : "实际穿甲 " + penetration.ratio + "%"]);
    if (rawPenetration < 0) armorLines.push(["穿甲率最低为 0%，实际穿甲 0%"]);
  }
  if (penetration.direct) {
    armorLines.push(["攻击 " + damageCheck.attack + " × 穿甲 " + penetration.ratio + "%","直伤 " + penetration.direct]);
    if (penetration.armorDamage) armorLines.push(["攻击 " + damageCheck.attack + " − 直伤 " + penetration.direct,
      "分给护甲 " + penetration.armorDamage]);
  }
  const armorAvailable = damage.armorBefore > 0;
  const armorCapped = damage.armorImpact > damage.blocked;
  if (armorAvailable && penetration.armorDamage && damage.armorEfficiency !== 100) {
    armorLines.push(["护甲分摊 " + penetration.armorDamage + " × 破甲效率 " + damage.armorEfficiency + "%",
      (armorCapped ? "理论扣甲 " : "实际扣甲 ") + damage.armorImpact]);
  }
  if (!armorAvailable) armorLines.push(["该部位无可用护甲，实际扣甲 0"]);
  else if (armorCapped) armorLines.push(["剩余护甲耐久 " + damage.armorBefore + "，实际扣甲 " + damage.blocked]);
  else if (!penetration.armorDamage || damage.armorEfficiency === 100) armorLines.push(["实际扣甲 " + damage.blocked]);

  const healthLines = [];
  if (damage.overflow && damage.armorAbsorbed) healthLines.push(["护甲分摊 " + penetration.armorDamage +
    " − 护甲挡下 " + damage.armorAbsorbed,"护甲溢出 " + damage.overflow]);
  const components = sumOfTerms([["穿甲直伤",penetration.direct],["护甲溢出",damage.overflow]],"");
  const healthCapped = damage.hpLoss < damage.hpDamage;
  if (components) {
    const expression = head ? "(" + components + ") × 爆头 2 倍" : components;
    healthLines.push([expression,(healthCapped ? "理论扣血 " + damage.hpDamage : "实际扣血 " + damage.hpLoss)]);
  } else healthLines.push(["实际扣血 0"]);
  if (healthCapped) healthLines.push(["目标剩余血量 " + damage.hpBefore + "，实际扣血 " + damage.hpLoss]);
  return location + calculation + detailSection("block","护甲伤害",armorLines) + detailSection("health","血量伤害",healthLines);
}

function selectRollSection(name) {
  const panel = $("attack-details");
  for (const section of panel.querySelectorAll("[data-roll-panel]")) section.hidden = section.dataset.rollPanel !== name;
  for (const key of panel.querySelectorAll("button[data-roll-section]")) key.setAttribute("aria-pressed",String(key.dataset.rollSection === name));
  if (detailAnchor && panel.getBoundingClientRect().bottom > window.innerHeight - 10) positionAttackDetails(detailAnchor,panel);
}

function showAttackDetails(anchor) {
  clearTimeout(detailCloseTimer);
  if (anchor === detailAnchor) return;
  const detail = state.log.find((entry) => entry.id === Number(anchor.dataset.attack))?.detail;
  if (!detail) return;
  detailAnchor?.setAttribute("aria-expanded","false");
  detailAnchor = anchor;
  anchor.setAttribute("aria-expanded","true");
  const {accuracy} = detail;
  const name = text(detail.target ? detail.actor + " → " + detail.target : detail.actor);
  const outcome = detail.outcome ?? (detail.hit === false ? "miss" : "hit");
  const result = detail.guard ? "盾牌格挡" : detail.mountDamage ? "命中坐骑" :
    detail.damage ? (detail.damage.zone === "head" ? "命中头部" : "命中身体") : strikeLabel(detail);
  const panel = $("attack-details");
  panel.className = "attack-details " + (outcome === "hit" ? "hit" : "miss");
  panel.innerHTML = '<div class="details-title"><b>' + name + '</b><strong class="roll-result tone-' + outcome + '">' +
    (accuracy.forced ? "保底" : "") + result + '</strong></div>' +
    rollAxis(accuracy) + accuracyPanels(accuracy,detail.name) + damagePanels(detail);
  panel.hidden = false;
  selectRollSection(outcome === "miss" ? null : outcome);
  positionAttackDetails(anchor,panel);
}

function positionAttackDetails(anchor,panel) {
  const rect = anchor.getBoundingClientRect();
  const gap = 10;
  panel.style.maxHeight = "";
  if (Math.max(rect.left,window.innerWidth-rect.right) >= panel.offsetWidth+2*gap) {
    positionTooltip(anchor,panel);
    return;
  }
  const above = rect.top-2*gap;
  const below = window.innerHeight-rect.bottom-2*gap;
  panel.style.maxHeight = Math.max(above,below) + "px";
  panel.style.left = Math.max(gap,Math.min(rect.left,window.innerWidth-panel.offsetWidth-gap)) + "px";
  panel.style.top = (above>=below ? rect.top-gap-panel.offsetHeight : rect.bottom+gap) + "px";
}

function refreshAttackDetailsPosition() {
  if (!detailAnchor) return;
  const rect = detailAnchor.getBoundingClientRect();
  const log = $("log").getBoundingClientRect();
  if (rect.bottom > Math.max(0,log.top) && rect.top < Math.min(window.innerHeight,log.bottom)) {
    positionAttackDetails(detailAnchor,$("attack-details"));
  } else closeAttackDetails();
}

function positionTooltip(anchor,panel) {
  const rect = anchor.getBoundingClientRect();
  const margin = 10;
  const left = rect.left >= panel.offsetWidth + 2 * margin
    ? rect.left - panel.offsetWidth - margin : rect.right + margin;
  panel.style.left = Math.max(margin,Math.min(left,window.innerWidth-panel.offsetWidth-margin)) + "px";
  panel.style.top = Math.max(margin,Math.min(rect.top,window.innerHeight-panel.offsetHeight-margin)) + "px";
}

function closeReachDetails() {
  $("reach-details").hidden = true;
  reachAnchor = null;
}

function showReachDetails(anchor) {
  if (anchor === reachAnchor) return;
  reachAnchor = anchor;
  const panel = $("reach-details");
  const chance = state.hitChances[selected]?.[anchor.dataset.card];
  panel.classList.toggle("can-hit",chance !== undefined);
  panel.textContent = chance === undefined ? reachReason() : "命中率 " + chance + "%";
  panel.hidden = false;
  positionTooltip(anchor,panel);
}

function reportToolbar() {
  if (!embedded) return;
  window.parent.postMessage({ type: "campfire-battle-toolbar", battleId, toolbar: {
    phase: state.phase,
    terrains: state.terrains.map(({ id, name }) => ({ id, name })),
    terrain: state.terrain.id,
    weather: state.weather.id,
    weatherName: state.weather.name,
    weatherEffect: $("weather-effect").textContent,
  } }, window.location.origin);
}

function reportFrontierResult() {
  const result = battleSession.result();
  if (result) window.parent.postMessage({type:"campfire-frontier-battle-finished",battleId,result},window.location.origin);
}

function render() {
  if (frontier && state.ammoSpent > lastAmmoSpent) {
    lastAmmoSpent = state.ammoSpent;
    window.parent.postMessage({type:"campfire-frontier-ammo",battleId,spent:lastAmmoSpent},window.location.origin);
  }
  if (!$("victory-screen").hidden) {
    if (!$("spoils-layout").hidden) renderVictory();
    return;
  }
  const options = $("terrain");
  if (!options.options.length) options.innerHTML = state.terrains.map((terrain) =>
    '<option value="' + terrain.id + '">' + text(terrain.name) + '</option>').join("");
  options.value = state.terrain.id;
  options.disabled = state.phase !== "setup";
  const weather = state.weather;
  $("weather").textContent = weather.name;
  $("weather-effect").textContent = (state.terrain.indoors ? "固定黑暗 · " : "命中　") +
    "远程 " + signedPercent(weather.rangedHit) + " · 魔法 " + signedPercent(weather.magicHit) +
    (state.ammoLeft === undefined ? "" : " · 弹药 " + state.ammoLeft + " 单位");
  reportToolbar();
  if (opening && state.phase === "setup") {
    $("battle-layout").hidden = true;
    opening.load(state,formationKey);
    if ($("unit-dialog").open) updateUnitDetails();
    return;
  }
  if (opening) {
    opening.hide();
    $("battle-layout").hidden = false;
  }
  renderWeather(weather.id, state.terrain.indoors);
  document.querySelector(".theater").style.setProperty("--terrain-art",'url("./art/' + state.terrain.id + '.webp")');
  renderActionOrder();
  renderBoard();
  renderControls();
  if ($("unit-dialog").open) updateUnitDetails();
  showSpeech();
}

function renderWeather(weather, indoors) {
  const layer = $("weather-visual");
  layer.classList.toggle("underground", Boolean(indoors));
  if (layer.dataset.weather === weather) return;
  layer.dataset.weather = weather;
  layer.innerHTML = weatherParticles(weather).map(({left,top,delay}) =>
    '<i style="left:' + left + '%;top:' + top + '%;animation-delay:' + delay + 's"></i>'
  ).join("");
}

function openRules() {
  if (!embedded) {
    window.open("../../?help=battle","_blank","noopener");
    return;
  }
  const {terrain,weathers} = state;
  const weather = weathers.map(({id,name,rangedHit,magicHit})=>({
    id,name,rangedHit,magicHit,...(frontier ? {} : {probability:terrain.weatherWeights[id] ?? 0}),
  }));
  window.parent.postMessage({type:"campfire-battle-help",battleId,context:{
    terrain:{id:terrain.id,name:terrain.name},weather,
  }},location.origin);
}

const settlementLabels = {loot:"搜刮",recruit:"俘虏",execute:"处决",talk:"对话"};
const settlementFilters = {loot:"all",inventory:"all"};
const itemKinds = {weapons:["武器"],equipment:["头盔","护甲","盾牌"]};

function openBattleReport() {
  if (state.phase !== "ended") return;
  if ($("unit-dialog").open) $("unit-dialog").close();
  closeAttackDetails();
  closeReachDetails();
  clearTimeout(bubbleTimer);
  $("battle-layout").hidden = true;
  $("victory-screen").hidden = false;
  $("battle-report").hidden = false;
  $("spoils-layout").hidden = true;
  $("victory-actions").hidden = true;
  $("leave-battle").hidden = true;
  $("postbattle-reset").hidden = !frontier && Boolean(state.settlement);
  if (frontier) $("postbattle-reset").textContent = battleSession.result().outcome === "defeat" ? "返回石岸镇" : "返回边境地图";
  $("open-spoils").hidden = frontier || !state.settlement;
  $("open-spoils").textContent = state.settlement?.left ? "查看队伍物资" : "进入搜刮";
  $("victory-screen").style.setProperty("--victory-art",'url("./art/' + state.terrain.id + '.webp")');
  $("victory-title").textContent = "战斗结算";
  const result = state.winner === "player" ? "战斗胜利" : "战斗失败";
  $("victory-context").textContent = state.terrain.name + " · " + (state.endReason === "withdrawal" ? "撤离战场 · " : "") + result;
  $("report-rows").innerHTML = (state.report ?? []).map(unit=>'<tr' + (unit.fallen ? ' class="fallen"' : '') + '>' +
    '<th scope="row">' + portraitImage(unit) + '<span>' + text(unit.name) +
    (unit.fallen ? '<small>阵亡</small>' : '') + '</span></th>' +
    '<td>' + unit.taken + '</td><td>' + unit.armor + '</td><td>' + unit.hp + '</td><td>' + (unit.armor+unit.hp) + '</td></tr>').join("");
  $("victory-title").focus();
}

function canSettle(entry,command) {
  if (!entry || entry.disposition || command === "talk") return false;
  return command === "loot" ? entry.kind === "corpse" && !entry.looted : entry.kind === "prisoner";
}

function openSpoils() {
  if (!state.settlement) return;
  settlementFilters.loot = settlementFilters.inventory = "all";
  $("battle-report").hidden = true;
  $("open-spoils").hidden = true;
  $("spoils-layout").hidden = false;
  $("victory-title").textContent = "战后搜刮";
  const result = {surrender:"敌方投降",withdrawal:"敌方撤离",elimination:"敌方全灭"};
  $("victory-context").textContent = state.terrain.name + " · " + result[state.endReason];
  renderVictory();
  $("victory-title").focus();
}

function inventoryItem(item) {
  return '<span class="item-copy"><strong>' + text(item.name) + '</strong><small>' + text(item.kind) +
    (item.max === undefined ? '' : ' · 耐久 ' + item.current + ' / ' + item.max) + '</small></span><b>×' + item.quantity + '</b>';
}

function renderSettlementItems(panel) {
  const filter = settlementFilters[panel];
  const items = state.settlement[panel];
  const visibleItems = filter === "all" ? items : items.filter(item=>itemKinds[filter].includes(item.kind));
  const list = $("victory-" + panel);
  const empty = $(panel + "-empty");
  const collectable = panel === "loot";
  list.hidden = visibleItems.length === 0;
  empty.hidden = !list.hidden;
  empty.textContent = filter === "all" ? (collectable ? "暂无战利品" : "暂无队伍物资") :
    (filter === "weapons" ? "暂无武器" : "暂无装备");
  list.innerHTML = visibleItems.map(item=>{
    const content = inventoryItem(item);
    if (state.settlement.left) return '<li class="stored-item">' + content + '</li>';
    const action = collectable ? "收取" : "放回";
    const target = collectable ? 'data-take="' + item.id + '"' :
      'data-return-stack="' + text(JSON.stringify([item.kind,item.name,item.current,item.max])) + '"';
    return '<li><button class="item-transfer" type="button" ' + target + ' aria-label="' + action + ' ' +
      text(item.name) + '">' + content + '<span class="transfer-label">' + action + '</span></button></li>';
  }).join("");
  for (const button of list.closest(".victory-panel").querySelectorAll("[data-item-filter]")) {
    button.setAttribute("aria-pressed",String(button.dataset.itemFilter === filter));
  }
}

function renderVictory() {
  const {entries,loot,left} = state.settlement;
  const focused = document.activeElement?.dataset.settlementEntry;
  $("leave-battle").hidden = left;
  $("postbattle-reset").hidden = !left;
  $("victory-entries").hidden = left;
  $("enemies-cleared").hidden = !left;
  $("execute-all").disabled = !entries.some(entry=>canSettle(entry,"execute"));
  $("search-all").disabled = !entries.some(entry=>canSettle(entry,"loot"));
  for (const [id,kind,side] of [["prisoner-cards","prisoner","enemy"],["friendly-casualties","corpse","player"],["enemy-casualties","corpse","enemy"]]) {
    const cards = entries.filter(entry=>entry.kind===kind && entry.card.side===side)
      .map(entry=>renderCard(entry.card,undefined,entry)).join("");
    $(id).innerHTML = cards || '<p class="victory-empty">暂无</p>';
  }
  const entry = entries.find(item=>item.card.id===settlementSelection);
  const menu = $("victory-actions");
  if (entry && !left) {
    menu.setAttribute("aria-label",entry.card.name + "的结算操作");
    const commands = entry.kind === "corpse" ? ["loot"] : ["talk","recruit","execute"];
    menu.innerHTML = commands.map(command=>'<button type="button" data-settlement-command="' + command + '"' +
      (canSettle(entry,command) ? '' : ' disabled') + (command === "talk" ? ' title="暂未开放"' : '') + '>' +
      settlementLabels[command] + '</button>').join("");
  } else menu.replaceChildren();
  $("take-all").disabled = !loot.length;
  renderSettlementItems("loot");
  renderSettlementItems("inventory");
  if (focused && !left) $("victory-entries").querySelector('.card-select[data-settlement-entry="' + focused + '"]')?.focus({preventScroll:true});
  positionVictoryMenu();
}

function positionVictoryMenu() {
  const entries = $("victory-entries");
  const anchor = entries.hidden ? null : entries.querySelector('[data-spoils-card="' + settlementSelection + '"]');
  positionCardMenu($("victory-actions"),anchor,entries.getBoundingClientRect());
}

function requestLeave() {
  const {entries,loot} = state.settlement;
  const pending = entries.filter(entry=>canSettle(entry,"loot")).length;
  const items = loot.reduce((total,item)=>total+item.quantity,0);
  const losses = [pending ? pending + " 名阵亡者身上的装备尚未搜刮" : "",
    items ? items + " 件战利品尚未收入队伍物资" : ""].filter(Boolean);
  if (!losses.length) return send({type:"settle",command:"leave"});
  $("leave-message").textContent = losses.join("，") + "。离开后，这些物品将丢失。";
  $("leave-dialog").showModal();
}

function showBattleBanner(message,duration=0) {
  const banner = $("battle-banner");
  clearTimeout(bannerTimer);
  banner.textContent = message;
  banner.hidden = !message;
  if (duration) bannerTimer = setTimeout(()=>{banner.hidden = true;},duration);
}

function renderActionOrder() {
  $("round-counter").textContent = "第 " + state.round + " 回合";
  const playing = state.phase !== "setup" && state.phase !== "ended";
  const actors = state.order.map(byId);
  const version = JSON.stringify([state.match,state.round,playing,actors.map(unit=>[unit.id,unit.initiative])]);
  if (version === orderVersion) return;
  orderVersion = version;
  $("turn-order").innerHTML = actors.map((unit,index)=>{
    const current = playing && index === 0;
    return '<li class="' + unit.side + (current ? ' current" aria-current="step' : "") + '" title="' +
      text(unit.name + " · 先攻 " + unit.initiative) + '">' + portraitImage(unit) +
      '<span>' + text(unit.name) + '</span></li>';
  }).join("");
}

function cardPoint(id) {
  const card = $("ranks").querySelector('[data-card="' + id + '"]');
  if (!card) return null;
  const box = card.getBoundingClientRect();
  const board = $("board").getBoundingClientRect();
  const left = box.left-board.left, top = box.top-board.top;
  return {x:left+box.width/2,y:top+box.height/2,left,top,width:box.width,height:box.height,card};
}

function showMoraleChanges(previous) {
  if (!previous || previous.match !== state.match) return false;
  let changed = false;
  for (const unit of state.units) {
    const prior = previous.units.find(entry=>entry.id===unit.id);
    if (!prior || prior.morale === unit.morale || unit.row === "reserve") continue;
    const point = cardPoint(unit.id);
    if (!point) continue;
    const delta = unit.morale-prior.morale;
    const effect = document.createElement("div");
    effect.className = "morale-change " + (delta>0 ? "rising" : "falling");
    effect.textContent = unit.morale === whiteFlag ? "🏳️ 举起白旗" :
      (prior.morale === whiteFlag ? "恢复战斗意志 · " : "") + "士气 " + (delta>0 ? "+" : "−") + Math.abs(delta);
    effect.style.left = point.x + "px";
    effect.style.top = point.top+point.height-8 + "px";
    $("effects").append(effect);
    setTimeout(()=>effect.remove(),2000);
    changed = true;
  }
  return changed;
}

function showSpeech() {
  const effects = $("effects");
  effects.querySelector(".speech")?.remove();
  const now = Date.now();
  const speech = state.speeches.find(entry=>entry.expiresAt>now);
  const speaking = speech && speech.startsAt<=now;
  if (speaking) {
    const point = cardPoint(speech.unitId);
    const bubble = document.createElement("div");
    bubble.className = "speech " + speech.side + (point ? "" : " off-field");
    bubble.textContent = point ? speech.text : speech.name + "：" + speech.text;
    if (point) {
      const maxWidth = Math.max(76,point.width);
      bubble.style.maxWidth = maxWidth + "px";
      bubble.style.left = Math.min(effects.clientWidth-maxWidth/2,Math.max(maxWidth/2,point.x)) + "px";
      bubble.style.top = Math.max(35,point.top+2) + "px";
    }
    effects.append(bubble);
  }
  clearTimeout(bubbleTimer);
  if (speech) bubbleTimer = setTimeout(showSpeech,Math.max(1,(speaking ? speech.expiresAt : speech.startsAt)-now));
  drawArrow();
  renderLog();
  if ($("unit-dialog").open && inspectedTab==="dialogue") showDialogue(byId(inspectedUnit));
}

function showCasualty({left,top,width,height,card},hit) {
  for (const [kind,label,loss] of [["hp","血",hit.hpLoss],[hit.zone,hit.zone === "head" ? "盔" : "甲",hit.blocked]]) {
    const prior = meterHistory.get(hit.target + "/" + kind);
    const bar = card.querySelector(".meter." + kind);
    if (bar && prior && loss > 0) {
      bar.outerHTML = meter(kind,label,Math.max(0,prior.current - loss),prior.max,"",hit.target);
    }
  }
  const effect = document.createElement("div");
  effect.className = "casualty";
  effect.inert = true;
  Object.assign(effect.style,{left:left+"px",top:top+"px",width:width+"px",height:height+"px"});
  for (const side of ["left","right"]) {
    const piece = document.createElement("div");
    piece.className = "casualty-piece " + side;
    const copy = card.cloneNode(true);
    copy.removeAttribute("data-card");
    copy.classList.remove("selected","target","out-of-range","impact");
    piece.append(copy);
    effect.append(piece);
  }
  effect.firstElementChild.addEventListener("animationend",()=>effect.remove(),{once:true});
  $("effects").append(effect);
}

function showStrike(hit,departedPoint) {
  const target = cardPoint(hit.target) ?? departedPoint;
  if (!target) return;
  const missed = hit.hit === false;
  if (departedPoint) showCasualty(departedPoint,hit);
  else if (!missed) target.card.classList.add("impact");
  const effect = document.createElement("div");
  effect.className = "damage" + (missed ? " missed" : "");
  effect.style.left = target.x + "px";
  effect.style.top = target.y + "px";
  const guard = hit.guard;
  if (missed) {
    effect.textContent = strikeLabel(hit);
    if (guard?.blocked) {
      const loss = document.createElement("span");
      loss.textContent = "盾 −" + guard.blocked;
      effect.append(loss);
    }
    if (guard?.broken) {
      const broken = document.createElement("span");
      broken.className = "wound";
      broken.textContent = "破盾";
      effect.append(broken);
    }
  } else {
    const durability = hit.zone === "head" ? "头盔耐久" : "护甲耐久";
    effect.innerHTML = [
      hit.zone === "head" && '<span>击中头部</span>',
      hit.mountLoss && '<span class="wound">坐骑 −' + hit.mountLoss + '</span>',
      hit.dismounted && '<span>坠马</span>',
      hit.blocked && '<span>' + durability + ' −' + hit.blocked + '</span>',
      hit.penetration?.direct && '<span class="wound">穿甲 ' + hit.penetration.direct + '</span>',
      hit.hpLoss && '<span class="wound">血量 −' + hit.hpLoss + '</span>',
    ].filter(Boolean).join("") || "命中";
  }
  $("effects").append(effect);
  setTimeout(() => effect.remove(), 1450);
}

function drawArrow() {
  const canvas = $("aim");
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(bounds.width*ratio), height = Math.round(bounds.height*ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,bounds.width,bounds.height);
  const intent = state?.pendingEnemyAttack;
  const now = Date.now();
  if (intent && intent.startsAt <= now && now < intent.expiresAt) {
    const source = cardPoint(intent.actor);
    const target = cardPoint(intent.target);
    if (source && target) paintArrow(ctx,source,target,colors.hostile,true);
    return;
  }
  if (!aiming || !pointer) return;
  const start = cardPoint(selected);
  if (!start) return;
  const end = pointer.target ? byId(pointer.target) : null;
  const color = end && !targetValid(byId(selected),end) ? colors.dull : colors.gold;
  paintArrow(ctx,start,{x:pointer.x-bounds.left,y:pointer.y-bounds.top},color);
}

function paintArrow(ctx,from,to,color,hostile=false) {
  const dx = to.x-from.x, dy = to.y-from.y;
  const distance = Math.hypot(dx,dy);
  if (distance < 25) return;
  const a = Math.atan2(dy,dx);
  const cx = Math.cos(a), cy = Math.sin(a);
  const tail = hostile ? Math.min(44,distance/4) : 23;
  const inset = hostile ? Math.min(36,distance/4) : 0;
  const x = to.x-cx*inset, y = to.y-cy*inset;
  ctx.lineWidth = hostile ? 3 : 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = "#1a1010";
  ctx.shadowBlur = 6;
  ctx.setLineDash(hostile ? [10,5] : [7,4]);
  ctx.beginPath();
  ctx.moveTo(from.x+cx*tail,from.y+cy*tail);
  ctx.lineTo(x-cx*8,y-cy*8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x,y);
  ctx.lineTo(x-Math.cos(a-.5)*15,y-Math.sin(a-.5)*15);
  ctx.lineTo(x-Math.cos(a+.5)*15,y-Math.sin(a+.5)*15);
  ctx.closePath();
  ctx.fill();
}

function onUnit(id) {
  const unit = byId(id);
  if (!unit) return;
  if (unit.side === "enemy" && aiming) {
    if (!targetValid(byId(selected),unit)) {
      if ($("reach-details").hidden) setNotice(reachReason());
      return;
    }
    aiming = false;
    return send({type:"attack",actor:selected,target:id});
  }
  if (state.phase === "reinforcement" && state.reinforcements.units.includes(id)) {
    reinforcementUnit = reinforcementUnit === id ? null : id;
    return render();
  }
  if (state.phase !== "setup") {
    if (unit.row === "reserve" || state.phase === "ended") return;
    inspectionTarget = canAct(unit) || inspectionTarget === id ? null : id;
    if (inspectionTarget && (aiming || moving)) {
      aiming = moving = false;
      setNotice();
      return render();
    }
    return positionActionMenu();
  }
  selected = id;
  aiming = false;
  moving = false;
  setNotice();
  render();
}

document.addEventListener("click",(event) => {
  const button = event.target.closest("button");
  if (button?.dataset.attack) {
    showAttackDetails(button);
    if (event.detail === 0) $("attack-details").querySelector('button[data-roll-section="hit"]')?.focus();
    return;
  }
  if ($("attack-details").contains(event.target)) return;
  closeAttackDetails();
  if (!button || !state) return;
  if (frontier && state.phase === "setup" && button.hasAttribute("data-prepare-encounter")) {
    window.parent.postMessage({type:"campfire-battle-prepare",battleId,side:button.dataset.prepareEncounter},window.location.origin);
    return;
  }
  if (frontier && button.id === "postbattle-reset") {
    button.disabled = true;
    return reportFrontierResult();
  }
  if (button.id === "open-rules") return openRules();
  if (button.id === "open-spoils") return openSpoils();
  if (button.dataset.itemFilter) {
    const panel = button.closest("[data-item-panel]").dataset.itemPanel;
    settlementFilters[panel] = button.dataset.itemFilter;
    $("victory-" + panel).scrollTop = 0;
    return renderSettlementItems(panel);
  }
  if (button.id === "leave-battle" && !sending) return requestLeave();
  if (button.id === "confirm-leave") {
    $("leave-dialog").close();
    return send({type:"settle",command:"leave"});
  }
  if (button.id === "take-all") return send({type:"settle",command:"take",all:true});
  if (button.dataset.take) return send({type:"settle",command:"take",target:Number(button.dataset.take)});
  if (button.dataset.returnStack) return send({type:"settle",command:"return",target:button.dataset.returnStack});
  if (button.dataset.settlementAll) return send({type:"settle",command:button.dataset.settlementAll,all:true});
  if (button.dataset.settlementEntry) {
    if (sending) return;
    const target = button.dataset.settlementEntry;
    settlementSelection = settlementSelection === target ? null : target;
    return renderVictory();
  }
  if (button.dataset.settlementCommand) {
    return send({type:"settle",command:button.dataset.settlementCommand,target:settlementSelection});
  }
  if (button.dataset.details) return showUnitDetails(button.dataset.details);
  if (button.dataset.unitTab) {
    inspectedTab = button.dataset.unitTab;
    $("unit-view").scrollTop = 0;
    return updateUnitDetails();
  }
  if (button.dataset.unit) return onUnit(button.dataset.unit);
  if (button.id === "finish-reinforcement") return send({type:"finishReinforcement"});
  if (button.hasAttribute("data-reinforce-column") && state.phase === "reinforcement" && reinforcementUnit) {
    return send({type:"reinforce",actor:reinforcementUnit,row:button.dataset.reinforceRow,column:Number(button.dataset.reinforceColumn)});
  }
  if (button.hasAttribute("data-move-column") && moving && canAct(byId(selected))) {
    const {fieldSide,fieldRow} = button.closest("[data-field-side]").dataset;
    return send({type:"move",actor:selected,fieldSide,row:fieldRow,column:Number(button.dataset.moveColumn)});
  }
  if (button.dataset.deploy) {
    return send({type:"deploy",actor:selected,row:button.dataset.deploy});
  }
  if (button.hasAttribute("data-start")) return send({type:"start"});
  if (button.hasAttribute("data-reset")) return send({type:"reset"});
  if (button.hasAttribute("data-retreat") && canAct(byId(selected))) return send({type:"retreat",actor:selected});
  if (button.hasAttribute("data-skill")) return setNotice(byId(selected).name + "暂无可用技能。");
  if (button.hasAttribute("data-items")) return showUnitDetails(selected,"items");
  if (button.hasAttribute("data-information")) return showUnitDetails(inspectionTarget ?? selected);
  if ((button.hasAttribute("data-defend") || button.hasAttribute("data-dodge")) && canAct(byId(selected))) {
    aiming = false;
    moving = false;
    return send({type:button.hasAttribute("data-dodge") ? "dodge" : "defend",actor:selected});
  }
  if (button.hasAttribute("data-aim") && canAct(byId(selected))) {
    aiming = !aiming;
    moving = false;
    setNotice(aiming && !state.attackTargets[selected].length ? reachReason() : "");
    render();
  }
  if (button.hasAttribute("data-move") && canAct(byId(selected))) {
    moving = !moving;
    aiming = false;
    setNotice(moving ? "选择空格移动，进入敌方近战的控制区即停。" : "");
    render();
  }
});
$("board").addEventListener("pointermove",(event) => {
  pointer = {x:event.clientX,y:event.clientY,target:event.target.closest("[data-unit]")?.dataset.unit};
  drawArrow();
});
$("board").addEventListener("pointerleave",() => { pointer = null; drawArrow(); });
$("ranks").addEventListener("animationend",event => {
  if (event.animationName !== "meter-loss") return;
  const meter = event.target.closest(".meter");
  if (meter?.matches('.mount[data-empty="true"]')) {
    renderBoard();
    positionActionMenu();
  } else event.target.remove();
});
$("terrain").addEventListener("change",(event) => send({type:"terrain",terrain:event.target.value}));
$("unit-dialog").addEventListener("close",() => {
  const fallback = () => document.querySelector('[data-details="' + inspectedUnit + '"],[data-card="' +
    inspectedUnit + '"] .card-select');
  (inspectedTrigger?.getClientRects().length ? inspectedTrigger : fallback())?.focus();
});
$("unit-view").addEventListener("submit",event => {
  const form = event.target.closest("form[data-use-potion]");
  if (!form) return;
  event.preventDefault();
  const unit = byId(inspectedUnit);
  if (!canAct(unit)) return;
  const target = String(new FormData(form).get("recipient") ?? "");
  if (!target) return;
  $("unit-dialog").close();
  send({type:"item",actor:unit.id,target,item:form.dataset.usePotion});
});
$("unit-view").addEventListener("click",event => {
  const unit = byId(inspectedUnit);
  if (unit && event.target.closest("button[data-portrait-view]")) {
    void portraitViewer.open(unit,portraitSource(unit,portraitPath(unit)));
    return;
  }
  const button = event.target.closest("button[data-swap-item]");
  if (!button || !canAct(unit)) return;
  $("unit-dialog").close();
  send({type:"swapItem",actor:unit.id,slot:Number(button.dataset.swapItem)});
});
$("unit-dialog").querySelector('[role="tablist"]').addEventListener("keydown",(event) => {
  if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]:not(:disabled)'));
  const index = tabs.findIndex((tab) => tab.dataset.unitTab === inspectedTab);
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
    (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].click();
  tabs[next].focus();
});
for (const type of ["pointerover","focusin"]) {
  $("log").addEventListener(type,(event) => {
    const record = event.target.closest("button[data-attack]");
    if (record) showAttackDetails(record);
  });
}
for (const type of ["pointerout","focusout"]) {
  $("log").addEventListener(type,(event) => {
    if (detailAnchor?.contains(event.target)) queueCloseAttackDetails(event.relatedTarget);
  });
}
const attackPanel = $("attack-details");
for (const type of ["pointerover","focusin","click"]) {
  attackPanel.addEventListener(type,(event) => {
    clearTimeout(detailCloseTimer);
    const key = event.target.closest("[data-roll-section]");
    if (key) selectRollSection(key.dataset.rollSection);
  });
}
attackPanel.addEventListener("pointerleave",event=>queueCloseAttackDetails(event.relatedTarget));
attackPanel.addEventListener("focusout",event=>queueCloseAttackDetails(event.relatedTarget));
$("log").addEventListener("scroll",refreshAttackDetailsPosition,{passive:true});
for (const type of ["pointerover","focusin"]) {
  $("board").addEventListener(type,event => {
    const card = event.target.closest(".out-of-range,.target");
    if (card) showReachDetails(card);
  });
}
for (const type of ["pointerout","focusout"]) {
  $("board").addEventListener(type,event => {
    if (!reachAnchor?.contains(event.target) || reachAnchor.contains(event.relatedTarget)) return;
    if (type === "pointerout" && reachAnchor.contains(document.activeElement) &&
        document.activeElement.matches(":focus-visible")) return;
    if (type === "focusout" && reachAnchor.matches(":hover")) return;
    closeReachDetails();
  });
}
document.addEventListener("keydown",(event) => {
  if (event.key === "Escape" && !$("unit-dialog").open) {
    if (settlementSelection && !$("spoils-layout").hidden && !$("leave-dialog").open) {
      settlementSelection = null;
      return renderVictory();
    }
    closeAttackDetails();
    closeReachDetails();
    if (aiming || moving) {
      if (aiming) aiming = false;
      else if (moving) moving = false;
      setNotice();
      render();
    }
  }
});
window.addEventListener("resize",() => {
  if (!$("victory-screen").hidden) positionVictoryMenu();
  else if (state) { closeAttackDetails(); closeReachDetails(); positionActionMenu(); drawArrow(); showSpeech(); }
});
$("victory-entries").addEventListener("scroll",positionVictoryMenu,{passive:true});
window.addEventListener("scroll",() => {
  if (!$("victory-screen").hidden) return positionVictoryMenu();
  if (!state) return;
  refreshAttackDetailsPosition();
  if (reachAnchor) {
    const rect = reachAnchor.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) positionTooltip(reachAnchor,$("reach-details"));
    else closeReachDetails();
  }
  positionActionMenu();
},{passive:true});
if (frontier) window.addEventListener("message",function loadEncounter(event) {
  if (event.origin !== location.origin || event.source !== window.parent ||
      event.data?.type !== "campfire-battle" || !event.data.player) return;
  window.removeEventListener("message",loadEncounter);
  battleId = event.data.battleId;
  formationKey = event.data.formationKey;
  const lighting = event.data.lighting;
  if (lighting === "lit" || lighting === "unlit") document.body.dataset.lighting = lighting;
  sync();
});
else sync();
