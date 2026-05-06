const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

function loadDB() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { users: [], tareas: [], compromisos: [], devengados: [], ampliaciones: [], pendientes: [], historial: [], archivos: [], config: {} };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

const INCN = { 2: 'Bienes de consumo', 3: 'Servicios no personales', 4: 'Bienes de uso', 5: 'Transferencias', 6: 'Activos financieros' };

function getTotalOrig(t) { return (t.i2 || 0) + (t.i3 || 0) + (t.i4 || 0) + (t.i5 || 0) + (t.i6 || 0); }
function getAmpAprobadas(db, tid) { return db.ampliaciones.filter(a => a.tareaId === tid && a.estado === 'aprobada'); }
function getCreditoVigente(db, t) {
  const orig = getTotalOrig(t);
  const amps = getAmpAprobadas(db, t.id).reduce((s, a) => s + a.monto, 0);
  return orig + amps;
}
function getCreditoVigenteInc(db, t, inc) {
  const orig = t['i' + inc] || 0;
  const amps = getAmpAprobadas(db, t.id).filter(a => a.inciso == inc).reduce((s, a) => s + a.monto, 0);
  return orig + amps;
}
function getComp(db, tid) { return db.compromisos.filter(c => c.tareaId === tid && c.estado !== 'anulado').reduce((s, c) => s + c.monto, 0); }
function getDev(db, tid) { return db.devengados.filter(d => d.tareaId === tid && d.estado !== 'anulado').reduce((s, d) => s + d.monto, 0); }
function getSaldo(db, t) { return getCreditoVigente(db, t) - getComp(db, t.id); }
function pendCount(db) { return db.pendientes.filter(p => p.estado === 'pendiente').length; }

function mon(s) { return s ? parseInt(s.split('-')[1]) : 0; }
function today() { return new Date().toISOString().split('T')[0]; }
function now() { return new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

app.get('/api/estado', (req, res) => {
  const db = loadDB();
  res.json({ state: db, timestamp: Date.now() });
});

app.get('/api/usuarios', (req, res) => {
  const db = loadDB();
  res.json(db.users);
});

app.post('/api/login', (req, res) => {
  const { userId, pin } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.id === userId);
  if (user && user.pin === pin) {
    res.json({ ok: true, user });
  } else {
    res.json({ ok: false, error: 'PIN incorrecto' });
  }
});

app.get('/api/tareas', (req, res) => {
  const db = loadDB();
  res.json(db.tareas);
});

app.post('/api/tareas', (req, res) => {
  const db = loadDB();
  const { desc, prog, act, ref, i2, i3, i4, i5, i6 } = req.body;
  const tarea = {
    id: uid(),
    desc, prog: prog || '—', act: act || '—', ref: ref || '—',
    i2: i2 || 0, i3: i3 || 0, i4: i4 || 0, i5: i5 || 0, i6: i6 || 0,
    subtareas: [],
    creado: today(),
    creadoPor: req.body.creadoPor || 'Sistema'
  };
  db.tareas.push(tarea);
  db.historial.unshift({ id: uid(), tipo: 'success', texto: 'Nueva tarea: ' + desc.substring(0, 50), ts: now(), user: req.body.creadoPor });
  saveDB(db);
  res.json(tarea);
});

app.put('/api/tareas/:id', (req, res) => {
  const db = loadDB();
  const { id } = req.params;
  const idx = db.tareas.findIndex(t => t.id === id);
  if (idx >= 0) {
    const { desc, prog, act, ref, i2, i3, i4, i5, i6 } = req.body;
    db.tareas[idx] = { ...db.tareas[idx], desc, prog, act, ref, i2, i3, i4, i5, i6 };
    db.historial.unshift({ id: uid(), tipo: 'info', texto: 'Tarea editada: ' + desc.substring(0, 50), ts: now(), user: req.body.creadoPor });
    saveDB(db);
    res.json(db.tareas[idx]);
  } else {
    res.status(404).json({ error: 'Tarea no encontrada' });
  }
});

