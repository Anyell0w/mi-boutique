import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Share } from '@capacitor/share';

import {
  db, load, save, flush, crearUsuario, verificarPin, hashPin, newSalt, guardarFoto, leerFoto, borrarFoto,
  exportarRespaldo, importarRespaldo, CATEGORIAS, TALLAS, DENOMINACIONES, uid, r2, isoDay,
} from './store.js';
import {
  ic, paintIcons, esc, money, initials, fmtFecha, fmtHora, fmtFull, haptic, toast, openSheet, closeSheet,
  hasSheet, confirmDialog, countUp, mountSeg, comprimirImagen,
} from './ui.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');

// =========================================================
// Estado de la sesión (no persistente)
// =========================================================
const S = {
  user: null,
  tab: 'vender',
  cart: [],
  cat: 'Todas',
  q: '',
  pago: 'Efectivo',
  descTipo: 'monto',
  descVal: 0,
  recibido: '',
  foto: null,
  hist: { rango: 'hoy', fecha: isoDay(), turno: 'TODOS', sub: 'ventas' },
  inv: { q: '', filtro: 'todos' },
  conteo: { apertura: {}, cierre: {} },
  login: { userId: null, pin: '', fails: 0, lockUntil: 0 },
};

const esAdmin = () => S.user?.rol === 'Administrador';
const catInfo = id => CATEGORIAS.find(c => c.id === id) || CATEGORIAS[0];
const pinLen = rol => (rol === 'Administrador' ? 8 : 4);

// =========================================================
// Dominio: caja, ventas, egresos
// =========================================================
function totales(idCaja, montoInicial = 0) {
  const vs = db.ventas.filter(v => v.idCaja === idCaja);
  const es = db.egresos.filter(e => e.idCaja === idCaja);
  const ventasEfectivo = r2(vs.filter(v => v.metodoPago === 'Efectivo').reduce((a, v) => a + v.total, 0));
  const ventasYape = r2(vs.filter(v => v.metodoPago !== 'Efectivo').reduce((a, v) => a + v.total, 0));
  const totalEgresos = r2(es.reduce((a, e) => a + e.monto, 0));
  const prendas = vs.reduce((a, v) => a + v.items.reduce((x, i) => x + i.cantidad, 0), 0);
  return {
    ventasEfectivo, ventasYape, totalEgresos, prendas, nVentas: vs.length,
    esperado: r2(montoInicial + ventasEfectivo - totalEgresos),
  };
}
function recalcCierre(idCaja) {
  const c = db.cierres.find(x => x.id === idCaja);
  if (!c) return;
  const t = totales(idCaja, c.montoInicial);
  Object.assign(c, {
    ventasEfectivo: t.ventasEfectivo, ventasYape: t.ventasYape,
    totalEgresos: t.totalEgresos, efectivoEsperado: t.esperado,
  });
}
const sumaConteo = m => r2(DENOMINACIONES.reduce((a, d) => a + (m[d] || 0) * d, 0));
const limpiarConteo = m => Object.fromEntries(Object.entries(m).filter(([, n]) => n > 0));

function cartTotals() {
  const sub = r2(S.cart.reduce((a, i) => a + i.precio * i.cantidad, 0));
  const val = Math.max(0, Number(S.descVal) || 0);
  const desc = r2(Math.min(sub, S.descTipo === 'pct' ? (sub * Math.min(val, 100)) / 100 : val));
  const total = r2(sub - desc);
  const recibido = Number(S.recibido) || 0;
  const vuelto = r2(recibido - total);
  const n = S.cart.reduce((a, i) => a + i.cantidad, 0);
  return { sub, desc, total, recibido, vuelto, n };
}

// =========================================================
// Arranque
// =========================================================
async function boot() {
  if (Capacitor.isNativePlatform()) {
    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#F8F7F8' }).catch(() => {});
    App.addListener('backButton', () => {
      if (hasSheet()) return closeSheet();
      if (S.user && S.tab !== 'vender') return go('vender');
      App.minimizeApp();
    });
    App.addListener('pause', () => flush());
  }
  await load();
  db.usuarios.length ? renderLogin() : renderSetup();
  SplashScreen.hide().catch(() => {});
  window.addEventListener('scroll', () => $('.topbar')?.classList.toggle('scrolled', scrollY > 4), { passive: true });
}

// =========================================================
// Configuración inicial (primer uso)
// =========================================================
function renderSetup() {
  app.innerHTML = `
    <div class="auth view-enter">
      <div class="brandmark" style="--i:0">${ic('Store')}</div>
      <h1 style="--i:1">Configura tu tienda</h1>
      <p class="lead" style="--i:2">Es la primera vez que se abre la app en este equipo. Crea la cuenta de administración.</p>
      <form class="stack" id="f-setup" style="margin-top:26px;--i:3">
        <div class="field"><label>Nombre de la tienda</label>
          <input class="input" name="tienda" required maxlength="40" value="Mi Boutique"></div>
        <div class="field"><label>Tu nombre</label>
          <input class="input" name="nombre" required maxlength="30" placeholder="Ej. Angela"></div>
        <label class="row" style="font-size:14px;color:var(--ink-2);margin-top:4px">
          <input type="checkbox" name="demo" checked style="width:18px;height:18px;accent-color:var(--brand)">
          Cargar prendas de ejemplo
        </label>
        <button class="btn primary block" style="margin-top:10px">Continuar ${ic('ChevronRight')}</button>
      </form>
    </div>`;
  paintIcons(app);
  $('#f-setup').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const datos = { tienda: f.get('tienda').trim(), nombre: f.get('nombre').trim(), demo: !!f.get('demo') };
    pinCreate({
      title: 'Crea tu PIN de administración',
      sub: '8 dígitos. Lo usarás para entrar y autorizar cambios.',
      length: 8,
      onDone: async pin => {
        db.tienda = datos.tienda || 'Mi Boutique';
        const u = await crearUsuario({ nombre: datos.nombre, rol: 'Administrador', pin });
        if (datos.demo) seedDemo();
        await flush();
        S.user = u;
        toast(`¡Bienvenida, ${u.nombre}!`, 'info');
        renderApp('caja');
      },
      onBack: renderSetup,
    });
  };
}

function seedDemo() {
  const p = (nombre, categoria, talla, color, precio, stock) => ({ id: uid(), nombre, categoria, talla, color, precio, stock });
  db.productos = [
    p('Blusa satinada clásica', 'Blusas y Tops', 'M', 'Champagne', 55, 6),
    p('Top de lino', 'Blusas y Tops', 'S', 'Blanco', 39.9, 5),
    p('Vestido midi floral', 'Vestidos', 'S', 'Rosa palo', 89, 4),
    p('Vestido negro cóctel', 'Vestidos', 'M', 'Negro', 129, 2),
    p('Jean wide leg tiro alto', 'Pantalones y Jeans', 'M', 'Celeste', 95, 8),
    p('Falda plisada midi', 'Faldas y Shorts', 'Estándar', 'Vino', 69, 3),
    p('Blazer oversize', 'Casacas y Abrigos', 'Estándar', 'Negro', 110, 3),
    p('Conjunto deportivo', 'Conjuntos', 'L', 'Gris melange', 120, 1),
  ];
}

