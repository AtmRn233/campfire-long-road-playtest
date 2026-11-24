const faceRatio = 2/3;
const minimumScale = .18;
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const automaticFace = {x:.5,y:.18,scale:.36};
const kneesFace = {x:.5,y:.125,scale:.23};

export function moveCrop(crop, dx, dy) {
  return {...crop,x:clamp(crop.x+dx,0,1-crop.width),y:clamp(crop.y+dy,0,1-crop.height)};
}

export function resizeCropEdge(crop, edge, dx, dy) {
  const horizontal = edge === "left" || edge === "right";
  const delta = horizontal ? dx / crop.width : dy / crop.height;
  const fixed = edge === "left" ? crop.x + crop.width : edge === "right" ? crop.x :
    edge === "top" ? crop.y + crop.height : crop.y;
  const center = horizontal ? crop.y + crop.height / 2 : crop.x + crop.width / 2;
  const maxAlong = (edge === "left" || edge === "top" ? fixed : 1 - fixed) / (horizontal ? crop.width : crop.height);
  const maxAcross = 2 * Math.min(center,1-center) / (horizontal ? crop.height : crop.width);
  const factor = clamp(1 + (edge === "left" || edge === "top" ? -delta : delta),
    minimumScale / crop.scale,Math.min(maxAlong,maxAcross,1 / crop.scale));
  const width = crop.width * factor, height = crop.height * factor;
  return {width,height,scale:crop.scale * factor,
    x:horizontal ? fixed - (edge === "left" ? width : 0) : center - width / 2,
    y:horizontal ? center - height / 2 : fixed - (edge === "top" ? height : 0)};
}

export function cropRectangle(width, height, {x,y,scale}) {
  scale = clamp(scale,minimumScale,1);
  const cropWidth = Math.min(width,height*faceRatio)*scale;
  const w = cropWidth/width;
  const h = cropWidth/(faceRatio*height);
  return moveCrop({x:x-w/2,y:y-h/2,width:w,height:h,scale},0,0);
}

export function portraitBackground({columns,rows,column,row}, crop) {
  const {x,y,width,height} = crop;
  return {
    size:[100*columns/width,100*rows/height],
    position:[width === columns ? 0 : 100*(column+x)/(columns-width),
      height === rows ? 0 : 100*(row+y)/(rows-height)],
  };
}

export function portraitSource(unit, fallback, artPath = "./art/") {
  const fullImage = url => ({url,columns:1,rows:1,column:0,row:0,
    defaultCrop:cropRectangle(2,3,unit.portraitFraming === "knees" ? kneesFace : automaticFace)});
  if (unit.profilePortrait) return {...fullImage(unit.profilePortrait),revision:unit.portraitVersion};
  if (unit.portraitSprite) {
    const {atlas,column,row,face} = unit.portraitSprite;
    const defaultCrop = cropRectangle(2,3,face ? {x:face[0],y:face[1],scale:face[2]} : automaticFace);
    return {url:artPath+"test-portraits-"+atlas+".png",columns:3,rows:2,column,row,defaultCrop};
  }
  return fallback ? fullImage(fallback) : undefined;
}

export function headshotCrop(source, saved) {
  return saved ?? source?.defaultCrop;
}

export const portraitCropStorageKey = key => "campfire.battle-face." + key;
export const portraitSelectionKey = (key, source) => source?.revision == null ? key : key + "@" + source.revision;

export function readPortraitCrop(key) {
  let value;
  try { value = JSON.parse(localStorage.getItem(portraitCropStorageKey(key))); } catch {}
  const valid = value && ["x","y","width","height","scale"].every(field =>
    Number.isFinite(value[field]) && value[field] >= 0 && value[field] <= 1);
  return valid && value.width > 0 && value.height > 0 ? value : undefined;
}