app.delete('/api/tareas/:id', (req, res) => {
  const db = loadDB();
  const { id } = req.params;
  const tarea = db.tareas.find(t => t.id === id);
  db.tareas = db.tareas.filter(t => t.id !== id);
  db.compromisos = db.compromisos.filter(c => c.tareaId !== id);
  db.devengados = db.devengados.filter(d => d.tareaId !== id);
  if (tarea) {
    db.historial.unshift({ id: uid(), tipo: 'danger', texto: 'Tarea eliminada: ' + tarea.desc.substring(0, 50), ts: now(), user: req.body.user });
  }
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/tareas/:id/subtareas', (req, res) => {
  const db = loadDB();
  const { id } = req.params;
  const { desc, inciso, credito, ref, obs, creadoPor } = req.body;
  const tarea = db.tareas.find(t => t.id === id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (!tarea.subtareas) tarea.subtareas = [];
  const subtarea = { id: uid(), desc, inciso, credito, ref, obs, creado: today(), creadoPor };
  tarea.subtareas.push(subtarea);
  db.historial.unshift({ id: uid(), tipo: 'success', texto: 'Subtarea agregada: ' + desc.substring(0, 40), ts: now(), user: creadoPor });
  saveDB(db);
  res.json(subtarea);
});

app.put('/api/tareas/:tid/subtareas/:sid', (req, res) => {
  const db = loadDB();
  const { tid, sid } = req.params;
  const { desc, inciso, credito, ref, obs, modificadoPor } = req.body;
  const tarea = db.tareas.find(t => t.id === tid);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  const st = tarea.subtareas.find(s => s.id === sid);
  if (!st) return res.status(404).json({ error: 'Subtarea no encontrada' });
  Object.assign(st, { desc, inciso, credito, ref, obs, modificado: today(), modificadoPor });
  db.historial.unshift({ id: uid(), tipo: 'info', texto: 'Subtarea editada: ' + desc.substring(0, 40), ts: now(), user: modificadoPor });
  saveDB(db);
  res.json(st);
});

app.delete('/api/tareas/:tid/subtareas/:sid', (req, res) => {
  const db = loadDB();
  const { tid, sid } = req.params;
  const tarea = db.tareas.find(t => t.id === tid);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  const st = tarea.subtareas.find(s => s.id === sid);
  tarea.subtareas = tarea.subtareas.filter(s => s.id !== sid);
  if (st) {
    db.historial.unshift({ id: uid(), tipo: 'danger', texto: 'Subtarea eliminada: ' + st.desc.substring(0, 40), ts: now(), user: req.body.user });
  }
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/compromisos', (req, res) => {
  const db = loadDB();
  res.json(db.compromisos);
});

app.post('/api/compromisos', (req, res) => {
  const db = loadDB();
  const { tareaId, subtareaId, inciso, monto, fecha, acto, desc, creadoPor } = req.body;
  const tarefa = db.tareas.find(t => t.id === tareaId);
  if (!tarefa) return res.status(404).json({ error: 'Tarea no encontrada' });
  const vig = getCreditoVigenteInc(db, tarefa, inciso);
  const comp = db.compromisos.filter(c => c.tareaId === tareaId && c.inciso === inciso && c.estado !== 'anulado').reduce((s, c) => s + c.monto, 0);
  const disp = vig - comp;
  if (monto > disp + 1) return res.status(400).json({ error: 'Monto supera el saldo disponible', disponible: disp });
  const compromiso = {
    id: uid(),
    tareaId, subtareaId, inciso, monto, fecha, mes: mon(fecha),
    acto, desc, estado: 'activo', creadoPor,
    archivos: []
  };
  db.compromisos.push(compromiso);
  db.historial.unshift({ id: uid(), tipo: 'success', texto: `Compromiso ${monto} I${inciso} — ${tarefa.desc.substring(0, 40)} — ${acto || 's/n'}`, ts: now(), user: creadoPor });
  saveDB(db);
  res.json(compromiso);
});

app.delete('/api/compromisos/:id', (req, res) => {
  const db = loadDB();
  const { id } = req.params;
  const comp = db.compromisos.find(c => c.id === id);
  if (comp) {
    comp.estado = 'anulado';
    comp.anuladoPor = req.body.user;
    comp.motivo = req.body.motivo;
    db.historial.unshift({ id: uid(), tipo: 'danger', texto: 'Compromiso anulado: ' + comp.monto, ts: now(), user: req.body.user });
  }
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/devengados', (req, res) => {
  const db = loadDB();
  res.json(db.devengados);
});

app.post('/api/devengados', (req, res) => {
  const db = loadDB();
  const { compromisoId, monto, fecha, cert, obs, creadoPor } = req.body;
  const comp = db.compromisos.find(c => c.id === compromisoId);
  if (!comp) return res.status(404).json({ error: 'Compromiso no encontrado' });
  const dev = db.devengados.filter(d => d.compromisoId === compromisoId && d.estado !== 'anulado').reduce((s, d) => s + d.monto, 0);
  const saldo = comp.monto - dev;
  if (monto > saldo + 1) return res.status(400).json({ error: 'Monto supera el saldo del compromiso', disponible: saldo });
  const tarefa = db.tareas.find(t => t.id === comp.tareaId);
  const devengado = {
    id: uid(),
    compromisoId, tareaId: comp.tareaId, subtareaId: comp.subtareaId,
    inciso: comp.inciso, monto, fecha, mes: mon(fecha),
    cert, obs, estado: 'activo', creadoPor, archivos: []
  };
  db.devengados.push(devengado);
  db.historial.unshift({ id: uid(), tipo: 'info', texto: `Devengado ${monto} — ${tarefa ? tarefa.desc.substring(0, 40) : '?'} — ${cert || 's/n'}`, ts: now(), user: creadoPor });
  saveDB(db);
  res.json(devengado);
});

app.delete('/api/devengados/:id', (req, res) => {
  const db = loadDB();
  const { id } = req.params;
  const dev = db.devengados.find(d => d.id === id);
  if (dev) {
    dev.estado = 'anulado';
    dev.anuladoPor = req.body.user;
    dev.motivo = req.body.motivo;
    db.historial.unshift({ id: uid(), tipo: 'danger', texto: 'Devengado anulado: ' + dev.monto, ts: now(), user: req.body.user });
  }
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/ampliaciones', (req, res) => {
  const db = loadDB();
  res.json(db.ampliaciones);
});

app.post('/api/ampliaciones', (req, res) => {
  const db = loadDB();
  const { tareaId, tareaOrigenId, tipo, inciso, monto, fecha, acto, motivo, creadoPor } = req.body;
  const tarefa = db.tareas.find(t => t.id === tareaId);
  if (!tarefa) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (tipo === 'reasignacion' && tareaOrigenId) {
    const tOrig = db.tareas.find(t => t.id === tareaOrigenId);
    if (tOrig) {
      const dispOrig = getCreditoVigenteInc(db, tOrig, inciso) - db.compromisos.filter(c => c.tareaId === tareaOrigenId && c.inciso === inciso && c.estado !== 'anulado').reduce((s, c) => s + c.monto, 0);
      if (monto > dispOrig + 1) return res.status(400).json({ error: 'La tarea origen no tiene suficiente saldo', disponible: dispOrig });
      const key = 'i' + inciso;
      tOrig[key] = (tOrig[key] || 0) - monto;
      db.historial.unshift({ id: uid(), tipo: 'warn', texto: `Reasignación: -${monto} I${inciso} desde "${tOrig.desc.substring(0, 40)}"`, ts: now(), user: creadoPor });
    }
  }
  const ampliacion = {
    id: uid(),
    tareaId, tareaOrigenId, tipo, inciso, monto, fecha, acto, motivo,
    estado: 'aprobada', aprobadaPor: creadoPor, fechaAprobacion: fecha, creadoPor, archivos: []
  };
  db.ampliaciones.push(ampliacion);
  db.historial.unshift({ id: uid(), tipo: 'success', texto: `Ampliación APROBADA +${monto} I${inciso} → "${tarefa.desc.substring(0, 40)}" — ${acto || motivo}`, ts: now(), user: creadoPor });
  saveDB(db);
  res.json(ampliacion);
});

app.get('/api/pendientes', (req, res) => {
  const db = loadDB();
  res.json(db.pendientes);
});

app.post('/api/pendientes', (req, res) => {
  const db = loadDB();
  const { tipo, refId, desc, motivo, nuevoMonto, solicitadoPor } = req.body;
  const pendiente = {
    id: uid(),
    tipo, refId, desc, motivo, nuevoMonto,
    solicitadoPor, fecha: today(), estado: 'pendiente'
  };
  db.pendientes.push(pendiente);
  db.historial.unshift({ id: uid(), tipo: 'warn', texto: `Solicitud de ${tipo}: ${desc.substring(0, 60)}`, ts: now(), user: solicitadoPor });
  saveDB(db);
  res.json(pendiente);
});

app.post('/api/pendientes/:id/aprobar', (req, res) => {
  const db = loadDB();
  const { id } = req.params;
  const p = db.pendientes.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: 'Pendiente no encontrado' });
  const aprobadoPor = req.body.aprobadoPor;
  p.estado = 'aprobada';
  p.aprobadaPor = aprobadoPor;
  p.fechaAprobacion = today();
  if (p.tipo === 'ampliacion') {
    const amp = db.ampliaciones.find(a => a.id === p.refId);
    if (amp) {
      amp.estado = 'aprobada';
      amp.aprobadaPor = aprobadoPor;
      amp.fechaAprobacion = today();
      if (amp.tipo === 'reasignacion' && amp.tareaOrigenId) {
        const tOrig = db.tareas.find(t => t.id === amp.tareaOrigenId);
        if (tOrig) {
          const key = 'i' + amp.inciso;
          tOrig[key] = (tOrig[key] || 0) - amp.monto;
          db.historial.unshift({ id: uid(), tipo: 'warn', texto: `Reasignación: -${amp.monto} I${amp.inciso} desde "${tOrig.desc.substring(0, 40)}"`, ts: now(), user: aprobadoPor });
        }
      }
    }
  } else if (p.tipo === 'correccion' || p.tipo === 'anulacion') {
    if (p.tipo === 'anulacion') {
      const c = db.compromisos.find(x => x.id === p.refId);
      const d = db.devengados.find(x => x.id === p.refId);
      if (c) { c.estado = 'anulado'; c.motivo = p.motivo; c.anuladoPor = aprobadoPor; }
      if (d) { d.estado = 'anulado'; d.motivo = p.motivo; d.anuladoPor = aprobadoPor; }
    } else {
      const c = db.compromisos.find(x => x.id === p.refId);
      const d = db.devengados.find(x => x.id === p.refId);
      if (c && p.nuevoMonto) { c.montoOriginal = c.monto; c.monto = p.nuevoMonto; c.corregidoPor = aprobadoPor; }
      if (d && p.nuevoMonto) { d.montoOriginal = d.monto; d.monto = p.nuevoMonto; d.corregidoPor = aprobadoPor; }
    }
  }
  db.historial.unshift({ id: uid(), tipo: 'success', texto: `[TC] Aprobado: ${p.desc.substring(0, 60)}`, ts: now(), user: aprobadoPor });
  saveDB(db);
  res.json(p);
});

