// ==========================================
// MOCK DATA LAYER
// ==========================================

export const mockDashboard = {
  kpis: {
    totalSkus: 3049,
    reorderAlerts: 127,
    avgForecastAccuracy: 87.3,
    estCostSavings: 142000
  },
  charts: {
    forecastAccuracy: [
      { name: 'W1', value: 82 },
      { name: 'W2', value: 84 },
      { name: 'W3', value: 86 },
      { name: 'W4', value: 88 },
      { name: 'W5', value: 87.3 },
    ],
    inventoryHealth: [
      { name: 'Tier A (High Value)', value: 50.0, color: '#0d9488' },
      { name: 'Tier B (Medium Value)', value: 30.5, color: '#f59e0b' },
      { name: 'Tier C (Low Value)', value: 19.5, color: '#ef4444' },
    ],
    forecastTrend: [
      { date: 'Mon', actual: 420, lightgbm: 415, arima: 390 },
      { date: 'Tue', actual: 435, lightgbm: 440, arima: 410 },
      { date: 'Wed', actual: 410, lightgbm: 405, arima: 395 },
      { date: 'Thu', actual: 480, lightgbm: 475, arima: 450 },
      { date: 'Fri', actual: 520, lightgbm: 510, arima: 480 },
      { date: 'Sat', actual: null, lightgbm: 550, arima: 500 },
      { date: 'Sun', actual: null, lightgbm: 530, arima: 490 },
    ],
    urgency: [
      { sku: 'SKU-8921', name: '(Ultra Boost)', urgency: 96, color: '#ef4444' },
      { sku: 'SKU-4402', name: '(Nike Vapor)', urgency: 85, color: '#ef4444' },
      { sku: 'SKU-1024', name: '(Puma Classic)', urgency: 72, color: '#f59e0b' },
      { sku: 'SKU-7721', name: '(Adidas Samba)', urgency: 65, color: '#f59e0b' },
      { sku: 'SKU-5012', name: '(Reebok Club)', urgency: 48, color: '#10b981' },
    ]
  },
  recentAlerts: [
    { status: 'CRITICAL OUTOFSTOCK', statusClass: 'critical', name: 'Nike Air Max 270 (Size 10)', location: 'Downtown flagship', details: '0 units left', actionText: 'Reorder 150 units immediately' },
    { status: 'WARNING LOWSTOCK', statusClass: 'warning', name: 'Adidas Ultraboost (White)', location: 'Eastside Mall', details: '12 units left (Lead Time: 5d)', actionText: 'Reorder triggered' },
    { status: 'SURGE DEMAND', statusClass: 'surge', name: 'Yeezy Slide Pure', location: 'E-Commerce Warehouse', details: '210 units left (Spike Predicted)', actionText: 'Increase allocation +20%' },
  ]
};

export const mockForecastExplorer = {
  skus: [
    { id: 'SKU-8921-A', name: 'Nike VaporMax', category: 'Footwear', store: 'CA_1_Downtown', fv: '12,450', accuracy: '94%', trend: 'up' },
    { id: 'SKU-4402-B', name: 'Adidas Ultraboost', category: 'Footwear', store: 'TX_3_Suburban', fv: '8,200', accuracy: '88%', trend: 'down' },
    { id: 'SKU-1024-C', name: 'Puma RS-X', category: 'Footwear', store: 'NY_1_Flagship', fv: '15,300', accuracy: '96%', trend: 'up' },
    { id: 'SKU-7721-D', name: 'New Balance 990', category: 'Footwear', store: 'FL_2_Mall', fv: '5,100', accuracy: '82%', trend: 'down' },
    { id: 'SKU-5012-E', name: 'Reebok Classic', category: 'Footwear', store: 'WA_1_Outlet', fv: '9,800', accuracy: '91%', trend: 'up' },
  ],
  chartData: [
    { date: '10/24', actual: 420, forecast: 415, lower: 390, upper: 440 },
    { date: '10/25', actual: 435, forecast: 440, lower: 410, upper: 470 },
    { date: '10/26', actual: 410, forecast: 405, lower: 380, upper: 430 },
    { date: '10/27', actual: 480, forecast: 475, lower: 450, upper: 500 },
    { date: '10/28', actual: 520, forecast: 510, lower: 480, upper: 540 },
    { date: '10/29', forecast: 550, lower: 520, upper: 580 },
    { date: '10/30', forecast: 530, lower: 500, upper: 560 },
  ],
  metrics: {
    mase: 0.84,
    rmse: 34.2,
    mae: 28.5,
    bias: -1.2
  },
  stats: {
    predictedDemand: '1,420 units',
    safetyStock: '180 units',
    reorderPoint: '220 units',
    mase: '0.64',
    ci: '[1,210 - 1,680]'
  },
  scheduleMatrix: [
    { date: 'Oct 24 (Today)', demand: 52, lower: 45, upper: 61, spike: 'LOW', spikeColor: 'text-teal' },
    { date: 'Oct 25 (Fri)', demand: 58, lower: 48, upper: 68, spike: 'LOW', spikeColor: 'text-teal' },
    { date: 'Oct 26 (Sat)', demand: 82, lower: 71, upper: 95, spike: 'MEDIUM', spikeColor: 'text-orange' },
    { date: 'Oct 27 (Sun)', demand: 94, lower: 82, upper: 112, spike: 'HIGH', spikeColor: 'text-red' },
    { date: 'Oct 28 (Mon)', demand: 45, lower: 36, upper: 54, spike: 'LOW', spikeColor: 'text-teal' },
  ]
};