// =========================================================
// PIN pad reutilizable
// =========================================================
function pinPadHTML(len) {
  return `
    <div class="pin-dots" id="dots">${Array.from({ length: len }, () => '<i></i>').join('')}</div>
    <div class="pin-msg" id="pin-msg"></div>
    <div class="keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="key" data-k="${n}">${n}</button>`).join('')}
      <span></span>
      <button class="key" data-k="0">0</button>
      <button class="key fn" data-k="del" aria-label="Borrar">${ic('Delete')}</button>
    </div>`;
}
function bindPad(root, getLen, onChange) {
  let pin = '';
  const dots = () => $$('#dots i', root).forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const api = {
    reset() { pin = ''; dots(); },
    error(msg) {
      const d = $('#dots', root);
      d.classList.add('err');
      $('#pin-msg', root).textContent = msg;
      $('#pin-msg', root).classList.add('bad');
      haptic.err();
      setTimeout(() => { d.classList.remove('err'); pin = ''; dots(); }, 480);
    },
    msg(m) { const el = $('#pin-msg', root); el.textContent = m; el.classList.remove('bad'); },
  };
  $$('[data-k]', root).forEach(b => b.addEventListener('click', () => {
    haptic.tap();
    const k = b.dataset.k;
    if (k === 'del') pin = pin.slice(0, -1);
    else if (pin.length < getLen()) pin += k;
    dots();
    if (pin.length === getLen()) setTimeout(() => onChange(pin, api), 120);
  }));
  return api;
}

function pinCreate({ title, sub, length, onDone, onBack }) {
  let first = null;
  app.innerHTML = `
    <div class="auth view-enter">
      <button class="icon-btn" id="back" style="--i:0">${ic('ArrowLeft')}</button>
      <h1 id="pc-title" style="--i:1">${title}</h1>
      <p class="lead" id="pc-sub" style="--i:2">${sub}</p>
      ${pinPadHTML(length)}
    </div>`;
  paintIcons(app);
  $('#back').onclick = onBack;
  bindPad(app, () => length, (pin, pad) => {
    if (!first) {
      first = pin; pad.reset();
      $('#pc-title').textContent = 'Confirma tu PIN';
      $('#pc-sub').textContent = 'Vuelve a ingresarlo para evitar errores.';
    } else if (pin !== first) {
      first = null;
      $('#pc-title').textContent = title;
      $('#pc-sub').textContent = sub;
      pad.error('Los PIN no coinciden. Inténtalo de nuevo.');
    } else { haptic.ok(); onDone(pin); }
  });
}

// =========================================================
// Login
// =========================================================
function renderLogin() {
  const L = S.login;
  if (!db.usuarios.some(u => u.id === L.userId)) L.userId = db.usuarios[0]?.id;
  const u = () => db.usuarios.find(x => x.id === L.userId);
  app.innerHTML = `
    <div class="auth view-enter">
      <div class="brandmark" style="--i:0">${ic('ShoppingBag')}</div>
      <h1 style="--i:1">${esc(db.tienda)}</h1>
      <p class="lead" style="--i:2">¿Quién está en caja hoy?</p>
      <div class="users-row" style="--i:3">
        ${db.usuarios.map(x => `
          <button class="ucard ${x.id === L.userId ? 'on' : ''}" data-u="${x.id}">
            <span class="avatar lg">${esc(initials(x.nombre))}</span>
            <span class="nm">${esc(x.nombre)}</span>
            <span class="rl">${x.rol === 'Administrador' ? 'Admin' : 'Vendedora'}</span>
          </button>`).join('')}
      </div>
      <div style="--i:4">${pinPadHTML(8)}</div>
    </div>`;
  paintIcons(app);
  const setDots = () => {
    const len = pinLen(u().rol);
    $('#dots').innerHTML = Array.from({ length: len }, () => '<i></i>').join('');
  };
  setDots();
  const pad = bindPad(app, () => pinLen(u().rol), async (pin, p) => {
    if (Date.now() < L.lockUntil) return p.error(`Demasiados intentos. Espera ${Math.ceil((L.lockUntil - Date.now()) / 1000)} s.`);
    if (await verificarPin(u(), pin)) {
      L.fails = 0; haptic.ok();
      S.user = u();
      renderApp(db.cajaActiva ? 'vender' : 'caja');
    } else {
      L.fails++;
      if (L.fails >= 5) { L.lockUntil = Date.now() + 30000; L.fails = 0; }
      p.error(L.lockUntil > Date.now() ? 'Bloqueado 30 s por seguridad.' : 'PIN incorrecto');
    }
  });
  pad.msg(`Ingresa tu PIN de ${pinLen(u().rol)} dígitos`);
  $$('[data-u]').forEach(b => b.addEventListener('click', () => {
    haptic.tap();
    L.userId = Number(b.dataset.u);
    $$('.ucard').forEach(x => x.classList.toggle('on', x === b));
    pad.reset(); setDots();
    pad.msg(`Ingresa tu PIN de ${pinLen(u().rol)} dígitos`);
  }));
}

function logout() {
  S.user = null; S.cart = []; S.descVal = 0; S.recibido = ''; S.foto = null;
  closeAllSheets();
  renderLogin();
}
function closeAllSheets() { while (closeSheet()); }

// =========================================================
// Shell de la app
// =========================================================
const TABS = () => [
  { id: 'vender', label: 'Vender', icon: 'ShoppingBag' },
  { id: 'caja', label: 'Caja', icon: 'Wallet' },
  { id: 'historial', label: 'Historial', icon: 'History' },
  ...(esAdmin() ? [{ id: 'inventario', label: 'Stock', icon: 'Package' }, { id: 'equipo', label: 'Equipo', icon: 'Users' }] : []),
];

function renderApp(tab = S.tab) {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar" id="topbar"></header>
      <main class="view" id="view"></main>
      <div class="cartbar" id="cartbar" data-a="openCart">
        <span class="n num" id="cb-n">0</span>
        <div><div style="font-size:12px;opacity:.65">Total</div><div class="num" id="cb-t" style="font-weight:650;font-size:16px">S/ 0.00</div></div>
        <span class="go">Cobrar ${ic('ChevronRight')}</span>
      </div>
      <nav class="tabbar"><div class="inner" id="tabs"></div></nav>
    </div>`;
  paintIcons(app);
  go(tab, true);
}

function go(tab, force = false) {
  if (!force && tab === S.tab && $('#view')?.childElementCount) return;
  if (!TABS().some(t => t.id === tab)) tab = 'vender';
  S.tab = tab;
  $('#tabs').innerHTML = TABS().map(t => `
    <button class="tab ${t.id === tab ? 'on' : ''}" data-a="go" data-tab="${t.id}">
      <span class="ic">${ic(t.icon)}</span>${t.label}
    </button>`).join('');
  paintIcons($('#tabs'));
  window.scrollTo({ top: 0 });
  renderView(true);
}

