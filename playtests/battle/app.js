import { moraleLabel, renderUnitCardContent, renderUnitHeadshot, renderUnitMeter, unitCardLevel, whiteFlag } from "./unitCard.mjs";
import { battleParticipantGear, battleSession } from "./client.mjs?v=battle-help";
import { weatherParticles, weatherSkyMarkup } from "../weatherVisual.mjs";
import { battleSwapProblem, dodgeAfterAction, restorationTargets, battleProfileCombat, pendingCorpseAction, settlementItemKey, settlementProblem, trapPlacementOptions } from "./battle.mjs";
import { fieldSideOf } from "./grid.mjs";
import { battleItemsBySlot } from "./loadout.mjs";
import { createOpeningScreen } from "./opening.mjs?v=encounter-actions";
import { createPortraitViewer, portraitSource } from "./portraits.mjs";
import { battleFaction, createBattleLogLabels, strikeLabel, strikeLabels } from "./battleLog.mjs";
import { createBloodEffects } from "./blood.mjs";
import { characterAttributeSheet, renderCharacterProfileData } from "./characterSheet.mjs";

import { selectedBattleRecordings, selectedStrikeFeedback } from "./selectedAudio.mjs";
import { battleVoicePools, randomVoiceIndex } from "./voiceAudio.mjs";

const $ = (id) => document.getElementById(id);
const colors = {gold:"#ffe0a0", dull:"#baa48a", hostile:"#ff947d"};
const names = {front:"前排",back:"后排",reserve:"预备队"};
const turnLabels = {player:"我方行动",ally:"盟友行动",enemy:"敌方行动"};
const embedded = window.parent !== window;
const params = new URLSearchParams(location.search);
const frontier = embedded && params.get("mode") === "frontier";
document.body.classList.toggle("embedded",embedded);
$("reset-battle").hidden = frontier;
$("battle-layout").hidden = frontier;
const eventLabels = {
  ready:"进攻前",hit:"命中",miss:strikeLabels.miss,light:"轻伤",heavy:"重伤",allyFall:"队友阵亡",fall:"阵亡",
  guard:"防御",shieldBreak:"盾牌破碎",dismount:"坠马",
};
let state;
let battleId;
let partyIds = frontier ? new Set(["pc"]) : undefined;
let lastAmmoSpent = 0;
let formationKey;
let selected = "roland";
let reinforcementUnit;
let aiming = false;
let moving = false;
let trapPlacement;
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
let reachPoint;
let aimedEnemy;
let actionMenuActor;
let inspectedUnit;
let inspectedTrigger;
let inspectedTab = "profile";
let portraitUpdates = {};
const meterHistory = new Map();
const meterLossDuration = 1250;
const bloodAppearanceDelay = 280;

