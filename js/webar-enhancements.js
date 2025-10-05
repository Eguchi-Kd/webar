// js/webar-enhancements.js
// Enhanced version: robust pose loading + many bone-name variants + debug output.
// Provides UI toggle + Screenshot + Pinch scale + Swipe rotate + Pose change.

export async function initEnhancements({
  renderer = null,
  camera = null,
  getPlacedObject = null,
  getVrmInstance = null,       // optional function -> returns currently loaded VRM instance (if any)
  modelViewerEl = null,
  uiRoot = document.body,
  overlayRoot = null,
  coreUiElements = {}
} = {}) {

  function createEl(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // inject CSS once
  if (!document.getElementById('webar-enh-style')) {
    const style = createEl('style', '', `
      #webar-ui { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); z-index: 10001; display:flex; flex-direction:column; gap:8px; pointer-events:auto; }
      #webar-ui .webar-btn { background: rgba(0,0,0,0.6); color:#fff; border:1px solid rgba(255,255,255,0.08); padding:8px 10px; border-radius:8px; font-size:14px; }
      #webar-ui .webar-btn.ghost { background:transparent; border:1px dashed rgba(255,255,255,0.12); }
      #webar-top-log { position: absolute; left: 12px; top: 12px; z-index: 10001; max-width: 60%; pointer-events:auto; color:#fff; font-size:13px; }
      .ui-hidden #webar-ui > .hidable { display:none !important; }
      .hidden-by-enh { display:none !important; }
    `);
    style.id = 'webar-enh-style';
    document.head.appendChild(style);
  }

  // build UI
  const root = createEl('div', '');
  root.id = 'webar-ui';
  root.style.pointerEvents = 'auto';
  const btnToggle = createEl('button', 'webar-btn', 'UI 表示/非表示');
  const hidableWrapper = createEl('div', 'hidable', '');
  const btnScreenshot = createEl('button', 'webar-btn', 'スクリーンショット');
  const btnPose = createEl('button', 'webar-btn', 'ポーズ変更');
  hidableWrapper.appendChild(btnScreenshot);
  hidableWrapper.appendChild(btnPose);
  root.appendChild(btnToggle);
  root.appendChild(hidableWrapper);

  const topLog = createEl('div', 'webar-top-log');
  topLog.id = 'webar-top-log';
  topLog.style.pointerEvents = 'auto';

  const container = overlayRoot || uiRoot || document.body;
  try {
    if (overlayRoot) {
      try { overlayRoot.style.pointerEvents = 'none'; } catch(e){}
      try { if (getComputedStyle(overlayRoot).position === 'static') overlayRoot.style.position = 'fixed'; } catch(e){}
    }
    container.appendChild(topLog);
    container.appendChild(root);
  } catch (e) {
    document.body.appendChild(topLog);
    document.body.appendChild(root);
  }

  function logTop(msg) {
    const d = createEl('div');
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    topLog.prepend(d);
    setTimeout(()=>{ try { d.remove(); } catch(e){} }, 8000);
  }

  const corePanel = coreUiElements.panel || null;
  const coreLog = coreUiElements.log || null;
  const coreButtons = Array.isArray(coreUiElements.autoButtons) ? coreUiElements.autoButtons.slice() : [];

  btnToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('ui-hidden');
    if (corePanel) corePanel.classList.toggle('hidden-by-enh');
    if (coreLog) coreLog.classList.toggle('hidden-by-enh');
    coreButtons.forEach(b => { if (b) b.classList.toggle('hidden-by-enh'); });
    topLog.classList.toggle('hidden-by-enh');
    logTop('UI トグル');
  });

  // screenshot
  async function screenshotFromRenderer() {
    if (!renderer) throw new Error('renderer not provided');
    document.documentElement.classList.add('ui-hidden');
    if (corePanel) corePanel.classList.add('hidden-by-enh');
    if (coreLog) coreLog.classList.add('hidden-by-enh');
    topLog.classList.add('hidden-by-enh');
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const canvas = renderer.domElement;
    let blob = null;
    if (canvas.toBlob) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } else {
      const data = canvas.toDataURL('image/png');
      const arr = data.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      const n = bstr.length;
      const u8 = new Uint8Array(n);
      for (let i=0;i<n;i++) u8[i]=bstr.charCodeAt(i);
      blob = new Blob([u8], { type: mime });
    }
    document.documentElement.classList.remove('ui-hidden');
    if (corePanel) corePanel.classList.remove('hidden-by-enh');
    if (coreLog) coreLog.classList.remove('hidden-by-enh');
    topLog.classList.remove('hidden-by-enh');
    return blob;
  }
  async function downloadBlob(blob, filename='screenshot.png') {
    if (!blob) throw new Error('no blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 10000);
  }
  btnScreenshot.addEventListener('click', async () => {
    logTop('スクリーンショット開始...');
    try {
      let blob = null;
      if (renderer && renderer.domElement) {
        blob = await screenshotFromRenderer();
      } else if (modelViewerEl) {
        // fallback: not implemented
      }
      if (!blob) throw new Error('スクリーンショット失敗 (描画領域が見つかりません)');
      await downloadBlob(blob, 'webar_screenshot.png');
      logTop('スクリーンショット完了');
    } catch (e) {
      console.error('screenshot error', e);
      logTop('スクリーンショット失敗: ' + (e.message || e));
    }
  });

  // --- Pose loading & application (robust) ---
  const POSE_COUNT = 5;
  let poses = [];
  let poseIndex = -1;

  async function fetchPoseFile(n) {
    const base = (location.pathname || '/').replace(/\/[^\/]*$/, '/');
    const origin = location.origin;
    const candidates = [
      `${origin}${base}assets/pose${n}.json`,
      `${origin}${base}pose${n}.json`,
      `./assets/pose${n}.json`,
      `./pose${n}.json`
    ];
    for (const url of candidates) {
      try {
        const r = await fetch(url);
        if (r.ok) {
          const json = await r.json();
          logTop(`Loaded pose ${n} from ${url}`);
          return json;
        }
      } catch (e) {
        // ignore
      }
    }
    return null;
  }

  async function preloadPoses() {
    poses = [];
    for (let i=1;i<=POSE_COUNT;i++){
      const p = await fetchPoseFile(i);
      if (p && p.pose) poses.push(p);
      else {
        poses.push(null);
        logTop(`pose${i}.json not found or invalid`);
      }
    }
    logTop(`Poses loaded: ${poses.filter(x=>x).length}/${POSE_COUNT}`);
  }

  // Generate many candidate name variants from a key
  function generateNameVariants(key) {
    const variants = new Set();
    if (!key) return [];
    variants.add(key);
    variants.add(key.toLowerCase());
    // snake_case
    variants.add(key.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')); // camel->snake
    // remove underscores
    variants.add(key.replace(/_/g,'').toLowerCase());
    // spaces
    variants.add(key.replace(/_/g,' ').toLowerCase());
    // PascalCase
    variants.add(key.charAt(0).toUpperCase() + key.slice(1));
    // mixamorig common patterns
    variants.add('mixamorig_' + key);
    variants.add('mixamorig:' + key);
    variants.add('mixamorig' + key);
    // variations with Right/Left normalized
    const commonMap = {
      left: ['Left', 'left', 'l'],
      right: ['Right', 'right', 'r']
    };
    // also add Upper/Lower synonyms
    const synonyms = [
      [ 'UpperLeg', 'UpLeg' ],
      [ 'LowerArm', 'ForeArm', 'LowerArm' ],
      [ 'UpperArm', 'Arm' ]
    ];
    // raw camel->split tokens
    const tokens = key.replace(/([A-Z])/g, ' $1').split(/[\s_:-]+/).filter(Boolean);
    const joined = tokens.join('');
    variants.add(joined.toLowerCase());
    variants.add(joined);
    // produce camel and snake combos
    let camel = tokens.map((t,i)=> i===0 ? t.toLowerCase() : t.charAt(0).toUpperCase()+t.slice(1)).join('');
    variants.add(camel);
    // add some reasonable explicit synonyms for common bones
    const replacements = {
      rightUpperLeg: ['RightUpLeg','RightUpperLeg','RightUpLeg','right_up_leg','mixamorig_RightUpLeg','mixamorig:RightUpLeg'],
      leftUpperLeg: ['LeftUpLeg','LeftUpperLeg','left_up_leg','mixamorig_LeftUpLeg','mixamorig:LeftUpLeg'],
      rightFoot: ['RightFoot','RightToeBase','mixamorig_RightFoot','mixamorig:RightToeBase'],
      leftLowerArm: ['LeftLowerArm','LeftForeArm','LeftForeArm','mixamorig_LeftForeArm'],
      leftUpperArm: ['LeftArm','LeftUpperArm','mixamorig_LeftArm'],
      rightUpperArm: ['RightArm','RightUpperArm','mixamorig_RightArm']
    };
    if (replacements[key]) {
      replacements[key].forEach(v => variants.add(v));
      replacements[key].forEach(v => variants.add(v.toLowerCase()));
    }
    return Array.from(variants);
  }

  // find node by trying VRM humanoid first, then name heuristics
  function findNodeByKey(root, key, vrmInstance = null) {
    if (!root || !key) return null;
    const variants = generateNameVariants(key);

    // 1) if vrmInstance and humanoid.getBoneNode exists, try variants
    try {
      if (vrmInstance && vrmInstance.humanoid && typeof vrmInstance.humanoid.getBoneNode === 'function') {
        for (const v of variants) {
          try {
            const node = vrmInstance.humanoid.getBoneNode(v);
            if (node) return node;
          } catch(e){}
        }
      }
    } catch(e){}

    // 2) traverse object names looking for a close match
    let found = null;
    const lowerVariants = variants.map(v => v.toLowerCase());
    root.traverse((node) => {
      if (found) return;
      if (!node.name) return;
      const name = node.name.toLowerCase();
      // exact or includes
      for (const v of lowerVariants) {
        if (name === v || name.includes(v) || v.includes(name)) {
          found = node; return;
        }
      }
      // try removing punctuation
      const alt = name.replace(/[:_\-]/g,' ');
      for (const v of lowerVariants) {
        if (alt.includes(v)) { found = node; return; }
      }
    });
    return found;
  }

  function applyPoseToObject(rootObj, poseObj, vrmInstance = null) {
    if (!rootObj || !poseObj) return { ok:false, msg:'no root or pose' };
    const missing = [];
    const applied = [];

    for (const key of Object.keys(poseObj)) {
      const data = poseObj[key];
      if (!data || !Array.isArray(data.rotation) || data.rotation.length < 4) {
        missing.push(key);
        continue;
      }
      const qarr = data.rotation;
      const targetNode = findNodeByKey(rootObj, key, vrmInstance);
      if (!targetNode) {
        missing.push(key);
        continue;
      }
      const q = new THREE.Quaternion(qarr[0], qarr[1], qarr[2], qarr[3]);
      try {
        targetNode.quaternion.copy(q);
        try { targetNode.updateMatrix(); targetNode.updateMatrixWorld(true); } catch(e){}
        applied.push(key);
      } catch(e){
        console.warn('applyPose error for', key, e);
        missing.push(key);
      }
    }

    // debug: if missing, emit list plus sample node names to help mapping
    if (missing.length > 0) {
      const names = [];
      let count = 0;
      rootObj.traverse(n => { if (n.name && count < 200) { names.push(n.name); count++; } });
      console.warn('pose missing keys:', missing, 'sample available node names:', names.slice(0,80));
    }

    return { ok:true, applied, missing };
  }

  function applyNextPose(){
    if (!poses || poses.length === 0) {
      logTop('No poses loaded');
      return;
    }
    poseIndex = (poseIndex + 1) % poses.length;
    const p = poses[poseIndex];
    if (!p || !p.pose) {
      logTop(`pose ${poseIndex+1} is not available`);
      return;
    }
    const target = (getPlacedObject && typeof getPlacedObject === 'function') ? getPlacedObject() : null;
    const vrmInst = (getVrmInstance && typeof getVrmInstance === 'function') ? getVrmInstance() : null;
    if (!target) {
      logTop('No placed object to apply pose to');
      return;
    }
    const result = applyPoseToObject(target, p.pose, vrmInst);
    logTop(`ポーズ ${poseIndex+1} を適用 — applied ${result.applied.length}, missing ${result.missing.length}`);
    if (result.missing && result.missing.length > 0) {
      console.warn('pose missing keys:', result.missing);
    }
  }

  btnPose.addEventListener('click', () => {
    applyNextPose();
  });

  preloadPoses().catch(e => { console.warn('pose preload failed', e); });

  // === Gesture handling (same as before) ===
  const eventTargetInitial = (renderer && renderer.domElement) ? renderer.domElement : (overlayRoot || modelViewerEl || document.body);
  let currentTarget = null;
  let listenersAttached = false;
  const pointers = new Map();
  let gestureState = { mode: 'none', startX:0, startY:0, startDist:0, startScale:1, startRotationY:0 };

  function getDistance(a,b){ const dx=b.x-a.x, dy=b.y-a.y; return Math.hypot(dx,dy); }
  function trySetPointerCapture(target, id){
    try { if (target && typeof target.setPointerCapture === 'function') { target.setPointerCapture(id); return true; } } catch(e){} return false;
  }

  function onPointerDown(e){
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    trySetPointerCapture(currentTarget, e.pointerId);
    try { if (e.target && typeof e.target.setPointerCapture === 'function') e.target.setPointerCapture(e.pointerId); } catch(e){}
    pointers.set(e.pointerId, { x:e.clientX, y:e.clientY, type:e.pointerType });
    const placed = (getPlacedObject && typeof getPlacedObject === 'function') ? getPlacedObject() : null;
    if (!placed) return;
    if (pointers.size === 1) {
      gestureState.mode = 'rotate';
      const p = pointers.values().next().value;
      gestureState.startX = p.x; gestureState.startY = p.y;
      gestureState.startRotationY = (placed.rotation && typeof placed.rotation.y === 'number') ? placed.rotation.y : (placed.quaternion ? (new THREE.Euler().setFromQuaternion(placed.quaternion)).y : 0);
    } else if (pointers.size === 2) {
      gestureState.mode = 'pinch';
      const it = pointers.values(); const pA = it.next().value; const pB = it.next().value;
      gestureState.startDist = getDistance(pA,pB);
      const placed = (getPlacedObject && typeof getPlacedObject === 'function') ? getPlacedObject() : null;
      gestureState.startScale = placed && placed.scale ? placed.scale.x : 1;
    } else {
      gestureState.mode = 'none';
    }
  }

  function onPointerMove(e){
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x:e.clientX, y:e.clientY, type:e.pointerType });
    const placed = (getPlacedObject && typeof getPlacedObject === 'function') ? getPlacedObject() : null;
    if (!placed) return;
    if (gestureState.mode === 'rotate' && pointers.size === 1) {
      const p = pointers.values().next().value;
      const dx = p.x - gestureState.startX;
      const ROT_SPEED = 0.008;
      const newY = gestureState.startRotationY - dx * ROT_SPEED;
      if (placed.rotation) {
        placed.rotation.y = newY;
      } else if (placed.quaternion) {
        const e = new THREE.Euler(0, newY, 0);
        placed.quaternion.setFromEuler(e);
      }
    } else if (gestureState.mode === 'pinch' && pointers.size === 2) {
      const it = pointers.values(); const pA = it.next().value; const pB = it.next().value;
      const curDist = getDistance(pA,pB);
      if (gestureState.startDist > 0) {
        const ratio = curDist / gestureState.startDist;
        const newScale = Math.max(0.05, Math.min(8, gestureState.startScale * ratio));
        if (placed.scale) {
          placed.scale.setScalar(newScale);
        } else {
          try { placed.traverse((c) => { if (c.isMesh) c.scale.setScalar(newScale); }); } catch (err) {}
        }
      }
    }
  }

  function onPointerUp(e){
    try {
      if (currentTarget && typeof currentTarget.releasePointerCapture === 'function') currentTarget.releasePointerCapture(e.pointerId);
    } catch(e){}
    try { if (e.target && typeof e.target.releasePointerCapture === 'function') e.target.releasePointerCapture(e.pointerId); } catch(e){}
    pointers.delete(e.pointerId);
    if (pointers.size === 0) gestureState.mode = 'none';
    else if (pointers.size === 1) {
      const p = pointers.values().next().value;
      gestureState.mode = 'rotate';
      gestureState.startX = p.x; gestureState.startY = p.y;
      const placed = (getPlacedObject && typeof getPlacedObject === 'function') ? getPlacedObject() : null;
      gestureState.startRotationY = (placed && placed.rotation && typeof placed.rotation.y === 'number') ? placed.rotation.y : (placed && placed.quaternion ? (new THREE.Euler().setFromQuaternion(placed.quaternion)).y : 0);
    }
  }

  function addListenersTo(target){
    if (!target) return;
    if (currentTarget) removeListenersFrom(currentTarget);
    currentTarget = target;
    try { target.style.touchAction = 'none'; } catch(e){}
    target.addEventListener('pointerdown', onPointerDown, { passive:false });
    target.addEventListener('pointermove', onPointerMove, { passive:false });
    target.addEventListener('pointerup', onPointerUp, { passive:false });
    target.addEventListener('pointercancel', onPointerUp, { passive:false });
    target.addEventListener('lostpointercapture', (ev) => { pointers.delete(ev.pointerId); }, { passive:true });
    listenersAttached = true;
    logTop('ジェスチャー listeners attached to ' + (target.id ? '#'+target.id : target.tagName || 'target'));
  }

  function removeListenersFrom(target){
    if (!target) return;
    try {
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
    } catch(e){}
    listenersAttached = false;
    currentTarget = null;
    pointers.clear();
    gestureState.mode = 'none';
  }

  if (renderer && renderer.domElement) {
    addListenersTo(renderer.domElement);
  } else if (overlayRoot) {
    addListenersTo(overlayRoot);
  } else {
    addListenersTo(document.body);
  }

  function setXRSession(session) {
    if (session) {
      if (currentTarget) removeListenersFrom(currentTarget);
      if (overlayRoot) {
        try { overlayRoot.style.pointerEvents = 'auto'; } catch(e){}
        addListenersTo(overlayRoot);
      } else if (renderer && renderer.domElement) {
        addListenersTo(renderer.domElement);
      } else {
        addListenersTo(document.body);
      }
      logTop('XR session active: gestures bound to overlay/document');
    } else {
      if (currentTarget) removeListenersFrom(currentTarget);
      if (overlayRoot) try { overlayRoot.style.pointerEvents = 'none'; } catch(e){}
      if (renderer && renderer.domElement) addListenersTo(renderer.domElement);
      else addListenersTo(document.body);
      logTop('XR session inactive: gestures bound to canvas/document');
    }
  }

  return {
    uiRoot: root,
    btnToggle,
    btnScreenshot,
    btnPose,
    logTop,
    setXRSession,
    destroy(){
      try { if (currentTarget) removeListenersFrom(currentTarget); root.remove(); topLog.remove(); } catch(e){}
    }
  };
}