export const mockReplenishment = {
  kpis: {
    itemsBelowRop: '14',
    pendingOrders: '8',
    avgSafetyStockDays: '12.3',
    totalEoqValue: '$24,580'
  },
  tableData: [
    { id: 'SKU-8921', name: 'Nike Ultra Boost', stock: 8, safety: 15, rop: 20, eoq: 150, status: 'CRITICAL', action: 'Reorder 150', actionPrimary: true },
    { id: 'SKU-4402', name: 'Nike Vapor', stock: 12, safety: 10, rop: 18, eoq: 120, status: 'LOW STOCK', action: 'Trigger Reorder', actionPrimary: false },
    { id: 'SKU-1024', name: 'Puma Classic', stock: 45, safety: 12, rop: 22, eoq: 80, status: 'IN STOCK', action: 'Monitor Demand', actionPrimary: false },
    { id: 'SKU-7721', name: 'Adidas Samba', stock: 68, safety: 25, rop: 40, eoq: 200, status: 'IN STOCK', action: 'Optimize', actionPrimary: false },
    { id: 'SKU-5012', name: 'Reebok Club', stock: 9, safety: 8, rop: 15, eoq: 100, status: 'LOW STOCK', action: 'Reorder Trigger', actionPrimary: false },
  ],
  chartData: [
    { name: 'Oct 24', demand: 15 },
    { name: 'Oct 31', demand: 8 },
    { name: 'Nov 07', demand: 12 },
    { name: 'Nov 14', demand: 22 },
    { name: 'Nov 21', demand: 18 },
  ]
};

export const mockAbcXyz = {
  logs: [
    { id: 'SKU-8921', name: 'Nike Ultra Boost (White)', classA: 'A', classX: 'X', combined: 'AX (Strategic)', rev: '$424,500', cov: '4.2%', policy: 'Daily Replenish, Tight Margin Safety' },
    { id: 'SKU-4402', name: 'Adidas VaporMax (Black)', classA: 'A', classX: 'Y', combined: 'AY (Dynamic)', rev: '$185,200', cov: '14.8%', policy: 'Bi-Weekly Model Runs, Buffer Multipliers' },
    { id: 'SKU-1024', name: 'Puma Suede Classic (Red)', classA: 'B', classX: 'X', combined: 'BX (Stable)', rev: '$62,400', cov: '8.1%', policy: 'Automated ROP Trigger, Baseline Buffer' },
    { id: 'SKU-7721', name: 'Adidas Samba OG (Black)', classA: 'B', classX: 'Z', combined: 'BZ (Erratic)', rev: '$48,900', cov: '32.4%', policy: 'Max-Min Buffer Cap, Supplier Lead SLA' },
    { id: 'SKU-5012', name: 'Reebok Club C 85 (Vintage)', classA: 'C', classX: 'X', combined: 'CX (Automated)', rev: '$12,300', cov: '5.0%', policy: 'Simplified Kanban, Batch Monthly Reorder' },
  ]
};

export const mockModelPerformance = {
  kpis: [
    { title: 'ARIMA (Classical Baseline)', type: 'baseline', metrics: { mase: '1.12', rmse: '45.2', mae: '35.8' } },
    { title: 'LightGBM (Tree Boosted)', type: 'challenger', metrics: { mase: '0.84', rmse: '32.1', mae: '24.6' } },
    { title: 'TFT (Temporal Fusion)', type: 'best', metrics: { mase: '0.64', rmse: '22.4', mae: '16.8' } }
  ],
  scatterData: [
    { x: 1, y: 1.2, fill: '#0d9488' },
    { x: 2, y: 1.9, fill: '#0d9488' },
    { x: 3, y: 2.8, fill: '#0d9488' },
    { x: 4, y: 4.2, fill: '#0d9488' },
    { x: 4.5, y: 2.2, fill: '#f59e0b' },
    { x: 5.5, y: 3.5, fill: '#0d9488' },
    { x: 2.5, y: 1.0, fill: '#ef4444' },
  ],
  shapValues: [
    { feature: 'Historical Sales Volume (Lag-7)', val: 0.32, pct: '80%' },
    { feature: 'Promotional Pricing Active', val: 0.24, pct: '60%' },
    { feature: 'Day of Week (Weekend Factor)', val: 0.18, pct: '45%' },
    { feature: 'Regional Store Weather Index', val: 0.14, pct: '35%' },
    { feature: 'National Holiday Calendar Event', val: 0.11, pct: '28%' },
    { feature: 'Competitor Price Index Ratio', val: 0.08, pct: '20%' },
    { feature: 'Moving Average (Window-14)', val: 0.06, pct: '15%' },
    { feature: 'Google Trends Footwear Volume', val: 0.04, pct: '10%' },
    { feature: 'Supplier Safety Lead Buffer', val: 0.02, pct: '5%' },
    { feature: 'Regional Logistics Delay Index', val: 0.01, pct: '2%' },
  ],
  comparisonTable: [
    { metric: 'Safety Stock', ml: '12.4 days', static: '15.8 days', improvement: '+21%' },
    { metric: 'ROP', ml: '1,240 units', static: '1,410 units', improvement: '+14%' },
    { metric: 'EOQ', ml: '480 units', static: '540 units', improvement: '+12%' }
  ]
};

