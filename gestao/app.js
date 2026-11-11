/* HG Gestão: estado, telas e orçamento. As regras de preço ficam em calc.js. */
(function () {
  'use strict';
  const { parseNumber, parseTime, formatTime, money, calculateItem, roundedPrice, marginForPrice, orderTotals, monthKey, salesInMonth, goalProgress, MARGIN_CAP } = window.HGCalc;

  const STORAGE_KEY = 'hg-gestao-v1';
  const APP_NAME = 'HG Gestão';

  const MATERIALS = [
    { label: 'PLA', cost: 100 },
    { label: 'PETG', cost: 110 },
    { label: 'ABS', cost: 90 },
    { label: 'Resina', cost: 250 },
  ];
  const PRINTERS = [
    { label: 'Ender 3/V2', watts: 150, price: 1800 },
    { label: 'Bambu A1', watts: 130, price: 3600 },
    { label: 'Bambu X1C', watts: 350, price: 12000 },
    { label: 'Resina', watts: 80, price: 2500 },
  ];
  const DEFAULT_SETTINGS = {
    watts: 150, kwh: 1.25, printerPrice: 6000, lifeHours: 4000,
    defaultCostKg: 100, minProfit: 0, laborRate: 0,
  };
  const DEFAULT_PROFILE = {
    name: '', doc: '', phone: '', email: '', site: '', address: '',
    logo: '', validityDays: 7, payment: '', footer: '',
  };
  const newDraft = (keep = {}) => ({
    name: '', qty: 1, grams: '', time: '', material: '', costKg: '',
    multi: false, grams2: '', costKg2: '', laborTime: '', others: '', pack: '',
    risk: 0, margin: 100, spoolId: null,
    mode: 'simple', capacity: '', colors: [], fullPlates: false, perPiece: '', fixedPrice: '', ...keep,
  });
  const newColor = () => ({ name: '', grams: '', time: '', costKg: '', spoolId: null });
  const newOrder = () => ({ id: null, ref: null, client: '', notes: '', items: [], createdAt: null, savedAt: null, dirty: false, status: 'quote', approvedAt: null });
  const firstGoal = () => ({ id: uid(), name: 'Primeiros R$ 500 de lucro', metric: 'profit', target: 500, period: 'all' });
  const isApproved = (o) => o.status === 'approved';
  const kindLabel = (o) => (isApproved(o) ? 'pedido' : 'orçamento');

  const state = {
    tab: 'dashboard',
    dashMonth: new Date(),
    historyFilter: 'all',
    goals: [],
    settings: { ...DEFAULT_SETTINGS },
    profile: { ...DEFAULT_PROFILE },
    draft: newDraft(),
    order: newOrder(),
    history: [],
    stock: [],
    currency: 'BRL',
    seq: 1,
    editingItemId: null,
  };

  /* ---------- utilidades ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#888888');
  const fmtMoney = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: state.currency }).format(n || 0);
  const fmtDate = (d) => new Date(d).toLocaleDateString('pt-BR');
  const fmtGrams = (g) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(g)} g`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const refLabel = (ref) => (ref ? `#${String(ref).padStart(4, '0')}` : 'novo');
  const currencySymbol = () => ({ BRL: 'R$', USD: 'US$', EUR: '€' }[state.currency]);

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : ''}`;
    el.textContent = msg;
    // Com um diálogo modal aberto, o toast precisa estar dentro dele para aparecer por cima.
    const host = $('dialog[open]') || document.body;
    let box = $('.toasts', host);
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; host.appendChild(box); }
    box.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  /* O que é só da tela aberta não entra no armazenamento nem no backup. */
  function persistedData() {
    const { tab, editingItemId, dashMonth, historyFilter, ...data } = state;
    return data;
  }

  // Com login, cada conta tem sua cópia local separada (rascunho e cache).
  let storageKey = STORAGE_KEY;

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(persistedData()));
    } catch (err) {
      toast('Não foi possível salvar neste navegador. Tente uma logo menor.', 'error');
    }
    cloudAfterSave();
  }

  function applyData(data) {
    state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    state.profile = { ...DEFAULT_PROFILE, ...(data.profile || {}) };
    state.draft = newDraft(data.draft || {});
    state.order = { ...newOrder(), ...(data.order || {}) };
    state.history = Array.isArray(data.history) ? data.history : [];
    state.stock = Array.isArray(data.stock) ? data.stock : [];
    // Só cria a primeira meta se nunca houve metas; apagar todas continua valendo.
    state.goals = Array.isArray(data.goals) ? data.goals : [firstGoal()];
    state.currency = ['BRL', 'USD', 'EUR'].includes(data.currency) ? data.currency : 'BRL';
    state.seq = Number(data.seq) > 0 ? Number(data.seq) : 1;
  }

  function load() {
    try {
      const raw = localStorage.getItem(storageKey);
      applyData(raw ? JSON.parse(raw) : {});
    } catch (err) {
      toast('Dados salvos não puderam ser lidos.', 'error');
    }
    if (state.draft.costKg === '') state.draft.costKg = String(state.settings.defaultCostKg);
  }

  const download = (name, content, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const decimal = (n) => Number(n || 0).toFixed(2).replace('.', ',');
  const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita virar fórmula na planilha
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');

  /* ---------- abas ---------- */
  function setTab(tab) {
    state.tab = tab;
    $$('.view').forEach((v) => { v.hidden = v.id !== `view-${tab}`; });
    $$('.tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'history') renderHistory();
    if (tab === 'stock') renderStock();
    if (tab === 'settings') fillSettings();
    if (tab === 'gallery') openGallery();
    window.scrollTo(0, 0);
  }

  /* ---------- formulário do item ---------- */
  const currentResult = () => calculateItem(state.draft, state.settings);

  function fillForm() {
    const d = state.draft;
    $$('[data-f]').forEach((el) => {
      if (el.type === 'checkbox') el.checked = !!d[el.dataset.f];
      else el.value = d[el.dataset.f] ?? '';
    });
    syncMargin();
    renderColors();
    syncFormChrome();
  }

  function renderColors() {
    const options = (selected) => `<option value="">Sem carretel do estoque</option>` + state.stock.map((s) =>
      `<option value="${esc(s.id)}" ${s.id === selected ? 'selected' : ''}>${esc(s.brand)} ${esc(s.material)}${s.colorName ? ` · ${esc(s.colorName)}` : ''} (${esc(fmtGrams(s.weightCurrent))})</option>`).join('');
    $('#color-list').innerHTML = (state.draft.colors || []).map((c, i) => `
      <div class="color-row">
        <div class="color-row-head">
          <input type="text" data-c="name" data-i="${i}" value="${esc(c.name)}" placeholder="Cor ou parte (ex.: Azul)" aria-label="Nome da cor ${i + 1}">
          <button type="button" class="icon-btn danger" data-action="color-del" data-i="${i}" title="Remover cor" aria-label="Remover cor ${i + 1}">${icon('trash')}</button>
        </div>
        <div class="color-row-grid">
          <label class="field"><span>g por mesa</span><input type="text" inputmode="decimal" data-c="grams" data-i="${i}" value="${esc(c.grams)}" placeholder="0"></label>
          <label class="field"><span>Tempo por mesa</span><input type="text" data-c="time" data-i="${i}" value="${esc(c.time)}" placeholder="0:00"></label>
          <label class="field"><span>${esc(currencySymbol())} por kg</span><input type="text" inputmode="decimal" data-c="costKg" data-i="${i}" value="${esc(c.costKg)}" placeholder="${esc(state.settings.defaultCostKg)}" ${c.spoolId ? 'readonly' : ''}></label>
        </div>
        ${state.stock.length ? `<select data-color-spool data-i="${i}" aria-label="Carretel da cor ${i + 1}">${options(c.spoolId)}</select>` : ''}
      </div>`).join('');
  }

  function syncMargin(source) {
    const v = parseNumber(state.draft.margin);
    const slider = $('#margin');
    if (source !== 'slider') slider.value = Math.min(v, Number(slider.max));
    if (source !== 'field') $('#margin-field').value = String(Math.round(v * 100) / 100).replace('.', ',');
  }

  function syncFormChrome() {
    const d = state.draft;
    $('#risk-out').textContent = `${parseNumber(d.risk)}%`;
    $('#multi-fields').hidden = !d.multi;
    $('#form-title').textContent = state.editingItemId ? 'Editando item' : 'Novo item';
    const plates = d.mode === 'plates';
    $('#simple-fields').hidden = plates;
    $('#plates-fields').hidden = !plates;
    $('#qty-label').textContent = plates ? 'Total de peças' : 'Qtd.';
    $('.row-name').classList.toggle('by-plates', plates);
    const plateCalc = $('#plate-calc');
    const pieces = Math.max(1, Math.floor(parseNumber(d.qty)) || 1);
    const capacity = Math.floor(parseNumber(d.capacity));
    plateCalc.hidden = !plates || capacity < 1;
    if (!plateCalc.hidden) {
      const full = Math.floor(pieces / capacity);
      const rest = pieces % capacity;
      const detail = rest && full ? ` (${plural(full, 'cheia', 'cheias')} e 1 com ${plural(rest, 'peça', 'peças')})` : '';
      plateCalc.textContent = pieces < capacity
        ? `${plural(pieces, 'peça', 'peças')} ocupam só parte de 1 mesa. Uma mesa cheia tem ${capacity} peças.`
        : `${plural(pieces, 'peça', 'peças')} = ${plural(Math.ceil(pieces / capacity), 'mesa', 'mesas')} por cor${detail}.`;
    }
    $$('.seg').forEach((b) => {
      const on = b.dataset.mode === d.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });

    const spool = state.stock.find((s) => s.id === d.spoolId);
    const costInput = $('#cost-input');
    costInput.readOnly = !!spool;
    const badge = $('#spool-badge');
    badge.hidden = !spool;
    if (spool) {
      badge.innerHTML = `<span class="dot" style="background:${safeColor(spool.colorHex)}"></span>
        <span class="grow">${esc(spool.brand)} ${esc(spool.material)}, ${esc(fmtGrams(spool.weightCurrent))} restantes</span>
        <button type="button" class="icon-btn" data-action="spool-clear" title="Parar de usar este carretel" aria-label="Parar de usar este carretel">${icon('x')}</button>`;
    }
    $$('#material-presets .chip[data-material]').forEach((c) => {
      c.classList.toggle('active', !spool && c.dataset.material === d.material);
    });
  }

  function renderMaterialChips() {
    $('#material-presets').innerHTML =
      MATERIALS.map((m) => `<button type="button" class="chip" data-action="material" data-material="${esc(m.label)}" data-cost="${m.cost}">${esc(m.label)}</button>`).join('') +
      `<button type="button" class="chip chip-stock" data-action="spool-pick">Estoque</button>`;
    $('#printer-presets').innerHTML = PRINTERS.map((p, i) =>
      `<button type="button" class="chip" data-action="printer" data-index="${i}">${esc(p.label)}</button>`).join('');
  }

  function resetForm(keepPricing = true) {
    const d = state.draft;
    const keep = keepPricing
      // A margem de um preço arredondado vale só para aquele item.
      ? {
        material: d.material, costKg: d.costKg, risk: d.risk, margin: d.marginBeforeRound ?? d.margin, spoolId: d.spoolId,
        mode: d.mode, capacity: d.capacity, fullPlates: d.fullPlates,
        colors: (d.colors || []).map((c) => ({ ...c, grams: '', time: '' })),
      }
      : { costKg: String(state.settings.defaultCostKg) };
    state.draft = newDraft(keep);
    state.editingItemId = null;
    save();
    fillForm();
    renderResult();
    renderOrder();
  }

  /* ---------- painel de resultado ---------- */
  const PARTS = [
    { key: 'material', label: 'Material', color: 'var(--c-material)' },
    { key: 'energy', label: 'Energia', color: 'var(--c-energy)' },
    { key: 'wear', label: 'Desgaste', color: 'var(--c-wear)' },
    { key: 'labor', label: 'Mão de obra', color: 'var(--c-labor)' },
    { key: 'risk', label: 'Risco', color: 'var(--c-risk)' },
    { key: 'accessories', label: 'Acessórios', color: 'var(--c-accessories)' },
    { key: 'extras', label: 'Extras', color: 'var(--c-extras)' },
  ];
  /* Ordem da barra empilhada: vizinhos com cores bem diferentes (validado para daltonismo). */
  const STACK_ORDER = ['material', 'labor', 'accessories', 'energy', 'extras', 'wear', 'risk'];

  /* Tabela interna de custo por cor. Nunca vai para o orçamento do cliente. */
  function colorTable(r) {
    return `<div class="table-scroll"><table class="cost-table wide">
      <thead><tr><th>Cor</th><th>Mesas</th><th>Por mesa</th><th>Por peça</th><th>Total</th></tr></thead>
      <tbody>${r.colors.map((c) => `<tr>
        <td>${esc(c.name)}</td><td>${c.plates}</td><td>${fmtMoney(c.perPlate)}</td><td>${fmtMoney(c.perPiece)}</td><td>${fmtMoney(c.total)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td>Produção</td><td>${r.plan.plateCount}</td><td>${fmtMoney(r.plan.perPlateSet)}</td><td>${fmtMoney(r.plan.perPiece)}</td><td>${fmtMoney(r.colors.reduce((a, c) => a + c.total, 0))}</td></tr></tfoot>
    </table></div>`;
  }

  function planLine(r) {
    const p = r.plan;
    const last = p.lastPlatePieces < p.capacity
      ? (p.fullPlates ? ` A última tem ${p.lastPlatePieces} peças e conta como inteira.` : ` A última tem ${p.lastPlatePieces} peças e custa proporcional.`)
      : '';
    return `${plural(p.platesPerColor, 'mesa', 'mesas')} por cor, com ${p.capacity} peças cada.${last}`;
  }

  function renderResult() {
    const el = $('#result-panel');
    const r = currentResult();
    const editing = !!state.editingItemId;
    if (!r.valid) {
      el.innerHTML = `<div class="empty">
        <span class="empty-ic">${icon('cube')}</span>
        <strong>Pronto para orçar</strong>
        <span>${state.draft.mode === 'plates'
          ? 'Informe as peças por mesa e, em cada cor, o peso e o tempo de uma mesa.'
          : 'Informe o peso e o tempo do fatiador para ver o preço em tempo real.'}</span>
        ${editing ? `<button class="btn btn-sm" data-action="cancel-edit">Cancelar edição</button>` : ''}
      </div>`;
      return;
    }
    const rows = PARTS.filter((p) => r.parts[p.key] > 0 || ['material', 'energy', 'wear'].includes(p.key));
    const stackRows = [...rows].sort((a, b) => STACK_ORDER.indexOf(a.key) - STACK_ORDER.indexOf(b.key));
    const segments = [...stackRows.map((p) => ({ label: p.label, color: p.color, value: r.parts[p.key] })), { label: 'Lucro', color: 'var(--c-profit)', value: r.profit }].filter((s) => s.value > 0);
    const whole = Math.max(r.price, r.cost);
    const pct = (v) => (whole > 0 ? (v / whole) * 100 : 0);
    const loss = r.profit < 0;

    el.innerHTML = `
      <div class="eyebrow">${r.qty > 1 ? `Preço do lote de ${r.qty} peças` : 'Preço do item'}${r.fixedPrice ? ' (fechado)' : ''}</div>
      <div class="hero-price">${fmtMoney(r.price)}</div>
      <div class="hero-row">
        <div class="stat ${loss ? 'bad' : 'good'}"><b>${fmtMoney(r.profit)}</b><span>${loss ? 'prejuízo' : 'lucro'}</span></div>
        <div class="stat"><b>${fmtMoney(r.cost)}</b><span>custo</span></div>
        ${r.qty > 1 ? `<div class="stat"><b>${fmtMoney(r.unitPrice)}</b><span>por unidade</span></div>` : ''}
        ${r.qty > 1 ? `<div class="stat"><b>${fmtMoney(r.unitCost)}</b><span>custo por unidade</span></div>` : ''}
        ${r.discount > 0 ? `<div class="stat"><b>${fmtMoney(r.listPrice)}</b><span>preço calculado</span></div><div class="stat"><b>${fmtMoney(r.discount)}</b><span>desconto</span></div>` : ''}
      </div>
      ${loss ? `<div class="notice notice-bad">Por este preço, cada unidade dá ${fmtMoney(Math.abs(r.unitProfit))} de prejuízo.</div>` : ''}
      ${r.minProfitApplied ? `<div class="notice">A margem rendia menos que o lucro mínimo de ${fmtMoney(state.settings.minProfit)}, então vale o mínimo.</div>` : ''}
      <div class="add-row">
        <button class="btn btn-primary btn-lg" data-action="add-item">${icon(editing ? 'save' : 'plus')}${editing ? 'Atualizar item' : 'Adicionar ao pedido'}</button>
        ${editing ? `<button class="btn btn-lg" data-action="cancel-edit">Cancelar</button>` : ''}
        ${r.fixedPrice || roundedPrice(r.price) === r.price ? '' : `<button class="btn btn-lg" data-action="round-price" title="Ajusta a margem para o próximo preço terminado em ,90">Arredondar para ${fmtMoney(roundedPrice(r.price))}</button>`}
      </div>
      ${r.colors ? `<h3 class="section-title">Custo por mesa, peça e cor</h3><p class="plan-line">${esc(planLine(r))}</p><div class="plan-table">${colorTable(r)}</div>` : ''}
      <h3 class="section-title">Composição do preço</h3>
      <div class="stack" aria-hidden="true">${segments.filter((s) => s.value > 0).map((s) => `<span style="width:${pct(s.value)}%;background:${s.color}"></span>`).join('')}</div>
      <div class="legend">${segments.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)} ${pct(s.value).toFixed(1).replace('.', ',')}%</span>`).join('')}</div>
      <table class="cost-table">
        <thead><tr><th>Custo</th><th>Total</th><th>Unitário</th></tr></thead>
        <tbody>${rows.map((p) => `<tr><td><span class="swatch" style="background:${p.color}"></span>${esc(p.label)}</td><td>${fmtMoney(r.parts[p.key])}</td><td>${fmtMoney(r.parts[p.key] / r.qty)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Custo final</td><td>${fmtMoney(r.cost)}</td><td>${fmtMoney(r.unitCost)}</td></tr></tfoot>
      </table>
      <div class="roi"><span>Vendas deste item para pagar a impressora</span><b>${r.roi > 0 ? `${r.roi.toLocaleString('pt-BR')} unid.` : '—'}</b></div>`;
  }

  /* ---------- pedido ---------- */
  function itemMeta(item) {
    const r = item.result;
    if (r.colors) return `${r.colors.map((c) => c.name).join(' + ')} · ${plural(r.plan.plateCount, 'mesa', 'mesas')} · ${fmtGrams(r.grams)}`;
    const material = item.input.material || 'Filamento 3D';
    return `${material} · ${fmtGrams(r.grams)} · ${formatTime(r.hours)}`;
  }

  /* O que o cliente vê. Item por mesas mostra só nome, quantidade e preço. */
  const quoteMeta = (item) => (item.result.colors ? '' : itemMeta(item));

  function markDirty() {
    state.order.dirty = true;
    save();
  }

  function addOrUpdateItem() {
    const r = currentResult();
    if (!r.valid) return toast('Informe peso e tempo antes de adicionar.', 'error');
    const order = state.order;
    const input = clone(state.draft);
    if (!input.name.trim()) input.name = `Item ${order.items.length + (state.editingItemId ? 0 : 1)}`;
    if (state.editingItemId) {
      const idx = order.items.findIndex((i) => i.id === state.editingItemId);
      if (idx > -1) order.items[idx] = { ...order.items[idx], input, result: r };
      toast(`"${input.name}" atualizado.`);
    } else {
      order.items.push({ id: uid(), input, result: r });
      toast(`"${input.name}" adicionado ao pedido.`);
    }
    if (!order.createdAt) order.createdAt = new Date().toISOString();
    markDirty();
    resetForm(true);
    $('[data-f="name"]').focus();
  }

  function renderOrder() {
    const o = state.order;
    const el = $('#order-panel');
    const t = orderTotals(o.items);
    const approved = isApproved(o);
    const status = (approved ? `<span class="badge saved">Aprovado</span>` : '') + (o.dirty && o.items.length
      ? `<span class="badge unsaved">Não salvo</span>`
      : o.id && !approved ? `<span class="badge saved">Salvo</span>` : '');
    const clientFocused = document.activeElement && document.activeElement.id === 'order-client';

    const head = `<div class="panel-head">
        <div class="order-title"><h2>${approved ? 'Pedido' : 'Orçamento'} ${esc(refLabel(o.ref))}</h2>
          <span class="badge ${o.items.length ? 'accent' : ''}">${plural(o.items.length, 'item', 'itens')}</span>${status}
          ${o.id
            ? `<button class="icon-btn danger" data-action="order-delete" title="Excluir ${kindLabel(o)}" aria-label="Excluir ${kindLabel(o)} ${esc(refLabel(o.ref))}">${icon('trash')}</button>`
            : o.items.length
              ? `<button class="icon-btn danger" data-action="order-new" title="Descartar ${kindLabel(o)}" aria-label="Descartar ${kindLabel(o)} não salvo">${icon('trash')}</button>`
              : ''}</div>
      </div>`;

    if (!o.items.length) {
      el.innerHTML = `${head}<div class="empty empty-sm"><span class="empty-ic">${icon('file')}</span>
        <strong>Nenhum item ainda</strong>
        <span>Calcule uma peça e use “Adicionar ao pedido”. Dá para ter quantos itens você quiser, e depois salvar como orçamento ou aprovar como pedido.</span></div>`;
      return;
    }

    el.innerHTML = `${head}
      <label class="field"><span>Cliente</span><input id="order-client" type="text" placeholder="Nome do cliente" value="${esc(o.client)}"></label>
      <ul class="order-items">${o.items.map((item) => `
        <li class="order-item ${item.id === state.editingItemId ? 'editing' : ''}">
          <div class="order-item-top"><span class="name">${item.result.qty}× ${esc(item.input.name)}</span><span class="val">${fmtMoney(item.result.price)}</span></div>
          <div class="order-item-meta">${esc(itemMeta(item))}${item.result.qty > 1 ? ` · ${fmtMoney(item.result.unitPrice)} cada` : ''}</div>
          <div class="order-item-actions">
            <button class="icon-btn" data-action="item-edit" data-id="${esc(item.id)}" title="Editar" aria-label="Editar ${esc(item.input.name)}">${icon('edit')}</button>
            <button class="icon-btn" data-action="item-dup" data-id="${esc(item.id)}" title="Duplicar" aria-label="Duplicar ${esc(item.input.name)}">${icon('copy')}</button>
            <button class="icon-btn danger" data-action="item-del" data-id="${esc(item.id)}" title="Remover" aria-label="Remover ${esc(item.input.name)}">${icon('trash')}</button>
          </div>
        </li>`).join('')}</ul>
      <div class="totals">
        <div><span>Custo</span><span>${fmtMoney(t.cost)}</span></div>
        <div class="${t.profit < 0 ? 'bad' : 'good'}"><span>${t.profit < 0 ? 'Prejuízo' : 'Lucro'}</span><span>${fmtMoney(t.profit)}</span></div>
        ${t.discount > 0 ? `<div><span>Desconto no orçamento</span><span>-${fmtMoney(t.discount)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${fmtMoney(t.price)}</span></div>
      </div>
      <label class="field"><span>Observações deste orçamento</span><textarea id="order-notes" rows="2" placeholder="Aparece no documento do cliente">${esc(o.notes)}</textarea></label>
      <button class="btn btn-primary btn-lg btn-block" data-action="quote">${icon('file')}Gerar ${approved ? 'pedido' : 'orçamento'}</button>
      <div class="grid-actions">
        ${approved ? '' : `<button class="btn btn-approve" data-action="order-approve">${icon('check')}Aprovar como pedido</button>`}
        <button class="btn" data-action="order-save">${icon('save')}${approved ? 'Salvar pedido' : 'Salvar orçamento'}</button>
        <button class="btn" data-action="order-whatsapp">${icon('send')}WhatsApp</button>
        <button class="btn" data-action="order-csv">${icon('down')}CSV</button>
        <button class="btn" data-action="order-copy">${icon('copy')}Copiar</button>
      </div>
      <div class="order-foot"><button class="btn-link" data-action="order-new">Começar novo orçamento</button></div>`;

    if (clientFocused) $('#order-client').focus();
  }

  function editItem(id) {
    const item = state.order.items.find((i) => i.id === id);
    if (!item) return;
    state.draft = newDraft(clone(item.input));
    state.editingItemId = id;
    save();
    fillForm();
    renderResult();
    renderOrder();
    $('#item-form').scrollIntoView({ block: 'nearest' });
    $('[data-f="name"]').focus();
  }

  function deleteItem(id) {
    state.order.items = state.order.items.filter((i) => i.id !== id);
    if (state.editingItemId === id) resetForm(true);
    markDirty();
    renderOrder();
  }

  function duplicateItem(id) {
    const items = state.order.items;
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const copy = clone(items[idx]);
    copy.id = uid();
    delete copy.deducted;
    delete copy.deductions;
    items.splice(idx + 1, 0, copy);
    markDirty();
    renderOrder();
  }

  function ensureRef() {
    const o = state.order;
    if (!o.ref) { o.ref = state.seq; state.seq += 1; save(); }
  }

  /* Devolve o que o pedido salvo tinha tirado do estoque e desconta a versão nova. */
  function reconcileStock(previousItems, newItems) {
    const findSpool = (id) => state.stock.find((s) => s.id === id);
    const taken = (i) => i.deductions || (i.deducted ? [{ spoolId: i.input.spoolId, grams: i.deducted }] : []);
    previousItems.forEach((i) => taken(i).forEach((d) => {
      const spool = findSpool(d.spoolId);
      if (spool) spool.weightCurrent = money(spool.weightCurrent + d.grams);
    }));
    const short = [];
    newItems.forEach((i) => {
      const uses = i.result.colors
        ? i.result.colors.filter((c) => c.spoolId).map((c) => ({ spoolId: c.spoolId, grams: c.grams }))
        : (i.input.spoolId ? [{ spoolId: i.input.spoolId, grams: i.result.grams }] : []);
      delete i.deducted;
      i.deductions = [];
      uses.forEach((u) => {
        const spool = findSpool(u.spoolId);
        if (!spool) return;
        const grams = Math.min(spool.weightCurrent, u.grams);
        if (grams < u.grams) short.push(`${spool.brand} ${spool.material}`);
        i.deductions.push({ spoolId: spool.id, grams });
        spool.weightCurrent = money(spool.weightCurrent - grams);
      });
    });
    return short;
  }

  const clearDeductions = (items) => items.forEach((i) => { delete i.deducted; delete i.deductions; });

  /* Só o pedido aprovado consome estoque e conta como venda. */
  function persistOrder(status) {
    const o = state.order;
    if (!o.items.length) return;
    ensureRef();
    const existing = o.id ? state.history.find((h) => h.id === o.id) : null;
    const approved = status === 'approved';
    const short = reconcileStock(existing ? existing.items : [], approved ? o.items : []);
    if (!approved) clearDeductions(o.items);
    if (!o.id) o.id = uid();
    o.status = status;
    o.approvedAt = approved ? (o.approvedAt || new Date().toISOString()) : null;
    o.savedAt = new Date().toISOString();
    o.dirty = false;
    const record = clone(o);
    if (existing) state.history[state.history.indexOf(existing)] = record;
    else state.history.unshift(record);
    save();
    renderOrder();
    renderColors();
    syncFormChrome();
    renderDashboard();
    if (short.length) toast(`Estoque insuficiente em ${short.join(', ')}. Pedido salvo mesmo assim.`, 'error');
    else toast(`${approved ? 'Pedido' : 'Orçamento'} ${refLabel(o.ref)} salvo.`);
  }

  const saveOrder = () => persistOrder(state.order.status);
  const approveOrder = () => persistOrder('approved');

  /* Aprova ou desfaz a aprovação de um registro salvo, a partir das listas. */
  function setRecordStatus(id, status) {
    const rec = state.history.find((h) => h.id === id);
    if (!rec) return;
    const approved = status === 'approved';
    if (!approved && !confirm(`Voltar o pedido ${refLabel(rec.ref)} para orçamento? O valor sai das vendas e o filamento volta ao estoque.`)) return;
    const short = reconcileStock(rec.items, approved ? rec.items : []);
    if (!approved) clearDeductions(rec.items);
    rec.status = status;
    rec.approvedAt = approved ? new Date().toISOString() : null;
    if (state.order.id === id) {
      state.order.status = status;
      state.order.approvedAt = rec.approvedAt;
    }
    save();
    renderOrder();
    renderColors();
    renderDashboard();
    renderHistory();
    if (short.length) toast(`Estoque insuficiente em ${short.join(', ')}. Pedido aprovado mesmo assim.`, 'error');
    else toast(approved ? `Pedido ${refLabel(rec.ref)} aprovado.` : `${refLabel(rec.ref)} voltou para orçamento.`);
  }

  function newOrderFlow() {
    const o = state.order;
    if (o.dirty && o.items.length && !confirm(`Este ${kindLabel(o)} tem alterações não salvas. Descartar e começar outro?`)) return;
    state.order = newOrder();
    resetForm(true);
  }

  function orderText() {
    const o = state.order;
    const p = state.profile;
    const t = orderTotals(o.items);
    const approved = isApproved(o);
    const lines = [`*${approved ? 'Pedido' : 'Orçamento'} ${refLabel(o.ref)}${p.name ? ` · ${p.name}` : ''}*`];
    if (o.client) lines.push(`Cliente: ${o.client}`);
    lines.push('');
    o.items.forEach((i) => lines.push(`• ${i.result.qty}× ${i.input.name}: ${fmtMoney(i.result.listPrice ?? i.result.price)}`));
    lines.push('');
    if (t.discount > 0) lines.push(`Subtotal: ${fmtMoney(t.subtotal)}`, `Desconto: -${fmtMoney(t.discount)}`);
    lines.push(`*Total: ${fmtMoney(t.price)}*`);
    if (!approved && p.validityDays > 0) lines.push(`Válido por ${plural(Number(p.validityDays), 'dia', 'dias')}.`);
    if (p.payment) lines.push(`Pagamento: ${p.payment}`);
    if (o.notes) lines.push('', o.notes);
    return lines.join('\n');
  }

  function orderRows() {
    const o = state.order;
    const t = orderTotals(o.items);
    return [
      ['Item', 'Qtd', 'Material', 'Peso (g)', 'Tempo', 'Custo', 'Lucro', 'Desconto', 'Unitário', 'Total'],
      ...o.items.map((i) => [i.input.name, i.result.qty, i.result.colors ? i.result.colors.map((c) => c.name).join(' + ') : (i.input.material || 'Filamento 3D'), decimal(i.result.grams), formatTime(i.result.hours), decimal(i.result.cost), decimal(i.result.profit), decimal(i.result.discount), decimal(i.result.unitPrice), decimal(i.result.price)]),
      ['TOTAL', t.pieces, '', '', '', decimal(t.cost), decimal(t.profit), decimal(t.discount), '', decimal(t.price)],
    ];
  }

  /* ---------- orçamento ---------- */
  function profileHeader(meta) {
    const p = state.profile;
    const contact = [p.doc, [p.phone, p.email].filter(Boolean).join(' · '), p.site, p.address].filter(Boolean);
    return `<header class="q-head">
      <div class="q-company">
        ${p.logo ? `<img class="q-logo" src="${esc(p.logo)}" alt="">` : ''}
        <div>
          <div class="q-name">${esc(p.name || APP_NAME)}</div>
          ${contact.map((c) => `<div class="q-contact">${esc(c)}</div>`).join('')}
        </div>
      </div>
      <div class="q-meta">${meta}</div>
    </header>`;
  }

  function renderQuote() {
    const o = state.order;
    const p = state.profile;
    const t = orderTotals(o.items);
    const now = new Date();
    const days = Math.max(0, Math.floor(parseNumber(p.validityDays)));
    const until = new Date(now.getTime() + days * 86400000);
    const approved = isApproved(o);
    const meta = `<h3>${approved ? 'PEDIDO' : 'ORÇAMENTO'}</h3>
      <div>Nº <b>${esc(refLabel(o.ref))}</b></div>
      <div>Data: <b>${fmtDate(approved ? o.approvedAt : now)}</b></div>
      ${days > 0 && !approved ? `<div>Válido até: <b>${fmtDate(until)}</b></div>` : ''}`;
    $('#quote-title').textContent = approved ? 'Prévia do pedido' : 'Prévia do orçamento';
    $('#quote-paper').innerHTML = `${profileHeader(meta)}
      <section class="q-client"><div class="q-label">Cliente</div><div class="q-client-name">${esc(o.client || 'Cliente final')}</div></section>
      <table class="q-table">
        <thead><tr><th>#</th><th>Item</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead>
        <tbody>${o.items.map((i, n) => {
          const listed = i.result.listPrice ?? i.result.price;
          return `<tr>
          <td>${n + 1}</td>
          <td><div class="q-item-name">${esc(i.input.name)}</div>${quoteMeta(i) ? `<div class="q-item-meta">${esc(quoteMeta(i))}</div>` : ''}</td>
          <td>${i.result.qty}</td><td>${fmtMoney(money(listed / i.result.qty))}</td><td>${fmtMoney(listed)}</td>
        </tr>`;
        }).join('')}</tbody>
      </table>
      ${t.discount > 0 ? `<div class="q-summary">
        <div><span>Subtotal</span><span>${fmtMoney(t.subtotal)}</span></div>
        <div><span>Desconto</span><span>-${fmtMoney(t.discount)}</span></div>
      </div>` : ''}
      <div class="q-total"><div><span>Total do pedido</span><b>${fmtMoney(t.price)}</b></div></div>
      <section class="q-notes">
        ${o.notes ? `<div><div class="q-label">Observações</div><p>${esc(o.notes)}</p></div>` : ''}
        ${p.payment ? `<div><div class="q-label">Pagamento</div><p>${esc(p.payment)}</p></div>` : ''}
        ${p.footer ? `<div><p>${esc(p.footer)}</p></div>` : ''}
      </section>
      ${p.name ? `<footer class="q-sign">${esc(p.name)}</footer>` : ''}`;
    const warn = $('#quote-warning');
    warn.hidden = !!p.name;
    warn.innerHTML = p.name ? '' : 'Seu perfil está vazio, então o cabeçalho mostra o nome do app. <button class="btn-link" data-action="goto-profile">Configurar perfil</button>';
  }

  function openQuote() {
    if (!state.order.items.length) return;
    ensureRef();
    renderOrder();
    renderQuote();
    $('#quote-dialog').showModal();
  }

  function printQuote() {
    const title = document.title;
    const o = state.order;
    document.title = `${isApproved(o) ? 'Pedido' : 'Orcamento'} ${refLabel(o.ref)}${o.client ? ` - ${o.client}` : ''}`;
    window.addEventListener('afterprint', () => { document.title = title; }, { once: true });
    window.print();
  }

  /* ---------- histórico ---------- */
  function itemCostDetail(item) {
    const r = item.result;
    const extraRows = r.colors
      ? PARTS.filter((p) => ['labor', 'accessories', 'extras'].includes(p.key) && r.parts[p.key] > 0)
      : PARTS.filter((p) => r.parts[p.key] > 0);
    const rows = extraRows.map((p) => `<tr><td>${esc(p.label)}</td><td>${fmtMoney(r.parts[p.key])}</td><td>${fmtMoney(r.parts[p.key] / r.qty)}</td></tr>`).join('');
    return `<div class="cost-detail">
      <h4>${r.qty}× ${esc(item.input.name)}</h4>
      ${r.colors ? `<p class="plan-line">${esc(planLine(r))}</p>${colorTable(r)}` : `<p class="plan-line">${esc(itemMeta(item))}</p>`}
      <table class="cost-table">
        <thead><tr><th>${r.colors ? 'Outros custos' : 'Custo'}</th><th>Total</th><th>Por peça</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td>Custo final</td><td>${fmtMoney(r.cost)}</td><td>${fmtMoney(r.unitCost)}</td></tr>
          ${r.discount > 0 ? `<tr><td>Preço calculado</td><td>${fmtMoney(r.listPrice)}</td><td>${fmtMoney(r.listPrice / r.qty)}</td></tr>
          <tr><td>Desconto</td><td>-${fmtMoney(r.discount)}</td><td>-${fmtMoney(r.discount / r.qty)}</td></tr>` : ''}
          <tr><td>Preço de venda</td><td>${fmtMoney(r.price)}</td><td>${fmtMoney(r.unitPrice)}</td></tr>
          <tr><td>${r.profit < 0 ? 'Prejuízo' : 'Lucro'}</td><td>${fmtMoney(r.profit)}</td><td>${fmtMoney(r.unitProfit)}</td></tr>
        </tfoot>
      </table>
    </div>`;
  }

  function renderHistory() {
    const el = $('#history-body');
    const list = state.history;
    if (!list.length) {
      el.innerHTML = `<div class="panel empty"><span class="empty-ic">${icon('history')}</span><strong>Nada salvo ainda</strong><span>Salve um orçamento ou aprove um pedido na calculadora para guardá-lo aqui.</span></div>`;
      return;
    }
    const totalOf = (orders, k) => money(orders.reduce((a, o) => a + orderTotals(o.items)[k], 0));
    const approved = list.filter(isApproved);
    const open = list.filter((o) => !isApproved(o));
    const profit = totalOf(approved, 'profit');
    const shown = { all: list, quote: open, approved }[state.historyFilter];
    const filters = [['all', 'Todos', list], ['quote', 'Orçamentos', open], ['approved', 'Pedidos', approved]];
    el.innerHTML = `<div class="kpis">
        <div class="panel kpi"><span>Em orçamentos abertos</span><b>${fmtMoney(totalOf(open, 'price'))}</b></div>
        <div class="panel kpi"><span>Vendido em pedidos</span><b>${fmtMoney(totalOf(approved, 'price'))}</b></div>
        <div class="panel kpi ${profit < 0 ? 'bad' : 'good'}"><span>Lucro dos pedidos</span><b>${fmtMoney(profit)}</b></div>
      </div>
      <div class="chips filter-row" role="group" aria-label="Filtrar lista">${filters.map(([key, label, items]) =>
        `<button class="chip ${state.historyFilter === key ? 'active' : ''}" data-action="history-filter" data-filter="${key}">${label} (${items.length})</button>`).join('')}</div>
      <div class="list">${shown.map((o) => {
        const t = orderTotals(o.items);
        const names = o.items.map((i) => i.input.name).slice(0, 3).join(', ') + (o.items.length > 3 ? '…' : '');
        return `<div class="panel hist">
          <div>
            <div class="hist-title">${esc(refLabel(o.ref))} · ${esc(o.client || 'Sem cliente')} ${statusBadge(o)}</div>
            <div class="hist-meta">${fmtDate(o.approvedAt || o.savedAt)} · ${plural(o.items.length, 'item', 'itens')} · ${esc(names)}</div>
          </div>
          <div class="hist-right">
            <div class="hist-val"><b>${fmtMoney(t.price)}</b><span class="${t.profit < 0 ? 'bad' : ''}">${t.profit < 0 ? 'prejuízo' : 'lucro'} ${fmtMoney(t.profit)}</span></div>
            <div class="actions">
              ${isApproved(o)
                ? `<button class="icon-btn" data-action="record-undo" data-id="${esc(o.id)}" title="Voltar para orçamento" aria-label="Voltar ${esc(refLabel(o.ref))} para orçamento">${icon('undo')}</button>`
                : `<button class="btn btn-sm btn-approve" data-action="record-approve" data-id="${esc(o.id)}">${icon('check')}Aprovar</button>`}
              <button class="icon-btn" data-action="history-open" data-id="${esc(o.id)}" title="Abrir" aria-label="Abrir ${esc(refLabel(o.ref))}">${icon('edit')}</button>
              <button class="icon-btn danger" data-action="history-del" data-id="${esc(o.id)}" title="Excluir" aria-label="Excluir ${esc(refLabel(o.ref))}">${icon('trash')}</button>
            </div>
          </div>
          <details class="hist-details">
            <summary>Ver custos detalhados</summary>
            ${o.items.map(itemCostDetail).join('')}
          </details>
        </div>`;
      }).join('') || `<div class="panel empty empty-sm"><span>Nada neste filtro.</span></div>`}</div>`;
  }

  const statusBadge = (o) => (isApproved(o)
    ? `<span class="badge saved">Pedido aprovado</span>`
    : `<span class="badge">Orçamento</span>`);

  function openHistoryOrder(id) {
    const rec = state.history.find((h) => h.id === id);
    if (!rec) return;
    const o = state.order;
    if (o.dirty && o.items.length && !confirm(`O ${kindLabel(o)} aberto tem alterações não salvas. Descartar e abrir este?`)) return;
    state.order = { ...newOrder(), ...clone(rec), dirty: false };
    state.editingItemId = null;
    save();
    setTab('calc');
    fillForm();
    renderResult();
    renderOrder();
    toast(`${isApproved(rec) ? 'Pedido' : 'Orçamento'} ${refLabel(rec.ref)} aberto.`);
  }

  function deleteHistoryOrder(id) {
    const rec = state.history.find((h) => h.id === id);
    if (!rec) return;
    const usesStock = rec.items.some((i) => i.deducted > 0 || (i.deductions || []).some((d) => d.grams > 0));
    const msg = `Excluir o ${kindLabel(rec)} ${refLabel(rec.ref)}?`
      + (isApproved(rec) ? ' O valor sai das vendas.' : '')
      + (usesStock ? ' O filamento descontado volta para o estoque.' : '');
    if (!confirm(msg)) return false;
    reconcileStock(rec.items, []);
    state.history = state.history.filter((h) => h.id !== id);
    if (state.order.id === id) detachOpenOrder();
    save();
    renderHistory();
    renderOrder();
    renderDashboard();
    return true;
  }

  /* Excluir pela calculadora também limpa a tela, já que o registro aberto deixou de existir. */
  function deleteOpenOrder() {
    if (!deleteHistoryOrder(state.order.id)) return;
    state.order = newOrder();
    resetForm(true);
  }

  /* O registro salvo sumiu: o que está aberto na calculadora vira um orçamento não salvo. */
  function detachOpenOrder() {
    Object.assign(state.order, { id: null, status: 'quote', approvedAt: null });
    clearDeductions(state.order.items);
    if (state.order.items.length) state.order.dirty = true;
  }

  /* ---------- dashboard ---------- */
  const viewedMonthKey = () => monthKey(state.dashMonth);

  function shiftMonth(delta) {
    const d = state.dashMonth;
    state.dashMonth = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    renderDashboard();
  }

  function renderDashboard() {
    const key = viewedMonthKey();
    const monthName = state.dashMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const shortMonth = state.dashMonth.toLocaleDateString('pt-BR', { month: 'long' });
    $('#dash-month').textContent = monthName;
    $('#month-next').disabled = key >= monthKey(new Date());

    const sales = salesInMonth(state.history, key);
    const open = state.history.filter((o) => !isApproved(o));
    const openTotal = money(open.reduce((a, o) => a + orderTotals(o.items).price, 0));
    $('#dash-kpis').innerHTML = `
      <div class="panel kpi"><span>Vendido em ${esc(shortMonth)}</span><b>${fmtMoney(sales.price)}</b></div>
      <div class="panel kpi ${sales.profit < 0 ? 'bad' : 'good'}"><span>${sales.profit < 0 ? 'Prejuízo' : 'Lucro'} em ${esc(shortMonth)}</span><b>${fmtMoney(sales.profit)}</b></div>
      <div class="panel kpi"><span>Pedidos aprovados</span><b>${sales.count}</b></div>
      <div class="panel kpi"><span>Orçamentos abertos</span><b>${open.length}</b><small>${fmtMoney(openTotal)} em aberto</small></div>`;

    $('#dash-orders').innerHTML = `
      <div class="panel-head"><h2>Pedidos aprovados em ${esc(shortMonth)}</h2></div>
      ${sales.count ? sales.orders.map((o) => {
        const t = orderTotals(o.items);
        return `<div class="dash-row">
          <div class="dash-row-main">
            <div class="hist-title">${esc(refLabel(o.ref))} · ${esc(o.client || 'Sem cliente')}</div>
            <div class="hist-meta">${fmtDate(o.approvedAt)} · ${esc(o.items.map((i) => `${i.result.qty}× ${i.input.name}`).join(', '))}</div>
          </div>
          <div class="dash-row-right">
            <div class="hist-val"><b>${fmtMoney(t.price)}</b><span class="${t.profit < 0 ? 'bad' : ''}">${t.profit < 0 ? 'prejuízo' : 'lucro'} ${fmtMoney(t.profit)}</span></div>
            <button class="icon-btn" data-action="history-open" data-id="${esc(o.id)}" title="Abrir" aria-label="Abrir pedido ${esc(refLabel(o.ref))}">${icon('edit')}</button>
          </div>
        </div>`;
      }).join('') + `<div class="dash-foot"><span>Total vendido</span><span>${fmtMoney(sales.price)}</span></div>`
    : `<div class="empty empty-sm"><span class="empty-ic">${icon('check')}</span><strong>Nenhum pedido neste mês</strong><span>Aprove um orçamento para o valor entrar aqui.</span></div>`}`;

    renderGoals();
    renderLastQuote(open);
  }

  function renderGoals() {
    const metricLabel = (g) => (g.metric === 'sales' ? 'em vendas' : 'de lucro');
    $('#dash-goals').innerHTML = `
      <div class="panel-head"><h2>Metas</h2><button class="btn btn-sm" data-action="goal-new">${icon('plus')}Nova meta</button></div>
      ${state.goals.length ? state.goals.map((g) => {
        const p = goalProgress(g, state.history);
        const percent = p.pct.toFixed(p.pct < 10 ? 1 : 0).replace('.', ',');
        return `<div class="goal ${p.reached ? 'reached' : ''}">
          <div class="goal-head">
            <span class="goal-name">${esc(g.name)}</span>
            <span class="goal-actions">
              <button class="icon-btn" data-action="goal-edit" data-id="${esc(g.id)}" title="Editar meta" aria-label="Editar meta ${esc(g.name)}">${icon('edit')}</button>
              <button class="icon-btn danger" data-action="goal-del" data-id="${esc(g.id)}" title="Excluir meta" aria-label="Excluir meta ${esc(g.name)}">${icon('trash')}</button>
            </span>
          </div>
          <div class="goal-numbers"><b>${fmtMoney(p.value)}</b><span>de ${fmtMoney(p.target)} ${metricLabel(g)}${g.period === 'month' ? ' no mês' : ''}</span></div>
          <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pct)}" aria-label="${esc(g.name)}"><span style="width:${p.pct}%"></span></div>
          <div class="goal-status">${p.reached ? `${icon('check')}Meta atingida` : `${percent}% · faltam ${fmtMoney(p.remaining)}`}</div>
        </div>`;
      }).join('') : `<div class="empty empty-sm"><span class="empty-ic">${icon('target')}</span><strong>Nenhuma meta</strong><span>Crie uma meta de lucro ou de vendas.</span></div>`}`;
  }

  function renderLastQuote(open) {
    const last = [...open].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))[0];
    const el = $('#dash-last');
    if (!last) {
      el.innerHTML = `<div class="panel-head"><h2>Último orçamento</h2></div>
        <div class="empty empty-sm"><span class="empty-ic">${icon('file')}</span><strong>Nenhum orçamento em aberto</strong><span>Os orçamentos salvos e ainda não aprovados aparecem aqui.</span></div>`;
      return;
    }
    const t = orderTotals(last.items);
    el.innerHTML = `<div class="panel-head"><h2>Último orçamento</h2><span class="badge">${esc(refLabel(last.ref))}</span></div>
      <div class="hist-title">${esc(last.client || 'Sem cliente')}</div>
      <div class="last-total">${fmtMoney(t.price)}</div>
      <div class="hist-meta">${fmtDate(last.savedAt)} · ${esc(last.items.map((i) => `${i.result.qty}× ${i.input.name}`).join(', '))}</div>
      <div class="last-actions">
        <button class="btn btn-approve" data-action="record-approve" data-id="${esc(last.id)}">${icon('check')}Aprovar</button>
        <button class="btn" data-action="history-open" data-id="${esc(last.id)}">${icon('edit')}Abrir</button>
        <button class="icon-btn danger" data-action="history-del" data-id="${esc(last.id)}" title="Excluir orçamento" aria-label="Excluir orçamento ${esc(refLabel(last.ref))}">${icon('trash')}</button>
      </div>`;
  }

  function openGoalForm(id) {
    const form = $('#goal-form');
    form.reset();
    const g = id ? state.goals.find((x) => x.id === id) : null;
    form.dataset.id = g ? g.id : '';
    $('#goal-title').textContent = g ? 'Editar meta' : 'Nova meta';
    if (g) {
      form.elements.name.value = g.name;
      form.metric.value = g.metric;
      form.target.value = g.target;
      form.period.value = g.period;
    }
    $('#goal-dialog').showModal();
  }

  function submitGoal(ev) {
    ev.preventDefault();
    const f = ev.target;
    const target = parseNumber(f.target.value);
    if (target <= 0) return toast('O valor da meta precisa ser maior que zero.', 'error');
    const data = { id: f.dataset.id || uid(), name: f.elements.name.value.trim(), metric: f.metric.value, target, period: f.period.value };
    const idx = state.goals.findIndex((g) => g.id === data.id);
    if (idx > -1) state.goals[idx] = data; else state.goals.push(data);
    save();
    $('#goal-dialog').close();
    renderGoals();
    toast('Meta salva.');
  }

  /* ---------- estoque ---------- */
  const spoolCostKg = (s) => (s.weightInitial > 0 ? s.price / (s.weightInitial / 1000) : 0);

  function renderStock() {
    const el = $('#stock-body');
    if (!state.stock.length) {
      el.innerHTML = `<div class="panel empty"><span class="empty-ic">${icon('box')}</span><strong>Nenhum carretel</strong><span>Cadastre seus carretéis para usar o custo real de cada um nos orçamentos.</span></div>`;
      return;
    }
    el.innerHTML = `<div class="spools">${state.stock.map((s) => {
      const pct = s.weightInitial > 0 ? Math.min(100, (s.weightCurrent / s.weightInitial) * 100) : 0;
      const color = pct < 10 ? 'var(--bad)' : pct < 30 ? 'var(--warn)' : 'var(--good)';
      return `<div class="panel">
        <div class="spool-head">
          <span class="spool-color" style="background:${safeColor(s.colorHex)}"></span>
          <div class="spool-name"><b>${esc(s.brand)}</b><span>${esc(s.material)}${s.colorName ? ` · ${esc(s.colorName)}` : ''}</span></div>
          <button class="icon-btn" data-action="spool-edit" data-id="${esc(s.id)}" aria-label="Editar carretel ${esc(s.brand)}" title="Editar">${icon('edit')}</button>
          <button class="icon-btn danger" data-action="spool-del" data-id="${esc(s.id)}" aria-label="Excluir carretel ${esc(s.brand)}" title="Excluir">${icon('trash')}</button>
        </div>
        <div class="meter-label"><span>Disponível</span><span>${esc(fmtGrams(s.weightCurrent))} de ${esc(fmtGrams(s.weightInitial))}</span></div>
        <div class="meter"><span style="width:${pct}%;background:${color}"></span></div>
        <div class="spool-cost"><span>Custo por kg</span><b>${fmtMoney(spoolCostKg(s))}</b></div>
      </div>`;
    }).join('')}</div>`;
  }

  function openSpoolForm(id) {
    const form = $('#spool-form');
    form.reset();
    const s = id ? state.stock.find((x) => x.id === id) : null;
    form.dataset.id = s ? s.id : '';
    $('#spool-title').textContent = s ? 'Editar carretel' : 'Novo carretel';
    if (s) {
      form.brand.value = s.brand;
      form.material.value = s.material;
      form.colorName.value = s.colorName || '';
      form.colorHex.value = safeColor(s.colorHex);
      form.weightInitial.value = s.weightInitial;
      form.weightCurrent.value = s.weightCurrent;
      form.price.value = s.price;
    }
    $('#spool-dialog').showModal();
  }

  function submitSpool(ev) {
    ev.preventDefault();
    const f = ev.target;
    const weightInitial = parseNumber(f.weightInitial.value);
    const weightCurrent = parseNumber(f.weightCurrent.value);
    const price = parseNumber(f.price.value);
    if (weightInitial <= 0) return toast('O peso inicial precisa ser maior que zero.', 'error');
    const data = {
      id: f.dataset.id || uid(),
      brand: f.brand.value.trim(),
      material: f.material.value.trim(),
      colorName: f.colorName.value.trim(),
      colorHex: f.colorHex.value,
      weightInitial, weightCurrent, price,
    };
    const idx = state.stock.findIndex((s) => s.id === data.id);
    if (idx > -1) state.stock[idx] = data; else state.stock.push(data);
    if (state.draft.spoolId === data.id) applySpool(data);
    (state.draft.colors || []).forEach((c) => { if (c.spoolId === data.id) c.costKg = spoolCostKg(data).toFixed(2); });
    save();
    $('#spool-dialog').close();
    renderStock();
    fillForm();
    renderResult();
    toast('Carretel salvo.');
  }

  function deleteSpool(id) {
    if (!confirm('Remover este carretel do estoque?')) return;
    state.stock = state.stock.filter((s) => s.id !== id);
    if (state.draft.spoolId === id) state.draft.spoolId = null;
    (state.draft.colors || []).forEach((c) => { if (c.spoolId === id) c.spoolId = null; });
    save();
    renderStock();
    fillForm();
  }

  function applySpool(spool) {
    state.draft.spoolId = spool.id;
    state.draft.costKg = spoolCostKg(spool).toFixed(2);
    state.draft.material = `${spool.brand} ${spool.material}`.trim();
  }

  function openSpoolPicker() {
    if (!state.stock.length) return toast('Nenhum carretel no estoque. Cadastre um na aba Estoque.', 'error');
    $('#spool-picker-list').innerHTML = state.stock.map((s) => `
      <button class="picker" data-action="spool-select" data-id="${esc(s.id)}">
        <span class="dot" style="background:${safeColor(s.colorHex)}"></span>
        <span class="grow">${esc(s.brand)} ${esc(s.material)}<small>${esc(fmtGrams(s.weightCurrent))} restantes</small></span>
        <b>${fmtMoney(spoolCostKg(s))}/kg</b>
      </button>`).join('');
    $('#spool-picker').showModal();
  }

  /* ---------- ajustes ---------- */
  function fillSettings() {
    $$('[data-s]').forEach((el) => { el.value = state.settings[el.dataset.s]; });
    $$('[data-p]').forEach((el) => { el.value = state.profile[el.dataset.p] ?? ''; });
    $('#currency').value = state.currency;
    renderProfilePreview();
  }

  function renderProfilePreview() {
    const p = state.profile;
    $('#logo-preview').innerHTML = p.logo ? `<img src="${esc(p.logo)}" alt="Logo atual">` : 'Sem logo';
    $('#logo-remove').hidden = !p.logo;
    const meta = `<h3>ORÇAMENTO</h3><div>Nº <b>#0001</b></div><div>Data: <b>${fmtDate(new Date())}</b></div>`;
    $('#profile-preview').innerHTML = profileHeader(meta);
  }

  /* Reduz a logo para caber com folga no armazenamento local do navegador. */
  function readLogo(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 480 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
      img.src = url;
    });
  }

  function exportBackup() {
    const data = persistedData();
    const stamp = new Date().toISOString().slice(0, 10);
    download(`hg-gestao-backup-${stamp}.json`, JSON.stringify({ app: 'hg-gestao', version: 1, ...data }, null, 2), 'application/json');
    toast('Backup gerado.');
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.app !== 'hg-gestao' || !data.settings) throw new Error('arquivo inválido');
        const scope = cloud.on ? 'todos os dados da sua conta, em todos os aparelhos' : 'todos os dados atuais';
        if (!confirm(`Restaurar substitui ${scope}. Continuar?`)) return;
        applyData(data);
        state.editingItemId = null;
        save();
        renderAll();
        fillSettings();
        toast('Dados restaurados.');
      } catch (err) {
        toast('Este arquivo não é um backup do HG Gestão.', 'error');
      }
    };
    reader.readAsText(file);
  }

  function renderCurrency() {
    $$('.cur').forEach((el) => { el.textContent = currencySymbol(); });
  }

  function renderAll() {
    renderCurrency();
    fillForm();
    renderResult();
    renderOrder();
    renderHistory();
    renderStock();
    renderDashboard();
  }

  /* ---------- ações (cliques) ---------- */
  const actions = {
    tab: (b, ev) => { ev.preventDefault(); setTab(b.dataset.tab); },
    mode: (b) => {
      state.draft.mode = b.dataset.mode;
      if (b.dataset.mode === 'plates' && !state.draft.colors.length) state.draft.colors = [newColor()];
      save();
      fillForm();
      renderResult();
    },
    'color-add': () => {
      state.draft.colors.push(newColor());
      save();
      renderColors();
      $(`[data-c="name"][data-i="${state.draft.colors.length - 1}"]`).focus();
    },
    'color-del': (b) => {
      state.draft.colors.splice(Number(b.dataset.i), 1);
      save();
      renderColors();
      renderResult();
    },
    'reset-form': () => {
      if (state.editingItemId || confirm('Limpar os dados do formulário?')) resetForm(false);
    },
    material: (b) => {
      state.draft.material = b.dataset.material;
      state.draft.costKg = b.dataset.cost;
      state.draft.spoolId = null;
      $('#cost-input').value = b.dataset.cost;
      save();
      syncFormChrome();
      renderResult();
    },
    printer: (b) => {
      const p = PRINTERS[Number(b.dataset.index)];
      state.settings.watts = p.watts;
      state.settings.printerPrice = p.price;
      save();
      fillSettings();
      renderResult();
      toast(`Máquina ajustada para ${p.label}.`);
    },
    'add-item': addOrUpdateItem,
    'cancel-edit': () => resetForm(false),
    'round-price': () => {
      const r = currentResult();
      const target = roundedPrice(r.price);
      state.draft.marginBeforeRound ??= state.draft.margin;
      state.draft.margin = marginForPrice(target, r);
      save();
      syncMargin();
      renderResult();
      toast(`Preço ajustado para ${fmtMoney(target)}.`);
    },
    'item-edit': (b) => editItem(b.dataset.id),
    'item-dup': (b) => duplicateItem(b.dataset.id),
    'item-del': (b) => deleteItem(b.dataset.id),
    quote: openQuote,
    print: printQuote,
    'close-dialog': (b) => b.closest('dialog').close(),
    'goto-profile': (b) => { b.closest('dialog').close(); setTab('settings'); },
    'order-save': saveOrder,
    'order-approve': approveOrder,
    'record-approve': (b) => setRecordStatus(b.dataset.id, 'approved'),
    'record-undo': (b) => setRecordStatus(b.dataset.id, 'quote'),
    'history-filter': (b) => { state.historyFilter = b.dataset.filter; renderHistory(); },
    'month-prev': () => shiftMonth(-1),
    'month-next': () => shiftMonth(1),
    'goal-new': () => openGoalForm(null),
    'goal-edit': (b) => openGoalForm(b.dataset.id),
    'goal-del': (b) => {
      if (!confirm('Excluir esta meta?')) return;
      state.goals = state.goals.filter((g) => g.id !== b.dataset.id);
      save();
      renderGoals();
    },
    'order-new': newOrderFlow,
    'order-whatsapp': () => {
      ensureRef();
      renderOrder();
      window.open(`https://wa.me/?text=${encodeURIComponent(orderText())}`, '_blank', 'noopener');
    },
    'order-csv': () => {
      ensureRef();
      renderOrder();
      download(`orcamento-${String(state.order.ref).padStart(4, '0')}.csv`, toCsv(orderRows()), 'text/csv;charset=utf-8');
    },
    'order-copy': async () => {
      const text = orderRows().map((r) => r.join('\t')).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        toast('Pedido copiado. É só colar na planilha.');
      } catch (err) {
        toast('O navegador bloqueou a cópia.', 'error');
      }
    },
    'history-csv': () => {
      if (!state.history.length) return toast('Histórico vazio.', 'error');
      const rows = [['Número', 'Tipo', 'Data', 'Cliente', 'Itens', 'Custo', 'Lucro', 'Desconto', 'Total']];
      state.history.forEach((o) => {
        const t = orderTotals(o.items);
        rows.push([refLabel(o.ref), isApproved(o) ? 'Pedido' : 'Orçamento', fmtDate(o.approvedAt || o.savedAt), o.client, t.count, decimal(t.cost), decimal(t.profit), decimal(t.discount), decimal(t.price)]);
      });
      download('historico-hg-gestao.csv', toCsv(rows), 'text/csv;charset=utf-8');
    },
    'history-clear': () => {
      if (!state.history.length) return toast('Histórico vazio.', 'error');
      if (!confirm('Apagar todo o histórico, incluindo os pedidos aprovados? As vendas e metas voltam a zero. Não dá para desfazer, e o estoque não é alterado. Se precisar, faça um backup em Ajustes antes.')) return;
      state.history = [];
      detachOpenOrder();
      save();
      renderHistory();
      renderOrder();
      renderDashboard();
    },
    'history-open': (b) => openHistoryOrder(b.dataset.id),
    'history-del': (b) => deleteHistoryOrder(b.dataset.id),
    'order-delete': deleteOpenOrder,
    'spool-new': () => openSpoolForm(null),
    'spool-edit': (b) => openSpoolForm(b.dataset.id),
    'spool-del': (b) => deleteSpool(b.dataset.id),
    'spool-pick': openSpoolPicker,
    'spool-select': (b) => {
      const spool = state.stock.find((s) => s.id === b.dataset.id);
      if (spool) applySpool(spool);
      save();
      $('#spool-picker').close();
      fillForm();
      renderResult();
    },
    'spool-clear': () => {
      state.draft.spoolId = null;
      save();
      syncFormChrome();
    },
    'theme-toggle': () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'),
    'logo-remove': () => {
      state.profile.logo = '';
      save();
      renderProfilePreview();
    },
    backup: exportBackup,
    'sign-out': signOutFlow,
    'gh-save': saveGithubToken,
    'gh-forget': forgetGithubToken,
    'gh-reload': () => loadPhotos(),
    'photo-del': (b) => deletePhoto(b.dataset.name),
    'forgot-password': forgotPassword,
  };

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action]');
    if (b && actions[b.dataset.action]) actions[b.dataset.action](b, ev);
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.f) {
      const key = el.dataset.f;
      state.draft[key] = el.type === 'checkbox' ? el.checked : el.value;
      save();
      if (['multi', 'risk', 'fixedPrice', 'qty', 'capacity'].includes(key)) syncFormChrome();
      renderResult();
    } else if (el.dataset.c) {
      state.draft.colors[Number(el.dataset.i)][el.dataset.c] = el.value;
      save();
      renderResult();
    } else if ('colorSpool' in el.dataset) {
      const color = state.draft.colors[Number(el.dataset.i)];
      const spool = state.stock.find((s) => s.id === el.value);
      color.spoolId = spool ? spool.id : null;
      if (spool) {
        color.costKg = spoolCostKg(spool).toFixed(2);
        if (!color.name.trim()) color.name = spool.colorName || spool.material;
      }
      save();
      renderColors();
      renderResult();
    } else if (el.id === 'margin' || el.id === 'margin-field') {
      const v = Math.min(MARGIN_CAP, Math.max(0, parseNumber(el.value)));
      state.draft.margin = v;
      delete state.draft.marginBeforeRound;
      save();
      syncMargin(el.id === 'margin' ? 'slider' : 'field');
      renderResult();
    } else if (el.dataset.s) {
      state.settings[el.dataset.s] = parseNumber(el.value);
      save();
      renderResult();
    } else if (el.dataset.p) {
      state.profile[el.dataset.p] = el.value;
      save();
      renderProfilePreview();
    } else if (el.id === 'order-client') {
      state.order.client = el.value;
      markDirty();
    } else if (el.id === 'order-notes') {
      state.order.notes = el.value;
      markDirty();
    }
  });

  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.id === 'margin-field') syncMargin();
    if (el.id === 'theme-select') setTheme(el.value);
    if (el.id === 'order-client' || el.id === 'order-notes') renderOrder();
    if (el.id === 'currency') {
      state.currency = el.value;
      save();
      renderCurrency();
      renderResult();
      renderOrder();
      renderStock();
      renderDashboard();
      renderHistory();
    }
    if (el.id === 'logo-input' && el.files[0]) {
      try {
        state.profile.logo = await readLogo(el.files[0]);
        save();
        renderProfilePreview();
      } catch (err) {
        toast('Não foi possível ler esta imagem.', 'error');
      }
      el.value = '';
    }
    if (el.id === 'photo-input' && el.files.length) {
      uploadPhotos([...el.files]);
      el.value = '';
    }
    if (el.id === 'restore-input' && el.files[0]) {
      importBackup(el.files[0]);
      el.value = '';
    }
  });

  $('#spool-form').addEventListener('submit', submitSpool);
  $('#goal-form').addEventListener('submit', submitGoal);

  /* Clique fora do conteúdo fecha o diálogo. */
  $$('dialog').forEach((d) => d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }));

  /* ---------- tema ----------
     Preferência deste aparelho, fora dos dados e do backup. Sem escolha, segue o sistema. */
  const THEME_KEY = 'hg-gestao-theme';
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const savedTheme = () => {
    try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (err) { return 'auto'; }
  };
  const currentTheme = () => document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');

  function setTheme(choice) {
    const root = document.documentElement;
    if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
    else delete root.dataset.theme;
    try {
      if (choice === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, choice);
    } catch (err) { /* sem armazenamento, o tema vale só até fechar */ }
    syncThemeControls();
  }

  function syncThemeControls() {
    const next = currentTheme() === 'dark' ? 'claro' : 'escuro';
    const btn = $('.theme-toggle');
    btn.title = `Usar tema ${next}`;
    btn.setAttribute('aria-label', `Usar tema ${next}`);
    $('#theme-select').value = savedTheme();
  }
  systemDark.addEventListener('change', syncThemeControls);

  /* ---------- nuvem (Firebase) ----------
     Configurações, perfil, estoque e metas ficam num documento; cada orçamento ou pedido
     salvo é um documento próprio. O rascunho da calculadora fica só no aparelho.
     A cada save(), o app compara com o que já está na nuvem e envia só o que mudou. */
  const cloud = {
    on: false, user: null, ready: false,
    gotMeta: false, gotOrders: false, metaMissing: false,
    lastMeta: null, lastOrders: new Map(), metaTimer: null,
    pending: { meta: false, orders: false }, error: null,
  };

  /* Ordena as chaves e tira valores vazios: a comparação não muda com a ordem dos campos,
     e o Firestore não aceita undefined. */
  function canonical(v) {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      const out = {};
      Object.keys(v).sort().forEach((k) => { if (v[k] !== undefined) out[k] = canonical(v[k]); });
      return out;
    }
    return v;
  }
  const metaPayload = () => canonical({
    settings: state.settings, profile: state.profile, stock: state.stock,
    goals: state.goals, currency: state.currency, seq: state.seq,
  });

  function syncError(err) {
    cloud.error = err && err.code === 'permission-denied'
      ? 'Sem permissão no banco. Confira as regras do Firestore.'
      : 'Erro ao sincronizar. As mudanças continuam neste aparelho.';
    renderSync();
  }

  function cloudAfterSave() {
    if (!cloud.ready) return;
    syncOrders();
    // Configurações mudam a cada tecla; espera a pessoa parar de digitar.
    clearTimeout(cloud.metaTimer);
    cloud.metaTimer = setTimeout(() => { flushMeta(); renderSync(); }, 700);
    renderSync();
  }

  function flushMeta() {
    clearTimeout(cloud.metaTimer);
    cloud.metaTimer = null;
    const payload = metaPayload();
    const json = JSON.stringify(payload);
    if (json === cloud.lastMeta) return;
    cloud.lastMeta = json;
    window.HGCloud.writeMeta(cloud.user.uid, payload).catch(syncError);
  }

  function syncOrders() {
    const uid = cloud.user.uid;
    const seen = new Set();
    state.history.forEach((o) => {
      seen.add(o.id);
      const payload = canonical(o);
      const json = JSON.stringify(payload);
      if (cloud.lastOrders.get(o.id) === json) return;
      cloud.lastOrders.set(o.id, json);
      window.HGCloud.writeOrder(uid, payload).catch(syncError);
    });
    [...cloud.lastOrders.keys()].forEach((id) => {
      if (seen.has(id)) return;
      cloud.lastOrders.delete(id);
      window.HGCloud.deleteOrder(uid, id).catch(syncError);
    });
  }

  function onRemoteMeta(data, meta) {
    cloud.pending.meta = meta.hasPendingWrites;
    renderSync();
    // Há uma mudança local esperando envio: manda agora; a versão nova volta em seguida.
    if (cloud.metaTimer) { flushMeta(); return; }
    if (!data) {
      // Cache vazio não prova que a conta é nova: espera a resposta do servidor.
      if (meta.fromCache) return;
      cloud.metaMissing = true;
    } else {
      const json = JSON.stringify(canonical(data));
      if (json !== cloud.lastMeta) {
        cloud.lastMeta = json;
        state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
        state.profile = { ...DEFAULT_PROFILE, ...(data.profile || {}) };
        state.stock = Array.isArray(data.stock) ? data.stock : [];
        state.goals = Array.isArray(data.goals) ? data.goals : [];
        state.currency = ['BRL', 'USD', 'EUR'].includes(data.currency) ? data.currency : 'BRL';
        state.seq = Math.max(Number(data.seq) || 1, cloud.ready ? state.seq : 1);
        if (cloud.ready) refreshFromRemote();
      }
    }
    cloud.gotMeta = true;
    maybeReady();
  }

  function onRemoteOrders(list, meta) {
    cloud.pending.orders = meta.hasPendingWrites;
    renderSync();
    if (!list.length && meta.fromCache && !cloud.gotOrders) return;
    const incoming = new Map(list.map((o) => [o.id, JSON.stringify(canonical(o))]));
    const changed = incoming.size !== cloud.lastOrders.size
      || [...incoming].some(([id, json]) => cloud.lastOrders.get(id) !== json);
    cloud.lastOrders = incoming;
    if (changed || !cloud.gotOrders) {
      state.history = list.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
      if (cloud.ready) refreshFromRemote();
    }
    cloud.gotOrders = true;
    maybeReady();
  }

  /* Outro aparelho mudou algo: atualiza o que está aberto aqui sem perder edição em andamento. */
  function refreshFromRemote() {
    const o = state.order;
    if (o.id) {
      const rec = state.history.find((h) => h.id === o.id);
      if (!rec) detachOpenOrder();
      else if (!o.dirty) state.order = { ...newOrder(), ...clone(rec), dirty: false };
    }
    try { localStorage.setItem(storageKey, JSON.stringify(persistedData())); } catch (err) { /* cache opcional */ }
    renderAll();
    if (!$('#view-settings').contains(document.activeElement)) fillSettings();
  }

  function maybeReady() {
    if (cloud.ready || !cloud.gotMeta || !cloud.gotOrders) return;
    cloud.ready = true;
    if (cloud.metaMissing) firstUseOfAccount();
    else syncOrders(); // envia o que tenha ficado só no cache local
    renderAll();
    fillSettings();
    setTab('dashboard');
    unlockApp();
  }

  /* Conta nova: oferece levar os dados que já estavam neste navegador sem login. */
  function firstUseOfAccount() {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (err) { local = null; }
    const hasLocal = local && ((local.history || []).length || (local.stock || []).length || (local.profile || {}).name);
    if (hasLocal && confirm('Encontramos dados salvos neste navegador. Enviar para a sua conta?')) {
      applyData(local);
    }
    save();
    flushMeta();
  }

  function startCloud(user) {
    cloud.user = user;
    storageKey = `${STORAGE_KEY}:${user.uid}`;
    load();
    showLoading('Carregando seus dados…');
    window.HGCloud.subscribe(user.uid, {
      onMeta: onRemoteMeta,
      onOrders: onRemoteOrders,
      onError: (err) => {
        syncError(err);
        if (!cloud.ready) showLoading(err.code === 'permission-denied'
          ? 'Sem permissão para ler os dados. Confira as regras do Firestore.'
          : 'Não foi possível carregar os dados. Recarregue a página.', true);
      },
    });
  }

  function renderSync() {
    const el = $('#sync-status');
    el.hidden = !cloud.on || !cloud.ready;
    if (el.hidden) return;
    let kind = 'ok';
    let text = 'Sincronizado';
    if (cloud.error) { kind = 'bad'; text = 'Erro ao sincronizar'; }
    else if (!navigator.onLine) { kind = 'off'; text = 'Sem internet, salvo no aparelho'; }
    else if (cloud.metaTimer || cloud.pending.meta || cloud.pending.orders) { kind = 'busy'; text = 'Salvando…'; }
    el.className = `sync-status ${kind}`;
    el.textContent = text;
    el.title = cloud.error || text;
  }
  window.addEventListener('online', () => { cloud.error = null; renderSync(); });
  window.addEventListener('offline', renderSync);

  /* ---------- tela de login ---------- */
  function showLogin(message) {
    document.body.classList.add('locked');
    $('#login-view').hidden = false;
    $('#login-loading').hidden = true;
    $('#login-fields').hidden = false;
    const err = $('#login-error');
    err.hidden = !message;
    err.textContent = message || '';
    $('#login-submit').disabled = false;
  }

  function showLoading(text, isError) {
    document.body.classList.add('locked');
    $('#login-view').hidden = false;
    $('#login-fields').hidden = true;
    $('#login-loading').hidden = false;
    $('#login-loading').classList.toggle('is-error', !!isError);
    $('#login-loading-text').textContent = text;
  }

  function unlockApp() {
    document.body.classList.remove('locked');
    $('#login-view').hidden = true;
    renderAccount();
    renderSync();
    loadGithubToken();
  }

  const LOGIN_ERRORS = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'Esse e-mail não parece válido.',
    'auth/too-many-requests': 'Muitas tentativas. Espere alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com a internet.',
    'auth/user-disabled': 'Esta conta foi desativada.',
  };

  async function submitLogin(ev) {
    ev.preventDefault();
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    if (!email || !password) return showLogin('Preencha o e-mail e a senha.');
    $('#login-submit').disabled = true;
    $('#login-error').hidden = true;
    try {
      await window.HGCloud.signIn(email, password);
      $('#login-password').value = '';
    } catch (err) {
      showLogin(LOGIN_ERRORS[err.code] || `Não foi possível entrar (${err.code || 'erro'}).`);
    }
  }

  async function forgotPassword() {
    const email = $('#login-email').value.trim();
    if (!email) return showLogin('Digite seu e-mail acima e clique de novo em “Esqueci minha senha”.');
    try { await window.HGCloud.resetPassword(email); } catch (err) { /* resposta igual para não revelar contas */ }
    showLogin(`Se esse e-mail tiver conta, chega um link para criar uma senha nova em ${email}.`);
  }

  async function signOutFlow() {
    if (!confirm('Sair da conta neste aparelho? Os dados continuam salvos na nuvem.')) return;
    try { await window.HGCloud.signOut(); } catch (err) { /* recarrega mesmo assim */ }
    try { localStorage.removeItem(storageKey); localStorage.removeItem(GH_TOKEN_KEY); } catch (err) { /* nada a limpar */ }
    location.reload();
  }

  function renderAccount() {
    const card = $('#account-card');
    if (cloud.on && cloud.user) {
      card.innerHTML = `<div class="panel-head"><div><h2>Conta</h2><p class="sub">Os dados sincronizam entre todos os aparelhos em que você entrar.</p></div></div>
        <div class="account-row"><span>Conectado como <b>${esc(cloud.user.email)}</b></span><button class="btn" data-action="sign-out">Sair</button></div>`;
      $('#backup-sub').textContent = 'Seus dados ficam na nuvem. O backup é uma cópia extra, em arquivo.';
    } else {
      card.innerHTML = `<div class="panel-head"><div><h2>Conta</h2><p class="sub">Modo local: os dados ficam só neste navegador. Para entrar na conta e sincronizar, abra o app pelo endereço do site.</p></div></div>`;
    }
  }

  $('#login-form').addEventListener('submit', submitLogin);

  /* ---------- galeria do site (fotos na pasta gallery do GitHub) ----------
     O app grava as fotos direto no repositório do site usando um token do GitHub
     que só pode mexer no repositório hg3d. O token fica na conta (nuvem) e no aparelho. */
  const GH = { owner: 'zedthunder', repo: 'hg3d', branch: 'main', dir: 'gallery' };
  const GH_API = `https://api.github.com/repos/${GH.owner}/${GH.repo}`;
  const GH_TOKEN_KEY = 'hg-gestao-github';
  const IMAGE_FILE = /\.(avif|gif|jpe?g|png|webp)$/i;
  const gallery = { token: '', photos: null, loading: false, busy: '', error: '' };
  try { gallery.token = localStorage.getItem(GH_TOKEN_KEY) || ''; } catch (err) { /* sem armazenamento */ }

  async function gh(path, opts = {}) {
    let res;
    try {
      res = await fetch(GH_API + path, {
        ...opts,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${gallery.token}`,
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch (err) {
      const e = new Error('rede'); e.status = 0; throw e;
    }
    if (!res.ok) { const e = new Error(`GitHub ${res.status}`); e.status = res.status; throw e; }
    return res.status === 204 ? null : res.json();
  }

  function ghErrorText(err) {
    if (err.status === 0) return 'Sem conexão com o GitHub. Confira a internet.';
    if (err.status === 401) return 'O token do GitHub é inválido ou venceu. Crie um novo e salve aqui.';
    if (err.status === 403 || err.status === 404) return 'O token não tem permissão para gravar no repositório hg3d. Confira o passo 4.';
    if (err.status === 409 || err.status === 422) return 'O site mudou enquanto as fotos eram enviadas. Tente de novo.';
    return `O GitHub recusou o pedido (erro ${err.status}).`;
  }

  function storeToken(token) {
    gallery.token = token;
    try {
      if (token) localStorage.setItem(GH_TOKEN_KEY, token); else localStorage.removeItem(GH_TOKEN_KEY);
    } catch (err) { /* sem armazenamento */ }
  }

  /* Ao entrar na conta, traz o token salvo por outro aparelho. */
  async function loadGithubToken() {
    if (!cloud.on || !cloud.user || gallery.token) return;
    try {
      const data = await window.HGCloud.readPrivate(cloud.user.uid, 'github');
      if (data && data.token && !gallery.token) {
        storeToken(data.token);
        if (state.tab === 'gallery') openGallery();
      }
    } catch (err) { /* segue sem token */ }
  }

  async function saveGithubToken() {
    const input = $('#gh-token');
    const token = input.value.trim();
    if (!token) return toast('Cole o token do GitHub no campo.', 'error');
    if (!/^(github_pat_|ghp_)\w+$/.test(token)) return toast('Isso não parece um token do GitHub. Ele começa com github_pat_.', 'error');
    const previous = gallery.token;
    gallery.token = token;
    gallery.busy = 'Conferindo o token…';
    renderGallery();
    try {
      await gh('');
      storeToken(token);
      if (cloud.on && cloud.user) {
        window.HGCloud.writePrivate(cloud.user.uid, 'github', { token }).catch(syncError);
      }
      toast('Token salvo. Já pode enviar fotos.');
      gallery.photos = null;
    } catch (err) {
      gallery.token = previous;
      toast(ghErrorText(err), 'error');
    }
    gallery.busy = '';
    openGallery();
  }

  function forgetGithubToken() {
    if (!confirm('Remover o token do GitHub? Para enviar fotos de novo, vai precisar colar um token.')) return;
    storeToken('');
    if (cloud.on && cloud.user) window.HGCloud.writePrivate(cloud.user.uid, 'github', { token: '' }).catch(syncError);
    gallery.photos = null;
    renderGallery();
  }

  function openGallery() {
    renderGallery();
    if (gallery.token && gallery.photos === null && !gallery.loading) loadPhotos();
  }

  async function loadPhotos() {
    gallery.loading = true;
    gallery.error = '';
    renderGallery();
    try {
      const files = await gh(`/contents/${GH.dir}?ref=${GH.branch}`).catch((err) => {
        if (err.status === 404) return []; // pasta ainda não existe
        throw err;
      });
      gallery.photos = files
        .filter((f) => f.type === 'file' && IMAGE_FILE.test(f.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    } catch (err) {
      gallery.error = ghErrorText(err);
    }
    gallery.loading = false;
    renderGallery();
  }

  /* Mesma regra do site: nome gerado pelo celular não vira legenda. */
  const photoCaption = (name) => {
    const alt = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    const auto = /^[0-9a-f]{6,}([ -][0-9a-f]{3,})*$/i.test(alt) || /^(img|dsc|pxl|whatsapp image)[ _-]?\d/i.test(alt);
    return auto ? '' : alt;
  };

  /* "Chaveiro do Naruto!" vira "Chaveiro-do-Naruto". Mantém acentos para a legenda. */
  const photoSlug = (text) => text.normalize('NFC').trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

  function renderGallery() {
    const el = $('#gallery-body');
    if (!el) return;
    if (!gallery.token) {
      el.innerHTML = `<div class="panel settings-card gh-setup">
        <div class="panel-head"><div><h2>Ligar a galeria ao site</h2><p class="sub">Feito uma vez só. Depois, é só escolher as fotos.</p></div></div>
        <ol class="gh-steps">
          <li>No computador, entre no GitHub e abra <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Novo token (fine-grained)</a>.</li>
          <li>Em <b>Token name</b>, escreva <b>HG Gestão galeria</b>. Em <b>Expiration</b>, escolha o prazo mais longo.</li>
          <li>Em <b>Repository access</b>, marque <b>Only select repositories</b> e escolha <b>zedthunder/hg3d</b>.</li>
          <li>Em <b>Permissions → Repository permissions</b>, ache <b>Contents</b> e mude para <b>Read and write</b>.</li>
          <li>Clique em <b>Generate token</b>, copie o código (começa com <b>github_pat_</b>) e cole abaixo.</li>
        </ol>
        <label class="field"><span>Token do GitHub</span><input id="gh-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
        <div class="actions"><button class="btn btn-primary" data-action="gh-save" ${gallery.busy ? 'disabled' : ''}>${icon('check')}${gallery.busy || 'Salvar token'}</button></div>
        <p class="hint">O token só consegue mexer nos arquivos do site. Ele fica salvo na sua conta, então os outros aparelhos já entram prontos.</p>
      </div>`;
      return;
    }
    const photos = gallery.photos || [];
    const busy = gallery.busy;
    let list;
    if (gallery.loading && !gallery.photos) list = `<div class="panel empty empty-sm"><span class="spinner" aria-hidden="true"></span><span>Carregando as fotos do site…</span></div>`;
    else if (gallery.error) list = `<div class="panel empty empty-sm"><strong>Não deu para carregar a galeria</strong><span>${esc(gallery.error)}</span><button class="btn btn-sm" data-action="gh-reload">Tentar de novo</button></div>`;
    else if (!photos.length) list = `<div class="panel empty"><span class="empty-ic">${icon('image')}</span><strong>Nenhuma foto no catálogo</strong><span>As fotos que você enviar aparecem aqui e no site.</span></div>`;
    else {
      list = `<div class="photo-grid">${photos.map((p) => {
        const caption = photoCaption(p.name);
        return `<figure class="photo">
          <img src="${esc(p.download_url)}" alt="${esc(caption || 'Foto do catálogo')}" loading="lazy" decoding="async">
          <figcaption><span class="${caption ? '' : 'faint'}">${esc(caption || 'Sem legenda')}</span>
            <button class="icon-btn danger" data-action="photo-del" data-name="${esc(p.name)}" title="Tirar do site" aria-label="Tirar a foto ${esc(caption || p.name)} do site" ${busy ? 'disabled' : ''}>${icon('trash')}</button>
          </figcaption>
        </figure>`;
      }).join('')}</div>`;
    }
    el.innerHTML = `<div class="panel upload-panel">
        <div class="panel-head"><div><h2>Enviar fotos</h2><p class="sub">As fotos são reduzidas para carregar rápido e aparecem no site em cerca de 1 minuto.</p></div></div>
        <div class="upload-row">
          <label class="field"><span>Legenda (opcional)</span><input id="photo-name" type="text" maxlength="60" placeholder="Ex.: Chaveiro personalizado" ${busy ? 'disabled' : ''}></label>
          <label class="btn btn-primary btn-lg ${busy ? 'is-disabled' : ''}">${busy ? '<span class="spinner spinner-sm" aria-hidden="true"></span>' : icon('up')}${esc(busy || 'Escolher fotos')}
            <input id="photo-input" type="file" accept="image/*" multiple class="visually-hidden" ${busy ? 'disabled' : ''}></label>
        </div>
        <p class="hint">A legenda vale para todas as fotos escolhidas de uma vez. Sem legenda, a foto aparece no site sem texto.</p>
      </div>
      <div class="gallery-bar"><span>${gallery.photos ? plural(photos.length, 'foto no site', 'fotos no site') : ''}</span>
        <span class="gallery-bar-actions"><button class="btn-link" data-action="gh-reload">Atualizar</button><button class="btn-link" data-action="gh-forget">Trocar token</button></span></div>
      ${list}`;
  }

  /* Reduz a foto (lado maior até 1600 px, JPEG) e devolve o conteúdo em base64. */
  function readPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
      img.src = url;
    });
  }

  /* Todas as fotos escolhidas vão num envio só (um commit no GitHub). */
  async function uploadPhotos(files) {
    if (gallery.busy) return;
    const images = files.filter((f) => f.type.startsWith('image/') || IMAGE_FILE.test(f.name));
    if (!images.length) return toast('Escolha arquivos de imagem.', 'error');
    const slug = photoSlug($('#photo-name') ? $('#photo-name').value : '');
    const taken = new Set((gallery.photos || []).map((p) => p.name.toLowerCase()));
    const stamp = Date.now();
    const names = images.map((f, i) => {
      // Sem legenda: nome em código, que o site não mostra como texto.
      let base = slug || (stamp + i).toString(16);
      let name = `${base}.jpg`;
      for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base}-${n}.jpg`;
      taken.add(name.toLowerCase());
      return name;
    });

    try {
      const blobs = [];
      for (let i = 0; i < images.length; i += 1) {
        gallery.busy = images.length > 1 ? `Preparando ${i + 1} de ${images.length}…` : 'Preparando…';
        renderGallery();
        let content;
        try { content = await readPhoto(images[i]); } catch (err) {
          throw Object.assign(new Error('leitura'), { file: images[i].name });
        }
        gallery.busy = images.length > 1 ? `Enviando ${i + 1} de ${images.length}…` : 'Enviando…';
        renderGallery();
        const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
        blobs.push({ path: `${GH.dir}/${names[i]}`, mode: '100644', type: 'blob', sha: blob.sha });
      }
      gallery.busy = 'Publicando no site…';
      renderGallery();
      const ref = await gh(`/git/ref/heads/${GH.branch}`);
      const head = await gh(`/git/commits/${ref.object.sha}`);
      const tree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree: blobs }) });
      const message = images.length > 1 ? `Galeria: ${images.length} fotos novas` : `Galeria: foto nova ${names[0]}`;
      const commit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [head.sha] }) });
      await gh(`/git/refs/heads/${GH.branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
      gallery.busy = '';
      toast(images.length > 1 ? `${images.length} fotos enviadas para o site.` : 'Foto enviada para o site.');
      await loadPhotos();
    } catch (err) {
      gallery.busy = '';
      renderGallery();
      toast(err.file ? `Não foi possível ler a imagem ${err.file}.` : ghErrorText(err), 'error');
    }
  }

  async function deletePhoto(name) {
    const photo = (gallery.photos || []).find((p) => p.name === name);
    if (!photo || gallery.busy) return;
    if (!confirm(`Tirar esta foto do site?\n\n${photoCaption(name) || name}`)) return;
    gallery.busy = 'Removendo…';
    renderGallery();
    try {
      await gh(`/contents/${GH.dir}/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        body: JSON.stringify({ message: `Galeria: remove ${name}`, sha: photo.sha, branch: GH.branch }),
      });
      gallery.photos = gallery.photos.filter((p) => p.name !== name);
      toast('Foto removida do site.');
    } catch (err) {
      toast(ghErrorText(err), 'error');
    }
    gallery.busy = '';
    renderGallery();
  }

  /* ---------- início ---------- */
  syncThemeControls();
  renderMaterialChips();

  function startLocal() {
    load();
    renderAll();
    fillSettings();
    setTab('dashboard');
    renderAccount();
  }

  function startWithCloud() {
    cloud.on = true;
    showLoading('Conectando…');
    const begin = () => window.HGCloud.onAuth((user) => {
      if (user) startCloud(user);
      else showLogin();
    });
    if (window.HGCloud) return begin();
    window.addEventListener('hgcloud-ready', begin, { once: true });
    import('./cloud.js').catch(() => showLoading('Não foi possível conectar. Confira a internet e recarregue a página.', true));
  }

  // Pelo site (http/https) usa a conta na nuvem; aberto como arquivo, funciona só no aparelho.
  if (location.protocol === 'http:' || location.protocol === 'https:') startWithCloud();
  else startLocal();
})();
