/* Regras de cálculo do HG Gestão. Sem acesso a DOM para poder ser testado no Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MARGIN_CAP = 100000;

  /** Aceita "1,5", "1.5" e "1.234,56". O último separador é o decimal. */
  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value === null || value === undefined) return 0;
    let s = String(value).trim().replace(/\s/g, '');
    if (!s) return 0;
    const comma = s.lastIndexOf(',');
    const dot = s.lastIndexOf('.');
    if (comma > -1 && dot > -1) {
      s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (comma > -1) {
      s = s.replace(',', '.');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  /** Converte para horas: "5:30", "5,5", "5h30", "1d 2h 15m" (formatos de fatiador). */
  function parseTime(value) {
    if (value === null || value === undefined) return 0;
    const s = String(value).toLowerCase().trim();
    if (!s) return 0;
    if (s.includes(':')) {
      const [h, m] = s.split(':');
      return parseNumber(h) + parseNumber(m) / 60;
    }
    if (/[dhms]/.test(s)) {
      const unit = (re) => {
        const m = s.match(re);
        return m ? parseNumber(m[1]) : 0;
      };
      const hasMinuteUnit = /[\d.,]+\s*m/.test(s);
      const trailing = !hasMinuteUnit ? unit(/h\s*([\d.,]+)\s*$/) : 0; // "5h30"
      return (
        unit(/([\d.,]+)\s*d/) * 24 +
        unit(/([\d.,]+)\s*h/) +
        unit(/([\d.,]+)\s*m/) / 60 +
        unit(/([\d.,]+)\s*s/) / 3600 +
        trailing / 60
      );
    }
    return parseNumber(s);
  }

  function formatTime(hours) {
    const total = Math.round(hours * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h}h${String(m).padStart(2, '0')}`;
  }

  const money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  /** Campo em branco usa o custo padrão; um 0 digitado vale como 0. */
  function costOrDefault(value, fallback) {
    const blank = value === '' || value === null || value === undefined;
    return blank ? fallback : parseNumber(value);
  }

  /**
   * Produção por mesas: cada cor é impressa em mesas próprias, com a mesma
   * capacidade. Por padrão a mesa incompleta custa proporcional às peças dela;
   * com fullPlates, conta como mesa inteira.
   */
  function calculatePlates(item, S, qty, riskPct) {
    const rawCapacity = Math.floor(parseNumber(item.capacity));
    const capacity = Math.max(1, rawCapacity || 1);
    const platesPerColor = Math.ceil(qty / capacity);
    const factor = item.fullPlates ? platesPerColor : qty / capacity;

    const active = (item.colors || []).filter((c) => parseNumber(c.grams) > 0 || parseTime(c.time) > 0);
    const colors = active.map((c, i) => {
      const gramsPerPlate = parseNumber(c.grams);
      const hoursPerPlate = parseTime(c.time);
      const material = (gramsPerPlate / 1000) * costOrDefault(c.costKg, S.defaultCostKg);
      const energy = (S.watts / 1000) * S.kwh * hoursPerPlate;
      const wear = S.lifeHours > 0 ? (S.printerPrice / S.lifeHours) * hoursPerPlate : 0;
      const risk = (material + energy + wear) * (riskPct / 100);
      const perPlate = material + energy + wear + risk;
      return {
        name: String(c.name || '').trim() || `Cor ${i + 1}`,
        spoolId: c.spoolId || null,
        gramsPerPlate,
        hoursPerPlate,
        plates: platesPerColor,
        grams: gramsPerPlate * factor,
        hours: hoursPerPlate * factor,
        material: material * factor,
        energy: energy * factor,
        wear: wear * factor,
        risk: risk * factor,
        perPlate: money(perPlate),
        perPiece: (perPlate * factor) / qty,
        total: money(perPlate * factor),
      };
    });
    const sum = (key) => colors.reduce((acc, c) => acc + c[key], 0);
    return {
      valid: rawCapacity >= 1 && colors.length > 0 && colors.every((c) => c.gramsPerPlate > 0 && c.hoursPerPlate > 0),
      colors,
      grams: sum('grams'),
      hours: sum('hours'),
      material: sum('material'),
      energy: sum('energy'),
      wear: sum('wear'),
      risk: sum('risk'),
      plan: {
        capacity,
        platesPerColor,
        plateCount: platesPerColor * colors.length,
        lastPlatePieces: qty % capacity || capacity,
        fullPlates: !!item.fullPlates,
        perPlateSet: money(sum('perPlate')),
        perPiece: colors.reduce((acc, c) => acc + c.perPiece, 0),
      },
    };
  }

  /**
   * No modo simples, peso, tempo e extras valem para o lote inteiro; a
   * quantidade só divide o resultado em preço unitário.
   */
  function calculateItem(item, settings) {
    const S = settings;
    const qty = Math.max(1, Math.floor(parseNumber(item.qty)) || 1);
    const margin = Math.min(MARGIN_CAP, Math.max(0, parseNumber(item.margin)));
    const risk = Math.max(0, parseNumber(item.risk));
    const plates = item.mode === 'plates' ? calculatePlates(item, S, qty, risk) : null;

    let grams, hours, material, energy, wear, riskCost;
    if (plates) {
      ({ grams, hours, material, energy, wear, risk: riskCost } = plates);
    } else {
      grams = parseNumber(item.grams);
      hours = parseTime(item.time);
      const material1 = (grams / 1000) * costOrDefault(item.costKg, S.defaultCostKg);
      const material2 = item.multi
        ? (parseNumber(item.grams2) / 1000) * costOrDefault(item.costKg2, S.defaultCostKg)
        : 0;
      material = material1 + material2;
      energy = (S.watts / 1000) * S.kwh * hours;
      wear = S.lifeHours > 0 ? (S.printerPrice / S.lifeHours) * hours : 0;
      riskCost = (material + energy + wear) * (risk / 100);
    }

    const labor = parseTime(item.laborTime) * S.laborRate;
    const base = material + energy + wear + labor + riskCost;
    const extras = parseNumber(item.others) + parseNumber(item.pack);
    const accessories = plates ? parseNumber(item.perPiece) * qty : 0;
    const cost = money(base + extras + accessories);

    // Preço fechado manda no valor final; o lucro vira consequência e pode ser negativo.
    // Abaixo do preço calculado, a diferença é desconto; acima, é só o novo preço.
    const fixedPrice = money(parseNumber(item.fixedPrice));
    const marginProfit = base * (margin / 100);
    const belowMinimum = S.minProfit > marginProfit;
    const minProfitApplied = !(fixedPrice > 0) && belowMinimum;
    const profit = belowMinimum ? S.minProfit : marginProfit;
    const calculatedPrice = money(base + extras + accessories + profit);
    const price = fixedPrice > 0 ? fixedPrice : calculatedPrice;
    const listPrice = Math.max(calculatedPrice, price);
    const discount = money(listPrice - price);
    const realProfit = money(price - cost);
    const unitProfit = realProfit / qty;

    return {
      valid: plates ? plates.valid : grams > 0 && hours > 0,
      qty,
      grams,
      hours,
      base,
      price,
      listPrice,
      discount,
      cost,
      profit: realProfit,
      unitPrice: money(price / qty),
      unitCost: money(cost / qty),
      unitProfit: money(unitProfit),
      minProfitApplied,
      fixedPrice: fixedPrice > 0,
      roi: unitProfit > 0 ? Math.ceil(S.printerPrice / unitProfit) : 0,
      parts: {
        material: money(material),
        energy: money(energy),
        wear: money(wear),
        labor: money(labor),
        risk: money(riskCost),
        accessories: money(accessories),
        extras: money(extras),
      },
      ...(plates ? { colors: plates.colors, plan: plates.plan } : {}),
    };
  }

  /** Próximo preço terminado em ,90 igual ou acima do atual. */
  function roundedPrice(price) {
    let target = Math.floor(price) + 0.9;
    if (target < price - 0.005) target += 1;
    return money(target);
  }

  /** Margem que faz o item chegar exatamente ao preço arredondado. */
  function marginForPrice(target, result) {
    if (result.base <= 0) return 0;
    const extras = result.parts.extras + result.parts.accessories;
    const needed = target - result.base - extras;
    return Math.min(MARGIN_CAP, Math.max(0, (needed / result.base) * 100));
  }

  /** Soma valores já arredondados para que o orçamento impresso feche ao centavo. */
  function orderTotals(items) {
    const sum = (key) => money(items.reduce((acc, i) => acc + i.result[key], 0));
    return {
      count: items.length,
      pieces: items.reduce((acc, i) => acc + i.result.qty, 0),
      price: sum('price'),
      // Pedidos salvos antes do desconto existir não têm estes campos.
      subtotal: money(items.reduce((acc, i) => acc + (i.result.listPrice ?? i.result.price), 0)),
      discount: money(items.reduce((acc, i) => acc + (i.result.discount || 0), 0)),
      cost: sum('cost'),
      profit: sum('profit'),
    };
  }

  /** Chave de mês na data local, para um pedido de dia 31 à noite não cair no mês seguinte. */
  function monthKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Só pedido aprovado conta como venda; registro sem status é orçamento. */
  const approvedOrders = (history) => history.filter((o) => o.status === 'approved');

  function salesInMonth(history, key) {
    const orders = approvedOrders(history)
      .filter((o) => monthKey(o.approvedAt) === key)
      .sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt));
    const totals = orders.map((o) => orderTotals(o.items));
    const sum = (k) => money(totals.reduce((acc, t) => acc + t[k], 0));
    return { orders, count: orders.length, price: sum('price'), cost: sum('cost'), profit: sum('profit') };
  }

  /** period 'month' conta só o mês atual; 'all' conta todos os pedidos aprovados. */
  function goalProgress(goal, history, now = new Date()) {
    const orders = approvedOrders(history).filter((o) => goal.period !== 'month' || monthKey(o.approvedAt) === monthKey(now));
    const key = goal.metric === 'sales' ? 'price' : 'profit';
    const value = money(orders.reduce((acc, o) => acc + orderTotals(o.items)[key], 0));
    const target = parseNumber(goal.target);
    return {
      value,
      target,
      remaining: money(Math.max(0, target - value)),
      pct: target > 0 ? Math.min(100, Math.max(0, (value / target) * 100)) : 0,
      reached: target > 0 && value >= target,
    };
  }

  return { MARGIN_CAP, parseNumber, parseTime, formatTime, money, calculateItem, roundedPrice, marginForPrice, orderTotals, monthKey, salesInMonth, goalProgress };
});
