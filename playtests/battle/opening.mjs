import { formationCapacity, formationColumns, standardFormation, validFormation } from "./battle.mjs";

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
  let drafts;
  let width;
  let selected;
  let dragging;

  const actualWidth = () => state.fieldColumns.length;
  const canStart = battle => !battle.encounter || battle.units.some(unit=>unit.side==="enemy" && unit.hp>0 && !unit.noncombatant);

  function readPresets(key) {
    try { return JSON.parse(localStorage.getItem(key)) ?? {}; }
    catch { return {}; }
  }

  function load(next,key) {
    state = next;
    const firstLoad = screen.hidden;
    const {encounter} = state;
    const wildMonster = encounter?.wildMonster === true;
    const arena = encounter?.arena;
    if (firstLoad) {
      storageKey = "campfire.formation." + key;
      presets = readPresets(storageKey);
      screen.style.setProperty("--encounter-art",'url("./art/' + state.terrain.id + '.webp")');
      const opponent = wildMonster ? "怪物" : (encounter?.name ?? "敌军");
      const sparring = arena?.mode === "sparring";
      const peaceful = encounter?.hostile === false;
      $("encounter-title").textContent = sparring || arena?.mode === "training" ? encounter.name : arena ? "竞技场 · " + encounter.name : "遭遇" + opponent;
      $("encounter-hostile-title").textContent = arena ? "对手" : peaceful ? "对方" : "敌方";
      $("withdraw-encounter").textContent = sparring ? "取消切磋" : peaceful ? "离开" : "撤退";
      $("start-encounter").textContent = sparring ? "开始切磋" : peaceful ? "强制攻击" : "开始战斗";
      $("open-parley").hidden = wildMonster || Boolean(arena);
      $("prepare-encounter").hidden = sparring || arena?.mode === "training";
      screen.hidden = false;
    }
    updateSummary();
    if (firstLoad && encounter?.openParley && encounter.hostile === false) openParley();
  }

  function updateSummary() {
    const start = $("start-encounter");
    start.disabled = !canStart(state);
    if (start.disabled) start.title = "对方没有战斗人员";
    else start.removeAttribute("title");
    for (const [side,id] of [["player","encounter-friendly"],["enemy","encounter-hostile"]]) {
      $(id).innerHTML = state.units.filter(unit=>unit.side===side)
        .map(unit=>renderCard(unit)).join("");
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
      const saved = presets[width];
      drafts[width] = validFormation(state,width,saved) ? structuredClone(saved) : standardFormation(state,width);
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

  function openEditor() {
    drafts = {};
    const widths = Array.from({length:state.lanes.length - 1},(_,index)=>index + 2);
    if (actualWidth() < 2) widths.unshift(actualWidth());
    widthControl.innerHTML = widths.map(value=>'<button class="quiet" type="button" data-opening-width="' +
      value + '"' + (value === actualWidth() ? ' data-current-map' : '') + '>' + value + ' 路' +
      (value === actualWidth() ? ' <small>本场</small>' : '') + '</button>').join("");
    chooseWidth(actualWidth());
    editor.showModal();
  }
  $("open-formation").onclick = openEditor;
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
    Object.assign(presets,drafts);
    try {
      localStorage.setItem(storageKey,JSON.stringify(presets));
      $("open-formation").removeAttribute("title");
    } catch {
      $("open-formation").title = "无法写入浏览器存储，阵型仍可用于本场。";
    }
    updateSummary();
    editor.close();
  };

  function openParley() {
    if (!state || $("open-parley").hidden || choice.open) return;
    const speaker = state.units.find(unit=>unit.id==="pc" && unit.side==="player") ?? state.units.find(unit=>unit.side==="player");
    const opponent = state.units.find(unit=>unit.side==="enemy");
    $("encounter-choice-title").textContent = "阵前对话";
    $("encounter-choice-body").innerHTML = '<p><strong>' + text(speaker.name) +
      (state.encounter?.hostile === false ? '</strong>　打扰了。你们要去哪里？</p><p><strong>' :
        '</strong>　我们无意交战。能让条路吗？</p><p><strong>') + text(opponent.name) +
      (state.encounter?.hostile === false ? '</strong>　你好。我们只是在这条路上遇见了。</p>' :
        '</strong>　收起兵器退回去。再往前，就是开战。</p>');
    choice.showModal();
  }
  $("open-parley").onclick = openParley;
  $("withdraw-encounter").onclick = () => send({type:"encounterExit",decision:"retreat"});
  $("start-encounter").onclick = () => {
    if (!state || !canStart(state)) return;
    const preset = presets[actualWidth()];
    if (editor.open) editor.close();
    if (choice.open) choice.close();
    send({type:"start",
      ...(validFormation(state,actualWidth(),preset) ? {formation:preset} : {}),
    });
  };
  return {load,hide:()=>{screen.hidden = true;}};
}