function renderTopbar(title, extra = '') {
  const caja = db.cajaActiva;
  $('#topbar').innerHTML = `
    <div class="grow">
      <div class="eyebrow"><span class="dot ${caja ? 'live' : 'off'}"></span>
        ${caja ? `Turno #${caja.numeroTurno} abierto` : 'Caja cerrada'}</div>
      <h1>${title}</h1>
    </div>
    ${extra}
    <button class="avatar" data-a="settings" aria-label="Cuenta">${esc(initials(S.user.nombre))}</button>`;
  paintIcons($('#topbar'));
}

function renderView(animate = false) {
  const v = $('#view');
  if (!v) return;
  v.className = 'view';
  ({ vender: viewVender, caja: viewCaja, historial: viewHistorial, inventario: viewInventario, equipo: viewEquipo })[S.tab]();
  if (animate) { void v.offsetWidth; v.classList.add('view-enter'); [...v.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 8))); }
  paintIcons(v);
  countUp(v);
  $$('.seg', v).forEach(mountSeg);
  updateCartbar();
}

// =========================================================
// VENDER (POS)
// =========================================================
function viewVender() {
  renderTopbar('Vender');
  const v = $('#view');
  if (!db.cajaActiva) {
    v.innerHTML = emptyState('LockOpen', 'Abre la caja para vender', 'Registra el efectivo inicial del turno y empieza a cobrar.',
      `<button class="btn primary" data-a="go" data-tab="caja">${ic('LockOpen')} Abrir caja</button>`);
    return;
  }
  const counts = Object.fromEntries(CATEGORIAS.map(c => [c.id, db.productos.filter(p => p.categoria === c.id).length]));
  v.innerHTML = `
    <div class="search-sticky">
      <div class="input-wrap">${ic('Search')}
        <input class="input" id="pos-q" type="search" placeholder="Buscar prenda, color o talla" value="${esc(S.q)}" autocomplete="off">
      </div>
      <div class="chips" style="margin-top:10px">
        <button class="chip ${S.cat === 'Todas' ? 'on' : ''}" data-a="cat" data-cat="Todas">Todo <span class="count">${db.productos.length}</span></button>
        ${CATEGORIAS.filter(c => counts[c.id]).map(c => `
          <button class="chip ${S.cat === c.id ? 'on' : ''}" data-a="cat" data-cat="${c.id}">${c.corto} <span class="count">${counts[c.id]}</span></button>`).join('')}
      </div>
    </div>
    <div class="pgrid" id="pgrid"></div>`;
  renderGrid();
  $('#pos-q').addEventListener('input', e => { S.q = e.target.value; renderGrid(); });
}

function productosFiltrados() {
  const q = S.q.trim().toLowerCase();
  return db.productos.filter(p =>
    (S.cat === 'Todas' || p.categoria === S.cat) &&
    (!q || `${p.nombre} ${p.color} ${p.talla}`.toLowerCase().includes(q)));
}

function pcardHTML(p, i = 0) {
  const c = catInfo(p.categoria);
  const inCart = S.cart.find(x => x.id === p.id)?.cantidad || 0;
  const out = p.stock <= 0;
  return `
    <button class="pcard ${inCart ? 'in-cart' : ''} ${out ? 'out' : ''}" data-a="add" data-id="${p.id}" ${out ? 'disabled' : ''}
      style="animation:rise .4s var(--ease-out) both;animation-delay:${Math.min(i, 10) * 30}ms">
      ${inCart ? `<span class="qty num">${inCart}</span>` : ''}
      <div class="ph" style="background:${c.bg};color:${c.fg}"><span class="size">${esc(p.talla)}</span>${c.abbr}</div>
      <div>
        <div class="name">${esc(p.nombre)}</div>
        <div class="meta">${esc(p.color)} · ${out ? '<span class="stock-low">Agotado</span>' : p.stock <= 2 ? `<span class="stock-low">Quedan ${p.stock}</span>` : `${p.stock} disp.`}</div>
      </div>
      <div class="foot"><span class="price num">${money(p.precio)}</span><span class="add">${ic('Plus')}</span></div>
    </button>`;
}

function renderGrid() {
  const g = $('#pgrid');
  if (!g) return;
  const list = productosFiltrados();
  g.innerHTML = list.length ? list.map(pcardHTML).join('')
    : `<div style="grid-column:1/-1">${emptyState('Search', 'Sin resultados', db.productos.length ? 'Prueba con otro nombre, color o talla.' : 'Aún no hay prendas en el inventario.',
      esAdmin() && !db.productos.length ? `<button class="btn soft" data-a="go" data-tab="inventario">${ic('PackagePlus')} Agregar prendas</button>` : '')}</div>`;
  paintIcons(g);
}

function refreshCard(id) {
  const old = $(`.pcard[data-id="${id}"]`);
  const p = db.productos.find(x => x.id === id);
  if (!old || !p) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = pcardHTML(p);
  const nu = tmp.firstElementChild;
  nu.style.animation = 'none';
  old.replaceWith(nu);
  paintIcons(nu);
}

function addToCart(id) {
  const p = db.productos.find(x => x.id === id);
  if (!p || p.stock <= 0) return;
  const it = S.cart.find(x => x.id === id);
  if (it) {
    if (it.cantidad >= p.stock) return toast(`Solo hay ${p.stock} en stock`, 'bad');
    it.cantidad++;
  } else S.cart.push({ id: p.id, nombre: p.nombre, talla: p.talla, color: p.color, categoria: p.categoria, precio: p.precio, cantidad: 1 });
  haptic.tap();
  refreshCard(id);
  updateCartbar(true);
}

function updateCartbar(bump = false) {
  const bar = $('#cartbar');
  if (!bar) return;
  const t = cartTotals();
  const show = S.tab === 'vender' && S.cart.length > 0 && !!db.cajaActiva;
  bar.classList.toggle('show', show);
  $('#cb-n').textContent = t.n;
  $('#cb-t').textContent = money(t.total);
  if (bump) { const n = $('#cb-n'); n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); }
}

// ---------- Carrito / cobro ----------
function openCart() {
  if (!S.cart.length) return;
  openSheet({
    title: 'Venta actual',
    subtitle: `Turno #${db.cajaActiva.numeroTurno} · ${esc(S.user.nombre)}`,
    body: `
      <div class="list" id="cart-items"></div>
      <div class="section-title" style="margin-top:16px">Descuento</div>
      <div class="row">
        <div class="seg" id="desc-seg" style="width:110px;flex-shrink:0">
          <button data-dt="monto" class="${S.descTipo === 'monto' ? 'on' : ''}">S/</button>
          <button data-dt="pct" class="${S.descTipo === 'pct' ? 'on' : ''}">%</button>
        </div>
        <input class="input num" id="desc-val" inputmode="decimal" type="number" min="0" step="0.5" placeholder="0" value="${S.descVal || ''}" style="height:42px">
      </div>
      <div class="totals" id="cart-totals"></div>
      <div class="section-title" style="margin-top:4px">Método de pago</div>
      <div class="pay">
        <button data-pay="Efectivo" class="cash ${S.pago === 'Efectivo' ? 'on' : ''}">
          <span class="tile" style="background:var(--ok-50);color:var(--ok)">${ic('Banknote')}</span>
          <span><b>Efectivo</b><small>Entra a caja</small></span></button>
        <button data-pay="Yape/Plin" class="yape ${S.pago !== 'Efectivo' ? 'on' : ''}">
          <span class="tile" style="background:var(--yape-50);color:var(--yape)">${ic('Smartphone')}</span>
          <span><b>Yape / Plin</b><small>Pago digital</small></span></button>
      </div>
      <div id="cash-box" class="collapse ${S.pago === 'Efectivo' ? 'open' : ''}"><div>
        <div class="field" style="margin-top:14px"><label>Monto recibido</label>
          <div class="input-wrap"><span class="pre">S/</span><input class="input num" id="recibido" inputmode="decimal" type="number" min="0" step="0.1" placeholder="Opcional — calcula el vuelto" value="${esc(S.recibido)}"></div>
          <div class="chips" id="quick-cash" style="margin-top:4px"></div>
        </div>
      </div></div>
      <div class="field" style="margin-top:14px"><label>Comprobante o foto <span style="color:var(--muted);font-weight:400">(opcional)</span></label>
        <label class="photo-drop" id="photo-drop">
          <input type="file" accept="image/*" id="foto-in">
          <span id="photo-prev">${S.foto ? `<img src="${S.foto}">` : `<span class="tile" style="background:var(--brand-50);color:var(--brand)">${ic('ImagePlus')}</span>`}</span>
          <span class="grow">${S.foto ? 'Foto adjunta · toca para cambiar' : 'Captura de Yape o foto de la prenda'}</span>
          ${S.foto ? `<button class="icon-btn sm" id="foto-del" type="button">${ic('Trash2')}</button>` : ''}
        </label>
      </div>`,
    foot: `<button class="btn primary block" id="btn-cobrar">Cobrar <span class="num" id="btn-total"></span></button>`,
    onMount: (el, close) => {
      const items = $('#cart-items', el);
      const drawItems = () => {
        items.innerHTML = S.cart.map(i => {
          const c = catInfo(i.categoria);
          return `<div class="li">
            <span class="tile" style="background:${c.bg};color:${c.fg}">${c.abbr}</span>
            <div class="grow"><div class="t">${esc(i.nombre)}</div><div class="s">Talla ${esc(i.talla)} · ${esc(i.color)} · <span class="num">${money(i.precio)}</span></div></div>
            <div class="stepper">
              <button data-q="-1" data-id="${i.id}">${ic(i.cantidad === 1 ? 'Trash2' : 'Minus')}</button>
              <span class="num">${i.cantidad}</span>
              <button data-q="1" data-id="${i.id}">${ic('Plus')}</button>
            </div></div>`;
        }).join('');
        paintIcons(items);
      };
      const drawTotals = () => {
        const t = cartTotals();
        $('#cart-totals', el).innerHTML = `
          <div class="row"><span>Subtotal · ${t.n} ${t.n === 1 ? 'prenda' : 'prendas'}</span><span class="num">${money(t.sub)}</span></div>
          ${t.desc ? `<div class="row" style="color:var(--warn)"><span>Descuento</span><span class="num">− ${money(t.desc)}</span></div>` : ''}
          <div class="row grand"><span>Total</span><span class="num">${money(t.total)}</span></div>
          ${S.pago === 'Efectivo' && t.recibido > 0 ? `<div class="diff ${t.vuelto >= 0 ? 'ok' : 'under'}" style="margin-top:6px">
            ${ic(t.vuelto >= 0 ? 'Coins' : 'CircleAlert')} ${t.vuelto >= 0 ? 'Vuelto a entregar' : 'Falta cobrar'}
            <span class="num">${money(Math.abs(t.vuelto))}</span></div>` : ''}`;
        paintIcons($('#cart-totals', el));
        $('#btn-total', el).textContent = money(t.total);
        const quick = [...new Set([t.total, Math.ceil(t.total / 10) * 10, Math.ceil(t.total / 50) * 50, Math.ceil(t.total / 100) * 100, 200])]
          .filter(x => x >= t.total && x > 0).slice(0, 5);
        $('#quick-cash', el).innerHTML = quick.map(q => `<button class="chip ${Number(S.recibido) === q ? 'on' : ''}" data-rc="${q}">${q === t.total ? 'Exacto' : `S/ ${q}`}</button>`).join('');
        $('#btn-cobrar', el).disabled = S.pago === 'Efectivo' && t.recibido > 0 && t.vuelto < 0;
        updateCartbar();
      };
      drawItems(); drawTotals();

      items.addEventListener('click', e => {
        const b = e.target.closest('[data-q]');
        if (!b) return;
        haptic.tap();
        const id = Number(b.dataset.id), d = Number(b.dataset.q);
        const it = S.cart.find(x => x.id === id);
        const p = db.productos.find(x => x.id === id);
        it.cantidad += d;
        if (it.cantidad > p.stock) { it.cantidad = p.stock; toast(`Solo hay ${p.stock} en stock`, 'bad'); }
        if (it.cantidad <= 0) S.cart = S.cart.filter(x => x.id !== id);
        refreshCard(id);
        if (!S.cart.length) { updateCartbar(); return close(); }
        drawItems(); drawTotals();
      });
      $$('[data-dt]', el).forEach(b => b.onclick = () => {
        S.descTipo = b.dataset.dt;
        $$('[data-dt]', el).forEach(x => x.classList.toggle('on', x === b));
        mountSeg($('#desc-seg', el)); drawTotals();
      });
      mountSeg($('#desc-seg', el));
      $('#desc-val', el).oninput = e => { S.descVal = e.target.value; drawTotals(); };
      $('#recibido', el).oninput = e => { S.recibido = e.target.value; drawTotals(); };
      $('#quick-cash', el).addEventListener('click', e => {
        const b = e.target.closest('[data-rc]');
        if (!b) return;
        haptic.tap();
        S.recibido = b.dataset.rc; $('#recibido', el).value = S.recibido; drawTotals();
      });
      $$('[data-pay]', el).forEach(b => b.onclick = () => {
        haptic.tap();
        S.pago = b.dataset.pay;
        $$('[data-pay]', el).forEach(x => x.classList.toggle('on', x === b));
        $('#cash-box', el).classList.toggle('open', S.pago === 'Efectivo');
        drawTotals();
      });
      $('#foto-in', el).onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          S.foto = await comprimirImagen(f);
          $('#photo-prev', el).innerHTML = `<img src="${S.foto}">`;
          $('#photo-drop .grow', el).textContent = 'Foto adjunta · toca para cambiar';
        } catch { toast('No se pudo leer la imagen', 'bad'); }
      };
      $('#foto-del', el)?.addEventListener('click', e => { e.preventDefault(); S.foto = null; close(); setTimeout(openCart, 320); });
      $('#btn-cobrar', el).onclick = () => cobrar(close);
    },
  });
}

