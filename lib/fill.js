/* Rellena los documentos PDF (parte propio, hoja Inter, conformidad Generali, encargo Iris).
   Las coordenadas están medidas sobre los PDF originales. "y" = línea base medida desde ARRIBA de la página. */
(function (root) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const INK = rgb(0.04, 0.08, 0.42);

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function dataUrlToBytes(u) {
    const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a;
  }

  async function ctx(bytes) {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const warnings = [];
    const san = (s) => Array.from(String(s == null ? '' : s).replace(/[\t\r]/g, ' ')).map(c => { if (c === '\n') return c; try { font.encodeText(c); return c; } catch (e) { return '?'; } }).join('');
    const W = (s, size, f) => (f || font).widthOfTextAtSize(s, size);

    function wrap(s, maxW, size) {
      const out = [];
      san(s).split('\n').forEach(par => {
        const words = par.split(' '); let line = '';
        words.forEach(w => {
          const t = line ? line + ' ' + w : w;
          if (W(t, size) <= maxW || !line) { line = t; } else { out.push(line); line = w; }
        });
        out.push(line);
      });
      return out;
    }
    const api = {
      pdf, font, bold, warnings, san, wrap,
      page(i) { return pdf.getPage(i || 0); },
      // texto en una línea; se reduce la letra hasta que quepa en maxW
      line(p, s, x, y, size, maxW, o) {
        s = san(s); if (!s) return;
        let sz = size;
        if (maxW) { while (sz > 5.5 && W(s, sz) > maxW) sz -= 0.25; if (W(s, sz) > maxW) warnings.push('Texto demasiado largo: ' + s.slice(0, 30)); }
        const H = p.getHeight();
        p.drawText(s, { x: (o && o.right) ? x - W(s, sz) : (o && o.center) ? x - W(s, sz) / 2 : x, y: H - y, size: sz, font: (o && o.bold) ? bold : font, color: INK });
      },
      // párrafo dentro de un cuadro; reduce la letra si no cabe
      para(p, s, x, top, w, h, size, minSize, lead) {
        s = san(s); if (!s.trim()) return;
        let sz = size, lines;
        for (; ;) {
          lines = wrap(s, w, sz);
          const need = lines.length * sz * (lead || 1.22);
          if (need <= h || sz <= (minSize || 6)) break;
          sz -= 0.5;
        }
        const step = sz * (lead || 1.22), H = p.getHeight();
        let maxLines = Math.floor(h / step);
        if (lines.length > maxLines) warnings.push('El texto no cabe entero en el recuadro; se ha cortado.');
        lines.slice(0, Math.max(maxLines, 1)).forEach((ln, i) => p.drawText(ln, { x, y: H - (top + sz + i * step), size: sz, font, color: INK }));
      },
      // párrafo sobre renglones fijos (baselines = líneas base desde arriba); reduce la letra si no cabe
      lines(p, s, x, baselines, maxW, size, minSize) {
        s = san(s); if (!s.trim()) return;
        let sz = size, ls;
        for (; ;) { ls = wrap(s, maxW, sz); if (ls.length <= baselines.length || sz <= (minSize || 6)) break; sz -= 0.5; }
        if (ls.length > baselines.length) warnings.push('El texto no cabe en los renglones del parte; se ha cortado.');
        const H = p.getHeight();
        ls.slice(0, baselines.length).forEach((ln, i) => p.drawText(ln, { x, y: H - baselines[i], size: sz, font, color: INK }));
      },
      async image(p, dataUrl, x, top, w, h) {
        if (!dataUrl) return;
        const img = await pdf.embedPng(dataUrlToBytes(dataUrl));
        const r = Math.min(w / img.width, h / img.height);
        const iw = img.width * r, ih = img.height * r, H = p.getHeight();
        p.drawImage(img, { x: x + (w - iw) / 2, y: H - (top + h / 2 + ih / 2), width: iw, height: ih });
      },
      cross(p, x, top, size) { // aspa dentro de una casilla
        const H = p.getHeight(), m = 1.2;
        p.drawLine({ start: { x: x + m, y: H - top - m }, end: { x: x + size - m, y: H - top - size + m }, thickness: 1.1, color: INK });
        p.drawLine({ start: { x: x + m, y: H - top - size + m }, end: { x: x + size - m, y: H - top - m }, thickness: 1.1, color: INK });
      },
      white(p, x, top, w, h) { const H = p.getHeight(); p.drawRectangle({ x, y: H - top - h, width: w, height: h, color: rgb(1, 1, 1) }); },
    };
    return api;
  }

  function fechaPartes(iso) { // 'YYYY-MM-DD' -> {d, m, mes, y}
    const [y, m, d] = (iso || '').split('-').map(Number);
    if (!y) { const t = new Date(); return { d: t.getDate(), m: t.getMonth() + 1, mes: MESES[t.getMonth()], y: t.getFullYear(), txt: '' }; }
    return { d, m, mes: MESES[m - 1], y, txt: String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + y };
  }
  function splitNombre(full) { // "Apellidos, Nombre" -> {nombre, apellidos}
    const i = (full || '').indexOf(',');
    return i < 0 ? { nombre: '', apellidos: full || '' } : { apellidos: full.slice(0, i).trim(), nombre: full.slice(i + 1).trim() };
  }
  function direccionCompleta(d) { return [d.direccion, [d.cp, d.poblacion].filter(Boolean).join(' ')].filter(Boolean).join(', '); }

  /* ---------- 1) Nuestro parte (Hidro Point Barcelona) ---------- */
  async function fillParte(bytes, d) {
    const c = await ctx(bytes), p = c.page(0), f = fechaPartes(d.fecha);
    const INKW = 9;
    // Compañía, póliza (12 casillas) y expediente (9 casillas)
    c.line(p, d.compania || d.aseguradora, 112, 92.5, 11, 205);
    const caja = (txt, x0, w, n, base) => {
      txt = c.san(txt || '').replace(/\s+/g, '');
      if (!txt) return;
      if (txt.length <= n) { const cw = w / n; Array.from(txt).forEach((ch, k) => c.line(p, ch, x0 + cw * k + cw / 2, base, 11, 0, { center: true })); }
      else c.line(p, txt, x0 + 3, base, 10, w - 6);
    };
    caja(d.poliza, 121, 205, 12, 118);
    caja(d.expediente, 422.6, 152.6, 9, 118);
    // Cliente
    c.line(p, d.nombre, 50, 178, 10, 280);
    c.line(p, [d.direccion, [d.cp, d.poblacion].filter(Boolean).join(' ')].filter(Boolean).join(', '), 50, 207.5, 10, 280);
    c.line(p, [d.telefono, d.telefono2].filter(Boolean).join(' / '), 50, 236.5, 10, 280);
    // Profesional (siempre el mismo)
    c.line(p, d.pedro.nombre, 344, 178, 10, 228);
    await c.image(p, d.sigPedro, 380, 218, 190, 25);
    // Descripción (4 líneas), realizados (7) y pendientes (7)
    c.lines(p, d.descripcion, 49, [283.5, 295.8, 308.6, 320.6], 518, 9.5, 7);
    c.lines(p, d.realizados, 49, [366.4, 378.7, 390.9, 403.1, 416.1, 428.3, 441.3], 518, 9.5, 7);
    c.lines(p, d.pendientes, 49, [485.9, 498.2, 511.1, 523.5, 535.5, 548.5, 560.8], 518, 9.5, 7);
    // IVA: SÍ / NO en las tres preguntas
    const iva = [{ si: 483.5, no: 505.5, top: 599.6 }, { si: 230.6, no: 254.4, top: 610.1 }, { si: 532.2, no: 550.5, top: 620.7 }];
    iva.forEach((r, i) => {
      const v = (d.iva && d.iva[i]) || 'NC'; if (v === 'NC') return;
      c.cross(p, r[v === 'SI' ? 'si' : 'no'] - 8.4, r.top + 1.1, 6.6);
    });
    // Fecha y horas en sus casillas
    const dd = String(f.d).padStart(2, '0'), mm = String(f.m).padStart(2, '0'), yy = String(f.y).slice(2);
    if (d.fecha) {
      [[dd[0], 61.4], [dd[1], 73.3], [mm[0], 99.7], [mm[1], 111.9], [yy[0], 138.4], [yy[1], 150.2]].forEach(([ch, x]) => c.line(p, ch, x, 716.2, 11, 0, { center: true }));
    }
    const hora = (h, a, b, cc, dd2) => { const t = (h || '').split(':'); if (t.length < 2) return; const H = t[0].padStart(2, '0'), M = t[1].padStart(2, '0');
      [[H[0], a], [H[1], b], [M[0], cc], [M[1], dd2]].forEach(([ch, x]) => c.line(p, ch, x, 716.2, 11, 0, { center: true })); };
    hora(d.horaIni, 182, 196.5, 221, 237);
    hora(d.horaFin, 289.2, 303.7, 328.2, 344.2);
    // Conforme del cliente
    const nom = c.san(d.firmaNombre || d.nombre);
    c.line(p, nom, 463, 720.2, 8.5, 102);
    // DNI/NIF de quien firma, en la fila libre bajo «Nombre y apellidos»
    c.line(p, 'DNI / NIF:', 384.1, 735.6, 8.5, 0);
    p.drawLine({ start: { x: 471.5, y: p.getHeight() - 737.6 }, end: { x: 566, y: p.getHeight() - 737.6 }, thickness: 0.6, color: rgb(0, 0, 0) });
    c.line(p, d.firmaDni, 474, 735.4, 8.5, 90);
    await c.image(p, d.sigCliente, 438, 751, 118, 44);
    return { bytes: await c.pdf.save(), warnings: c.warnings };
  }

  /* ---------- 2) Hoja de encargo v2 (Inter Partner) ---------- */
  async function fillInter(bytes, d) {
    const c = await ctx(bytes), p = c.page(0), f = fechaPartes(d.fecha);
    c.line(p, d.nombre, 360, 76, 9, 186);
    c.line(p, d.direccion, 373, 94.6, 8.5, 173);
    c.line(p, [d.cp, d.poblacion].filter(Boolean).join(' '), 373, 102.6, 7.5, 173);
    c.line(p, d.nif, 338, 113.6, 9, 200);
    c.line(p, d.emailCliente, 349, 131.7, 9, 195);
    c.line(p, d.telefono, 368, 151.8, 9, 170);
    c.line(p, d.refSiniestro, 125, 155.6, 10, 180);
    c.line(p, f.txt, 415, 184.4, 9.5, 130);
    // "Resultando manifiesto el daño producido por ......" (2 líneas de puntos)
    if (d.causa && d.causa.trim()) {
      const words = c.san(d.causa).replace(/\s+/g, ' ').trim().split(' ');
      let l1 = '', i = 0;
      while (i < words.length && c.font.widthOfTextAtSize((l1 ? l1 + ' ' : '') + words[i], 9.5) <= 255) { l1 += (l1 ? ' ' : '') + words[i]; i++; }
      const l2 = words.slice(i).join(' ');
      c.line(p, l1, 249, 244.8, 9.5, 258);
      c.line(p, l2, 45, 258.2, 9.5, 266);
    }
    // Trabajos realizados (en la caja grande, debajo del texto impreso)
    const trabajo = d.realizados + (d.pendientes && d.pendientes.trim() ? '\n\nTrabajos pendientes: ' + d.pendientes : '');
    c.para(p, trabajo, 46, 298, 494, 222, 10, 6.5);
    // Lugar y fecha
    c.line(p, d.lugar || d.pedro.lugar, 100, 621.4, 9, 80, { center: true });
    c.line(p, String(f.d), 187.5, 621.4, 9, 40, { center: true });
    c.line(p, f.mes, 314, 621.4, 9, 80, { center: true });
    c.line(p, String(f.y), 396, 621.4, 9, 50, { center: true });
    // Cliente
    c.line(p, [d.firmaNombre || d.nombre, d.firmaDni].filter(Boolean).join(' - '), 165, 643, 8.5, 130);
    await c.image(p, d.sigCliente, 60, 650, 230, 62);
    // En ausencia del cliente, y en su representación (opcional)
    c.line(p, [d.repNombre, d.repNif].filter(Boolean).join(' - '), 352, 653.4, 8.5, 190);
    await c.image(p, d.sigRep, 332, 666, 206, 44);
    if (d.consentimiento) { c.cross(p, 301.3, 731.4, 6.2); }
    // Pagador de la factura
    c.line(p, d.pagoPor, 127, 790.4, 7.5, 142);
    // Reparador
    await c.image(p, d.sigPedro, 352, 756, 80, 32);
    return { bytes: await c.pdf.save(), warnings: c.warnings };
  }

  /* ---------- 3) Conformidad de trabajos terminados (Generali) ---------- */
  async function fillGenerali(bytes, d) {
    const c = await ctx(bytes), p = c.page(0), f = fechaPartes(d.fecha);
    c.line(p, d.refSiniestro, 430, 203.8, 10, 96);
    c.line(p, d.nombre, 262, 247.6, 10, 268);
    // domicilio en dos líneas
    c.line(p, d.direccion, 260, 294, 10, 270);
    c.line(p, [d.cp, d.poblacion].filter(Boolean).join(' '), 64, 328.4, 10, 465);
    // resumen: 8 líneas de rayas
    const base = [392.0, 423.7, 455.3, 487.1, 518.8, 550.5, 582.2, 613.9];
    let sz = 10, lines;
    for (; ;) { lines = c.wrap(d.realizados + (d.pendientes && d.pendientes.trim() ? '\nPendiente: ' + d.pendientes : ''), 462, sz); if (lines.length <= 8 || sz <= 7) break; sz -= 0.5; }
    if (lines.length > 8) c.warnings.push('El resumen no cabe entero en las 8 líneas de Generali.');
    lines.slice(0, 8).forEach((ln, k) => c.line(p, ln, 66, base[k] - 3.5, sz));
    // En ..., a .. de .... de 20..
    c.line(p, d.lugar || d.pedro.lugar, 210, 654, 10, 220, { center: true });
    c.line(p, String(f.d), 351.5, 654, 10, 20, { center: true });
    c.line(p, f.mes, 430, 654, 10, 100, { center: true });
    c.line(p, String(f.y).slice(2), 510.5, 654, 10, 14, { center: true });
    c.line(p, d.firmaDni ? 'DNI: ' + d.firmaDni : '', 458, 721.6, 9, 110, { right: true });
    await c.image(p, d.sigCliente, 398, 726, 145, 60);
    return { bytes: await c.pdf.save(), warnings: c.warnings };
  }

  /* ---------- 4) Encargo de trabajo (Iris Global) ---------- */
  async function fillIris(bytes, d) {
    const c = await ctx(bytes), p = c.page(0), f = fechaPartes(d.fecha), n = splitNombre(d.nombre);
    c.line(p, n.nombre, 78, 124.6, 9, 122);
    c.line(p, n.apellidos, 207, 124.6, 9, 148);
    c.line(p, d.nif, 362, 124.6, 9, 156);
    c.line(p, d.direccion, 78, 153, 9, 276);
    c.line(p, d.cp, 362, 153, 9, 156);
    c.line(p, d.poblacion, 78, 182, 9, 184);
    c.line(p, d.provincia, 270, 182, 9, 86);
    c.line(p, d.telefono, 362, 182, 9, 76);
    c.line(p, d.refSiniestro || d.expediente, 444, 211.4, 8.5, 76);
    c.para(p, d.descripcion, 78, 235, 442, 28, 8.5, 6);
    const trabajo = d.realizados + (d.pendientes && d.pendientes.trim() ? '\nPendiente: ' + d.pendientes : '');
    c.para(p, trabajo, 78, 474, 442, 34, 8.5, 6);
    await c.image(p, d.sigCliente, 333, 551, 108, 40);
    c.line(p, f.txt, 485, 566, 9, 80);
    return { bytes: await c.pdf.save(), warnings: c.warnings };
  }

  root.PartesFill = { fillParte, fillInter, fillGenerali, fillIris, fechaPartes, splitNombre };
})(typeof window !== 'undefined' ? window : globalThis);
