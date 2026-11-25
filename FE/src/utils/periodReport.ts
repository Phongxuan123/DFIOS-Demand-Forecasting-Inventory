/** demo.md §6.2 Reports: "Xuất báo cáo kỳ (PDF/CSV): chi phí theo thành phần, dịch vụ theo nhóm, số đơn".
 *  The PDF is the browser's print of a self-contained HTML page (Unicode text, no PDF library, no network). */

export interface PeriodReportCost {
  label: string;
  c3: number | null;
  b0: number | null;
}

export interface PeriodReportClass {
  cls: string;
  nSku: number | null;
  c3: number | null;
  b0: number | null;
  theta: number;
  target: number;
}

export interface PeriodReportData {
  title: string;
  store: string;
  period: string;
  generatedAt: string;
  labels: {
    costTitle: string;
    serviceTitle: string;
    ordersTitle: string;
    item: string;
    c3: string;
    b0: string;
    diff: string;
    cls: string;
    nSku: string;
    target: string;
    theta: string;
    status: string;
    below: string;
    ok: string;
    notMeasured: string;
    orders: string;
    availability: string;
    fillRate: string;
    basis: string;
    footer: string;
  };
  costs: PeriodReportCost[];
  classes: PeriodReportClass[];
  availability: { c3: number | null; b0: number | null };
  fillRate: { c3: number | null; b0: number | null };
  orders: { c3: number | null; b0: number | null };
  basis: string;
  money: (v: number) => string;
  pct: (v: number) => string;
  int: (v: number) => string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildPeriodReportHtml(d: PeriodReportData): string {
  const L = d.labels;
  const m = (v: number | null) => (v == null ? '—' : esc(d.money(v)));
  const p = (v: number | null) => (v == null ? '—' : esc(d.pct(v)));
  const n = (v: number | null) => (v == null ? '—' : esc(d.int(v)));
  const diff = (a: number | null, b: number | null) => (a == null || b == null ? '—' : `${a - b > 0 ? '+' : ''}${esc(d.money(a - b))}`);
  const costRows = d.costs
    .map((c) => `<tr><td>${esc(c.label)}</td><td class="r">${m(c.c3)}</td><td class="r">${m(c.b0)}</td><td class="r">${diff(c.c3, c.b0)}</td></tr>`)
    .join('');
  const classRows = d.classes
    .map((c) => {
      const status = c.c3 == null ? L.notMeasured : c.c3 < c.target ? L.below : L.ok;
      return `<tr><td>${esc(c.cls)}</td><td class="r">${n(c.nSku)}</td><td class="r">${p(c.c3)}</td><td class="r">${p(c.b0)}</td><td class="r">${p(c.target)}</td><td class="r">${esc(c.theta.toFixed(3))}</td><td>${esc(status)}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)} · ${esc(d.store)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#14213d;margin:32px;font-size:12px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:24px 0 8px}
.meta{color:#4a5568;margin-bottom:16px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #d8dde6;padding:6px 8px;text-align:left}
th{background:#f1f4f8}.r{text-align:right}.kpis{display:flex;gap:24px;margin-top:8px}
.kpi b{display:block;font-size:16px}.foot{margin-top:24px;color:#4a5568;font-size:11px}
@media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(d.title)} · ${esc(d.store)}</h1>
<div class="meta">${esc(d.period)} · ${esc(d.generatedAt)}</div>
<div class="kpis">
<div class="kpi">${esc(L.availability)}<b>${p(d.availability.c3)}</b>${esc(L.b0)} ${p(d.availability.b0)}</div>
<div class="kpi">${esc(L.fillRate)}<b>${p(d.fillRate.c3)}</b>${esc(L.b0)} ${p(d.fillRate.b0)}</div>
<div class="kpi">${esc(L.orders)}<b>${n(d.orders.c3)}</b>${esc(L.b0)} ${n(d.orders.b0)}</div>
</div>
<h2>${esc(L.costTitle)}</h2>
<table><thead><tr><th>${esc(L.item)}</th><th class="r">${esc(L.c3)}</th><th class="r">${esc(L.b0)}</th><th class="r">${esc(L.diff)}</th></tr></thead><tbody>${costRows}</tbody></table>
<h2>${esc(L.serviceTitle)}</h2>
<table><thead><tr><th>${esc(L.cls)}</th><th class="r">${esc(L.nSku)}</th><th class="r">${esc(L.c3)}</th><th class="r">${esc(L.b0)}</th><th class="r">${esc(L.target)}</th><th class="r">${esc(L.theta)}</th><th>${esc(L.status)}</th></tr></thead><tbody>${classRows}</tbody></table>
<h2>${esc(L.ordersTitle)}</h2>
<table><thead><tr><th></th><th class="r">${esc(L.c3)}</th><th class="r">${esc(L.b0)}</th></tr></thead><tbody><tr><td>${esc(L.orders)}</td><td class="r">${n(d.orders.c3)}</td><td class="r">${n(d.orders.b0)}</td></tr></tbody></table>
<div class="foot">${esc(L.basis)}: ${esc(d.basis)}<br>${esc(L.footer)}</div>
</body></html>`;
}

/** Opens the report in a new window and starts the print dialog ("Save as PDF"). Returns false when blocked. */
export function printPeriodReport(html: string): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  // document.write pages do not always fire onload: print once, whichever comes first
  let printed = false;
  const go = () => {
    if (printed) return;
    printed = true;
    w.print();
  };
  w.onload = go;
  setTimeout(go, 400);
  return true;
}
