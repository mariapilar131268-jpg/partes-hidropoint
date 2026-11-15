/* Partes Hidro Point — todo se calcula en el propio móvil. */
(function () {
  'use strict';
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  const $ = (id) => document.getElementById(id);
  const DEFAULT_EMAIL = 'serveis2@multiserveispalamos.com';

  const DOCS = {
    inter: { nombre: 'Hoja de encargo v2 (Inter Partner)', tpl: 'templates/inter.pdf', fich: 'hoja_encargo_inter', fn: 'fillInter', corto: 'Hoja Inter' },
    generali: { nombre: 'Conformidad de trabajos terminados (Generali)', tpl: 'templates/generali.pdf', fich: 'conformidad_generali', fn: 'fillGenerali', corto: 'Generali' },
    iris: { nombre: 'Encargo de trabajo (Iris Global)', tpl: 'templates/iris.pdf', fich: 'encargo_iris', fn: 'fillIris', corto: 'Iris' },
    parte: { nombre: 'Parte de trabajo de Hidro Point', tpl: 'templates/parte.pdf', fich: 'parte', fn: 'fillParte', corto: 'Nuestro parte' },
  };
  const ORDEN = ['inter', 'generali', 'iris', 'parte'];

  function nuevoD() {
    return { registro: '', expediente: '', compania: '', aseguradora: '', poliza: '', nombre: '', direccion: '', cp: '', poblacion: '', telefono: '', telefono2: '', nif: '',
      descripcion: '', emailCliente: '', fecha: '', horaIni: '', horaFin: '', realizados: '', pendientes: '', causa: '', pagoPor: '', provincia: '',
      consentimiento: false, refSiniestro: '', firmaNombre: '', firmaDni: '', iva: ['NC', 'NC', 'NC'], sigCliente: null, sigPedro: null };
  }
  const S = { tipo: 'parte', incluir: false, fotos: [], files: [], tplCache: {}, hecho: {}, ajustes: {}, d: nuevoD(), docActual: 'parte', hotIdx: -1, zoom: false };

  /* ---------- ajustes guardados en el móvil ---------- */
  function cargarAjustes() { try { return JSON.parse(localStorage.getItem('hp_ajustes') || '{}'); } catch (e) { return {}; } }
  function guardarAjustes(a) { try { localStorage.setItem('hp_ajustes', JSON.stringify(a)); } catch (e) { } }
  S.ajustes = cargarAjustes();

  function msg(id, tipo, texto) {
    const el = $(id); el.innerHTML = '';
    if (!texto || (Array.isArray(texto) && !texto.length)) return;
    (Array.isArray(texto) ? texto : [texto]).forEach(t => { const d = document.createElement('div'); d.className = tipo; d.textContent = t; el.appendChild(d); });
  }

  /* ---------- acceso a los datos por clave ('iva:0' = casilla de IVA nº 1) ---------- */
  function get(k) { if (k.indexOf('iva:') === 0) return S.d.iva[+k.slice(4)]; return S.d[k]; }
  function set(k, v) { if (k.indexOf('iva:') === 0) S.d.iva[+k.slice(4)] = v; else S.d[k] = v; }
  function vacio(fl) {
    if (fl.kind === 'sig') return fl.k === 'sigPedro' ? !(S.d.sigPedro || S.ajustes.sig) : !S.d[fl.k];
    if (fl.kind === 'check' || fl.kind === 'radio') return false;
    return !String(get(fl.k) == null ? '' : get(fl.k)).trim();
  }
  const falta = (h) => h.f.some(fl => fl.req && vacio(fl));
  const faltaObligatorio = (h) => h.f.some(fl => fl.req === 'must' && vacio(fl));

  /* ---------- pasos ---------- */
  function docsActivos() { return S.tipo === 'parte' ? ['parte'] : (S.incluir ? [S.tipo, 'parte'] : [S.tipo]); }
  function ir(n) {
    document.querySelectorAll('main > section').forEach(s => s.classList.toggle('on', s.id === 's' + n));
    document.querySelectorAll('#pasos button').forEach(b => { b.classList.toggle('on', b.dataset.p == n); b.classList.toggle('hecho', !!S.hecho[b.dataset.p] && b.dataset.p != n); });
    window.scrollTo(0, 0);
    if (n === 2) { construirTabs(); pedirRender(0); }
    if (n === 4) prepararEnvio();
  }
  document.querySelectorAll('#pasos button').forEach(b => b.addEventListener('click', () => { const n = +b.dataset.p; if (n > 1 && !S.hecho[1]) return; ir(n); }));

  /* ---------- firma con el dedo ---------- */
  function Pad(canvas, color) {
    const ctx = canvas.getContext('2d'); let dibujando = false, last = null, tiene = false, guardada = null;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    function resize() {
      const r = canvas.getBoundingClientRect(); if (!r.width) return;
      const img = tiene ? canvas.toDataURL() : null;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 2.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color;
      if (img) { const i = new Image(); i.onload = () => ctx.drawImage(i, 0, 0, r.width, r.height); i.src = img; }
    }
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); dibujando = true; last = pos(e); ctx.beginPath(); ctx.arc(last.x, last.y, 1.3, 0, 7); ctx.fillStyle = color; ctx.fill(); tiene = true; });
    canvas.addEventListener('pointermove', (e) => { if (!dibujando) return; e.preventDefault(); const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => canvas.addEventListener(t, () => { dibujando = false; }));
    function clear() { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore(); tiene = false; guardada = null; }
    function png() {
      if (guardada && !tiene) return guardada;
      if (!tiene) return null;
      const w = canvas.width, h = canvas.height, d = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 <= x0) return null;
      const m = 6; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
      const c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
      c.getContext('2d').drawImage(canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    }
    function setImg(dataUrl) {
      clear(); guardada = dataUrl; if (!dataUrl) return;
      const i = new Image(); i.onload = () => { const r = canvas.getBoundingClientRect(); const k = Math.min(r.width * .9 / i.width, r.height * .9 / i.height); ctx.drawImage(i, (r.width - i.width * k) / 2, (r.height - i.height * k) / 2, i.width * k, i.height * k); };
      i.src = dataUrl;
    }
    window.addEventListener('resize', resize); setTimeout(resize, 0);
    return { resize, clear, png, set: setImg, vacia: () => !(tiene || guardada), destroy: () => window.removeEventListener('resize', resize) };
  }
  const padPedro = Pad($('padPedro'), '#0a1a6b');
  $('borrarPedro').addEventListener('click', () => padPedro.clear());

  /* ---------- ajustes (modal) ---------- */
  function abrirAjustes() {
    $('aNombre').value = S.ajustes.nombre || ''; $('aNif').value = S.ajustes.nif || ''; $('aCodigo').value = S.ajustes.codigo || '';
    $('aLugar').value = S.ajustes.lugar || '';
    $('modalAjustes').classList.add('on');
    setTimeout(() => { padPedro.resize(); padPedro.set(S.ajustes.sig || null); }, 40);
  }
  $('bAjustes').addEventListener('click', abrirAjustes);
  $('guardarAjustes').addEventListener('click', () => {
    const sig = padPedro.png(), fallos = [];
    if (!$('aNombre').value.trim()) fallos.push('Escribe el nombre de Pedro.');
    if (!$('aLugar').value.trim()) fallos.push('Escribe la ciudad donde se firma.');
    if (fallos.length) return msg('msgAjustes', 'error', fallos);
    S.ajustes = { nombre: $('aNombre').value.trim(), nif: $('aNif').value.trim(), codigo: $('aCodigo').value.trim(), lugar: $('aLugar').value.trim(), email: DEFAULT_EMAIL, sig };
    guardarAjustes(S.ajustes); msg('msgAjustes', '', ''); $('modalAjustes').classList.remove('on');
    if ($('s2').classList.contains('on')) pedirRender(0);
  });

  /* ---------- paso 1: leer la orden de trabajo (solo lectura) ---------- */
  const ids1 = ['registro', 'expediente', 'compania', 'aseguradora'];
  ids1.forEach(k => $(k).addEventListener('input', () => { S.d[k] = $(k).value.trim(); }));

  function resumenCliente() {
    const d = S.d; const l = [];
    if (d.nombre) l.push('Cliente: ' + d.nombre);
    const dir = [d.direccion, [d.cp, d.poblacion].filter(Boolean).join(' ')].filter(Boolean).join(', '); if (dir) l.push(dir);
    if (d.telefono) l.push('Tel.: ' + d.telefono);
    $('resumenCliente').textContent = l.join(' · ');
  }
  async function leerPdf(file) {
    msg('msgPdf', 'aviso', 'Leyendo la orden…');
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const pg = await doc.getPage(1), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
      const items = tc.items.map(i => ({ s: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width }));
      const r = parseEncargo(items);
      const nd = nuevoD();
      ['registro', 'expediente', 'compania', 'aseguradora', 'poliza', 'nombre', 'direccion', 'cp', 'poblacion', 'nif', 'descripcion'].forEach(k => { nd[k] = r[k] || ''; });
      nd.telefono = (r.telefonos || [])[0] || ''; nd.telefono2 = (r.telefonos || [])[1] || '';
      if (r.fechaServicio) { const m = r.fechaServicio.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) nd.fecha = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
      S.d = nd; ids1.forEach(k => { $(k).value = nd[k]; }); resumenCliente();
      const falta1 = ['registro', 'expediente', 'nombre'].filter(k => !r[k]);
      if (falta1.length) msg('msgPdf', 'aviso', 'He leído la orden, pero no encuentro: ' + falta1.join(', ') + '. Complétalo a mano.');
      else msg('msgPdf', 'bien', `Orden leída: parte ${r.registro}, expediente ${r.expediente}.`);
      elegirTipoAuto();
    } catch (e) { console.error(e); msg('msgPdf', 'error', 'No he podido leer ese PDF. Puedes rellenar los datos a mano.'); }
  }
  $('fPdf').addEventListener('change', (e) => { if (e.target.files[0]) leerPdf(e.target.files[0]); e.target.value = ''; });
  $('bManual').addEventListener('click', () => { msg('msgPdf', 'aviso', 'Modo manual: escribe el registro y el expediente; el resto se rellena en el documento.'); $('registro').focus(); });
  ['compania', 'aseguradora'].forEach(k => $(k).addEventListener('change', elegirTipoAuto));

  function tipoAuto() {
    const t = (S.d.compania + ' ' + S.d.aseguradora).toLowerCase();
    if (/generali/.test(t)) return 'generali';
    if (/\biris\b/.test(t)) return 'iris';
    if (/inter/.test(t)) return 'inter';
    return 'parte';
  }
  function cambiarTipo(k) { if (S.tipo === 'parte' && k !== 'parte') { S.incluir = false; $('incluirParte').checked = false; } S.tipo = k; pintarOpcionesDoc(); }
  function elegirTipoAuto() { cambiarTipo(tipoAuto()); }
  $('incluirParte').addEventListener('change', () => { S.incluir = $('incluirParte').checked; });

  function pintarOpcionesDoc() {
    const c = $('opcionesDoc'); c.innerHTML = '';
    ORDEN.forEach(k => {
      const l = document.createElement('label'); l.className = 'opcion' + (S.tipo === k ? ' sel' : '');
      const i = document.createElement('input'); i.type = 'radio'; i.name = 'tipo'; i.checked = S.tipo === k;
      i.addEventListener('change', () => cambiarTipo(k));
      const s = document.createElement('span'); s.textContent = DOCS[k].nombre;
      if (k === tipoAuto() && (S.d.compania || S.d.aseguradora)) { const sm = document.createElement('small'); sm.textContent = 'Sugerido por la compañía de la orden'; s.appendChild(sm); }
      l.append(i, s); c.appendChild(l);
    });
    $('opParte').classList.toggle('oculto', S.tipo === 'parte');
    $('incluirParte').checked = S.incluir;
  }

  $('to2').addEventListener('click', () => {
    const f = [];
    if (!S.d.registro) f.push('Falta el nº de parte (registro).');
    if (!S.d.expediente) f.push('Falta el expediente.');
    if (f.length) return msg('msgDoc', 'error', f);
    msg('msgDoc', '', '');
    const d = S.d;
    if (!d.refSiniestro) d.refSiniestro = d.expediente;
    if (!d.pagoPor) d.pagoPor = d.aseguradora;
    if (!d.firmaNombre) d.firmaNombre = d.nombre;
    if (!d.firmaDni) d.firmaDni = d.nif;
    if (!d.fecha) d.fecha = hoyIso();
    if (!S.ajustes.nombre) { abrirAjustes(); return; }
    S.docActual = docsActivos()[0]; S.hecho[1] = true; ir(2);
  });
  function hoyIso() { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  function horaAhora() { const t = new Date(); return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); }

  /* ---------- paso 2: el documento en pantalla ---------- */
  function construirTabs() {
    const c = $('tabsDoc'); c.innerHTML = '';
    const lista = docsActivos(); if (lista.indexOf(S.docActual) < 0) S.docActual = lista[0];
    if (lista.length < 2) return;
    lista.forEach(k => { const b = document.createElement('button'); b.type = 'button'; b.textContent = DOCS[k].corto; b.className = k === S.docActual ? 'on' : ''; b.addEventListener('click', () => { S.docActual = k; construirTabs(); pedirRender(0); }); c.appendChild(b); });
  }
  async function plantilla(k) {
    if (!S.tplCache[k]) { const r = await fetch(DOCS[k].tpl); if (!r.ok) throw new Error('No encuentro la plantilla ' + k); S.tplCache[k] = new Uint8Array(await r.arrayBuffer()); }
    return S.tplCache[k];
  }
  function datos() {
    return Object.assign({}, S.d, { iva: S.d.iva.slice(),
      sigPedro: S.d.sigPedro || S.ajustes.sig || null,
      pedro: { nombre: S.ajustes.nombre || '', nif: S.ajustes.nif || '', codigo: S.ajustes.codigo || '', lugar: S.ajustes.lugar || '' } });
  }

  let rt = null, rendering = false, dirty = false;
  function pedirRender(ms) { clearTimeout(rt); rt = setTimeout(render, ms == null ? 160 : ms); }
  async function render() {
    if (rendering) { dirty = true; return; }
    if (!$('s2').classList.contains('on')) return;
    rendering = true;
    try {
      const k = S.docActual, base = await plantilla(k);
      const r = await PartesFill[DOCS[k].fn](base.slice(), datos());
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(r.bytes) }).promise;
      const pg = await doc.getPage(1), vp0 = pg.getViewport({ scale: 1 });
      const wcss = $('hoja').clientWidth || 340, dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
      const vp = pg.getViewport({ scale: wcss / vp0.width * dpr });
      const cv = $('cvDoc'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; doc.destroy();
      S.pw = vp0.width; S.ph = vp0.height; colocarHots(); estado();
    } catch (e) { console.error(e); msg('msg2', 'error', 'No he podido dibujar el documento: ' + (e.message || e)); }
    finally { rendering = false; if (dirty) { dirty = false; render(); } }
  }
  function colocarHots() {
    const c = $('hots'); c.innerHTML = '';
    (HOTS[S.docActual] || []).forEach((h, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'hot' + (falta(h) ? ' falta' : '') + (i === S.hotIdx ? ' sel' : ''); b.setAttribute('aria-label', h.t);
      b.style.left = (h.x / S.pw * 100) + '%'; b.style.top = (h.y / S.ph * 100) + '%'; b.style.width = (h.w / S.pw * 100) + '%'; b.style.height = (h.h / S.ph * 100) + '%';
      b.addEventListener('click', () => abrirEditor(i)); c.appendChild(b);
    });
  }
  function estado() {
    const hs = HOTS[S.docActual] || [], must = hs.filter(faltaObligatorio).length, soft = hs.filter(h => falta(h) && !faltaObligatorio(h)).length;
    const e = $('estado');
    if (must) { e.textContent = `Faltan ${must} obligatorios`; e.className = 'estado mal'; }
    else if (soft) { e.textContent = `Listo (${soft} dato${soft > 1 ? 's' : ''} sin rellenar)`; e.className = 'estado bien2'; }
    else { e.textContent = 'Todo relleno ✓'; e.className = 'estado bien2'; }
  }
  $('bZoom').addEventListener('click', () => { S.zoom = !S.zoom; $('hoja').style.width = S.zoom ? '210%' : '100%'; $('bZoom').textContent = S.zoom ? '🔍 Reducir' : '🔍 Ampliar'; pedirRender(0); });
  window.addEventListener('resize', () => pedirRender(250));

  /* ---------- editor de casilla ---------- */
  let padSheet = null, padKey = 'sigCliente';
  function crearControl(fl) {
    const w = document.createElement('div'); w.className = 'campo';
    const lab = document.createElement('label'); lab.textContent = fl.label;
    if (fl.kind === 'sig') {
      const cv = document.createElement('canvas'); cv.className = 'firma'; cv.id = 'padSheet';
      const bb = document.createElement('button'); bb.type = 'button'; bb.className = 'btn sec'; bb.textContent = 'Borrar firma';
      w.append(lab, cv, bb);
      setTimeout(() => { padSheet = Pad(cv, '#0a1a6b'); padSheet.resize(); padSheet.set(S.d[fl.k] || (fl.k === 'sigPedro' ? S.ajustes.sig : null)); }, 40);
      padKey = fl.k;
      bb.addEventListener('click', () => { if (padSheet) padSheet.clear(); S.d[fl.k] = null; pedirRender(); });
      return w;
    }
    if (fl.kind === 'radio') {
      const g = document.createElement('div'); g.className = 'grande';
      fl.opts.forEach(([v, t]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.className = get(fl.k) === v ? 'on' : ''; b.addEventListener('click', () => { set(fl.k, v); Array.from(g.children).forEach(x => x.classList.remove('on')); b.classList.add('on'); pedirRender(); }); g.appendChild(b); });
      w.append(lab, g); return w;
    }
    if (fl.kind === 'check') {
      const l = document.createElement('label'); l.className = 'opcion'; const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!get(fl.k);
      i.addEventListener('change', () => { set(fl.k, i.checked); pedirRender(); });
      const s = document.createElement('span'); s.textContent = fl.label; l.append(i, s); return l;
    }
    let inp;
    if (fl.kind === 'area') { inp = document.createElement('textarea'); }
    else { inp = document.createElement('input'); inp.type = fl.kind === 'date' ? 'date' : fl.kind === 'time' ? 'time' : fl.kind === 'email' ? 'email' : fl.kind === 'tel' ? 'tel' : 'text'; if (fl.kind === 'tel') inp.inputMode = 'tel'; }
    if (fl.ph) inp.placeholder = fl.ph;
    inp.value = get(fl.k) || '';
    inp.addEventListener('input', () => { set(fl.k, inp.value); pedirRender(); });
    inp.dataset.k = fl.k;
    w.append(lab, inp);
    if (fl.kind === 'time') { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sec'; b.textContent = 'Poner la hora de ahora'; b.addEventListener('click', () => { inp.value = horaAhora(); set(fl.k, inp.value); pedirRender(); }); w.appendChild(b); }
    return w;
  }
  function abrirEditor(i) {
    cerrarEditor(false);
    S.hotIdx = i; const h = HOTS[S.docActual][i];
    $('edTitulo').textContent = h.t;
    const c = $('edCampos'); c.innerHTML = ''; h.f.forEach(fl => c.appendChild(crearControl(fl)));
    $('editor').classList.add('on'); $('sombra').classList.add('on');
    const primero = c.querySelector('input,textarea'); if (primero && primero.type !== 'date') { try { primero.focus(); } catch (e) { } }
    colocarHots();
  }
  function confirmarFirma() { if (padSheet) { const p = padSheet.png(); if (p) S.d[padKey] = p; padSheet.destroy(); padSheet = null; } }
  function cerrarEditor(render_) {
    confirmarFirma();
    $('editor').classList.remove('on'); $('sombra').classList.remove('on'); S.hotIdx = -1;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (render_ !== false) pedirRender(0);
  }
  $('edHecho').addEventListener('click', () => cerrarEditor(true));
  $('sombra').addEventListener('click', () => cerrarEditor(true));
  function siguienteVacio() {
    const hs = HOTS[S.docActual] || [], n = hs.length, ini = S.hotIdx;
    confirmarFirma();
    for (let s = 1; s <= n; s++) { const j = (ini + s + n) % n; if (falta(hs[j])) { abrirEditor(j); return; } }
    cerrarEditor(true); msg('msg2', 'bien', 'No falta nada por rellenar en este documento.'); setTimeout(() => msg('msg2', '', ''), 2500);
  }
  $('edSig').addEventListener('click', siguienteVacio);
  $('bSig').addEventListener('click', () => { S.hotIdx = -1; siguienteVacio(); });

  /* ---------- comprobaciones antes de seguir ---------- */
  function problemas() {
    const f = [];
    docsActivos().forEach(k => {
      (HOTS[k] || []).forEach(h => h.f.forEach(fl => { if (fl.req === 'must' && vacio(fl)) { const t = `${docsActivos().length > 1 ? DOCS[k].corto + ': ' : ''}falta «${fl.label}»`; if (f.indexOf(t) < 0) f.push(t); } }));
    });
    return f;
  }
  $('to3').addEventListener('click', () => { const f = problemas(); if (f.length) return msg('msg2', 'error', f); msg('msg2', '', ''); S.hecho[2] = true; ir(3); });

  /* ---------- paso 3: fotos ---------- */
  async function reducir(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    } finally { URL.revokeObjectURL(url); }
  }
  $('fFotos').addEventListener('change', async (e) => {
    const lista = Array.from(e.target.files || []); e.target.value = '';
    for (const f of lista) { try { S.fotos.push(await reducir(f)); } catch (er) { console.error(er); } }
    pintarFotos();
  });
  function pintarFotos() {
    const g = $('rejilla'); g.innerHTML = '';
    S.fotos.forEach((b, i) => {
      const d = document.createElement('div'); d.className = 'foto';
      const im = document.createElement('img'); im.src = URL.createObjectURL(b);
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Quitar foto');
      x.addEventListener('click', () => { S.fotos.splice(i, 1); pintarFotos(); });
      d.append(im, x); g.appendChild(d);
    });
    $('notaFotos').textContent = S.fotos.length ? S.fotos.length + (S.fotos.length === 1 ? ' foto lista.' : ' fotos listas.') : 'Todavía no hay fotos.';
  }
  $('to4').addEventListener('click', () => { S.hecho[3] = true; ir(4); });

  /* ---------- generar los documentos definitivos ---------- */
  function nombreFich(k, d) { return (d.registro || 'parte').replace(/[^\w-]+/g, '_') + '_' + DOCS[k].fich + '.pdf'; }
  async function generar() {
    const d = datos(), salida = [], avisos = [];
    for (const k of docsActivos()) {
      const r = await PartesFill[DOCS[k].fn]((await plantilla(k)).slice(), d);
      salida.push({ k, nombre: nombreFich(k, d), bytes: r.bytes });
      r.warnings.forEach(w => avisos.push(DOCS[k].nombre + ': ' + w));
    }
    return { salida, avisos, d };
  }

  /* ---------- paso 4: revisar y enviar ---------- */
  const asuntoDe = (d) => [d.registro, d.expediente].filter(Boolean).join(' - ');
  function cuerpoDe(d, docs) {
    const L = [];
    L.push(`Parte nº ${d.registro} - Expediente ${d.expediente}`);
    L.push(`Cliente: ${d.nombre}${d.direccion ? ' - ' + d.direccion : ''}${d.cp || d.poblacion ? ', ' + [d.cp, d.poblacion].filter(Boolean).join(' ') : ''}`);
    L.push(''); L.push('Trabajo realizado: ' + d.realizados);
    if (d.pendientes) L.push('Pendiente: ' + d.pendientes);
    L.push(''); L.push(`Se adjunta: ${docs.map(x => DOCS[x.k].nombre).join(', ')}, firmado por el cliente` + (S.fotos.length ? ` y ${S.fotos.length} foto${S.fotos.length === 1 ? '' : 's'} de la actuación.` : '.'));
    L.push(''); L.push('Un saludo,'); L.push(S.ajustes.nombre || 'Hidro Point Barcelona');
    return L.join('\n');
  }
  let generando = 0;
  async function prepararEnvio() {
    const turno = ++generando; msg('msg4', '', '');
    $('para').value = DEFAULT_EMAIL;
    $('vistas').innerHTML = '<p class="nota">Preparando…</p>'; $('bEnviar').disabled = true; $('fallback').innerHTML = '';
    const f = problemas();
    if (!S.ajustes.nombre) f.push('Faltan «Mis datos» (nombre de Pedro). Pulsa ⚙ arriba.');
    if (f.length) { msg('msg4', 'error', f); $('vistas').innerHTML = ''; return; }
    try {
      const g = await generar(); if (turno !== generando) return;
      S.files = g.salida.map(x => new File([x.bytes], x.nombre, { type: 'application/pdf' }));
      S.fotos.forEach((b, i) => S.files.push(new File([b], `${g.d.registro || 'parte'}_foto_${i + 1}.jpg`, { type: 'image/jpeg' })));
      $('asunto').textContent = asuntoDe(g.d); $('cuerpo').value = cuerpoDe(g.d, g.salida);
      $('resumenAdj').textContent = 'Se adjuntará: ' + S.files.map(x => x.name).join(', ');
      if (g.avisos.length) msg('msg4', 'aviso', g.avisos);
      $('bEnviar').disabled = false; await pintarVistas(g.salida, turno);
    } catch (e) { console.error(e); msg('msg4', 'error', 'No he podido preparar los documentos: ' + (e.message || e)); }
  }
  async function pintarVistas(salida, turno) {
    const c = $('vistas'); c.innerHTML = '';
    for (const s of salida) {
      const t = document.createElement('p'); t.className = 'nota'; t.textContent = DOCS[s.k].nombre; c.appendChild(t);
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(s.bytes) }).promise;
      const pg = await doc.getPage(1), base = pg.getViewport({ scale: 1 });
      const ancho = Math.min(c.clientWidth || 340, 700), vp = pg.getViewport({ scale: ancho / base.width * 1.6 });
      const cv = document.createElement('canvas'); cv.className = 'vista'; cv.width = vp.width; cv.height = vp.height;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; doc.destroy();
      if (turno !== generando) return; c.appendChild(cv);
    }
  }
  $('bCopiar').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('asunto').textContent); msg('msg4', 'bien', 'Asunto copiado.'); } catch (e) { msg('msg4', 'aviso', 'No he podido copiarlo. Asunto: ' + $('asunto').textContent); } });
  $('bEnviar').addEventListener('click', async () => {
    const asunto = $('asunto').textContent, cuerpo = $('cuerpo').value, para = ($('para').value || '').trim();
    try { navigator.clipboard && navigator.clipboard.writeText(asunto).catch(() => { }); } catch (e) { }
    if (navigator.canShare && navigator.canShare({ files: S.files })) {
      try { await navigator.share({ files: S.files, title: asunto, text: cuerpo }); msg('msg4', 'bien', `Elige «Mail» y envíalo a ${para}. Comprueba que el asunto sea «${asunto}»; ya está copiado por si hay que pegarlo.`); return; }
      catch (e) { if (e && e.name === 'AbortError') return; console.error(e); }
    }
    mostrarAlternativa(asunto, cuerpo, para);
  });
  function mostrarAlternativa(asunto, cuerpo, para) {
    const f = $('fallback'); f.innerHTML = '';
    const a = document.createElement('div'); a.className = 'aviso'; a.textContent = 'Este dispositivo no permite compartir los archivos directamente. Descarga los archivos y adjúntalos al correo.'; f.appendChild(a);
    S.files.forEach(file => { const l = document.createElement('a'); l.className = 'dl'; l.textContent = '⬇ ' + file.name; l.href = URL.createObjectURL(file); l.download = file.name; f.appendChild(l); });
    const m = document.createElement('a'); m.className = 'dl'; m.textContent = '✉ Abrir el correo (sin adjuntos)';
    m.href = 'mailto:' + encodeURIComponent(para) + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(cuerpo); f.appendChild(m);
  }
  $('bNuevo').addEventListener('click', () => {
    if (!confirm('¿Empezar un parte nuevo? Se borrarán los datos de este.')) return;
    S.d = nuevoD(); ids1.forEach(k => { $(k).value = ''; }); resumenCliente();
    S.fotos = []; pintarFotos(); S.files = []; S.hecho = {}; S.incluir = false; S.tipo = 'parte'; S.docActual = 'parte';
    msg('msgPdf', '', ''); msg('msgDoc', '', ''); $('fallback').innerHTML = ''; pintarOpcionesDoc(); ir(1);
  });

  /* ---------- arranque ---------- */
  pintarOpcionesDoc();
  if (!S.ajustes.nombre) abrirAjustes();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) { navigator.serviceWorker.register('sw.js').catch(() => { }); }
  window.__hp = { S, generar, datos, docsActivos };
})();
