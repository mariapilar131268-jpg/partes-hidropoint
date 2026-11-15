/* Lee los datos del PDF de encargo que manda Girona (formato "parte" con REGISTRO / EXPEDIENTE). */
(function (root) {
  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  function parseEncargo(items) {
    // items: [{s, x, y, w}] con y = línea base medida desde arriba
    const it = items.filter(i => norm(i.s) !== '').map(i => ({ s: norm(i.s), x: i.x, y: i.y, w: i.w }));
    const byLabel = (txt) => it.find(i => i.s.toUpperCase() === txt.toUpperCase());
    const startsWith = (txt) => it.find(i => i.s.toUpperCase().startsWith(txt.toUpperCase()));
    const rightOf = (txt, maxX) => {
      const l = byLabel(txt); if (!l) return '';
      return it.filter(i => i !== l && Math.abs(i.y - l.y) <= 5 && i.x >= l.x + l.w - 2 && (!maxX || i.x < maxX))
        .sort((a, b) => a.x - b.x).map(i => i.s).join(' ');
    };
    const lineAfterPrefix = (prefix, maxX) => {
      // "NOMBRE: Mejías..." puede venir en uno o varios trozos
      const l = startsWith(prefix); if (!l) return '';
      const parts = it.filter(i => Math.abs(i.y - l.y) <= 3 && i.x >= l.x - 1 && (!maxX || i.x < maxX)).sort((a, b) => a.x - b.x).map(i => i.s);
      return norm(parts.join(' ')).replace(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim();
    };

    const r = {};
    r.registro = rightOf('REGISTRO');
    r.fechaServicio = rightOf('FECHA SERVICIO');
    const gr = byLabel('GREMIO'), op = byLabel('OPERARIO');
    r.gremio = gr ? it.filter(i => i.x >= 400 && i.y > gr.y - 8 && i.y < (op ? op.y - 3 : gr.y + 30)).sort((a, b) => a.y - b.y || a.x - b.x).map(i => i.s).join(' ') : '';
    r.compania = rightOf('COMPAÑÍA', 320);
    r.aseguradora = rightOf('ASEGURADORA', 320);
    r.expediente = rightOf('EXPEDIENTE');
    r.poliza = rightOf('Nº PÓLIZA');
    r.nombre = lineAfterPrefix('NOMBRE:', 300);
    r.direccion = lineAfterPrefix('DIRECCIÓN:', 300);
    const cpLine = lineAfterPrefix('C.P.:', 300);
    const m = cpLine.match(/^(\d{5})?\s*POBLACI[ÓO]N:\s*(.*)$/i);
    r.cp = m ? (m[1] || '') : cpLine;
    r.poblacion = m ? m[2] : '';
    r.nif = lineAfterPrefix('NIF:', 300);
    const tel = it.filter(i => i.x >= 306 && i.y > 160 && i.y < 230).map(i => i.s).join(' ');
    r.telefonos = Array.from(new Set((tel.match(/\b[6-9]\d{8}\b/g) || [])));
    const d1 = byLabel('DESCRIPCIÓN DEL SERVICIO'), d2 = byLabel('TRABAJOS REALIZADOS');
    r.descripcion = (d1 && d2) ? norm(it.filter(i => i.y > d1.y + 3 && i.y < d2.y - 8).sort((a, b) => a.y - b.y || a.x - b.x).map(i => i.s).join(' ')) : '';
    return r;
  }

  root.parseEncargo = parseEncargo;
  if (typeof module !== 'undefined') module.exports = { parseEncargo };
})(typeof window !== 'undefined' ? window : globalThis);
