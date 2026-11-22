const faceRatio = 2/3;
const minimumScale = .18;
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));

export function moveCrop(crop, dx, dy) {
  return {...crop,x:clamp(crop.x+dx,0,1-crop.width),y:clamp(crop.y+dy,0,1-crop.height)};
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

export function portraitSource(unit, fallback) {
  if (unit.profilePortrait) return {url:unit.profilePortrait,columns:1,rows:1,column:0,row:0};
  if (unit.portraitSprite) {
    const {atlas,column,row,face} = unit.portraitSprite;
    const defaultCrop = face && cropRectangle(2,3,{x:face[0],y:face[1],scale:face[2]});
    return {url:"./art/test-portraits-"+atlas+".png",columns:3,rows:2,column,row,defaultCrop};
  }
  return fallback ? {url:fallback,columns:1,rows:1,column:0,row:0} : undefined;
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
  const size = get("portrait-size");
  const save = get("portrait-save");
  const status = get("portrait-status");
  const crops = new Map();
  const keyOf = unit => "campfire.battle-face."+(unit.portraitCropKey ?? "roster:"+unit.id);
  let active, crop, drag;

  function savedCrop(unit) {
    const key = keyOf(unit);
    if (!crops.has(key)) {
      let value;
      try { value = JSON.parse(localStorage.getItem(key)); } catch {}
      const valid = value && ["x","y","width","height","scale"].every(field =>
        Number.isFinite(value[field]) && value[field] >= 0 && value[field] <= 1);
      crops.set(key,valid && value.width > 0 && value.height > 0 ? value : undefined);
    }
    return crops.get(key);
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
    const selection = savedCrop(active.unit) ?? active.source.defaultCrop;
    crop = cropRectangle(canvas.width,canvas.height,selection
      ? {x:selection.x+selection.width/2,y:selection.y+selection.height/2,scale:selection.scale}
      : {x:.5,y:.19,scale:.32});
    size.value = String(Math.round(crop.scale*100));
    paintCrop();
    actions.hidden = true;
    frame.hidden = controls.hidden = result.hidden = false;
    frame.focus({preventScroll:true});
  }

  async function open(unit,source) {
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
    } catch {
      if (active === request) status.textContent = "无法载入立绘。";
    }
  }

  edit.addEventListener("click",startEdit);
  function resize(scale) {
    crop = cropRectangle(canvas.width,canvas.height,{x:crop.x+crop.width/2,y:crop.y+crop.height/2,scale});
    paintCrop();
  }
  size.addEventListener("input",()=>resize(Number(size.value)/100));
  frame.addEventListener("pointerdown",event=>{
    if (event.button !== 0) return;
    event.preventDefault();
    frame.focus({preventScroll:true});
    frame.setPointerCapture(event.pointerId);
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,crop};
  });
  frame.addEventListener("pointermove",event=>{
    if (event.pointerId !== drag?.id) return;
    const rect = canvas.getBoundingClientRect();
    crop = moveCrop(drag.crop,(event.clientX-drag.x)/rect.width,(event.clientY-drag.y)/rect.height);
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
    const key = keyOf(active.unit);
    crops.set(key,crop);
    try { localStorage.setItem(key,JSON.stringify(crop)); } catch {}
    dialog.close();
    render();
  });
  dialog.addEventListener("close",()=>{ active = crop = drag = undefined; });
  return {open,savedCrop};
}
