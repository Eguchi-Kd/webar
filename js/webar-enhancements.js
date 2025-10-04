// js/webar-enhancements.js
// Provides UI toggle + Screenshot + Pinch scale + Swipe rotate for Three.Object3D placed in the scene.
// Usage: initEnhancements({ renderer, camera, getPlacedObject, modelViewerEl, uiRoot, overlayRoot, coreUiElements })

export function initEnhancements({
  renderer = null,
  camera = null,
  getPlacedObject = null,
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
  // ensure UI itself accepts pointer events
  root.style.pointerEvents = 'auto';
  const btnToggle = createEl('button', 'webar-btn', 'UI 表示/非表示');
  const hidableWrapper = createEl('div', 'hidable', '');
  const btnScreenshot = createEl('button', 'webar-btn', 'スクリーンショット');
  btnScreenshot.title = '表示中の画面を保存します（Quick Look中は制約あり）';
  hidableWrapper.appendChild(btnScreenshot);
  root.appendChild(btnToggle);
  root.appendChild(hidableWrapper);

  const topLog = createEl('div', 'webar-top-log');
  topLog.id = 'webar-top-log';
  topLog.style.pointerEvents = 'auto';

  // choose container: overlayRoot if provided else uiRoot
  const container = overlayRoot || uiRoot || document.body;
  try {
    // If overlayRoot provided, ensure overlayRoot stays pointer-events:none so clicks fall through,
    // but UI children (root/topLog) will have pointer-events:auto so they still get interactions.
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

  // screenshot helpers
  async function screenshotFromRenderer() {
    if (!renderer) throw new Error('renderer not provided');
    // hide UI (but we keep toggle visible by class manipulation)
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

  async function screenshotFromModelViewer(mv) {
    if (!mv) throw new Error('model-viewer element required');
    if (typeof mv.toBlob === 'function') {
      return await mv.toBlob();
    }
    if (typeof mv.toDataURL === 'function') {
      const data = mv.toDataURL();
      const arr = data.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      const n = bstr.length;
      const u8 = new Uint8Array(n);
      for (let i=0;i<n;i++) u8[i]=bstr.charCodeAt(i);
      return new Blob([u8], { type: mime });
    }
    throw new Error('model-viewer does not expose screenshot API in this environment');
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
        try { blob = await screenshotFromModelViewer(modelViewerEl); } catch(e){ console.warn(e); }
      }
      if (!blob) throw new Error('スクリーンショット失敗 (適切な描画領域が見つかりません)');
      await downloadBlob(blob, 'webar_screenshot.png');
      logTop('スクリーンショット完了');
    } catch (e) {
      console.error('screenshot error', e);
      logTop('スクリーンショット失敗: ' + (e.message || e));
    }
  });

  // Gesture handling: prefer overlayRoot for event target (works in AR overlay), else renderer.domElement
  if (!getPlacedObject || typeof getPlacedObject !== 'function') {
    logTop('ジェスチャー: getPlacedObject 関数が未提供。スワイプ/ピンチは無効。');
  } else {
    const eventTarget = overlayRoot || (renderer && renderer.domElement) || modelViewerEl || document.body;
    try { eventTarget.style.touchAction = 'none'; } catch(e){}
    try { if (renderer && renderer.domElement) { renderer.domElement.style.touchAction = 'none'; renderer.domElement.style.userSelect='none'; } } catch(e){}

    const pointers = new Map();
    let gestureState = { mode: 'none', startX:0, startY:0, startDist:0, startScale:1, startRotationY:0 };

    function getDistance(p1,p2){ const dx=p2.x-p1.x, dy=p2.y-p1.y; return Math.hypot(dx,dy); }

    function trySetPointerCapture(target, id) {
      try {
        if (target && typeof target.setPointerCapture === 'function') {
          target.setPointerCapture(id);
          return true;
        }
      } catch(e){}
      return false;
    }

    function onPointerDown(e){
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      trySetPointerCapture(eventTarget, e.pointerId);
      try { if (e.target && typeof e.target.setPointerCapture === 'function') e.target.setPointerCapture(e.pointerId); } catch(e){}
      pointers.set(e.pointerId, { x:e.clientX, y:e.clientY, type:e.pointerType });
      const placed = getPlacedObject();
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
        const placed = getPlacedObject();
        gestureState.startScale = placed && placed.scale ? placed.scale.x : 1;
      } else {
        gestureState.mode = 'none';
      }
    }

    function onPointerMove(e){
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x:e.clientX, y:e.clientY, type:e.pointerType });
      const placed = getPlacedObject();
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
        if (eventTarget && typeof eventTarget.releasePointerCapture === 'function') eventTarget.releasePointerCapture(e.pointerId);
      } catch(e){}
      try { if (e.target && typeof e.target.releasePointerCapture === 'function') e.target.releasePointerCapture(e.pointerId); } catch(e){}
      pointers.delete(e.pointerId);
      if (pointers.size === 0) gestureState.mode = 'none';
      else if (pointers.size === 1) {
        const p = pointers.values().next().value;
        gestureState.mode = 'rotate';
        gestureState.startX = p.x; gestureState.startY = p.y;
        const placed = getPlacedObject();
        gestureState.startRotationY = (placed && placed.rotation && typeof placed.rotation.y === 'number') ? placed.rotation.y : (placed && placed.quaternion ? (new THREE.Euler().setFromQuaternion(placed.quaternion)).y : 0);
      }
    }

    eventTarget.addEventListener('pointerdown', onPointerDown, { passive:false });
    eventTarget.addEventListener('pointermove', onPointerMove, { passive:false });
    eventTarget.addEventListener('pointerup', onPointerUp, { passive:false });
    eventTarget.addEventListener('pointercancel', onPointerUp, { passive:false });
    eventTarget.addEventListener('touchstart', (ev)=>{}, { passive:false });

    logTop('ジェスチャー: 有効 (ピンチで拡大/縮小、単指で回転) — events attached to ' + (overlayRoot ? '#overlay' : (renderer && renderer.domElement ? 'renderer.domElement' : 'document.body')));
  }

  return {
    uiRoot: root,
    btnToggle,
    btnScreenshot,
    logTop,
    destroy(){
      try{ root.remove(); topLog.remove(); }catch(e){}
    }
  };
}