async function cobrar(closeCart) {
  const caja = db.cajaActiva;
  if (!caja || !S.cart.length) return;
  for (const i of S.cart) {
    const p = db.productos.find(x => x.id === i.id);
    if (!p || p.stock < i.cantidad) return toast(`Stock insuficiente: ${i.nombre}`, 'bad');
  }
  const t = cartTotals();
  const id = uid();
  let foto = null;
  if (S.foto) { try { foto = await guardarFoto(id, S.foto); } catch { toast('No se pudo guardar la foto', 'bad'); } }
  S.cart.forEach(i => { db.productos.find(x => x.id === i.id).stock -= i.cantidad; });
  const now = Date.now();
  const venta = {
    id, ts: now, idCaja: caja.id, numeroTurno: caja.numeroTurno,
    fechaISO: isoDay(), fechaTexto: fmtFull(now), vendedora: S.user.nombre,
    items: S.cart.map(i => ({ ...i })), subtotal: t.sub, descuento: t.desc, total: t.total,
    metodoPago: S.pago, recibido: S.pago === 'Efectivo' && t.recibido ? t.recibido : null,
    vuelto: S.pago === 'Efectivo' && t.recibido ? t.vuelto : null, foto,
  };
  db.ventas.unshift(venta);
  save();
  S.cart = []; S.descVal = 0; S.recibido = ''; S.foto = null; S.pago = 'Efectivo';
  closeCart();
  haptic.ok();
  renderGrid(); updateCartbar();
  setTimeout(() => openSheet({
    dialog: true,
    body: `<div class="success">
      <div class="ring"><svg class="check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h3>Venta registrada</h3>
      <div class="amount num">${money(venta.total)}</div>
      <span class="badge ${venta.metodoPago === 'Efectivo' ? 'ok' : 'yape'}">${venta.metodoPago}</span>
      ${venta.vuelto ? `<p style="margin:12px 0 0;color:var(--ink-2)">Entrega <b class="num">${money(venta.vuelto)}</b> de vuelto</p>` : ''}
    </div>
    <button class="btn dark block" data-close style="margin-top:18px">Nueva venta</button>`,
  }), 280);
}

// =========================================================
// CAJA
// =========================================================
function denomCounterHTML(tipo) {
  const m = S.conteo[tipo];
  return `<div class="denoms" id="den-${tipo}">${DENOMINACIONES.map(d => {
    const n = m[d] || 0;
    return `<div class="denom ${n ? 'on' : ''}">
      <div><span class="dv num">${d >= 1 ? `S/ ${d}` : `${Math.round(d * 100)} ¢`}</span><span class="ds">${n ? `<span class="num">${money(n * d)}</span>` : d >= 10 ? 'Billete' : 'Moneda'}</span></div>
      <div class="stepper">
        <button data-den="${d}" data-d="-1" data-t="${tipo}">${ic('Minus')}</button>
        <span class="num">${n}</span>
        <button data-den="${d}" data-d="1" data-t="${tipo}">${ic('Plus')}</button>
      </div></div>`;
  }).join('')}</div>`;
}
function bindDenoms(root, tipo, onSum) {
  const box = $(`#den-${tipo}`, root);
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-den]');
    if (!b) return;
    haptic.tap();
    const d = Number(b.dataset.den);
    S.conteo[tipo][d] = Math.max(0, (S.conteo[tipo][d] || 0) + Number(b.dataset.d));
    const tmp = document.createElement('div');
    tmp.innerHTML = denomCounterHTML(tipo);
    box.innerHTML = tmp.firstElementChild.innerHTML;
    paintIcons(box);
    onSum(sumaConteo(S.conteo[tipo]));
  });
}

function viewCaja() {
  renderTopbar('Caja');
  const v = $('#view');
  const caja = db.cajaActiva;
  if (!caja) {
    S.conteo.apertura = {};
    const ult = db.cierres[0];
    v.innerHTML = `
      <div class="card pad stack">
        <div class="row">
          <span class="tile" style="background:var(--ok-50);color:var(--ok)">${ic('LockOpen')}</span>
          <div class="grow"><div style="font-weight:620;font-size:16px">Abrir turno #${(db.seq.turno || 0) + 1}</div>
          <div style="font-size:13px;color:var(--muted)">Registra el sencillo con el que inicias.</div></div>
        </div>
        <div class="money-box">
          <div class="cap">Efectivo inicial</div>
          <div class="row" style="justify-content:center;gap:4px"><span class="cur">S/</span>
            <input class="money-input" id="m-apertura" inputmode="decimal" type="number" min="0" step="0.1" placeholder="0.00" style="max-width:220px"></div>
        </div>
        <div>
          <button class="disclosure" id="disc-ap">${ic('Coins')}<span class="grow" style="text-align:left;margin-left:8px">Contar billetes y monedas</span>${ic('ChevronDown')}</button>
          <div class="collapse" id="col-ap"><div>${denomCounterHTML('apertura')}</div></div>
        </div>
        <button class="btn ok block" data-a="abrirCaja">${ic('LockOpen')} Abrir caja</button>
      </div>
      ${ult ? `<div class="section-title">Último cierre</div>${turnoRowHTML(ult)}` : ''}`;
    $('#disc-ap').onclick = e => { e.currentTarget.classList.toggle('open'); $('#col-ap').classList.toggle('open'); };
    bindDenoms(v, 'apertura', s => { $('#m-apertura').value = s.toFixed(2); });
    v.classList.add('stack');
    return;
  }

  const t = totales(caja.id, caja.montoInicial);
  const movs = [
    ...db.ventas.filter(x => x.idCaja === caja.id).map(x => ({ k: 'v', ts: x.ts || x.id, x })),
    ...db.egresos.filter(x => x.idCaja === caja.id).map(x => ({ k: 'e', ts: x.ts || x.id, x })),
  ].sort((a, b) => b.ts - a.ts);
  v.innerHTML = `
    <div class="card hero">
      <div class="row between"><span class="label">Efectivo esperado en caja</span>
        <span class="badge" style="background:rgba(255,255,255,.16);color:#fff">${ic('Clock')} desde ${fmtHora(caja.ts || caja.id)}</span></div>
      <div class="big num" data-count="${t.esperado}" data-money>${money(t.esperado)}</div>
      <div class="sub">
        <div><span style="opacity:.75">Inicial</span><b class="num">${money(caja.montoInicial)}</b></div>
        <div><span style="opacity:.75">+ Efectivo</span><b class="num">${money(t.ventasEfectivo)}</b></div>
        <div><span style="opacity:.75">− Egresos</span><b class="num">${money(t.totalEgresos)}</b></div>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi yape"><div class="k">${ic('Smartphone')} Yape / Plin</div><div class="v num" data-count="${t.ventasYape}" data-money></div></div>
      <div class="kpi brand"><div class="k">${ic('Receipt')} Ventas</div><div class="v num">${t.nVentas} <span style="font-size:13px;color:var(--muted);font-weight:500">· ${t.prendas} prendas</span></div></div>
    </div>
    <div class="row">
      <button class="btn ghost grow" data-a="egreso">${ic('ArrowUpRight')} Registrar gasto</button>
      <button class="btn dark grow" data-a="cerrarCaja">${ic('Lock')} Cerrar caja</button>
    </div>
    <div class="section-title">Movimientos del turno <span>${movs.length}</span></div>
    ${movs.length ? `<div class="list">${movs.map(m => m.k === 'v' ? ventaRowHTML(m.x, true) : egresoRowHTML(m.x, true)).join('')}</div>`
      : emptyState('Receipt', 'Sin movimientos aún', 'Las ventas y gastos de este turno aparecerán aquí.')}`;
  v.classList.add('stack');
}

async function abrirCaja() {
  const monto = r2(Number($('#m-apertura').value) || 0);
  if (monto < 0) return toast('Monto inválido', 'bad');
  db.seq.turno = (db.seq.turno || 0) + 1;
  const now = Date.now();
  db.cajaActiva = {
    id: uid(), ts: now, numeroTurno: db.seq.turno,
    fechaApertura: fmtFull(now), fechaISO: isoDay(),
    usuarioApertura: S.user.nombre, montoInicial: monto,
    billetesApertura: limpiarConteo(S.conteo.apertura),
  };
  save();
  haptic.ok();
  toast(`Turno #${db.seq.turno} abierto con ${money(monto)}`);
  go('vender', true);
}

function openEgreso(eg = null) {
  const editing = !!eg;
  const caja = db.cajaActiva;
  const sugerencias = ['Bolsas', 'Pasajes', 'Almuerzo', 'Limpieza', 'Útiles', 'Delivery'];
  openSheet({
    title: editing ? 'Editar gasto' : 'Registrar gasto',
    subtitle: editing ? `Turno #${eg.numeroTurno} · ${esc(eg.usuario)}` : 'Dinero que sale de la caja en efectivo',
    body: `
      <div class="stack">
        <div class="money-box">
          <div class="cap">Monto</div>
          <div class="row" style="justify-content:center;gap:4px"><span class="cur">S/</span>
          <input class="money-input" id="eg-monto" inputmode="decimal" type="number" min="0.1" step="0.1" placeholder="0.00" value="${editing ? eg.monto : ''}" style="max-width:220px"></div>
        </div>
        <div class="field"><label>¿En qué se gastó?</label>
          <input class="input" id="eg-motivo" maxlength="60" placeholder="Ej. Bolsas de regalo" value="${editing ? esc(eg.motivo) : ''}">
          <div class="chips">${sugerencias.map(s => `<button class="chip" data-sg="${s}">${s}</button>`).join('')}</div>
        </div>
        <div id="eg-warn"></div>
      </div>`,
    foot: `<div class="row">
      ${editing ? `<button class="btn danger" id="eg-del" style="width:54px;padding:0">${ic('Trash2')}</button>` : ''}
      <button class="btn primary grow" id="eg-save">${editing ? 'Guardar cambios' : 'Registrar gasto'}</button></div>`,
    onMount: (el, close) => {
      setTimeout(() => !editing && $('#eg-monto', el).focus(), 350);
      $$('[data-sg]', el).forEach(b => b.onclick = () => { haptic.tap(); $('#eg-motivo', el).value = b.dataset.sg; });
      const warn = () => {
        if (editing || !caja) return;
        const m = Number($('#eg-monto', el).value) || 0;
        const disp = totales(caja.id, caja.montoInicial).esperado;
        $('#eg-warn', el).innerHTML = m > disp ? `<div class="diff over">${ic('TriangleAlert')} Supera el efectivo disponible<span class="num">${money(disp)}</span></div>` : '';
        paintIcons($('#eg-warn', el));
      };
      $('#eg-monto', el).oninput = warn;
      $('#eg-save', el).onclick = () => {
        const monto = r2(Number($('#eg-monto', el).value));
        const motivo = $('#eg-motivo', el).value.trim();
        if (!(monto > 0)) return toast('Ingresa un monto válido', 'bad');
        if (!motivo) return toast('Describe el gasto', 'bad');
        if (editing) {
          Object.assign(eg, { monto, motivo });
          recalcCierre(eg.idCaja);
          toast('Gasto actualizado');
        } else {
          const now = Date.now();
          db.egresos.unshift({
            id: uid(), ts: now, idCaja: caja.id, numeroTurno: caja.numeroTurno, fechaISO: isoDay(),
            fechaTexto: fmtFull(now), hora: fmtHora(now), usuario: S.user.nombre, motivo, monto,
          });
          haptic.ok();
          toast(`Gasto de ${money(monto)} registrado`);
        }
        save(); close(); renderView();
      };
      $('#eg-del', el)?.addEventListener('click', async () => {
        if (!await confirmDialog({ title: '¿Eliminar gasto?', message: `El monto de ${money(eg.monto)} volverá al efectivo esperado del turno.`, ok: 'Eliminar', danger: true, icon: 'Trash2' })) return;
        db.egresos = db.egresos.filter(x => x.id !== eg.id);
        recalcCierre(eg.idCaja); save(); close(); renderView();
        toast('Gasto eliminado');
      });
    },
  });
}