const text = (value) => String(value).replace(/[&<>"']/g,(ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
const logLabels = createBattleLogLabels(text);
const blood = createBloodEffects($("battle-blood"),$("effects"));
const stanceActions = {dodge:"闪避",guard:"防御"};
const opening = frontier && createOpeningScreen({
  text,renderCard:(unit,slot)=>renderCard(unit,undefined,undefined,true,slot),send,
});
const signedPercent = (value) => (value > 0 ? "+" : "") + value + "%";
const byId = (id) => state.units.find((unit) => unit.id === id);
const portraitPath = unit => unit.portrait === null ? "" : "./art/" + (unit.portrait ?? unit.id) + ".webp";
function unitPortraitSource(unit) {
  return portraitSource({...unit,...portraitUpdates[unit.portraitCropKey]},portraitPath(unit));
}
const portraitViewer = createPortraitViewer($("portrait-dialog"),()=>{
  orderVersion = undefined;
  $("unit-dialog").close();
  render();
});
window.addEventListener("storage",event=>{
  if (!state || !event.key?.startsWith("campfire.battle-face.")) return;
  orderVersion = undefined;
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

function cardPortrait(unit,className) {
  return renderUnitHeadshot(unit.name,unitPortraitSource(unit),unit.portraitCropKey ?? "roster:"+unit.id,className);
}
const battleStatusNames = {defend:"防御",dodge:"闪避",surprised:"措手不及"};
const rowUnits = (side,row) => state.units.filter(unit=>fieldSideOf(unit) === side && unit.row === row).sort((a,b) => a.position-b.position);
const gridColumn = (column) => state.lanes.indexOf(column) + 1;
const canAct = (unit) => unit?.side === "player" && unit.morale !== whiteFlag && unit.row !== "reserve" && !unit.acted &&
  state.phase === "player" && !state.autoBattle && !state.busy && state.order?.[0] === unit.id;
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
const moraleLogKey = "battle-morale-log-muted";
const recordedSounds = new Map();
const recordedLevels = {
  block:.65,missOne:.32,missTwo:.38,bowLaunch:.55,crossbowLaunch:.55,throwLaunch:.55,armorHit:.70,bluntHit:.62,sharpHit:.60,fleshHit:.60,
  projectileSoft:.65,projectileMetal:.70,projectileMiss:.32,crossbowMiss:.32,shieldBreak:.60,
  swing:.32,axe:.40,thrust:.36,bow:.55,crossbow:.55,arrowPass:.32,dodge:.29,
  plate:.70,padded:.62,parry:.65,shield:.72,flesh:.60,break:.47,fall:.45,step:.25,
};
let soundEnabled = true;
let dialogueEnabled = true;
let moraleLogEnabled = true;
try {
  soundEnabled = localStorage.getItem(battleSoundKey) !== "1";
  dialogueEnabled = localStorage.getItem(battleDialogueKey) !== "1";
  moraleLogEnabled = localStorage.getItem(moraleLogKey) !== "1";
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
        Promise.all(decoded).then(buffers=>recordedSounds.set(battleVoicePools[name]?"legacy-"+name:name,{buffers,next:0})).catch(()=>{});
      }
      for (const [name,entry] of Object.entries(selectedBattleRecordings)) {
        fetch(new URL(entry.url,import.meta.url)).then(response=>{
          if (!response.ok) throw new Error("Audio HTTP " + response.status);
          return response.arrayBuffer();
        }).then(bytes=>audioContext.decodeAudioData(bytes))
          .then(buffer=>recordedSounds.set(name,{buffers:[buffer],next:0,offset:entry.offset??0}))
          .catch(error=>console.warn("无法读取已选音效 " + entry.code,error));
      }
      // 四个池交错加载，限制同时下载／解码的数量；同一战斗页只加载一次。
      const poolEntries=Object.entries(battleVoicePools),voiceQueue=[];
      for(const [name] of poolEntries) recordedSounds.set(name,{buffers:[],offsets:[],next:-1,random:true});
      for(let i=0;i<Math.max(...poolEntries.map(([,entries])=>entries.length));i++) {
        for(const [name,entries] of poolEntries) if(entries[i]) voiceQueue.push({name,entry:entries[i]});
      }
      let voiceIndex=0;
      const loadVoices=async()=>{
        while(voiceIndex<voiceQueue.length) {
          const {name,entry}=voiceQueue[voiceIndex++];
          try {
            const response=await fetch(new URL(entry.url,import.meta.url));
            if(!response.ok) throw new Error("Audio HTTP "+response.status);
            const buffer=await audioContext.decodeAudioData(await response.arrayBuffer());
            const pool=recordedSounds.get(name);pool.buffers.push(buffer);pool.offsets.push(entry.offset);
          } catch(error) { console.warn("无法读取人物音效 "+entry.code,error); }
        }
      };
      void Promise.all(Array.from({length:4},loadVoices));
    }
    if (audioContext.state !== "running") await audioContext.resume();
  } catch {}
}

function playBattleSound(name,delay=0,volume=1) {
  if (!soundEnabled || audioContext?.state !== "running") return;
  const recording = recordedSounds.get(name);
  if (recording?.buffers.length) {
    const sample = audioContext.createBufferSource();
    const index=recording.random?randomVoiceIndex(recording.buffers.length,recording.next):recording.next;
    sample.buffer = recording.buffers[index];
    recording.next = recording.random?index:(index+1)%recording.buffers.length;
    sample.playbackRate.value = recording.random?1:.985 + Math.random()*.03;
    const gain = audioContext.createGain();
    gain.gain.value = (recordedLevels[name] ?? selectedBattleRecordings[name]?.volume ?? 1)*volume;
    sample.connect(gain).connect(audioOutput);
    sample.start(audioContext.currentTime+delay,recording.offsets?.[index]??recording.offset??0);
    return;
  }
  // 首次解码尚未完成时沿用同一性别的旧声，不影响命中及叫声的先后。
  if(battleVoicePools[name]) return playBattleSound(name.endsWith("-hurt")?name.replace(/-hurt$/,"-light"):"legacy-"+name,delay,volume);
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

function playStrikeSounds(cues) {
  for (const cue of cues) playBattleSound(cue.name,cue.delay,cue.volume);
}

function refreshSoundButton() {
  const button = $("battle-sound");
  button.setAttribute("aria-checked",String(soundEnabled));
}

refreshSoundButton();
function refreshDialogueButton() {
  const button = $("battle-dialogue");
  button.setAttribute("aria-checked",String(dialogueEnabled));
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
const moraleLogButton = $("battle-morale-log");
function refreshMoraleLogButton() {
  moraleLogButton.setAttribute("aria-checked",String(moraleLogEnabled));
}
refreshMoraleLogButton();
moraleLogButton.addEventListener("click",() => {
  moraleLogEnabled = !moraleLogEnabled;
  try { localStorage.setItem(moraleLogKey,moraleLogEnabled ? "0" : "1"); } catch {}
  refreshMoraleLogButton();
  if (state) renderLog();
});
const battleOptions = $("battle-options");
document.addEventListener("click",event => {
  if (battleOptions.open && !battleOptions.contains(event.target)) battleOptions.open = false;
});
for (const event of ["pointerdown","keydown"]) document.addEventListener(event,unlockBattleAudio);
$("battle-sound").addEventListener("click",async () => {
  soundEnabled = !soundEnabled;
  refreshSoundButton();
  try { localStorage.setItem(battleSoundKey,soundEnabled ? "0" : "1"); } catch {}
  if (audioOutput) audioOutput.gain.setValueAtTime(soundEnabled ? .38 : 0,audioContext.currentTime);
  if (soundEnabled) {
    await unlockBattleAudio();
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
    const previousHarvest = state?.settlement?.lastHarvest;
    const next = battleSession.submit(payload);
    if (payload.type === "settle" && payload.command === "pickup") settlementItemTab = "inventory";
    else if (next.settlement?.lastHarvest && next.settlement.lastHarvest !== previousHarvest) {
      settlementItemTab = "loot";
      settlementFilters.loot = "all";
    }
    receive(next);
    if (frontier && payload.type === "settle" && payload.command === "leave" && state.settlement?.left) {
      reportFrontierResult();
    }
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
  const freshStrike = previous?.match === next.match && strike && strike.id !== lastStrike && Date.now() - strike.at < 2100;
  const departed = freshStrike && !next.units.some(unit=>unit.id===strike.target);
  const fallen = departed && !strike.arenaWithdrawn;
  const strikeSounds = freshStrike ? selectedStrikeFeedback(strike,
    previous.units.find(unit=>unit.id===strike.actor)?.weapon,
    previous.units.find(unit=>unit.id===strike.target),fallen) : [];
  const afterStrike = strikeSounds.length ? Math.max(...strikeSounds.map(cue=>cue.delay))+.12 : 0;
  const departedPoint = departed ? cardPoint(strike.target) : null;
  if (previous && next.match !== previous.match) {
    selected = "roland";
    aiming = false;
    moving = false;
    trapPlacement = undefined;
    lastStrike = null;
    meterHistory.clear();
    clearTimeout(victoryTimer);
    settlementSelection = null;
    if ($("leave-dialog").open) $("leave-dialog").close();
    if ($("battle-record-dialog").open) $("battle-record-dialog").close();
    if ($("harvest-checks-dialog").open) $("harvest-checks-dialog").close();
    $("victory-screen").hidden = true;
    $("battle-layout").hidden = false;
    $("effects").replaceChildren();
  }
  state = next;
  if (previous?.match !== state.match || actionMenuActor !== state.order[0] || !canAct(byId(actionMenuActor))) {
    actionMenuActor = undefined;
  }
  logLabels.update(state.match,state.units,partyIds);
  if (previous?.match !== state.match || !state.reinforcements?.units.includes(reinforcementUnit)) {
    reinforcementUnit = null;
  }
  if (["player","enemy"].includes(state.phase) && selected !== state.order[0]) {
    selected = state.order[0];
    aiming = moving = false;
  }
  if (!canAct(byId(selected))) aiming = moving = false;
  if (trapPlacement && (!canAct(byId(trapPlacement.actor)) || !byId(trapPlacement.actor).items.some(item=>item.trap && (item.key ?? item.name) === trapPlacement.item))) {
    trapPlacement = undefined;
  }
  if (byId(selected)?.moved) moving = false;
  if (frontier && previous?.phase === "setup" && state.phase === "ended") {
    reportToolbar();
    if (state.endReason === "withdrawal") return reportFrontierResult();
    return openAftermath();
  }
  render();
  const moraleChanged = showMoraleChanges(previous);
  if (state.phase === "ended" && (previous?.phase !== "ended" || previous?.match !== state.match)) {
    const result = state.winner === "player" ? "我方获胜" : "敌方获胜";
    const ending = {surrender:"全队溃败 · ",withdrawal:"撤离战场 · "};
    showBattleBanner((ending[state.endReason] ?? "") + result);
    if (previous) {
      playBattleSound(state.winner === "player" ? "victory" : "defeat",freshStrike ? Math.max(.54,afterStrike) : 0);
      const delay = freshStrike && strike.hpLoss > 0 ? meterLossDuration : 850;
      victoryTimer = setTimeout(openAftermath,moraleChanged ? 2100 : delay);
    }
    else openAftermath();
  } else if (state.phase === "setup") {
    showBattleBanner("");
  } else if (previous?.phase === "setup" || previous?.round !== state.round) {
    showBattleBanner("第 " + state.round + " 回合",1400);
    if (previous) playBattleSound(previous.phase === "setup" ? "start" : "round",freshStrike ? Math.max(.4,afterStrike) : 0);
  }
  if (freshStrike) {
    playStrikeSounds(strikeSounds);
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

function meter(kind, label, current, max, owner) {
  return renderUnitMeter(kind,label,current,max,meterLoss(owner,kind,current,max));
}

function renderCard(unit,column,entry,preview=false,formationSlot) {
  const inBattle = column !== undefined;
  const fighting = inBattle && state.phase !== "setup";
  const fieldCard = fighting || Boolean(entry);
  const current = fighting && (state.phase === "player" || state.phase === "enemy") && unit.id === state.order[0];
  const canOpenActions = current && canAct(unit);
  const faction = current ? battleFaction(unit,partyIds) : undefined;
  const target = inBattle && aiming && targetValid(byId(selected),unit);
  const blocked = inBattle && aiming && unit.side === "enemy" && !target;
  const highlighted = !preview && unit.id === (inBattle ? (state.phase === "setup" ? selected : state.order[0]) : settlementSelection);
  const classes = ["card","campfire-unit-card",unit.side];
  if (fieldCard || formationSlot) classes.push("battle-card");
  if (highlighted) classes.push("selected");
  if (target) classes.push("target");
  if (blocked) classes.push("out-of-range");
  const statuses = fighting && state.phase !== "ended" ? Object.entries(unit.statuses) : [];
  const badges = statuses.map(([id,turns])=>({id,name:battleStatusNames[id],turns}));
  const describeBadge = ({name,turns}) => name + "，剩余 " + turns + " 回合";
  const description = badges.map(describeBadge).join("，");
  if (statuses.some(([id])=>id==="defend")) classes.push("guarding");
  if (statuses.some(([id])=>id==="dodge")) classes.push("evading");
  const levelLabel = unitCardLevel(unit) + " 级";
  const placement = formationSlot ? "" : inBattle ? ' data-card="' + unit.id + '" style="grid-column:' + column + '"' :
    (preview ? ' data-encounter-unit="' : ' data-spoils-card="') + unit.id + '"';
  const details = 'data-details="' + unit.id + '" aria-haspopup="dialog"';
  const selection = formationSlot ?
    'data-opening-row="' + formationSlot.row + '" data-opening-index="' + formationSlot.index +
    '" data-opening-id="' + text(unit.id) + '" draggable="true"' :
    preview ? details : inBattle ? 'data-unit="' + unit.id + '"' : 'data-settlement-entry="' + unit.id + '"';
  const menu = inBattle ? details + ' title="人物详情"' :
    selection + ' title="结算操作"';
  const menuButton = fieldCard || preview ? "" : '<button type="button" class="unit-menu" ' + menu + ' aria-label="' +
    text(unit.name + (inBattle ? "详情" : "结算操作")) + '"><i></i><i></i><i></i></button>';
  return '<div class="' + classes.join(" ") + '"' + placement + '>' +
    '<button type="button" class="card-select" ' + selection + ' aria-label="' +
    text((formationSlot ? formationSlot.label + " · " : "") + unit.name + " · " + levelLabel) + '"' +
    (preview && !formationSlot ? '' : ' aria-pressed="' + highlighted + '"') +
    (canOpenActions ? ' aria-controls="unit-actions" aria-expanded="' + (actionMenuActor === unit.id) + '"' : "") +
    (entry ? ' aria-controls="victory-actions" aria-expanded="' + highlighted + '"' : "") +
    (description ? ' aria-description="' + text(description) + '"' : '') +
    (blocked || target ? ' aria-describedby="reach-details"' : "") + '>' +
    renderUnitCardContent(unit,{
      portrait:cardPortrait(unit),
      badges:badges.length ? '<span class="portrait-statuses">' + badges.map(badge=>
        '<span class="portrait-status' + (badge.id === "surprised" ? " adverse" : "") + '" title="' + text(describeBadge(badge)) + '">' +
        text(badge.name) + '<b>' + badge.turns + '</b></span>').join("") + '</span>' : "",
      field:fieldCard || inBattle,
      meterTrail:inBattle ? (kind,current,max)=>meterLoss(unit.id,kind,current,max) : undefined,
      turn:faction ? '<span class="turn-marker" data-faction="' + faction + '" aria-hidden="true"><span>▲</span> ' +
        turnLabels[faction] + '</span>' : "",
    }) + '</button>' + menuButton +

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
  const placing = trapPlacement ? trapPlacementOptions(state,byId(trapPlacement.actor)).filter(spot=>spot.fieldSide===side && spot.row===row) : [];
  const reinforcements = reinforcementUnit && side === "player" ? state.reinforcements.columns[row] : [];
  if (state.phase !== "setup") content += state.fieldColumns.slice(0,max).filter(column=>
    !units.some(unit=>unit.column===column) && !moves.some(spot=>spot.column===column) &&
    !placing.some(spot=>spot.column===column) && !reinforcements.includes(column)
  ).map(column=>{
    const trap = state.traps.find(entry=>entry.fieldSide===side && entry.row===row && entry.column===column);
    return '<span class="field-cell' + (trap ? ' trapped-field-cell' : '') + '" style="grid-column:' + gridColumn(column) +
      (trap ? '" title="' + text(trap.name) + '" aria-label="' + text(trap.name) + '">⚙️' : '" aria-hidden="true">') + '</span>';
  }).join("");
  content += placing.map(({column})=>'<button type="button" class="slot trap-slot" style="grid-column:' + gridColumn(column) +
    '" data-trap-column="' + column + '">布设在此</button>').join("");
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
  const hover = reachPoint;
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
    '>' + text(unit.name) +
    '</button></span>';
  }).join("");
  const moveToReserve = canDeploy("player","reserve")
    ? '<button type="button" class="quiet" data-deploy="reserve">移入预备队</button>' : "";
  $("enemy-reserves").innerHTML = reserves(theirs);
  $("player-reserves").innerHTML = reserves(ours) + moveToReserve;
  if (!aiming || (aimedEnemy && !byId(aimedEnemy))) setAimedEnemy();
  if (aiming && hover) {
    const card = document.elementFromPoint?.(hover.x,hover.y)?.closest(".out-of-range,.target");
    if (card) showReachDetails(card,hover);
  }
  drawArrow();
}

function positionActionMenu() {
  const menu = $("unit-actions");
  const unit = byId(actionMenuActor);
  const anchor = document.querySelector('[data-card="' + unit?.id + '"]');
  if (!canAct(unit)) {
    menu.hidden = true;
    return;
  }
  menu.setAttribute("aria-label",unit.name + "的操作");
  positionCardMenu(menu,anchor);
}

function toggleActionMenu(id) {
  const trigger = $("ranks").querySelector('[aria-controls="unit-actions"]');
  actionMenuActor = id === actionMenuActor ? undefined : id;
  trigger?.setAttribute("aria-expanded",String(Boolean(actionMenuActor)));
  positionActionMenu();
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
  const row = anchor.closest(".spoils-card")?.parentElement ?? anchor.parentElement;
  for (const peer of row.children) {
    if (peer.contains(anchor) || !peer.matches(".card,.slot,.reserve-unit,.spoils-card")) continue;
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
  $("start-battle").hidden = !setup;
  $("restart-battle").hidden = frontier || state.phase !== "ended";
  $("reinforcement-actions").hidden = state.phase !== "reinforcement" || Boolean(state.autoBattle);
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
  const explanation = setup ? "布阵结束后才能行动。" : state.autoBattle ? "自动战斗中。" : state.busy ? "正在结算当前行动。" :
    unit?.side === "enemy" ? "敌方角色由系统控制。" : unit?.acted ? "该角色本轮已行动。" : "还没轮到该角色。";
  attack.disabled = defend.disabled = dodge.disabled = !permitted;
  $("unit-actions").querySelector("[data-skill]").disabled = !permitted;
  $("unit-actions").querySelector("[data-items]").disabled = !permitted;
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

const fraction = ({current,max}) => current + " / " + max;

function blockDisplay({meleeBlock,rangedBlock}) {
  const percent = value => value + "%" + (value ? " → " + (value*2) + "%" : "");
  return meleeBlock === rangedBlock ? percent(meleeBlock) : "近战 " + percent(meleeBlock) + " · 远程 " + percent(rangedBlock);
}

function showUnitStatDetails(anchor) {
  const unit = byId(inspectedUnit);
  if (!unit) return;
  const detail = battleProfileCombat(unit,state.weather).profileStatSources[anchor.dataset.unitStat];
  if (!detail) return;
  const panel = $("unit-stat-details");
  panel.innerHTML = '<strong>' + text(detail.title) + '</strong>' + detail.rows.map(([label,value])=>
    '<div><span>' + text(label) + '</span><b>' + text(value) + '</b></div>').join("") +
    '<p>' + text(detail.total) + '</p>' + (detail.note ? '<small>' + text(detail.note) + '</small>' : "");
  panel.hidden = false;
  positionTooltip(anchor,panel);
}

function showProfile(unit) {
  const source = unitPortraitSource(unit);
  const original = portraitImage(unit,"unit-profile-portrait",source?.url,source?.columns > 1);
  const profile = {...unit, ...battleProfileCombat(unit,state.weather),
    ...(unit.monster ? {monsterCategory:unit.raceName ?? "",bodyLabel:unit.size} : {}),
    profileMorale:moraleLabel(unit.morale),
    profileStatuses:Object.entries(unit.statuses).map(([id,turns])=>
      (battleStatusNames[id] ?? id) + " · " + turns + " 回合"),
  };
  const view = $("unit-view");
  let host = view.querySelector(".battle-profile-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "battle-profile-host";
    view.replaceChildren(host);
  }
  if (frontier) {
    document.dispatchEvent(new CustomEvent("battle-profile-panel",{detail:{host,unit:profile,portrait:source}}));
    if (host.shadowRoot) return;
  }
  host.innerHTML = '<div class="unit-profile">' +
    '<div class="unit-profile-art">' + (source ?
      '<button type="button" class="portrait-preview" data-portrait-view aria-label="查看原始立绘">' +
      original + '</button>' : original) + '</div>' +
    '<div class="unit-profile-data">' + renderCharacterProfileData(profile,true) + '</div></div>';
}

function showAttributes(unit) {
  const {columns,rows} = characterAttributeSheet(unit);
  const valueColumn = ({emphasis}) => emphasis ? " data-value-column" : "";
  $("unit-view").innerHTML = '<table class="attribute-sources"><thead><tr><th scope="col">属性</th>' +
    columns.map(column=>'<th scope="col"' + valueColumn(column) + '>' + column.label + '</th>').join("") +
    '</tr></thead><tbody>' + rows.map(({label,cells,rank})=>'<tr><th scope="row">' + label + '</th>' +
      cells.map((cell,index)=>'<td' + valueColumn(columns[index]) + '>' + text(cell) +
        (columns[index].key === "total" && rank ? '<span class="attribute-rank" role="img" aria-label="' +
          (rank === 1 ? '最高属性">★' : '次高属性">☆') + '</span>' : '') + '</td>').join("") +
      '</tr>').join("") + '</tbody></table>';
}

function showEquipment(unit) {
  const view = $("unit-view");
  let host = view.querySelector(".battle-equipment-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "battle-equipment-host";
    view.replaceChildren(host);
  }
  function latest() {
    const context = battleSession.equipment(unit.id);
    if (!context) return null;
    return {
      ...context, host, latest,
      swaps:canAct(byId(unit.id)) ? battleItemsBySlot(context.unit.items).map(item=>item?.swap?.gear ? battleSwapProblem(context.unit,item) : null) : [],
      swap(slot) {
        const actor = byId(unit.id);
        if (!canAct(actor) || battleSwapProblem(actor,battleItemsBySlot(actor.items)[slot])) return;
        $("unit-dialog").close();
        send({type:"swapItem",actor:unit.id,slot});
      },
      apply(gear) {
        const next = battleSession.changeEquipment(unit.id,context.revision,battleParticipantGear(gear));
        queueMicrotask(()=>receive(next));
      },
    };
  }
  document.dispatchEvent(new CustomEvent("battle-equipment-panel",{detail:latest()}));
  if (!host.shadowRoot) host.textContent = "请从游戏内进入战场，打开共用装备面板。";
  view.querySelector(".battle-potions")?.remove();
  host.insertAdjacentHTML("afterend",equipmentPotions(unit));
}

function hideEquipment() {
  if ($("unit-view").querySelector(".battle-equipment-host")) {
    document.dispatchEvent(new CustomEvent("battle-equipment-panel"));
  }
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

function carriedIcon(item, fallback) {
  if (item?.iconSrc) return '<img class="battle-item-icon" src="' + text(item.iconSrc) + '" alt="">';
  const emoji = item?.iconEmoji ?? fallback;
  return emoji ? '<span class="battle-item-icon" aria-hidden="true">' + text(emoji) + '</span>' : "";
}

function equipmentPotions(unit) {
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
      '<span>' + carriedIcon(item,icon ?? "🧪") + text(name) +
      '<small>恢复 ' + text(dice) + ' 点' + label + '</small></span>' +
      '<select name="recipient" aria-label="' + text(item.name + "使用对象") + '"' +
      (targets.length ? '' : ' disabled') + '>' + (options || '<option>无可用对象</option>') + '</select>' +
      '<button type="submit"' + (targets.length ? '' : ' disabled') + '>使用</button></form>';
  }).join("") : "";
  const traps = canAct(unit) ? unit.items.filter(item=>item.trap).map(item=>
    '<div class="use-potion"><span>' + carriedIcon(item,"⚙️") + text(item.name + " ×" + item.qty) +
    '</span><span>伤害 ' + text(item.trap.damage) + '</span><button type="button" data-place-trap="' +
    text(item.key ?? item.name) + '"' + (trapPlacementOptions(state,unit).length ? '' : ' disabled') + '>布设</button></div>').join("") : "";
  return potions || traps ? '<div class="battle-potions" aria-label="使用随身道具">' + potions + traps +
    '<small>使用道具会结束本轮行动。</small></div>' : "";
}

function updateUnitDetails() {
  $("unit-stat-details").hidden = true;
  const unit = byId(inspectedUnit);
  if (!unit) {
    $("unit-dialog").close();
    return;
  }
  $("unit-heading").textContent = unit.name;
  const level = $("unit-level");
  level.textContent = unit.level;
  level.title = "等级 " + unit.level;
  const monster = Boolean(unit.monster);
  const dialog = $("unit-dialog");
  const tabs = dialog.querySelector('[role="tablist"]');
  const subject = monster ? "怪物详情" : "人物详情";
  tabs.hidden = monster;
  const view = $("unit-view");
  const worldBook = $("unit-world-book");
  const monsterId = monster && (unit.monster.corpse?.monsterId ?? state.encounter?.monsterProfileId);
  worldBook.hidden = !monsterId;
  if (monsterId) {
    const url = new URL("../../",location.href);
    url.searchParams.set("monster",monsterId);
    worldBook.href = url.href;
  } else worldBook.removeAttribute("href");
  dialog.querySelector('button[type="submit"]').setAttribute("aria-label","关闭" + subject);
  if (monster) inspectedTab = "profile";
  view.setAttribute("role",monster ? "region" : "tabpanel");
  if (monster) view.setAttribute("aria-labelledby","unit-heading");
  for (const tab of tabs.querySelectorAll("[data-unit-tab]")) {
    const key = tab.dataset.unitTab;
    const active = key === inspectedTab;
    tab.setAttribute("aria-selected",String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && !monster) view.setAttribute("aria-labelledby",tab.id);
  }
  if (inspectedTab !== "equipment") hideEquipment();
  if (inspectedTab !== "profile" && frontier) document.dispatchEvent(new CustomEvent("battle-profile-panel"));
  if (inspectedTab === "profile") {
    showProfile(unit);
  } else if (inspectedTab === "attributes") {
    showAttributes(unit);
  } else if (inspectedTab === "dialogue") {
    showDialogue(unit);
  } else if (inspectedTab === "equipment") {
    showEquipment(unit);
  }
}

function showUnitDetails(id, tab = "profile") {
  inspectedUnit = id;
  inspectedTab = tab;
  inspectedTrigger = document.activeElement;
  updateUnitDetails();
  $("unit-dialog").showModal();
  $("unit-view").scrollTop = 0;
  $("unit-dialog").querySelector('.unit-tabs:not([hidden]) [aria-selected="true"], #unit-world-book:not([hidden])')?.focus();
}

function renderLog() {
  const now = Date.now();
  const entries = state.log.filter(entry=>entry.at<=now &&
    (moraleLogEnabled || entry.kind !== "morale" || !entry.text.includes("，士气 ")))
    .sort((a,b)=>a.at-b.at || a.id-b.id);
  const version = state.match + ":" + (entries.at(-1)?.id ?? 0) + ":" + (entries.length || state.phase);
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
    const participants = [detail?.actorId,detail?.targetId];
    const stance = stanceActions[event.kind];
    if (stance && detail?.actor) {
      return '<li class="stance-log">' + logLabels.format(detail.actor,participants) +
        '开始“<span class="log-action ' + event.kind + '">' + stance + '</span>”。</li>';
    }
    const actionType = event.kind === "skill" ? "技能" : event.kind === "item" ? "道具" : "";
    const summary = actionType && detail?.accuracy && detail.actor && detail.name ?
      detail.actor + (detail.target ? "对" + detail.target : "") + "使用了" + actionType + "「" + detail.name + "」" : event.text;
    if ((event.kind === "strike" || actionType) && detail?.accuracy) {
      const hit = detail.hit !== false;
      return '<li class="attack-log ' + (hit ? "hit" : "miss") + '">' +
        '<div class="attack-record"><span>' + logLabels.format(summary,participants) + '，</span>' +
        '<button type="button" class="attack-result" data-attack="' + event.id + '" aria-controls="attack-details" aria-expanded="false">' +
        strikeLabel(detail) + '</button>' + (hit ? '！' : '。') + '</div></li>';
    }
    return '<li class="' + (event.kind === "speech" ? "speech-log" : event.kind) + '">' +
      (event.speaker ? '<b>' + logLabels.format(event.speaker,participants) + '</b>　' : "") +
      logLabels.format(summary,participants) + (summary !== event.text ? "。" : "") + '</li>';
  }).join("") : state.phase === "setup" ? '<li>布阵完成后开始战斗。</li>' : "";
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
    ["优势地形",accuracy.terrainHit],["攻击者士气",accuracy.moraleHit],["天气" + (accuracy.weatherName ? "·" + accuracy.weatherName : ""),accuracy.weatherHit],
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
  if (activeDodge || accuracy.terrainDodge) dodgeLines.push([sumOfTerms([
    ["基础闪避",Math.max(0,rawDodge)],["主动闪避",activeDodge],["优势地形",accuracy.terrainDodge],
  ]),"合计闪避修正 " + accuracy.dodge + "%"]);
  const dodge = accuracy.dodgeLimit > accuracy.blockLimit ? subpanel("dodge",
    sumOfTerms([[accuracy.dodgeSource ?? "目标敏捷",attributeDodge],["目标士气",accuracy.moraleDodge]]) || "0%",
    (rawDodge<0 ? "修正合计 " + rawDodge : (activeDodge || accuracy.terrainDodge) ? "基础闪避 " + rawDodge : "合计闪避修正 " + accuracy.dodge) + "%",dodgeLines) : "";
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
    const expression = head ? "(" + components + ") × 爆头 " + damage.multiplier + " 倍（四舍五入）" : components;
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

function positionPointerTooltip(point,panel) {
  const gap = 16, margin = 10;
  const left = point.x+gap+panel.offsetWidth <= window.innerWidth-margin ? point.x+gap : point.x-panel.offsetWidth-gap;
  const top = point.y+gap+panel.offsetHeight <= window.innerHeight-margin ? point.y+gap : point.y-panel.offsetHeight-gap;
  panel.style.left = Math.max(margin,Math.min(left,window.innerWidth-panel.offsetWidth-margin)) + "px";
  panel.style.top = Math.max(margin,Math.min(top,window.innerHeight-panel.offsetHeight-margin)) + "px";
}

function closeReachDetails() {
  $("reach-details").hidden = true;
  reachAnchor = reachPoint = null;
}

function refreshAimedEnemy() {
  for (const entry of $("turn-order").children) {
    entry.classList.toggle("aim-target",entry.dataset.turnUnit === aimedEnemy);
  }
}

function setAimedEnemy(id) {
  if (aimedEnemy === id) return;
  aimedEnemy = id;
  refreshAimedEnemy();
}

function showReachDetails(anchor,point) {
  setAimedEnemy(anchor.dataset.card);
  reachAnchor = anchor;
  reachPoint = point;
  const panel = $("reach-details");
  const chance = state.hitChances[selected]?.[anchor.dataset.card];
  panel.classList.toggle("can-hit",chance !== undefined);
  panel.dataset.chanceTone = chance === undefined ? "" : chance < 40 ? "low" : chance < 70 ? "medium" : "high";
  panel.textContent = chance === undefined ? reachReason() : "命中率 " + chance + "%";
  panel.hidden = false;
  if (point) positionPointerTooltip(point,panel);
  else positionTooltip(anchor,panel);
}

const canAutoBattle = () => state.phase !== "setup" && state.phase !== "ended";

function reportToolbar() {
  if (!embedded) return;
  window.parent.postMessage({ type: "campfire-battle-toolbar", battleId, toolbar: {
    phase: state.phase,
    autoBattle: Boolean(state.autoBattle),
    canAutoBattle: canAutoBattle(),
    terrains: state.terrains.map(({ id, name }) => ({ id, name })),
    terrain: state.terrain.id,
    weather: state.weather.id,
    weatherName: state.weather.name,
    weatherEffect: $("weather-effect").textContent,
  } }, window.location.origin);
}

function reportFrontierResult(defeatChoice) {
  const result = battleSession.result();
  if (!result) return;
  if (defeatChoice && result.outcome === "defeat") {
    result.defeatChoice = defeatChoice;
  }
  window.parent.postMessage({type:"campfire-frontier-battle-finished",battleId,result},window.location.origin);
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
  const outdoorSky = String(!indoors && !document.body.dataset.lighting);
  if (layer.dataset.weather === weather && layer.dataset.outdoorSky === outdoorSky) return;
  layer.dataset.weather = weather;
  layer.dataset.outdoorSky = outdoorSky;
  layer.innerHTML = weatherParticles(weather).map(({left,top,delay}) =>
    '<i style="left:' + left + '%;top:' + top + '%;animation-delay:' + delay + 's"></i>'
  ).join("") + (outdoorSky === "true" ? weatherSkyMarkup(weather) : "");
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

const settlementLabels = {loot:"搜刮",recruit:"俘虏",execute:"处决",bury:"埋葬",discard:"丢弃",pickup:"携带"};
const settlementEntryTabs = {
  kills:{kind:"corpse",side:"enemy",empty:"暂无击杀"},
  prisoners:{kind:"prisoner",side:"enemy",empty:"暂无俘虏"},
  fallen:{kind:"corpse",side:"player",empty:"暂无牺牲"},
};
let settlementEntryTab = "prisoners";
let settlementItemTab = "loot";
const settlementFilters = {loot:"all",inventory:"all"};
const itemKinds = {weapons:["武器"],equipment:["头盔","护甲","盾牌"]};

function openAftermath() {
  if (state.phase !== "ended") return;
  if (opening) opening.hide();
  if ($("unit-dialog").open) $("unit-dialog").close();
  closeAttackDetails();
  closeReachDetails();
  clearTimeout(bubbleTimer);
  const sparring = state.encounter?.arena?.mode === "sparring";
  const defeated = state.winner !== "player" && state.endReason !== "withdrawal";
  $("battle-layout").hidden = true;
  $("victory-screen").hidden = false;
  $("victory-screen").dataset.spoils = String(Boolean(state.settlement));
  $("spoils-layout").hidden = !state.settlement;
  $("open-harvest-checks").hidden = !state.settlement;
  $("defeat-choices").hidden = sparring || !defeated;
  $("leave-battle").hidden = true;
  $("pause-aftermath").hidden = true;
  $("postbattle-reset").disabled = false;
  $("postbattle-reset").hidden = (!sparring && defeated) || Boolean(state.settlement);
  if (frontier) $("postbattle-reset").textContent = sparring ? "结束切磋" : state.encounter?.arena ? "返回城镇" : "返回冒险地图";
  $("defeat-reload-detail").textContent = frontier ? "读取本局最近的战前存档" : "重开这场战斗";
  setDefeatPending(false);
  $("victory-screen").style.setProperty("--victory-art",'url("./art/' + state.terrain.id + '.webp")');
  const bounty = state.winner === "player" && state.encounter?.arena?.bounty;
  const title = state.winner === "player" ? "战斗胜利" : defeated ? "我方战败" : "撤离战场";
  $("victory-title").textContent = sparring ? "切磋结束" : state.settlement ? "战后搜刮" : title;
  if (state.settlement) {
    if (frontier) {
      const battleLog = battleSession.result()?.battleLog;
      window.parent.postMessage({type:"campfire-battle-victory-log",battleId,battleLog},window.location.origin);
    }
    settlementFilters.loot = settlementFilters.inventory = "all";
    settlementEntryTab = "prisoners";
    settlementItemTab = state.settlement.left ? "inventory" : "loot";
    settlementSelection = null;
    renderVictory();
  }
  $("aftermath-bounty").hidden = !bounty;
  $("aftermath-bounty").textContent = bounty ? "赏金 " + bounty + " 克朗" : "";
  $("victory-title").focus();
}

function setDefeatPending(pending,message="") {
  const panel = $("defeat-choices");
  for (const choice of panel.querySelectorAll("[data-defeat-choice]")) choice.disabled = pending;
  panel.setAttribute("aria-busy",String(pending));
  const notice = $("defeat-error");
  notice.textContent = message;
  notice.hidden = !message;
}

function openBattleRecord() {
  const report = state.report ?? [];
  const highestOutput = report.length ? report[0].armor + report[0].hp : 0;
  $("report-rows").innerHTML = report.map((unit,index)=>{
    const output = unit.armor + unit.hp;
    const share = highestOutput > 0 ? output / highestOutput : 0;
    const participant = byId(unit.id) ?? state.fallen.find(entry=>entry.card.id === unit.id)?.card ??
      {...unit,portrait:unit.portrait ?? null};
    return '<tr' + (unit.fallen ? ' class="fallen"' : '') + '>' +
      '<td class="report-rank"><span>' + (index+1) + '</span></td>' +
      '<th scope="row" class="report-member"><div class="report-identity">' + cardPortrait(participant,"report-portrait") +
      '<span class="report-name">' + text(unit.name) + (unit.fallen ? '<small>阵亡</small>' : '') + '</span></div></th>' +
      '<td>' + unit.taken + '</td><td>' + unit.armor + '</td><td>' + unit.hp + '</td>' +
      '<td class="report-output"><strong>' + output + '</strong><span class="report-output-track" aria-hidden="true">' +
      '<span style="--output-share:' + share + '"></span></span></td></tr>';
  }).join("") || '<tr><td class="report-empty" colspan="6">暂无战斗数据</td></tr>';
  $("battle-report").scrollTop = 0;
  $("battle-record-dialog").showModal();
}

function canSettle(entry,command) {
  if (!entry) return false;
  if (command === "pickup" && entry.monster && !entry.body && !(entry.card.side === "enemy" && state.encounter?.corpse)) return false;
  return !settlementProblem(entry,command);
}

function inventoryItem(item) {
  return '<span class="item-copy"><strong>' + text(item.name) + '</strong><small>' + text(item.kind) +
    (item.max === undefined ? '' : ' · 耐久 ' + item.current + ' / ' + item.max) + '</small></span><b>×' + item.quantity + '</b>';
}

function renderSettlementItems() {
  const panel = settlementItemTab;
  const filter = settlementFilters[panel];
  const items = state.settlement[panel];
  const visibleItems = filter === "all" ? items : items.filter(item=>itemKinds[filter].includes(item.kind));
  const list = $("victory-items-list");
  const empty = $("spoils-empty");
  const collectable = panel === "loot";
  const harvest = state.settlement.harvestChecks ?? [];
  $("take-all").hidden = state.settlement.left || !collectable;
  $("take-all").disabled = !items.length;
  if (frontier) {
    const host = $("battle-spoils-mount");
    host.hidden = false;
    list.hidden = empty.hidden = true;
    $("spoils-fallback-filters").hidden = true;
    const {loot,inventory,left} = state.settlement;
    document.dispatchEvent(new CustomEvent("battle-spoils-panel",{detail:{
      host,panel,loot,collected:inventory.map(item=>({...item,returnKey:settlementItemKey(item)})),left,harvest:harvest.slice(),
      take:id=>send({type:"settle",command:"take",target:id}),
      putBack:key=>send({type:"settle",command:"return",target:key}),
    }}));
    return;
  }
  $("battle-harvest-mount").innerHTML = harvest.map(({target,tier,score,check,drops}) => {
    const gained = drops.map(({name,qty}) => text(name) + " ×" + qty).join("、");
    const roll = check ? '<span>1d' + check.sides + '（' + check.rolled + '） ' +
      (check.bonus < 0 ? '− ' : '+ ') + Math.abs(check.bonus) + ' = ' + score +
      (check.difficulty === undefined ? '' : '　难度 ' + check.difficulty) + '</span>' : '';
    return '<p class="harvest-fallback"><strong>屠宰' + text(tier ?? "") + '</strong><span>' +
      text(target) + ' · ' + (gained ? '取得 ' + gained : '无可收取的材料') + '</span>' + roll + '</p>';
  }).join("") || '<p class="harvest-fallback">暂无搜刮检定</p>';
  list.hidden = visibleItems.length === 0;
  empty.hidden = !list.hidden;
  empty.textContent = filter === "all" ? (collectable ? "暂无战利品" : "暂无队伍物资") :
    (filter === "weapons" ? "暂无武器" : "暂无装备");
  list.innerHTML = visibleItems.map(item=>{
    const content = inventoryItem(item);
    if (state.settlement.left) return '<li class="stored-item">' + content + '</li>';
    const action = collectable ? "收取" : "放回";
    const target = collectable ? 'data-take="' + item.id + '"' :
      'data-return-stack="' + text(settlementItemKey(item)) + '"';
    return '<li><button class="item-transfer" type="button" ' + target + ' aria-label="' + action + ' ' +
      text(item.name) + '">' + content + '<span class="transfer-label">' + action + '</span></button></li>';
  }).join("");
  for (const button of $("spoils-layout").querySelectorAll("[data-item-filter]")) {
    button.setAttribute("aria-pressed",String(button.dataset.itemFilter === filter));
  }
}

function positionSettlementActions() {
  const entries = $("victory-entries");
  const anchor = Array.from(entries.querySelectorAll("[data-spoils-card]")).find(card=>card.dataset.spoilsCard===settlementSelection);
  positionCardMenu($("victory-actions"),anchor,entries.getBoundingClientRect());
}

function renderVictory() {
  const {entries,left} = state.settlement;
  const focused = document.activeElement;
  const focusedUnit = focused?.dataset.settlementEntry;
  const focusedCommand = focused?.dataset.settlementCommand;
  $("leave-battle").hidden = left;
  $("pause-aftermath").hidden = left || !frontier;
  $("postbattle-reset").hidden = !left;
  $("process-all").disabled = left || !entries.some(pendingCorpseAction);
  const matches = tab => entries.filter(entry=>entry.kind === tab.kind && entry.card.side === tab.side &&
    !(entry.kind === "corpse" && entry.disposition));
  for (const button of $("spoils-layout").querySelectorAll("[data-entry-tab]")) {
    button.setAttribute("aria-pressed",String(button.dataset.entryTab === settlementEntryTab));
    button.querySelector("span").textContent = left ? "" : matches(settlementEntryTabs[button.dataset.entryTab]).length;
  }
  for (const button of $("spoils-layout").querySelectorAll("[data-spoils-tab]")) {
    button.setAttribute("aria-pressed",String(button.dataset.spoilsTab === settlementItemTab));
  }
  const tab = settlementEntryTabs[settlementEntryTab];
  const visible = left ? [] : matches(tab);
  if (!visible.some(entry=>entry.card.id===settlementSelection)) settlementSelection = null;
  const cards = visible.map(entry=>{
    const done = entry.looted || entry.disposition;
    const status = entry.looted ? "已搜刮" : entry.disposition ? "已" + settlementLabels[entry.disposition] :
      entry.kind === "prisoner" ? "待处置" : entry.monster ? "" : "待搜刮";
    return '<div class="spoils-card">' + renderCard(entry.card,undefined,entry) +
      (status ? '<span class="spoils-state' + (done ? ' done' : '') + '">' + status + '</span>' : "") + '</div>';
  }).join("");
  $("victory-entries").innerHTML = cards ? '<div class="victory-cards">' + cards + '</div>' :
    '<p class="spoils-empty">' + (left ? "已离开战场" : tab.empty) + '</p>';
  const entry = visible.find(item=>item.card.id===settlementSelection);
  const menu = $("victory-actions");
  if (entry) {
    menu.setAttribute("aria-label",entry.card.name + "的结算操作");
    const commands = entry.kind === "corpse" ? ["loot","pickup","bury","discard"] : ["loot","recruit","execute"];
    menu.innerHTML = commands.map(command=>'<button type="button" data-settlement-command="' + command + '"' +
      (canSettle(entry,command) ? '' : ' disabled') + '>' +
      settlementLabels[command] + '</button>').join("");
  } else {
    menu.setAttribute("aria-label","人物结算操作");
    menu.innerHTML = "";
  }
  positionSettlementActions();
  renderSettlementItems();
  const cardButton = $("victory-entries").querySelector('.card-select[data-settlement-entry="' + (focusedUnit || settlementSelection) + '"]');
  if (focusedCommand) {
    const commandButton = menu.querySelector('[data-settlement-command="' + focusedCommand + '"]:enabled');
    (commandButton ?? cardButton)?.focus({preventScroll:true});
  } else if (focusedUnit) cardButton?.focus({preventScroll:true});
}

function requestLeave() {
  const {entries,loot} = state.settlement;
  const pending = entries.filter(entry=>entry.items.length && pendingCorpseAction(entry) === "loot").length;
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
    return '<li class="' + unit.side + (current ? ' current" aria-current="step' : "") + '" data-turn-unit="' + text(unit.id) + '" title="' +
      text(unit.name + " · 先攻 " + unit.initiative) + '"><span class="turn-avatar">' + cardPortrait(unit) + '</span>' +
      '<span>' + text(unit.name) + '</span></li>';
  }).join("");
  refreshAimedEnemy();
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
      bar.outerHTML = meter(kind,label,Math.max(0,prior.current - loss),prior.max,hit.target);
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
  blood.show(target,hit.hpLoss,bloodAppearanceDelay);
  const missed = hit.hit === false;
  if (departedPoint && !hit.arenaWithdrawn) showCasualty(departedPoint,hit);
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
    setAimedEnemy();
    closeReachDetails();
    return send({type:"attack",actor:selected,target:id});
  }
  if (state.phase === "reinforcement" && state.reinforcements.units.includes(id)) {
    reinforcementUnit = reinforcementUnit === id ? null : id;
    return render();
  }
  if (id === state.order[0] && canAct(unit)) return toggleActionMenu(id);
  if (state.phase !== "setup") return showUnitDetails(id);
  selected = id;
  aiming = false;
  moving = false;
  setNotice();
  render();
  showUnitDetails(id);
}

document.addEventListener("click",(event) => {
  const button = event.target.closest("button");
  if (actionMenuActor && !event.target.closest("#unit-actions,[aria-controls='unit-actions']")) toggleActionMenu();
  if (settlementSelection && !$("spoils-layout").hidden &&
    !event.target.closest("#victory-actions,[data-settlement-entry],#pause-aftermath")) {
    settlementSelection = null;
    renderVictory();
  }
  if (button?.dataset.attack) {
    showAttackDetails(button);
    if (event.detail === 0) $("attack-details").querySelector('button[data-roll-section="hit"]')?.focus();
    return;
  }
  if ($("attack-details").contains(event.target)) return;
  closeAttackDetails();
  if (!button || !state) return;
  if (frontier && state.phase === "setup" && button.hasAttribute("data-prepare-encounter")) {
    window.parent.postMessage({type:"campfire-battle-prepare",battleId},window.location.origin);
    return;
  }
  if (frontier && state.phase === "setup" && button.id === "tame-encounter" && !button.disabled) {
    button.disabled = true;
    window.parent.postMessage({type:"campfire-monster-tame",battleId},window.location.origin);
    return;
  }
  if (frontier && button.id === "postbattle-reset") {
    button.disabled = true;
    return reportFrontierResult();
  }
  if (button.id === "open-rules") return openRules();
  if (button.id === "open-battle-record") return openBattleRecord();
  if (button.id === "open-harvest-checks" && state.settlement) {
    $("harvest-checks-list").scrollTop = 0;
    $("harvest-checks-dialog").showModal();
    return;
  }
  if (button.dataset.defeatChoice && !button.disabled && !$("defeat-choices").hidden) {
    if (!frontier) return send({type:"reset"});
    setDefeatPending(true,button.dataset.defeatChoice === "reload" ? "正在读取存档…" : "正在继续冒险…");
    return reportFrontierResult(button.dataset.defeatChoice);
  }
  if (button.dataset.entryTab) {
    settlementEntryTab = button.dataset.entryTab;
    settlementSelection = null;
    $("victory-entries").scrollTop = 0;
    return renderVictory();
  }
  if (button.dataset.spoilsTab) {
    settlementItemTab = button.dataset.spoilsTab;
    $("victory-items").scrollTop = 0;
    return renderVictory();
  }
  if (button.dataset.itemFilter) {
    settlementFilters[settlementItemTab] = button.dataset.itemFilter;
    $("victory-items").scrollTop = 0;
    return renderSettlementItems();
  }
  if (button.id === "leave-battle" && !sending) return requestLeave();
  if (button.id === "pause-aftermath" && frontier && !sending && !state.settlement?.left) {
    return window.parent.postMessage({type:"campfire-battle-pause-aftermath",battleId},window.location.origin);
  }
  if (button.id === "confirm-leave") {
    $("leave-dialog").close();
    return send({type:"settle",command:"leave"});
  }
  if (button.id === "take-all") return send({type:"settle",command:"take",all:true});
  if (button.dataset.take) return send({type:"settle",command:"take",target:Number(button.dataset.take)});
  if (button.dataset.returnStack) return send({type:"settle",command:"return",target:button.dataset.returnStack});
  if (button.dataset.settlementEntry) {
    if (sending) return;
    const target = button.dataset.settlementEntry;
    settlementSelection = settlementSelection === target ? null : target;
    return renderVictory();
  }
  if (button.dataset.settlementCommand) {
    const command = button.dataset.settlementCommand;
    if (command === "execute") {
      const menu = $("victory-actions");
      menu.innerHTML = '<form class="settlement-description"><textarea name="description" rows="2" maxlength="600" required aria-label="处决方式" placeholder="写下处决方式"></textarea><button type="submit">提交</button></form>';
      positionSettlementActions();
      menu.querySelector("textarea").focus();
      return;
    }
    return send({type:"settle",command,target:settlementSelection});
  }
  if (button.dataset.details) return showUnitDetails(button.dataset.details);
  if (button.hasAttribute("data-current-details") && actionMenuActor) {
    const unitId = actionMenuActor;
    toggleActionMenu();
    return showUnitDetails(unitId);
  }
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
  if (button.hasAttribute("data-trap-column") && trapPlacement && canAct(byId(trapPlacement.actor))) {
    const {fieldSide,fieldRow} = button.closest("[data-field-side]").dataset;
    const {actor,item} = trapPlacement;
    trapPlacement = undefined;
    return send({type:"placeTrap",actor,item,fieldSide,row:fieldRow,column:Number(button.dataset.trapColumn)});
  }
  if (button.dataset.deploy) {
    return send({type:"deploy",actor:selected,row:button.dataset.deploy});
  }
  if (button.hasAttribute("data-start")) return send({type:"start"});
  if (button.hasAttribute("data-reset")) return send({type:"reset"});
  if (button.hasAttribute("data-retreat") && canAct(byId(selected))) return send({type:"retreat",actor:selected});
  if (button.hasAttribute("data-skill")) return setNotice(byId(selected).name + "暂无可用技能。");
  if (button.hasAttribute("data-items")) return showUnitDetails(selected,"equipment");
  if ((button.hasAttribute("data-defend") || button.hasAttribute("data-dodge")) && canAct(byId(selected))) {
    trapPlacement = undefined;
    aiming = false;
    moving = false;
    return send({type:button.hasAttribute("data-dodge") ? "dodge" : "defend",actor:selected});
  }
  if (button.hasAttribute("data-aim") && canAct(byId(selected))) {
    trapPlacement = undefined;
    aiming = !aiming;
    moving = false;
    setNotice(aiming && !state.attackTargets[selected].length ? reachReason() : "");
    render();
  }
  if (button.hasAttribute("data-move") && canAct(byId(selected))) {
    trapPlacement = undefined;
    moving = !moving;
    aiming = false;
    setNotice(moving ? "选择空格移动，进入敌方近战的控制区即停。" : "");
    render();
  }
});
$("board").addEventListener("pointermove",(event) => {
  const card = event.target.closest(".out-of-range,.target");
  pointer = {x:event.clientX,y:event.clientY,target:card?.dataset.card ?? event.target.closest("[data-unit]")?.dataset.unit};
  drawArrow();
  if (card) showReachDetails(card,pointer);
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
  hideEquipment();
  if (frontier) document.dispatchEvent(new CustomEvent("battle-profile-panel"));
  $("unit-stat-details").hidden = true;
  const fallback = () => document.querySelector('[data-details="' + inspectedUnit + '"],[data-card="' +
    inspectedUnit + '"] .card-select');
  (inspectedTrigger?.getClientRects().length ? inspectedTrigger : fallback())?.focus();
});
for (const type of ["pointerover","focusin"]) {
  $("unit-view").addEventListener(type,event=>{
    const anchor = event.composedPath().find(node=>node.matches?.("[data-unit-stat]"));
    if (anchor) showUnitStatDetails(anchor);
  });
}
for (const type of ["pointerout","focusout"]) {
  $("unit-view").addEventListener(type,event=>{
    const anchor = event.composedPath().find(node=>node.matches?.("[data-unit-stat]"));
    if (anchor && !anchor.contains(event.relatedTarget)) $("unit-stat-details").hidden = true;
  });
}
$("unit-view").addEventListener("scroll",()=>{$("unit-stat-details").hidden = true;},{passive:true});
$("victory-actions").addEventListener("submit",event => {
  const form = event.target.closest(".settlement-description");
  if (!form || !settlementSelection) return;
  event.preventDefault();
  const description = String(new FormData(form).get("description") ?? "").trim();
  if (description) void send({type:"settle",command:"execute",target:settlementSelection,description});
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
  const trapButton = event.target.closest("button[data-place-trap]");
  if (trapButton && canAct(unit) && trapPlacementOptions(state,unit).length) {
    trapPlacement = {actor:unit.id,item:trapButton.dataset.placeTrap};
    selected = unit.id;
    aiming = moving = false;
    $("unit-dialog").close();
    setNotice("选择相邻空格布设陷阱，按 Esc 取消。");
    render();
    return;
  }
  if (unit && event.target.closest("button[data-portrait-view]")) {
    void portraitViewer.open(unit,unitPortraitSource(unit));
    return;
  }
});
$("unit-dialog").querySelector('[role="tablist"]').addEventListener("keydown",(event) => {
  if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]:not(:disabled):not([hidden])'));
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
    if (card) showReachDetails(card,type === "pointerover" ? {x:event.clientX,y:event.clientY} : undefined);
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
  if (event.key === "Escape" && trapPlacement && !$("unit-dialog").open) {
    trapPlacement = undefined;
    setNotice();
    render();
    return;
  }
  if (event.key === "Escape" && !$("unit-dialog").open && !$("battle-record-dialog").open) {
    if (battleOptions.open) {
      battleOptions.open = false;
      battleOptions.querySelector("summary").focus();
      return;
    }
    if (actionMenuActor && !aiming && !moving) {
      toggleActionMenu();
      $("ranks").querySelector('[aria-controls="unit-actions"]')?.focus();
      return;
    }
    if (settlementSelection && !$("spoils-layout").hidden && !$("leave-dialog").open) {
      const previous = settlementSelection;
      settlementSelection = null;
      renderVictory();
      Array.from($("victory-entries").querySelectorAll("[data-settlement-entry]"))
        .find(button=>button.dataset.settlementEntry===previous)?.focus();
      return;
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
  $("unit-stat-details").hidden = true;
  if (state && $("victory-screen").hidden) {
    closeAttackDetails(); closeReachDetails(); positionActionMenu(); drawArrow(); showSpeech();
  }
  if (settlementSelection && !$("spoils-layout").hidden) positionSettlementActions();
});
$("victory-entries").addEventListener("scroll",positionSettlementActions,{passive:true});
window.addEventListener("scroll",() => {
  if (!state || !$("victory-screen").hidden) return;
  refreshAttackDetailsPosition();
  if (reachAnchor) {
    const rect = reachAnchor.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) {
      if (reachPoint) positionPointerTooltip(reachPoint,$("reach-details"));
      else positionTooltip(reachAnchor,$("reach-details"));
    }
    else closeReachDetails();
  }
  positionActionMenu();
},{passive:true});
if (frontier) window.addEventListener("message",function loadEncounter(event) {
  if (event.origin !== location.origin || event.source !== window.parent ||
      event.data?.type !== "campfire-battle" || !event.data.player) return;
  window.removeEventListener("message",loadEncounter);
  battleId = event.data.battleId;
  partyIds = new Set(["pc",...(event.data.partyMemberIds ?? []).map(id=>"ally-" + encodeURIComponent(id))]);
  formationKey = event.data.formationKey;
  const lighting = event.data.lighting;
  if (lighting === "lit" || lighting === "unlit") document.body.dataset.lighting = lighting;
  sync();
});
if (frontier) window.addEventListener("message",event=>{
  if (event.origin !== location.origin || event.source !== window.parent ||
      event.data?.battleId !== battleId || !state) return;
  if (event.data.type === "campfire-monster-tame-result" && state.phase === "setup") {
    const status = $("tame-encounter-result");
    status.textContent = event.data.message;
    status.hidden = false;
    const offer = state.encounter?.taming;
    if (offer) offer.blocked = event.data.blocked;
    const button = $("tame-encounter");
    button.disabled = Boolean(event.data.blocked);
    if (event.data.blocked) button.title = event.data.blocked;
    return;
  }
  if (event.data.type === "campfire-battle-toggle-auto") {
    if (canAutoBattle()) send({type:"autoBattle",enabled:!state.autoBattle});
    return;
  }
  if (event.data.type === "campfire-battle-resume-aftermath" && !$("spoils-layout").hidden) {
    positionSettlementActions();
    $("pause-aftermath").focus({preventScroll:true});
    return;
  }
  if (event.data.type === "campfire-frontier-defeat-error" && !$("defeat-choices").hidden) {
    setDefeatPending(false,event.data.message || "读档失败。");
    return;
  }
  if (event.data.type !== "campfire-battle-portraits") return;
  portraitUpdates = event.data.portraits;
  orderVersion = undefined;
  render();
});
else sync();
