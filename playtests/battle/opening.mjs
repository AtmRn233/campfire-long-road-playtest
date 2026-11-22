import { formationCapacity, formationColumns, standardFormation, validFormation } from "./battle.mjs";
import { strongestUnit } from "./morale.mjs";

const rows = [["front","前排"],["back","后排"],["reserve","预备队"]];
const laneNames = ["左翼","左侧","中路","右侧","右翼"];
const reserveColumns = 5;
const $ = id => document.getElementById(id);

export function createOpeningScreen({text,renderCard,send}) {
  const screen = $("encounter-screen");
  const editor = $("formation-dialog");
  const choice = $("encounter-choice");
  const board = $("formation-rows");
  const widthControl = $("formation-widths");
  const note = $("formation-note");
  let state;
  let storageKey;
  let presets = {};
  let enemyPresets = {};
  let side = "player";
  let drafts;
  let width;
  let selected;
  let dragging;

  const actualWidth = () => state.fieldColumns.length;
  const activePresets = () => side === "enemy" ? enemyPresets : presets;

  function readPresets(key) {
    try { return JSON.parse(localStorage.getItem(key)) ?? {}; }
    catch { return {}; }
  }

  function load(next,key) {
    state = next;
    if (screen.hidden) {
      storageKey = "campfire.formation." + key;
      presets = readPresets(storageKey);
      enemyPresets = state.enemyFormationEnabled ? readPresets(storageKey+"-enemy") : {};
      $("open-enemy-formation").hidden = !state.enemyFormationEnabled;
      $("prepare-enemy-encounter").hidden = !state.enemyFormationEnabled;
      screen.style.setProperty("--encounter-art",'url("./art/' + state.terrain.id + '.webp")');
      screen.hidden = false;
    }
    updateSummary();
  }

  function plannedLeader(side) {
    const preset = (side === "enemy" ? enemyPresets : presets)[actualWidth()];
    const team = state.units.filter(unit=>unit.side===side && unit.hp>0);
    if (!validFormation(state,actualWidth(),preset,side)) return team.find(unit=>unit.leader);
    const fielded = new Set([...preset.front,...preset.back]);
    return strongestUnit(team.filter(unit=>fielded.has(unit.id)));
  }

  function updateSummary() {
    for (const [side,id] of [["player","encounter-friendly"],["enemy","encounter-hostile"]]) {
      const leader = plannedLeader(side);
      $(id).innerHTML = state.units.filter(unit=>unit.side===side)
        .map(unit=>renderCard({...unit,leader:unit === leader})).join("");
    }
    $("encounter-plan").textContent = actualWidth() + " 路 · " +
      (validFormation(state,actualWidth(),presets[actualWidth()]) ? "已保存阵型" : "默认阵型");
    if (state.enemyFormationEnabled) {
      $("open-enemy-formation").textContent = validFormation(state,actualWidth(),enemyPresets[actualWidth()],"enemy")
        ? "敌方布阵（已保存）" : "敌方布阵（测试）";
    }
  }

  function changeSelection(id) {
    selected = id;
    for (const button of board.querySelectorAll("button[data-opening-row]")) {
      const own = Boolean(id && button.dataset.openingId === id);
      if (button.dataset.openingId) {
        button.setAttribute("aria-pressed",String(own));
        button.closest(".card").classList.toggle("selected",own);
      }
      button.toggleAttribute("data-destination",Boolean(id && !own));
    }
    note.hidden = true;
  }

  function renderSlot(row,label,index,id) {
    const unit = state.units.find(unit=>unit.id===id);
    if (unit) return renderCard(unit,{row,index,label});
    return '<button class="formation-slot formation-empty" type="button" data-opening-row="' + row +
      '" data-opening-index="' + index + '" aria-label="' + text(label + " · 空位") +
      '"><span aria-hidden="true">＋</span>空位</button>';
  }

  function paintEditor() {
    const plan = drafts[width];
    const columns = formationColumns(width);
    const lanes = state.lanes;
    board.innerHTML = '<div class="formation-rank formation-lane-labels" aria-hidden="true"><span></span>' +
      lanes.map(lane=>'<span>' + laneNames[lane+2] + '</span>').join("") + '</div>' +
      rows.map(([row,label]) => {
        const reserve = row === "reserve";
        const capacity = formationCapacity(state,width,row);
        const filled = plan[row].filter(Boolean).length;
        const reserveCount = reserve ? reserveColumns * Math.max(
          Math.ceil((plan[row].findLastIndex(Boolean) + 1) / reserveColumns),
          Math.floor(filled / reserveColumns) + 1,
        ) : 0;
        const slots = reserve ? Array.from({length:reserveCount},(_,index) =>
          renderSlot(row,label + " " + (index+1) + "号位",index,plan[row][index])) : lanes.map(lane => {
          const index = columns.indexOf(lane);
          return index >= 0 && index < capacity ? renderSlot(row,label + " " + laneNames[lane+2],index,plan[row][index]) :
            '<span class="formation-blocked" aria-label="此处不可布阵">—</span>';
        });
        const content = reserve ? '<div class="formation-reserve-slots">' + slots.join("") + '</div>' : slots.join("");
        return '<section class="formation-rank' + (reserve ? ' formation-reserve' : '') + '"><h3>' + label +
          '<small>' + filled + (reserve ? ' 人' : ' / ' + capacity) + '</small></h3>' + content + '</section>';
      }).join("");
    changeSelection();
  }

  function chooseWidth(value) {
    width = value;
    if (!drafts[width]) {
      const saved = activePresets()[width];
      drafts[width] = validFormation(state,width,saved,side) ? structuredClone(saved) : standardFormation(state,width,side);
    }
    for (const button of widthControl.querySelectorAll("button")) {
      button.setAttribute("aria-pressed",String(Number(button.dataset.openingWidth) === width));
    }
    paintEditor();
  }

  function place(row,index) {
    const plan = drafts[width];
    const from = rows.find(([name])=>plan[name].includes(selected))?.[0];
    if (!from) return;
    const origin = plan[from].indexOf(selected);
    const other = plan[row][index];
    if (from === row && origin === index) return;
    if (row === "reserve" && from !== "reserve" && !other && [...plan.front,...plan.back].filter(Boolean).length === 1) {
      note.hidden = false;
      return;
    }
    if (other) plan[from][origin] = other;
    else plan[from][origin] = null;
    while (plan[row].length < index) plan[row].push(null);
    const placed = selected;
    plan[row][index] = placed;
    paintEditor();
    board.querySelector('[data-opening-id="' + CSS.escape(placed) + '"]')?.focus();
  }

  function openEditor(team) {
    side = team;
    $("formation-title").textContent = side === "enemy" ? "敌方布阵" : "布阵";
    drafts = {};
    const widths = Array.from({length:state.lanes.length - 1},(_,index)=>index + 2);
    if (actualWidth() < 2) widths.unshift(actualWidth());
    widthControl.innerHTML = widths.map(value=>'<button class="quiet" type="button" data-opening-width="' +
      value + '"' + (value === actualWidth() ? ' data-current-map' : '') + '>' + value + ' 路' +
      (value === actualWidth() ? ' <small>本场</small>' : '') + '</button>').join("");
    chooseWidth(actualWidth());
    editor.showModal();
  }
  $("open-formation").onclick = () => openEditor("player");
  $("open-enemy-formation").onclick = () => openEditor("enemy");
  widthControl.addEventListener("click",event => {
    const button = event.target.closest("button[data-opening-width]");
    if (button && Number(button.dataset.openingWidth) !== width) chooseWidth(Number(button.dataset.openingWidth));
  });
  board.addEventListener("click",event => {
    const button = event.target.closest("button[data-opening-row]");
    if (!button) return;
    const {openingId,openingRow,openingIndex} = button.dataset;
    if (!selected || selected === openingId) changeSelection(selected === openingId ? undefined : openingId);
    else place(openingRow,Number(openingIndex));
  });
  editor.addEventListener("cancel",event => {
    if (!selected) return;
    event.preventDefault();
    changeSelection();
  });
  board.addEventListener("dragstart",event => {
    const origin = event.target.closest("[data-opening-id]");
    if (!origin) return;
    event.dataTransfer.setData("text/plain",origin.dataset.openingId);
    event.dataTransfer.effectAllowed = "move";
    dragging = true;
    changeSelection(origin.dataset.openingId);
  });
  board.addEventListener("dragover",event => {
    if (!dragging || !event.target.closest("[data-destination]")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  board.addEventListener("drop",event => {
    const target = event.target.closest("[data-destination]");
    if (!dragging || !target) return;
    event.preventDefault();
    dragging = false;
    place(target.dataset.openingRow,Number(target.dataset.openingIndex));
  });
  board.addEventListener("dragend",() => {
    if (dragging) changeSelection();
    dragging = false;
  });
  $("save-formation").onclick = () => {
    Object.assign(activePresets(),drafts);
    try {
      localStorage.setItem(storageKey+(side === "enemy" ? "-enemy" : ""),JSON.stringify(activePresets()));
    } catch {
      $("encounter-plan").title = "无法写入浏览器存储，阵型仍可用于本场。";
    }
    updateSummary();
    editor.close();
  };

  $("open-parley").onclick = () => {
    const lead = plannedLeader("player") ?? state.units.find(unit=>unit.side==="player");
    const opponent = plannedLeader("enemy") ?? state.units.find(unit=>unit.side==="enemy");
    $("encounter-choice-title").textContent = "阵前对话";
    $("encounter-choice-body").innerHTML = '<p><strong>' + text(lead.name) +
      '</strong>　我们无意交战。能让条路吗？</p><p><strong>' + text(opponent.name) +
      '</strong>　收起兵器退回去。再往前，就是开战。</p>';
    $("confirm-encounter-surrender").hidden = true;
    choice.showModal();
  };
  $("open-surrender").onclick = () => {
    $("encounter-choice-title").textContent = "确认投降？";
    $("encounter-choice-body").innerHTML = "<p>本次遭遇将以战败结束。</p>";
    $("confirm-encounter-surrender").hidden = false;
    choice.showModal();
  };
  $("confirm-encounter-surrender").onclick = () => {
    choice.close();
    send({type:"encounterExit",decision:"surrender"});
  };
  $("withdraw-encounter").onclick = () => send({type:"encounterExit",decision:"retreat"});
  $("start-encounter").onclick = () => {
    const preset = presets[actualWidth()];
    const enemy = enemyPresets[actualWidth()];
    send({type:"start",
      ...(validFormation(state,actualWidth(),preset) ? {formation:preset} : {}),
      ...(state.enemyFormationEnabled && validFormation(state,actualWidth(),enemy,"enemy") ? {enemyFormation:enemy} : {}),
    });
  };
  return {load,hide:()=>{screen.hidden = true;}};
}