function openCierre() {
  const caja = db.cajaActiva;
  const t = totales(caja.id, caja.montoInicial);
  S.conteo.cierre = {};
  openSheet({
    title: `Cerrar turno #${caja.numeroTurno}`,
    subtitle: 'Cuenta el efectivo físico antes de cerrar',
    body: `
      <div class="list">
        ${kvRow('Efectivo inicial', money(caja.montoInicial))}
        ${kvRow('+ Ventas en efectivo', money(t.ventasEfectivo), 'var(--ok)')}
        ${kvRow('− Gastos', money(t.totalEgresos), 'var(--bad)')}
        ${kvRow('<b>Efectivo esperado</b>', `<b>${money(t.esperado)}</b>`)}
        ${kvRow('Yape / Plin (no entra a caja)', money(t.ventasYape), 'var(--yape)')}
      </div>
      <div class="money-box" style="margin-top:14px">
        <div class="cap">Efectivo contado</div>
        <div class="row" style="justify-content:center;gap:4px"><span class="cur">S/</span>
        <input class="money-input" id="m-cierre" inputmode="decimal" type="number" min="0" step="0.1" placeholder="0.00" style="max-width:220px"></div>
        <button class="chip" id="usar-esp" style="margin-top:6px">Coincide con lo esperado</button>
      </div>
      <div id="diff" style="margin-top:10px"></div>
      <button class="disclosure" id="disc-ci">${ic('Coins')}<span class="grow" style="text-align:left;margin-left:8px">Contar billetes y monedas</span>${ic('ChevronDown')}</button>
      <div class="collapse" id="col-ci"><div>${denomCounterHTML('cierre')}</div></div>`,
    foot: `<button class="btn dark block" id="btn-cerrar" disabled>${ic('Lock')} Cerrar caja</button>`,
    onMount: (el, close) => {
      const inp = $('#m-cierre', el);
      const upd = () => {
        const has = inp.value !== '';
        const d = r2((Number(inp.value) || 0) - t.esperado);
        $('#btn-cerrar', el).disabled = !has;
        $('#diff', el).innerHTML = !has ? '' : Math.abs(d) < 0.05
          ? `<div class="diff ok">${ic('CircleCheck')} Caja cuadrada<span class="num">${money(0)}</span></div>`
          : d > 0 ? `<div class="diff over">${ic('TrendingUp')} Sobrante<span class="num">+ ${money(d)}</span></div>`
            : `<div class="diff under">${ic('TrendingDown')} Faltante<span class="num">− ${money(-d)}</span></div>`;
        paintIcons($('#diff', el));
      };
      inp.oninput = upd;
      $('#usar-esp', el).onclick = () => { haptic.tap(); inp.value = t.esperado.toFixed(2); upd(); };
      $('#disc-ci', el).onclick = e => { e.currentTarget.classList.toggle('open'); $('#col-ci', el).classList.toggle('open'); };
      bindDenoms(el, 'cierre', s => { inp.value = s.toFixed(2); upd(); });
      $('#btn-cerrar', el).onclick = async () => {
        const contado = r2(Number(inp.value) || 0);
        const d = r2(contado - t.esperado);
        const ok = await confirmDialog({
          title: '¿Cerrar la caja?',
          message: Math.abs(d) < 0.05 ? 'La caja está cuadrada. Después solo un administrador podrá editarla.'
            : `Hay un ${d > 0 ? 'sobrante' : 'faltante'} de ${money(Math.abs(d))}. Después solo un administrador podrá editarla.`,
          ok: 'Cerrar caja', icon: 'Lock',
        });
        if (!ok) return;
        const now = Date.now();
        const tt = totales(caja.id, caja.montoInicial);
        db.cierres.unshift({
          ...caja, tsCierre: now, fechaCierre: fmtFull(now), usuarioCierre: S.user.nombre,
          ventasEfectivo: tt.ventasEfectivo, ventasYape: tt.ventasYape, totalEgresos: tt.totalEgresos,
          efectivoEsperado: tt.esperado, efectivoContado: contado, billetesCierre: limpiarConteo(S.conteo.cierre),
        });
        db.cajaActiva = null;
        S.cart = [];
        await flush();
        close(); haptic.ok();
        toast(`Turno #${caja.numeroTurno} cerrado`);
        go('caja', true);
      };
    },
  });
}
const kvRow = (k, v, color = '') => `<div class="li" style="padding:11px 14px"><span class="grow" style="font-size:14px;color:var(--ink-2)">${k}</span><span class="num" style="font-size:14px;${color ? `color:${color}` : ''}">${v}</span></div>`;

// =========================================================
// HISTORIAL
// =========================================================
function rangoOk(fechaISO) {
  const h = S.hist, hoy = isoDay();
  if (h.rango === 'todo') return true;
  if (h.rango === 'hoy') return fechaISO === hoy;
  if (h.rango === 'ayer') return fechaISO === isoDay(new Date(Date.now() - 864e5));
  if (h.rango === '7d') return fechaISO >= isoDay(new Date(Date.now() - 6 * 864e5));
  return fechaISO === h.fecha;
}
function turnosEnRango() {
  const ts = [...(db.cajaActiva ? [{ ...db.cajaActiva, activa: true }] : []), ...db.cierres];
  return ts.filter(c => rangoOk(c.fechaISO));
}