app.post('/api/pendientes/:id/rechazar', (req, res) => {
  const db = loadDB();
  const { id } = req.params;
  const { motivo, rechazadoPor } = req.body;
  const p = db.pendientes.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: 'Pendiente no encontrado' });
  p.estado = 'rechazada';
  p.rechazadaPor = rechazadoPor;
  p.motivoRechazo = motivo;
  if (p.tipo === 'ampliacion') {
    const amp = db.ampliaciones.find(a => a.id === p.refId);
    if (amp) amp.estado = 'rechazada';
  }
  db.historial.unshift({ id: uid(), tipo: 'danger', texto: `[TC] Rechazado: ${p.desc.substring(0, 50)} — ${motivo}`, ts: now(), user: rechazadoPor });
  saveDB(db);
  res.json(p);
});

app.get('/api/historial', (req, res) => {
  const db = loadDB();
  res.json(db.historial);
});

app.post('/api/historial', (req, res) => {
  const db = loadDB();
  const { tipo, texto, user } = req.body;
  const entry = { id: uid(), tipo, texto, ts: now(), user };
  db.historial.unshift(entry);
  saveDB(db);
  res.json(entry);
});

app.get('/api/archivos', (req, res) => {
  const db = loadDB();
  res.json(db.archivos);
});

app.post('/api/archivos', (req, res) => {
  const db = loadDB();
  const archivos = req.body.archivos || [];
  db.archivos.push(...archivos);
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  const db = loadDB();
  res.json(db.config || {});
});

app.put('/api/config', (req, res) => {
  const db = loadDB();
  db.config = { ...db.config, ...req.body };
  saveDB(db);
  res.json(db.config);
});

app.get('/api/resumen', (req, res) => {
  const db = loadDB();
  const cred = db.tareas.reduce((s, t) => s + getCreditoVigente(db, t), 0);
  const orig = db.tareas.reduce((s, t) => s + getTotalOrig(t), 0);
  const comp = db.compromisos.filter(c => c.estado !== 'anulado').reduce((s, c) => s + c.monto, 0);
  const dev = db.devengados.filter(d => d.estado !== 'anulado').reduce((s, d) => s + d.monto, 0);
  const saldo = cred - comp;
  const pct = cred ? Math.round(dev / cred * 100) : 0;
  res.json({ cred, orig, comp, dev, saldo, pct, pendCount: pendCount(db) });
});

console.log(`🚀 Servidor presupuesto DGCICD running on http://10.116.17.104:${PORT}`);
app.listen(PORT);