export function createPortraitViewer(dialog, render) {
  const get = id => dialog.querySelector("#"+id);
  const canvas = get("portrait-original");
  const frame = get("portrait-crop");
  const controls = get("portrait-controls");
  const result = get("portrait-result");
  const preview = get("portrait-selected");
  const actions = get("portrait-actions");
  const edit = get("portrait-edit");
  const save = get("portrait-save");
  const status = get("portrait-status");
  const keyOf = unit => unit.portraitCropKey ?? "roster:"+unit.id;
  let active, crop, drag;

  function savedCrop(unit,source) {
    return readPortraitCrop(portraitSelectionKey(keyOf(unit),source));
  }

  function paintCrop() {
    const {x,y,width,height} = crop;
    Object.assign(frame.style,{left:100*x+"%",top:100*y+"%",width:100*width+"%",height:100*height+"%"});
    preview.getContext("2d").drawImage(canvas,x*canvas.width,y*canvas.height,width*canvas.width,height*canvas.height,
      0,0,preview.width,preview.height);
  }

  function startEdit() {
    if (!active || canvas.hidden) return;
    active.editing = true;
    dialog.setAttribute("aria-label",active.unit.name + "的面部取景");
    const selection = headshotCrop(active.source,savedCrop(active.unit,active.source));
    crop = cropRectangle(canvas.width,canvas.height,selection
      ? {x:selection.x+selection.width/2,y:selection.y+selection.height/2,scale:selection.scale}
      : automaticFace);
    paintCrop();
    actions.hidden = true;
    frame.hidden = controls.hidden = result.hidden = false;
    frame.focus({preventScroll:true});
  }

  async function open(unit,source,editImmediately=false) {
    if (!source || dialog.open) return;
    const request = {unit,source,editing:false};
    active = request;
    dialog.setAttribute("aria-label",unit.name + "的原始立绘");
    canvas.hidden = frame.hidden = controls.hidden = result.hidden = true;
    actions.hidden = false;
    edit.disabled = true;
    status.hidden = false;
    status.textContent = "正在载入立绘…";
    dialog.showModal();
    try {
      const image = new Image();
      image.src = source.url;
      await image.decode();
      if (active !== request || !dialog.open) return;
      const width = image.naturalWidth/source.columns;
      const height = image.naturalHeight/source.rows;
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      canvas.style.setProperty("--portrait-ratio",String(canvas.width/canvas.height));
      canvas.getContext("2d").drawImage(image,source.column*width,source.row*height,width,height,0,0,canvas.width,canvas.height);
      canvas.hidden = false;
      status.hidden = true;
      edit.disabled = false;
      if (editImmediately) startEdit();
    } catch {
      if (active === request) status.textContent = "无法载入立绘。";
    }
  }

  edit.addEventListener("click",startEdit);
  frame.addEventListener("pointerdown",event=>{
    if (event.button !== 0) return;
    event.preventDefault();
    frame.focus({preventScroll:true});
    frame.setPointerCapture(event.pointerId);
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,crop,edge:event.target.closest("[data-edge]")?.dataset.edge};
  });
  frame.addEventListener("pointermove",event=>{
    if (event.pointerId !== drag?.id) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (event.clientX-drag.x)/rect.width, dy = (event.clientY-drag.y)/rect.height;
    crop = drag.edge ? resizeCropEdge(drag.crop,drag.edge,dx,dy) : moveCrop(drag.crop,dx,dy);
    paintCrop();
  });
  frame.addEventListener("lostpointercapture",()=>{ drag = undefined; });
  frame.addEventListener("keydown",event=>{
    const direction = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? .04 : .01;
    crop = moveCrop(crop,direction[0]*step,direction[1]*step);
    paintCrop();
  });
  save.addEventListener("click",()=>{
    if (!active?.editing || controls.hidden) return;
    const key = portraitCropStorageKey(portraitSelectionKey(keyOf(active.unit),active.source));
    try { localStorage.setItem(key,JSON.stringify(crop)); } catch {}
    dialog.close();
    window.dispatchEvent(new StorageEvent("storage",{key}));
    render();
  });
  dialog.addEventListener("close",()=>{ active = crop = drag = undefined; });
  return {open,savedCrop};
}
