const preferenceKey = "battle-blood-muted";
const bloodLevels = [
  {minimum:1, count:4, pools:0, spread:.16, size:4},
  {minimum:5, count:9, pools:1, spread:.25, size:8},
  {minimum:13,count:17,pools:2, spread:.36, size:13},
  {minimum:25,count:28,pools:3, spread:.49, size:20},
  {minimum:40,count:45,pools:5, spread:.66, size:28},
];

export function createBloodEffects(button,effects) {
  let enabled = true;
  try { enabled = localStorage.getItem(preferenceKey) !== "1"; } catch {}

  function updateButton() {
    button.setAttribute("aria-checked",String(enabled));
  }

  updateButton();
  button.hidden = false;
  button.addEventListener("click",() => {
    enabled = !enabled;
    try { localStorage.setItem(preferenceKey,enabled ? "0" : "1"); } catch {}
    updateButton();
    if (!enabled) effects.querySelectorAll(".blood-spatter").forEach(stain=>stain.remove());
  });

  function show(point,amount,delay = 0) {
    if (!enabled || !point?.width || !point.height || !(amount > 0)) return;
    const level = bloodLevels.findLast(entry=>amount >= entry.minimum);
    if (!level) return;
    const {count,pools,spread,size} = level;
    const spray = document.createElement("div");
    spray.className = "blood-spatter";
    spray.dataset.bloodLevel = String(bloodLevels.indexOf(level) + 1);
    spray.style.animationDelay = delay + "ms";
    const direction = Math.random()*2*Math.PI;
    for (let index = 0; index < count; index++) {
      const pool = index < pools;
      const angle = direction + (index < count*.7 ? (Math.random()-.5)*(1.1 + spread) : Math.random()*2*Math.PI);
      const reach = (pool ? .52 : .74) + Math.random()*(.27 + spread);
      const x = point.x + Math.cos(angle)*point.width/2*reach;
      const y = point.y + Math.sin(angle)*point.height/2*reach;
      const width = pool ? size*(.6 + Math.random()*.75) : 1.5 + Math.random()**2*size;
      const droplet = document.createElement("i");
      if (pool) droplet.className = "blood-pool";
      Object.assign(droplet.style,{
        left:x+"px",top:y+"px",width:width+"px",height:width*(.38+Math.random()*.54)+"px",
        transform:"translate(-50%,-50%) rotate("+angle+"rad)",
      });
      spray.append(droplet);
    }
    effects.append(spray);
  }

  return {show};
}