function viewHistorial() {
  renderTopbar('Historial');
  const h = S.hist;
  const turnos = turnosEnRango();
  if (h.turno !== 'TODOS' && !turnos.some(c => String(c.id) === h.turno)) h.turno = 'TODOS';
  const pasa = x => (h.turno === 'TODOS' ? rangoOk(x.fechaISO) : String(x.idCaja) === h.turno);
  const ventas = db.ventas.filter(pasa);
  const egresos = db.egresos.filter(pasa);
  const efec = r2(ventas.filter(v => v.metodoPago === 'Efectivo').reduce((a, v) => a + v.total, 0));
  const yape = r2(ventas.filter(v => v.metodoPago !== 'Efectivo').reduce((a, v) => a + v.total, 0));
  const egr = r2(egresos.reduce((a, e) => a + e.monto, 0));
  const prendas = ventas.reduce((a, v) => a + v.items.reduce((x, i) => x + i.cantidad, 0), 0);
  const turnosVista = h.turno === 'TODOS' ? turnos : turnos.filter(c => String(c.id) === h.turno);
  const rangos = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', '7 días'], ['todo', 'Todo']];

  $('#view').innerHTML = `
    <div class="chips">
      ${rangos.map(([k, l]) => `<button class="chip ${h.rango === k ? 'on' : ''}" data-a="rango" data-r="${k}">${l}</button>`).join('')}
      <label class="chip ${h.rango === 'fecha' ? 'on' : ''}" style="position:relative">${ic('Calendar')} ${h.rango === 'fecha' ? fmtFecha(h.fecha + 'T12:00') : 'Fecha'}
        <input type="date" id="h-fecha" value="${h.fecha}" max="${isoDay()}" style="position:absolute;inset:0;opacity:0"></label>
    </div>
    <div class="input-wrap">${ic('Hash')}
      <select class="input" id="h-turno" style="appearance:none;padding-left:42px">
        <option value="TODOS">Todos los turnos (${turnos.length})</option>
        ${turnos.map(c => `<option value="${c.id}" ${String(c.id) === h.turno ? 'selected' : ''}>Turno #${c.numeroTurno} · ${esc(c.usuarioApertura)} · ${c.activa ? 'abierto' : esc(c.fechaApertura)}</option>`).join('')}
      </select>
    </div>
    <div class="card hero">
      <span class="label">Ingresos por ventas</span>
      <div class="big num" data-count="${r2(efec + yape)}" data-money></div>
      <div class="sub">
        <div><span style="opacity:.75">Efectivo</span><b class="num">${money(efec)}</b></div>
        <div><span style="opacity:.75">Yape/Plin</span><b class="num">${money(yape)}</b></div>
        <div><span style="opacity:.75">Gastos</span><b class="num">${money(egr)}</b></div>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi brand"><div class="k">${ic('Receipt')} Ventas</div><div class="v num" data-count="${ventas.length}"></div></div>
      <div class="kpi"><div class="k">${ic('Shirt')} Prendas</div><div class="v num" data-count="${prendas}"></div></div>
    </div>
    <div class="seg" id="h-seg">
      <button data-a="hsub" data-s="ventas" class="${h.sub === 'ventas' ? 'on' : ''}">Ventas</button>
      <button data-a="hsub" data-s="turnos" class="${h.sub === 'turnos' ? 'on' : ''}">Turnos</button>
      <button data-a="hsub" data-s="egresos" class="${h.sub === 'egresos' ? 'on' : ''}">Gastos</button>
    </div>
    <div>${
      h.sub === 'ventas' ? (ventas.length ? `<div class="list">${ventas.map(x => ventaRowHTML(x)).join('')}</div>` : emptyState('Receipt', 'Sin ventas', 'No hay ventas en este periodo.'))
      : h.sub === 'egresos' ? (egresos.length ? `<div class="list">${egresos.map(x => egresoRowHTML(x)).join('')}</div>` : emptyState('ArrowUpRight', 'Sin gastos', 'No se registraron gastos en este periodo.'))
      : (turnosVista.length ? `<div class="stack">${turnosVista.map(turnoRowHTML).join('')}</div>` : emptyState('Wallet', 'Sin turnos', 'No hay turnos en este periodo.'))
    }</div>`;
  $('#view').classList.add('stack');
  $('#h-fecha').onchange = e => { if (!e.target.value) return; h.fecha = e.target.value; h.rango = 'fecha'; renderView(); };
  $('#h-turno').onchange = e => { h.turno = e.target.value; renderView(); };
}

function ventaRowHTML(v, compact = false) {
  const n = v.items.reduce((a, i) => a + i.cantidad, 0);
  const cash = v.metodoPago === 'Efectivo';
  const ts = v.ts || v.id;
  return `<div class="li tap" data-a="venta" data-id="${v.id}">
    <span class="tile" style="background:${cash ? 'var(--ok-50)' : 'var(--yape-50)'};color:${cash ? 'var(--ok)' : 'var(--yape)'}">${ic(cash ? 'Banknote' : 'Smartphone')}</span>
    <div class="grow"><div class="t">${esc(v.items.map(i => i.nombre).join(', '))}</div>
      <div class="s">${compact ? fmtHora(ts) : fmtFull(ts)} · ${esc(v.vendedora)} · ${n} ${n === 1 ? 'prenda' : 'prendas'}${v.foto ? ' · 📎' : ''}</div></div>
    <div class="amt num" style="color:var(--ok)">+${money(v.total)}</div>
  </div>`;
}
function egresoRowHTML(e, compact = false) {
  const ts = e.ts || e.id;
  return `<div class="li tap" data-a="egresoDet" data-id="${e.id}">
    <span class="tile" style="background:var(--bad-50);color:var(--bad)">${ic('ArrowUpRight')}</span>
    <div class="grow"><div class="t">${esc(e.motivo)}</div><div class="s">${compact ? fmtHora(ts) : fmtFull(ts)} · ${esc(e.usuario)}</div></div>
    <div class="amt num" style="color:var(--bad)">−${money(e.monto)}</div>
  </div>`;
}
function turnoRowHTML(c) {
  const activa = c.activa || c.id === db.cajaActiva?.id;
  const t = activa ? totales(c.id, c.montoInicial) : null;
  const dif = activa ? 0 : r2(c.efectivoContado - c.efectivoEsperado);
  const badge = activa ? '<span class="badge ok"><span class="dot live" style="width:6px;height:6px"></span>En curso</span>'
    : Math.abs(dif) < 0.05 ? `<span class="badge ok">${ic('Check')} Cuadrada</span>`
      : `<span class="badge ${dif > 0 ? 'warn' : 'bad'} num">${dif > 0 ? '+' : '−'}${money(Math.abs(dif))}</span>`;
  return `<div class="list"><div class="li tap" data-a="turno" data-id="${c.id}">
    <span class="tile" style="background:var(--brand-50);color:var(--brand)">${ic(activa ? 'LockOpen' : 'Lock')}</span>
    <div class="grow"><div class="t">Turno #${c.numeroTurno} · ${esc(c.usuarioApertura)}</div>
      <div class="s">${esc(c.fechaApertura)}${activa ? '' : ` → ${esc(c.fechaCierre)}`}</div></div>
    <div style="text-align:right"><div class="amt num">${money(activa ? t.esperado : c.efectivoContado)}</div>${badge}</div>
  </div></div>`;
}

async function openVenta(id) {
  const v = db.ventas.find(x => x.id === id);
  if (!v) return;
  const foto = await leerFoto(v.foto);
  openSheet({
    title: money(v.total),
    subtitle: `${fmtFull(v.ts || v.id)} · Turno #${v.numeroTurno} · ${esc(v.vendedora)}`,
    body: `
      <div class="list">${v.items.map(i => {
        const c = catInfo(i.categoria || db.productos.find(p => p.id === i.id)?.categoria);
        return `<div class="li"><span class="tile" style="background:${c.bg};color:${c.fg}">${c.abbr}</span>
          <div class="grow"><div class="t">${esc(i.nombre)}</div><div class="s">${i.cantidad} × <span class="num">${money(i.precio)}</span> · Talla ${esc(i.talla)} · ${esc(i.color)}</div></div>
          <div class="amt num">${money(i.precio * i.cantidad)}</div></div>`;
      }).join('')}</div>
      <div class="totals">
        <div class="row"><span>Subtotal</span><span class="num">${money(v.subtotal)}</span></div>
        ${v.descuento ? `<div class="row" style="color:var(--warn)"><span>Descuento</span><span class="num">− ${money(v.descuento)}</span></div>` : ''}
        <div class="row grand"><span>Total</span><span class="num">${money(v.total)}</span></div>
        <div class="row"><span>Pago</span><span class="badge ${v.metodoPago === 'Efectivo' ? 'ok' : 'yape'}">${v.metodoPago}</span></div>
        ${v.recibido ? `<div class="row"><span>Recibido / vuelto</span><span class="num">${money(v.recibido)} / ${money(v.vuelto)}</span></div>` : ''}
      </div>
      ${foto ? `<img class="photo-full" src="${foto}" alt="Comprobante">` : ''}`,
    foot: esAdmin() ? `<button class="btn danger block" id="anular">${ic('Ban')} Anular venta y devolver stock</button>` : '',
    onMount: (el, close) => {
      $('#anular', el)?.addEventListener('click', async () => {
        if (!await confirmDialog({ title: '¿Anular esta venta?', message: 'Las prendas volverán al inventario y el total se descontará del turno.', ok: 'Anular', danger: true, icon: 'Ban' })) return;
        v.items.forEach(i => { const p = db.productos.find(x => x.id === i.id); if (p) p.stock += i.cantidad; });
        db.ventas = db.ventas.filter(x => x.id !== v.id);
        borrarFoto(v.foto);
        recalcCierre(v.idCaja); save(); close(); renderView();
        toast('Venta anulada');
      });
    },
  });
}

function openTurno(id) {
  const activa = db.cajaActiva?.id === id;
  const c = activa ? db.cajaActiva : db.cierres.find(x => x.id === id);
  if (!c) return;
  const t = totales(c.id, c.montoInicial);
  const desglose = (m, total) => {
    const e = Object.entries(m || {}).filter(([, n]) => n > 0).sort((a, b) => b[0] - a[0]);
    if (!e.length) return `<p style="margin:6px 2px;color:var(--muted);font-size:13px">Monto ingresado directamente: <b class="num">${money(total)}</b></p>`;
    return `<div class="list">${e.map(([d, n]) => kvRow(`${n} × ${Number(d) >= 1 ? `S/ ${d}` : `${Math.round(d * 100)} cént.`}`, money(n * d))).join('')}</div>`;
  };
  openSheet({
    title: `Turno #${c.numeroTurno}`,
    subtitle: `${esc(c.usuarioApertura)} · ${esc(c.fechaApertura)}${activa ? ' · en curso' : ` → ${esc(c.fechaCierre)} (${esc(c.usuarioCierre)})`}`,
    body: `
      <div class="list">
        ${kvRow('Efectivo inicial', money(c.montoInicial))}
        ${kvRow('+ Ventas en efectivo', money(t.ventasEfectivo), 'var(--ok)')}
        ${kvRow('− Gastos', money(t.totalEgresos), 'var(--bad)')}
        ${kvRow('<b>Efectivo esperado</b>', `<b>${money(t.esperado)}</b>`)}
        ${activa ? '' : kvRow('<b>Efectivo contado</b>', `<b>${money(c.efectivoContado)}</b>`)}
        ${kvRow('Yape / Plin', money(t.ventasYape), 'var(--yape)')}
        ${kvRow('Ventas · prendas', `${t.nVentas} · ${t.prendas}`)}
      </div>
      <div class="section-title">Billetes y monedas al abrir</div>${desglose(c.billetesApertura, c.montoInicial)}
      ${activa ? '' : `<div class="section-title">Billetes y monedas al cerrar</div>${desglose(c.billetesCierre, c.efectivoContado)}`}
      ${!activa && esAdmin() ? `
        <div class="section-title">Corregir (administración)</div>
        <div class="row">
          <div class="field grow"><label>Inicial</label><input class="input num" id="ed-ini" type="number" inputmode="decimal" step="0.1" value="${c.montoInicial}"></div>
          <div class="field grow"><label>Contado</label><input class="input num" id="ed-cont" type="number" inputmode="decimal" step="0.1" value="${c.efectivoContado}"></div>
        </div>` : ''}`,
    foot: !activa && esAdmin() ? `<button class="btn primary block" id="ed-save">Guardar corrección</button>` : '',
    onMount: (el, close) => {
      $('#ed-save', el)?.addEventListener('click', () => {
        const ini = Number($('#ed-ini', el).value), cont = Number($('#ed-cont', el).value);
        if (isNaN(ini) || isNaN(cont) || ini < 0 || cont < 0) return toast('Valores inválidos', 'bad');
        c.montoInicial = r2(ini); c.efectivoContado = r2(cont);
        c.editadoPor = S.user.nombre; c.editadoTs = Date.now();
        recalcCierre(c.id); save(); close(); renderView();
        toast('Turno corregido');
      });
    },
  });
}