export const mockReports = {
  templates: [
    { title: 'Demand Forecast Report', desc: 'Comprehensive summary of forecast models, tracking accuracy scores (MASE) against observed outcomes across filtered SKUs.', icon: 'TrendingUp', btnText: 'Generate Report' },
    { title: 'Inventory Health Report', desc: 'Examine safety stock status, potential stockout hazards, reorder point triggers, and estimated holding cost metrics.', icon: 'Activity', btnText: 'Generate Report' },
    { title: 'ABC/XYZ Classification Report', desc: 'A complete audit of current value-distribution tiers with suggested action policies for procurement optimization.', icon: 'Grid', btnText: 'Generate Report' },
    { title: 'Model Benchmarking Report', desc: 'Compare neural networks, LightGBM, and baseline models. Features SHAP interpretability values for accuracy metrics.', icon: 'Settings', btnText: 'Generate Report' },
    { title: 'Historical Backtesting Report', desc: 'Run backtesting simulations on historical data to evaluate ML model effectiveness vs baseline inventory policies.', icon: 'Settings', btnText: 'Run Backtest' },
    { title: 'Cost Comparison Report', desc: 'Compare estimated inventory holding costs between ML-driven optimization and traditional static formula approach, with improvement percentages.', icon: 'TrendingUp', btnText: 'Generate Report' }
  ],
  logs: [
    { name: 'Monthly Accuracy Audit - Sep 2...', type: 'Model Benchmarking', date: 'Oct 22, 2024', format: 'PDF', formatClass: 'pdf', size: '4.2 MB', status: 'READY', action: 'Download' },
    { name: 'Stockout Vulnerability Summary', type: 'Inventory Health', date: 'Oct 20, 2024', format: 'CSV', formatClass: 'csv', size: '842 KB', status: 'READY', action: 'Download' },
    { name: 'Q3 Demand Distribution Grid', type: 'ABC/XYZ Classification', date: 'Oct 18, 2024', format: 'Excel', formatClass: 'excel', size: '1.8 MB', status: 'PROCESSING', action: 'Wait...' },
    { name: 'Temporal Fusion Performance R...', type: 'Model Benchmarking', date: 'Oct 15, 2024', format: 'PDF', formatClass: 'pdf', size: '5.1 MB', status: 'READY', action: 'Download' },
  ]
};

export const mockProducts = {
  list: [
    { id: 'SKU-8921', name: 'Nike Ultra Boost', category: 'Footwear', store: 'Downtown flagship', stock: '184', demand: '42 u/d', isLow: false },
    { id: 'SKU-4402', name: 'Nike Vapor Fly', category: 'Footwear', store: 'E-Comm Warehouse', stock: '12', demand: '65 u/d', isLow: true },
    { id: 'SKU-1024', name: 'Puma Suede Classic', category: 'Footwear', store: 'Eastside Mall', stock: '54', demand: '14 u/d', isLow: false },
    { id: 'SKU-7721', name: 'Adidas Samba OG', category: 'Footwear', store: 'Downtown flagship', stock: '95', demand: '31 u/d', isLow: false },
    { id: 'SKU-5012', name: 'Reebok Club C 85', category: 'Footwear', store: 'Downtown flagship', stock: '142', demand: '11 u/d', isLow: false },
  ],
  trend: [
    { day: 1, val: 30 }, { day: 2, val: 40 }, { day: 3, val: 35 }, { day: 4, val: 50 },
    { day: 5, val: 55 }, { day: 6, val: 45 }, { day: 7, val: 65 }, { day: 8, val: 75 },
    { day: 9, val: 70 }, { day: 10, val: 85 },
  ]
};

export const mockSettings = {
  general: {
    hostName: 'DFIOS cockpit - Enterprise Retail',
    timezone: 'UTC -05:00 (EST)',
    defaultModel: 'tft',
    horizon: '28 Days',
    confidence: '90% (Recommended)',
    autoRetrain: true,
  },
  inventory: {
    leadTime: '7',
    serviceLevel: '95.0%',
    holdingCost: '18%',
    fixedOrdering: '$45.00'
  },
  alerts: {
    reorderNotifs: true,
    emailDispatch: true,
    email: 'jenkins@dfios.cockpit.com'
  }
};
