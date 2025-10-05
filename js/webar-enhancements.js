// js/webar-enhancements.js
// Simplified enhancements module — pose functionality removed.
// Provides: UI toggle, Screenshot, gesture controls (rotate/pinch), XR binding helpers.

export async function initEnhancements({
  renderer = null,
  camera = null,
  getPlacedObject = null,   // optional, used by gesture handlers to affect placed object
  getVrmInstance = null,    // optional, retained for compatibility (not used here)
  modelViewerEl = null,
  uiRoot = document.body,
  overlayRoot = null,
  coreUiElements = {}
} = {}) {

  // --- small helpers ---
  function createEl(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // inject CSS once
  if (!document.getElementById('webar-enh-style')) {
    const style = createEl('style', '', `
      /* webar enhancements styles */
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

  // --- build UI ---
  const root = createEl('div', '');
  root.id = 'webar-ui';
  root.style.pointerEvents = 'auto';

  const btnToggle = createEl('button', 'webar-btn', 'UI 表示/非表示');
  const hidableWrapper = createEl('div', 'hidable', '');
  const btnScreenshot = createEl('button', 'webar-btn', 'スクリーンショット');

  hidableWrapper.appendChild(btnScreenshot);
  root.appendChild(btnToggle);
  root.appendChild(hidableWrapper);

  const topLog = createEl('div', 'webar-top-log');
  topLog.id = 'webar-top-log';
  topLog.style.pointerEvents = 'auto';

  // choose container (overlayRoot prioritized)
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
    // auto-remove after a while to avoid clutter
    setTimeout(()=>{ try { d.remove(); } catch(e){} }, 8000);
  }

  // references to core UI elements (optional) so toggle can hide them too
  const corePanel = coreUiElements.panel || null;
  const coreLog = coreUiElements.log || null;
  const coreButtons = Array.isArray(coreUiElements.autoButtons) ? coreUiElements.autoButtons.slice() : [];

  // Toggle UI visibility
  btnToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('ui-hidden');
    if (corePanel) corePanel.classList.toggle('hidden-by-enh');
    if (coreLog) coreLog.classList.toggle('hidden-by-enh');
    coreButtons.forEach(b => { if (b) b.classList.toggle('hidden-by-enh'); });
    topLog.classList.toggle('hidden-by-enh');
    logTop('UI トグル');
  });

  // --- Screenshot logic ---
  async function screenshotFromRenderer() {
    if (!renderer) throw new Error('renderer not provided');
    // hide UI
    document.documentElement.classList.add('ui-hidden');
    if (corePanel) corePanel.classList.add('hidden-by-enh');
    if (coreLog) coreLog.classList.add('hidden-by-enh');
    topLog.classList.add('hidden-by-enh');
    // wait two frames
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    const canvas = renderer.domElement;
    let blob = null;
    if (canvas.toBlob) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } else {
      // fallback
      const data = canvas.toDataURL('image/png');
      const arr = data.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      const n = bstr.length;
      const u8 = new Uint8Array(n);
      for (let i=0;i<n;i++) u8[i]=bstr.charCodeAt(i);
      blob = new Blob([u8], { type: mime });
    }

    // restore UI
    document.documentElement.classList.remove('ui-hidden');
    if (corePanel) corePanel.classList.remove('hidden-by-enh');
    if (coreLog) coreLog.classList.remove('hidden-by-enh');
    topLog.classList.remove('hidden-by-enh');

    if (!blob) throw new Error('スクリーンショット取得失敗');
    return blob;
  }

  async function downloadBlob(blob, filename='screenshot.png') {
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
        // optional: future fallback if model-viewer supports capture
        throw new Error('model-viewer screenshot fallback not implemented');
      } else {
        throw new Error('描画領域が見つかりません');
      }
      await downloadBlob(blob, 'webar_screenshot.png');
      logTop('スクリーンショット完了');
    } catch (e) {
      console.error('screenshot error', e);
      logTop('スクリーンショット失敗: ' + (e.message || e));
    }
  });

  // --- Gesture handling (pointer events) ---
  // Bind to renderer.domElement or overlayRoot or document.body
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
      gestureState.startRotationY = (placed.rotation && typeof placed.rotation.y === 'number')
        ? placed.rotation.y
        : (placed.quaternion ? (new THREE.Euler().setFromQuaternion(placed.quaternion)).y : 0);
    } else if (pointers.size === 2) {
      gestureState.mode = 'pinch';
      const it = pointers.values(); const pA = it.next().value; const pB = it.next().value;
      gestureState.startDist = getDistance(pA,pB);
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
        const euler = new THREE.Euler(0, newY, 0);
        placed.quaternion.setFromEuler(euler);
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
      gestureState.startRotationY = (placed && placed.rotation && typeof placed.rotation.y === 'number')
        ? placed.rotation.y
        : (placed && placed.quaternion ? (new THREE.Euler().setFromQuaternion(placed.quaternion)).y : 0);
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

  // initial attach
  if (renderer && renderer.domElement) {
    addListenersTo(renderer.domElement);
  } else if (overlayRoot) {
    addListenersTo(overlayRoot);
  } else {
    addListenersTo(document.body);
  }

  // Public: rebind gesture listeners when XR session toggles
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

  // Cleanup
  function destroy() {
    try {
      if (currentTarget) removeListenersFrom(currentTarget);
      root.remove();
      topLog.remove();
    } catch(e) { /* ignore */ }
  }

  // Public API
  return {
    uiRoot: root,
    btnToggle,
    btnScreenshot,
    logTop,
    setXRSession,
    destroy
  };
}