function openEgresoDet(id) {
  const e = db.egresos.find(x => x.id === id);
  if (!e) return;
  if (esAdmin()) return openEgreso(e);
  openSheet({
    title: `− ${money(e.monto)}`, subtitle: `${fmtFull(e.ts || e.id)} · Turno #${e.numeroTurno}`,
    body: `<div class="list">${kvRow('Motivo', esc(e.motivo))}${kvRow('Registrado por', esc(e.usuario))}</div>
      <p style="font-size:13px;color:var(--muted);margin:12px 2px 0">Solo un administrador puede editar o eliminar gastos.</p>`,
  });
}

// =========================================================
// INVENTARIO (admin)
// =========================================================
function viewInventario() {
  renderTopbar('Inventario', `<button class="icon-btn" data-a="producto" aria-label="Nueva prenda">${ic('Plus')}</button>`);
  const f = S.inv;
  const bajos = db.productos.filter(p => p.stock > 0 && p.stock <= 2).length;
  const agot = db.productos.filter(p => p.stock <= 0).length;
  const unidades = db.productos.reduce((a, p) => a + Math.max(0, p.stock), 0);
  const valor = r2(db.productos.reduce((a, p) => a + Math.max(0, p.stock) * p.precio, 0));
  $('#view').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k">${ic('Package')} Unidades</div><div class="v num" data-count="${unidades}"></div></div>
      <div class="kpi brand"><div class="k">${ic('Tag')} Valor en stock</div><div class="v num" data-count="${valor}" data-money></div></div>
    </div>
    <div class="input-wrap">${ic('Search')}<input class="input" id="inv-q" type="search" placeholder="Buscar en inventario" value="${esc(f.q)}"></div>
    <div class="chips">
      <button class="chip ${f.filtro === 'todos' ? 'on' : ''}" data-a="invf" data-f="todos">Todas <span class="count">${db.productos.length}</span></button>
      <button class="chip ${f.filtro === 'bajo' ? 'on' : ''}" data-a="invf" data-f="bajo">${ic('TriangleAlert')} Stock bajo <span class="count">${bajos}</span></button>
      <button class="chip ${f.filtro === 'agotado' ? 'on' : ''}" data-a="invf" data-f="agotado">Agotadas <span class="count">${agot}</span></button>
    </div>
    <div id="inv-list"></div>`;
  $('#view').classList.add('stack');
  drawInv();
  $('#inv-q').oninput = e => { f.q = e.target.value; drawInv(); };
}
function drawInv() {
  const f = S.inv, q = f.q.trim().toLowerCase();
  const list = db.productos.filter(p =>
    (f.filtro === 'todos' || (f.filtro === 'bajo' ? p.stock > 0 && p.stock <= 2 : p.stock <= 0)) &&
    (!q || `${p.nombre} ${p.color} ${p.talla} ${p.categoria}`.toLowerCase().includes(q)));
  const box = $('#inv-list');
  box.innerHTML = list.length ? `<div class="list">${list.map(p => {
    const c = catInfo(p.categoria);
    return `<div class="li tap" data-a="producto" data-id="${p.id}">
      <span class="tile" style="background:${c.bg};color:${c.fg}">${c.abbr}</span>
      <div class="grow"><div class="t">${esc(p.nombre)}</div>
        <div class="s">Talla ${esc(p.talla)} · ${esc(p.color)} · <span class="num">${money(p.precio)}</span></div></div>
      <div class="stepper" data-stop>
        <button data-a="stk" data-id="${p.id}" data-d="-1">${ic('Minus')}</button>
        <span class="num ${p.stock <= 2 ? 'stock-low' : ''}">${p.stock}</span>
        <button data-a="stk" data-id="${p.id}" data-d="1">${ic('Plus')}</button>
      </div></div>`;
  }).join('')}</div>`
    : emptyState('Package', db.productos.length ? 'Nada por aquí' : 'Tu inventario está vacío', db.productos.length ? 'Ninguna prenda coincide con el filtro.' : 'Agrega tu primera prenda para empezar a vender.',
      db.productos.length ? '' : `<button class="btn primary" data-a="producto">${ic('PackagePlus')} Agregar prenda</button>`);
  paintIcons(box);
}

function openProducto(id) {
  const p = id ? db.productos.find(x => x.id === id) : null;
  const d = p || { nombre: '', categoria: CATEGORIAS[0].id, talla: 'M', color: '', precio: '', stock: 1 };
  let cat = d.categoria, talla = d.talla;
  openSheet({
    title: p ? 'Editar prenda' : 'Nueva prenda',
    subtitle: p ? `${p.stock} en stock` : 'Se agregará al catálogo de ventas',
    body: `
      <div class="stack">
        <div class="field"><label>Nombre</label><input class="input" id="p-nom" maxlength="50" placeholder="Ej. Vestido satinado" value="${esc(d.nombre)}"></div>
        <div class="field"><label>Categoría</label>
          <div class="chips" id="p-cat">${CATEGORIAS.map(c => `<button class="chip pick ${c.id === cat ? 'on' : ''}" data-v="${c.id}">${c.corto}</button>`).join('')}</div></div>
        <div class="field"><label>Talla</label>
          <div class="chips" id="p-talla">${TALLAS.map(t => `<button class="chip pick ${t === talla ? 'on' : ''}" data-v="${t}">${t}</button>`).join('')}</div></div>
        <div class="field"><label>Color</label><input class="input" id="p-color" maxlength="30" placeholder="Ej. Perla" value="${esc(d.color)}"></div>
        <div class="row">
          <div class="field grow"><label>Precio</label><div class="input-wrap"><span class="pre">S/</span><input class="input num" id="p-precio" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0.00" value="${d.precio}"></div></div>
          <div class="field" style="width:120px"><label>Stock</label><input class="input num" id="p-stock" type="number" inputmode="numeric" min="0" step="1" value="${d.stock}"></div>
        </div>
      </div>`,
    foot: `<div class="row">
      ${p ? `<button class="btn danger" id="p-del" style="width:54px;padding:0">${ic('Trash2')}</button>` : ''}
      <button class="btn primary grow" id="p-save">${p ? 'Guardar cambios' : 'Agregar al inventario'}</button></div>`,
    onMount: (el, close) => {
      const pick = (sel, set) => $(sel, el).addEventListener('click', e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        haptic.tap(); set(b.dataset.v);
        $$(`${sel} .chip`, el).forEach(x => x.classList.toggle('on', x === b));
      });
      pick('#p-cat', v => cat = v);
      pick('#p-talla', v => talla = v);
      $('#p-save', el).onclick = () => {
        const nombre = $('#p-nom', el).value.trim();
        const color = $('#p-color', el).value.trim();
        const precio = r2($('#p-precio', el).value);
        const stock = parseInt($('#p-stock', el).value, 10);
        if (!nombre) return toast('Escribe el nombre de la prenda', 'bad');
        if (!(precio > 0)) return toast('Ingresa un precio válido', 'bad');
        if (isNaN(stock) || stock < 0) return toast('Stock inválido', 'bad');
        const data = { nombre, categoria: cat, talla, color: color || '—', precio, stock };
        if (p) Object.assign(p, data); else db.productos.unshift({ id: uid(), ...data });
        save(); haptic.ok(); close(); renderView();
        toast(p ? 'Prenda actualizada' : 'Prenda agregada');
      };
      $('#p-del', el)?.addEventListener('click', async () => {
        if (!await confirmDialog({ title: '¿Eliminar prenda?', message: `“${esc(p.nombre)}” saldrá del catálogo. El historial de ventas se conserva.`, ok: 'Eliminar', danger: true, icon: 'Trash2' })) return;
        db.productos = db.productos.filter(x => x.id !== p.id);
        S.cart = S.cart.filter(x => x.id !== p.id);
        save(); close(); renderView(); toast('Prenda eliminada');
      });
    },
  });
}

// =========================================================
// EQUIPO (admin)
// =========================================================
function viewEquipo() {
  renderTopbar('Equipo', `<button class="icon-btn" data-a="usuario" aria-label="Nuevo usuario">${ic('UserPlus')}</button>`);
  $('#view').innerHTML = `
    <p style="margin:0 2px;color:var(--muted);font-size:13.5px">Vendedoras usan PIN de 4 dígitos; administradores, de 8. Los PIN se guardan cifrados.</p>
    <div class="list">${db.usuarios.map(u => `
      <div class="li tap" data-a="usuario" data-id="${u.id}">
        <span class="avatar">${esc(initials(u.nombre))}</span>
        <div class="grow"><div class="t">${esc(u.nombre)}${u.id === S.user.id ? ' <span class="badge neutral">Tú</span>' : ''}</div>
          <div class="s">${u.rol}</div></div>
        ${u.rol === 'Administrador' ? `<span class="badge brand">${ic('Crown')} Admin</span>` : ''}
        <span class="chev">${ic('ChevronRight')}</span>
      </div>`).join('')}</div>`;
  $('#view').classList.add('stack');
}

function openUsuario(id) {
  const u = id ? db.usuarios.find(x => x.id === id) : null;
  let rol = u?.rol || 'Vendedora';
  openSheet({
    title: u ? esc(u.nombre) : 'Nuevo integrante',
    subtitle: u ? u.rol : 'Podrá entrar con su propio PIN',
    body: `
      <div class="stack">
        <div class="field"><label>Nombre</label><input class="input" id="u-nom" maxlength="30" value="${u ? esc(u.nombre) : ''}" placeholder="Ej. Nikol"></div>
        <div class="field"><label>Rol</label>
          <div class="seg" id="u-rol">
            <button data-r="Vendedora" class="${rol === 'Vendedora' ? 'on' : ''}">${ic('User')} Vendedora</button>
            <button data-r="Administrador" class="${rol === 'Administrador' ? 'on' : ''}">${ic('Crown')} Admin</button>
          </div></div>
        <div class="field"><label>${u ? 'Nuevo PIN (opcional)' : 'PIN'}</label>
          <input class="input num" id="u-pin" type="password" inputmode="numeric" autocomplete="off" placeholder="${pinLen(rol)} dígitos" style="letter-spacing:.3em;font-size:20px">
          <span class="hint" id="u-hint">${pinLen(rol)} dígitos numéricos</span></div>
      </div>`,
    foot: `<div class="row">
      ${u && u.id !== S.user.id ? `<button class="btn danger" id="u-del" style="width:54px;padding:0">${ic('Trash2')}</button>` : ''}
      <button class="btn primary grow" id="u-save">${u ? 'Guardar' : 'Agregar al equipo'}</button></div>`,
    onMount: (el, close) => {
      const seg = $('#u-rol', el);
      mountSeg(seg);
      $$('[data-r]', el).forEach(b => b.onclick = () => {
        rol = b.dataset.r;
        $$('[data-r]', el).forEach(x => x.classList.toggle('on', x === b));
        mountSeg(seg);
        $('#u-pin', el).placeholder = `${pinLen(rol)} dígitos`;
        $('#u-hint', el).textContent = `${pinLen(rol)} dígitos numéricos${u && rol !== u.rol ? ' · al cambiar de rol debes asignar un PIN nuevo' : ''}`;
      });
      $('#u-pin', el).oninput = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, pinLen(rol)); };
      $('#u-save', el).onclick = async () => {
        const nombre = $('#u-nom', el).value.trim();
        const pin = $('#u-pin', el).value;
        if (!nombre) return toast('Escribe un nombre', 'bad');
        const needPin = !u || rol !== u.rol;
        if ((needPin || pin) && pin.length !== pinLen(rol)) return toast(`El PIN debe tener ${pinLen(rol)} dígitos`, 'bad');
        if (u && u.rol === 'Administrador' && rol !== 'Administrador' && db.usuarios.filter(x => x.rol === 'Administrador').length <= 1)
          return toast('Debe quedar al menos un administrador', 'bad');
        if (u) {
          u.nombre = nombre; u.rol = rol;
          if (pin) { u.salt = newSalt(); u.pinHash = await hashPin(pin, u.salt); }
          if (u.id === S.user.id) S.user = u;
          toast('Cambios guardados');
        } else { await crearUsuario({ nombre, rol, pin }); toast(`${nombre} se unió al equipo`); }
        save(); haptic.ok(); close();
        if (u?.id === S.user.id && !esAdmin()) return go('vender', true);
        renderView();
      };
      $('#u-del', el)?.addEventListener('click', async () => {
        if (u.rol === 'Administrador' && db.usuarios.filter(x => x.rol === 'Administrador').length <= 1)
          return toast('Debe quedar al menos un administrador', 'bad');
        if (!await confirmDialog({ title: `¿Quitar a ${esc(u.nombre)}?`, message: 'Ya no podrá ingresar. Sus ventas registradas se conservan.', ok: 'Quitar', danger: true, icon: 'Trash2' })) return;
        db.usuarios = db.usuarios.filter(x => x.id !== u.id);
        save(); close(); renderView(); toast('Usuario eliminado');
      });
    },
  });
}

// =========================================================
// AJUSTES / CUENTA
// =========================================================
function openSettings() {
  openSheet({
    title: esc(S.user.nombre),
    subtitle: `${S.user.rol} · ${esc(db.tienda)}`,
    body: `
      <div class="stack">
        ${esAdmin() ? `
          <div class="field"><label>Nombre de la tienda</label>
            <div class="row"><input class="input grow" id="st-name" maxlength="40" value="${esc(db.tienda)}">
            <button class="btn soft sm" id="st-save" style="height:50px">Guardar</button></div></div>
          <div class="section-title">Respaldo de datos</div>
          <div class="list">
            <div class="li tap" id="bk-exp"><span class="tile" style="background:var(--brand-50);color:var(--brand)">${ic('Download')}</span>
              <div class="grow"><div class="t">Exportar respaldo</div><div class="s">Guarda o comparte un archivo .json</div></div><span class="chev">${ic('ChevronRight')}</span></div>
            <label class="li tap" style="position:relative"><span class="tile" style="background:#F2EFF1;color:var(--ink-2)">${ic('Upload')}</span>
              <div class="grow"><div class="t">Restaurar respaldo</div><div class="s">Reemplaza los datos actuales</div></div><span class="chev">${ic('ChevronRight')}</span>
              <input type="file" accept="application/json,.json" id="bk-imp" style="position:absolute;inset:0;opacity:0"></label>
          </div>
          <p style="font-size:12.5px;color:var(--muted);margin:0 2px">Los datos viven en este teléfono. Exporta un respaldo semanalmente por seguridad.</p>` : ''}
      </div>`,
    foot: `<button class="btn ghost block" id="logout">${ic('LogOut')} Cerrar sesión</button>`,
    onMount: (el, close) => {
      $('#logout', el).onclick = () => { close(); setTimeout(logout, 250); };
      $('#st-save', el)?.addEventListener('click', () => {
        const n = $('#st-name', el).value.trim();
        if (!n) return;
        db.tienda = n; save(); toast('Nombre actualizado');
      });
      $('#bk-exp', el)?.addEventListener('click', async () => {
        try {
          await flush();
          const uri = await exportarRespaldo();
          if (Capacitor.isNativePlatform()) await Share.share({ title: 'Respaldo Mi Boutique', url: uri, dialogTitle: 'Guardar respaldo' });
          else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'mi-boutique', ...db })], { type: 'application/json' }));
            a.download = `respaldo-mi-boutique-${isoDay()}.json`; a.click();
          }
        } catch (e) { if (!String(e).includes('cancel')) toast('No se pudo exportar', 'bad'); }
      });
      $('#bk-imp', el)?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        if (!await confirmDialog({ title: '¿Restaurar respaldo?', message: 'Se reemplazarán todos los datos actuales de este teléfono.', ok: 'Restaurar', danger: true, icon: 'Upload' })) return;
        try {
          importarRespaldo(await file.text());
          await flush();
          closeAllSheets(); toast('Respaldo restaurado'); setTimeout(logout, 400);
        } catch { toast('El archivo no es un respaldo válido', 'bad'); }
      });
    },
  });
}

// =========================================================
// Helpers de UI
// =========================================================
function emptyState(icon, title, text, cta = '') {
  return `<div class="empty"><div class="eic">${ic(icon)}</div><h3>${title}</h3><p>${text}</p>${cta}</div>`;
}

// =========================================================
// Delegación de eventos
// =========================================================
const ACTIONS = {
  go: el => { haptic.tap(); go(el.dataset.tab); },
  cat: el => {
    haptic.tap(); S.cat = el.dataset.cat;
    $$('.chip[data-cat]').forEach(c => c.classList.toggle('on', c === el));
    el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    renderGrid();
  },
  add: el => addToCart(Number(el.dataset.id)),
  openCart: () => { haptic.medium(); openCart(); },
  abrirCaja,
  egreso: () => openEgreso(),
  cerrarCaja: () => openCierre(),
  venta: el => openVenta(Number(el.dataset.id)),
  egresoDet: el => openEgresoDet(Number(el.dataset.id)),
  turno: el => openTurno(Number(el.dataset.id)),
  rango: el => { haptic.tap(); S.hist.rango = el.dataset.r; S.hist.turno = 'TODOS'; renderView(); },
  hsub: el => { haptic.tap(); S.hist.sub = el.dataset.s; renderView(); },
  invf: el => { haptic.tap(); S.inv.filtro = el.dataset.f; $$('.chip[data-f]').forEach(c => c.classList.toggle('on', c === el)); drawInv(); },
  stk: el => {
    haptic.tap();
    const p = db.productos.find(x => x.id === Number(el.dataset.id));
    if (!p) return;
    p.stock = Math.max(0, p.stock + Number(el.dataset.d));
    save();
    const span = el.parentElement.querySelector('span');
    span.textContent = p.stock;
    span.classList.toggle('stock-low', p.stock <= 2);
  },
  producto: el => openProducto(el.dataset.id ? Number(el.dataset.id) : null),
  usuario: el => openUsuario(el.dataset.id ? Number(el.dataset.id) : null),
  settings: () => { haptic.tap(); openSettings(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  // Evita abrir la ficha al tocar el stepper dentro de una fila
  if (el.dataset.a === 'producto' && e.target.closest('[data-stop]')) return;
  ACTIONS[el.dataset.a]?.(el, e);
});

boot();
