// Persistencia local: Capacitor Preferences (Android: SharedPreferences) para datos
// y Filesystem para las fotos de comprobantes (evita inflar el JSON principal).
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

const KEY = 'mi_boutique_db_v3';
export const SCHEMA = 3;

export const CATEGORIAS = [
  { id: 'Blusas y Tops', corto: 'Blusas', abbr: 'BL', bg: '#FCE4EF', fg: '#9D174D' },
  { id: 'Vestidos', corto: 'Vestidos', abbr: 'VE', bg: '#F3E8FF', fg: '#7E22CE' },
  { id: 'Pantalones y Jeans', corto: 'Jeans', abbr: 'JE', bg: '#E0EBFF', fg: '#1D4ED8' },
  { id: 'Faldas y Shorts', corto: 'Faldas', abbr: 'FA', bg: '#FFEDE0', fg: '#C2410C' },
  { id: 'Casacas y Abrigos', corto: 'Casacas', abbr: 'CA', bg: '#E7E5E4', fg: '#44403C' },
  { id: 'Conjuntos', corto: 'Conjuntos', abbr: 'CO', bg: '#DDF5EA', fg: '#047857' },
];
export const TALLAS = ['XS', 'S', 'M', 'L', 'XL', 'Estándar'];
export const DENOMINACIONES = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];

const empty = () => ({
  schema: SCHEMA,
  tienda: 'Mi Boutique',
  usuarios: [],
  productos: [],
  ventas: [],
  egresos: [],
  cierres: [],
  cajaActiva: null,
  seq: { turno: 0 },
});

export const db = empty();

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 120);
}
export async function flush() {
  clearTimeout(saveTimer);
  await Preferences.set({ key: KEY, value: JSON.stringify(db) });
}

export async function load() {
  const { value } = await Preferences.get({ key: KEY });
  if (value) {
    Object.assign(db, empty(), JSON.parse(value));
    return true;
  }
  return await migrarPrototipo();
}

export function resetDb() { Object.assign(db, empty()); }

// ---------- Seguridad del PIN (SHA-256 + sal) ----------
export async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function newSalt() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function crearUsuario({ nombre, rol, pin }) {
  const salt = newSalt();
  const u = { id: uid(), nombre, rol, salt, pinHash: await hashPin(pin, salt), creado: Date.now() };
  db.usuarios.push(u);
  save();
  return u;
}
export async function verificarPin(u, pin) {
  return (await hashPin(pin, u.salt)) === u.pinHash;
}

// ---------- Fotos ----------
export async function guardarFoto(id, dataUrl) {
  const path = `fotos/${id}.jpg`;
  await Filesystem.writeFile({ path, data: dataUrl.split(',')[1], directory: Directory.Data, recursive: true });
  return path;
}
export async function leerFoto(path) {
  if (!path) return null;
  if (path.startsWith('data:')) return path; // fotos migradas del prototipo
  try {
    const r = await Filesystem.readFile({ path, directory: Directory.Data });
    return typeof r.data === 'string' ? `data:image/jpeg;base64,${r.data}` : URL.createObjectURL(r.data);
  } catch { return null; }
}
export async function borrarFoto(path) {
  if (!path || path.startsWith('data:')) return;
  try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch {}
}

// ---------- Respaldo ----------
export async function exportarRespaldo() {
  const fecha = new Date().toISOString().slice(0, 10);
  const path = `respaldo-mi-boutique-${fecha}.json`;
  const res = await Filesystem.writeFile({
    path, data: JSON.stringify({ app: 'mi-boutique', ...db }, null, 1),
    directory: Directory.Cache, encoding: Encoding.UTF8,
  });
  return res.uri;
}
export function importarRespaldo(text) {
  const data = JSON.parse(text);
  if (data.app !== 'mi-boutique' || !Array.isArray(data.usuarios)) throw new Error('Archivo no válido');
  delete data.app;
  Object.assign(db, empty(), data);
  save();
}

// ---------- Migración desde el prototipo HTML (localStorage btq_*_v2) ----------
async function migrarPrototipo() {
  try {
    const raw = k => JSON.parse(localStorage.getItem(k));
    const usuarios = raw('btq_usuarios_v2');
    if (!usuarios?.length) return false;
    for (const u of usuarios) await crearUsuario({ nombre: u.nombre, rol: u.rol, pin: u.pin });
    db.productos = raw('btq_productos_v2') || [];
    db.ventas = (raw('btq_ventas_v2') || []).map(v => ({ ...v, ts: v.id, foto: v.foto || null }));
    db.egresos = (raw('btq_egresos_v2') || []).map(e => ({ ...e, ts: e.id }));
    db.cierres = raw('btq_cierres_v2') || [];
    db.cajaActiva = raw('btq_caja_activa_v2');
    db.seq.turno = Math.max(0, ...db.cierres.map(c => c.numeroTurno || 0), db.cajaActiva?.numeroTurno || 0);
    await flush();
    return true;
  } catch { return false; }
}

// ---------- Utilidades ----------
export const uid = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
export const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
export const isoDay = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
