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

export const mockUsers = [
  { name: 'Sarah Jenkins', email: 's.jenkins@dfios.com', role: 'WAREHOUSE MANAGER', status: 'ACTIVE', lastLogin: '10 mins ago' },
  { name: 'Marcus Brody', email: 'm.brody@dfios.com', role: 'ADMIN', status: 'ACTIVE', lastLogin: '2 hours ago' },
  { name: 'Leah Vance', email: 'l.vance@dfios.com', role: 'VIEWER', status: 'ACTIVE', lastLogin: 'Yesterday, 18:04' },
  { name: 'Donald Sterling', email: 'd.sterling@dfios.com', role: 'WAREHOUSE MANAGER', status: 'DISABLED', lastLogin: 'Oct 12, 10:45' },
  { name: 'Chloe Bennett', email: 'c.bennett@dfios.com', role: 'VIEWER', status: 'ACTIVE', lastLogin: 'Oct 19, 08:33' },
  { name: 'Arthur Dent', email: 'a.dent@dfios.com', role: 'VIEWER', status: 'ACTIVE', lastLogin: 'Oct 21, 11:20' }
];

export const mockSuppliers = [
  { name: 'Pacifica Footwear Co', email: 'contract-active@pacifica.com', skus: 84, leadTime: 5, reliability: 94 },
  { name: 'Apex Sports Logistics', email: 'contract-active@pacifica.com', skus: 112, leadTime: 7, reliability: 88 },
  { name: 'Nordic Athletic Supplies', email: 'contract-active@pacifica.com', skus: 43, leadTime: 14, reliability: 98 },
  { name: 'Vanguard Global Imports', email: 'contract-active@pacifica.com', skus: 201, leadTime: 21, reliability: 72 },
  { name: 'Horizon Retail Dist', email: 'contract-active@pacifica.com', skus: 19, leadTime: 4, reliability: 91 }
];

export const mockDataImports = [
  { name: 'm5-historical-store-data-2024.xlsx', date: 'Oct 22, 11:20', records: '142,000', status: 'VALIDATED', operator: 'Sarah Jenkins' },
  { name: 'e-commerce-warehouse-sales-q3.csv', date: 'Oct 18, 09:44', records: '89,102', status: 'VALIDATED', operator: 'Sarah Jenkins' },
  { name: 'eastside-mall-adjustments-sep.xlsx', date: 'Oct 15, 14:12', records: '12,901', status: 'ERROR', operator: 'Leah Vance' },
  { name: 'downtown-flagship-actuals-q2.csv', date: 'Oct 09, 10:30', records: '214,055', status: 'VALIDATED', operator: 'Marcus Brody' }
];

export const mockEvents = [
  { id: '1', name: 'Autumn Flash Clearance', type: 'Marketing Promotion', lift: '+35%', dates: ['10/24', '10/25'] }
];
// Append to mockData.ts
export const mockAdjustments = [
  { date: 'Oct 24, 09:32', sku: 'SKU-8921', name: 'Nike Ultra Boost', desc: 'Physical count variance', type: 'Cycle Count', prev: 24, new: 22, change: -2, user: 'Sarah Jenkins' },
  { date: 'Oct 24, 08:15', sku: 'SKU-4402', name: 'Nike Vapor Fly', desc: 'PO-2024-098 received', type: 'PO Receipt', prev: 50, new: 150, change: 100, user: 'Warehouse Te...' },
  { date: 'Oct 23, 16:40', sku: 'SKU-1024', name: 'Puma Classic', desc: 'Damaged stock write-off', type: 'Manual Edit', prev: 12, new: 10, change: -2, user: 'Sarah Jenkins' },
  { date: 'Oct 23, 11:10', sku: 'SKU-7721', name: 'Adidas Samba', desc: 'Urgent transfer receipt', type: 'PO Receipt', prev: 0, new: 80, change: 80, user: 'Warehouse Te...' },
  { date: 'Oct 22, 14:05', sku: 'SKU-5012', name: 'Reebok Club C', desc: 'Scheduled audit perfect match', type: 'Cycle Count', prev: 45, new: 45, change: 0, user: 'John Doe' },
  { date: 'Oct 21, 09:20', sku: 'SKU-2931', name: 'Asics Gel Kayano', desc: 'Found misplaced inventory', type: 'Manual Edit', prev: 8, new: 12, change: 4, user: 'Sarah Jenkins' },
  { date: 'Oct 20, 15:30', sku: 'SKU-8921', name: 'Nike Ultra Boost', desc: 'PO-2024-091 completed', type: 'PO Receipt', prev: 22, new: 122, change: 100, user: 'Warehouse Te...' },
  { date: 'Oct 19, 10:00', sku: 'SKU-3129', name: 'New Balance 990', desc: 'Shrinkage entry', type: 'Cycle Count', prev: 18, new: 15, change: -3, user: 'John Doe' }
];

export const mockReplenishmentDashboard = {
  kpis: {
    avgSafetyStockDays: '12.4 Days',
    systemRopCoverage: '94.1%',
    systemRopAlerts: 27,
    totalEoqValue: '$45,820',
    serviceLevel: '96.4%',
    serviceLevelMom: '+0.8%'
  },
  skus: [
    { id: 'SKU-8921', name: 'Nike Ultra Boost', category: 'Footwear', daily: 25.4, sd: 4.2, lt: 7, ss: 20, rop: 198, eoq: 450, status: 'Below ROP' },
    { id: 'SKU-4402', name: 'Nike Vapor Fly', category: 'Footwear', daily: 12.8, sd: 2.1, lt: 10, ss: 11, rop: 140, eoq: 250, status: 'Critical' },
    { id: 'SKU-1024', name: 'Puma Classic', category: 'Footwear', daily: 8.5, sd: 1.5, lt: 5, ss: 7, rop: 50, eoq: 180, status: 'Critical' },
    { id: 'SKU-7721', name: 'Adidas Samba', category: 'Footwear', daily: 42.1, sd: 6.8, lt: 4, ss: 25, rop: 194, eoq: 600, status: 'Above ROP' },
    { id: 'SKU-5012', name: 'Reebok Club C', category: 'Footwear', daily: 15, sd: 2.5, lt: 6, ss: 12, rop: 102, eoq: 300, status: 'Above ROP' },
    { id: 'SKU-2931', name: 'Asics Gel Kayano', category: 'Footwear', daily: 11.2, sd: 1.9, lt: 8, ss: 10, rop: 100, eoq: 220, status: 'Above ROP' },
    { id: 'SKU-3129', name: 'New Balance 990', category: 'Footwear', daily: 6.4, sd: 1.1, lt: 14, ss: 7, rop: 97, eoq: 150, status: 'Below ROP' },
    { id: 'SKU-8812', name: 'Under Armour Hovr', category: 'Apparel', daily: 19.5, sd: 3.2, lt: 6, ss: 15, rop: 132, eoq: 380, status: 'Above ROP' }
  ]
};

export const mockCostSimulation = {
  currentPolicy: { sl: '95%', holding: '$6,420', stockout: '$7,210', total: '$14,210' },
  simulatedPolicy: { sl: '98%', holding: '$8,250', stockout: '$2,100', total: '$10,850' },
  delta: { holding: '+28.5%', stockout: '-70.8%', total: '-23.6%' },
  chartData: [
    { sl: '85%', cost: 18000 },
    { sl: '90%', cost: 16000 },
    { sl: '95%', cost: 14210 },
    { sl: '96%', cost: 13500 },
    { sl: '98%', cost: 10850 },
    { sl: '99.9%', cost: 22000 }
  ]
};

export const mockAuditLogs = [
  { timestamp: '2024-10-24 10:32:15', user: 'sarah.j@dfios.com', action: 'Inventory Policy Update', details: 'Service Level Target globally updated to 95%', ip: '192.168.1.42', severity: 'Warning' },
  { timestamp: '2024-10-24 09:40:02', user: 'system-agent-ml', action: 'Model Training Execution', details: 'TFT v3.2 weekly retraining pipeline finished', ip: '10.0.4.12', severity: 'Info' },
  { timestamp: '2024-10-24 08:15:30', user: 'wh-receiver-02', action: 'Inventory Adjustment', details: 'SKU-4402 Nike Vapor received PO-2024-098', ip: '192.168.10.15', severity: 'Info' },
  { timestamp: '2024-10-23 16:40:11', user: 'sarah.j@dfios.com', action: 'Manual Inventory Edit', details: 'SKU-1024 Puma Classic quantity write-off (-2)', ip: '192.168.1.42', severity: 'Warning' },
  { timestamp: '2024-10-23 14:15:00', user: 'john.d@dfios.com', action: 'Data Export', details: 'ABC/XYZ analysis exported to Excel format', ip: '192.168.1.109', severity: 'Info' },
  { timestamp: '2024-10-23 09:00:24', user: 'system-agent-ml', action: 'Data Ingestion Sync', details: 'Walmart Sales database sync finalized cleanly', ip: '10.0.4.12', severity: 'Info' },
  { timestamp: '2024-10-22 17:30:15', user: 'admin@dfios.com', action: 'User Deletion', details: "Role 'Store Manager' user deleted (ID: 442)", ip: '192.168.1.2', severity: 'Critical' },
  { timestamp: '2024-10-22 08:30:00', user: 'sarah.j@dfios.com', action: 'User Authentication', details: 'Successfully logged in via SSO', ip: '192.168.1.42', severity: 'Info' },
  { timestamp: '2024-10-21 11:22:18', user: 'john.d@dfios.com', action: 'Automatic Recalculation', details: 'SS/ROP/EOQ values successfully auto-updated', ip: '192.168.1.109', severity: 'Info' },
  { timestamp: '2024-10-20 15:45:02', user: 'wh-receiver-02', action: 'Inventory Adjustment', details: 'SKU-8921 Nike Ultra Boost PO-2024-091 (+100)', ip: '192.168.10.15', severity: 'Info' }
];

export const mockDataQuality = {
  score: '94.2%',
  missingRate: '0.3%',
  outliers: 2,
  inspections: [
    { name: 'Future date target leakage check', category: 'Leakage Prevention', status: 'Pass', details: 'Validated all validation dataset windows possess no future va...', affected: '0 anomalies' },
    { name: 'Sales volume completeness audit', category: 'Completeness', status: 'Warning', details: 'Discovered 32 null/missing values in historical series', affected: '32 SKUs' },
    { name: 'SKU database redundancy validation', category: 'Consistency', status: 'Pass', details: 'Verified absolutely no duplicate matching index entries exist', affected: '0 anomalies' },
    { name: 'Price-demand correlation consistency', category: 'Validity', status: 'Pass', details: 'Temporal correlation metrics validate correctly within bound t...', affected: '0 anomalies' },
    { name: 'Promotion flag data integrity aligner', category: 'Consistency', status: 'Fail', details: 'Identified binary promotion flags active on past closed dates', affected: '2 records' },
    { name: 'Outlier Sales Spikes Analysis', category: 'Validity', status: 'Warning', details: 'Sales spikes identified outside normal distribution limits (3 S...', affected: '4 events' }
  ]
};

export const mockMlPipeline = {
  kpis: {
    lastRun: {
      time: 'Oct 24, 00:00',
      status: 'Duration: 42 mins finished clean'
    },
    nextRun: {
      time: 'In 6 Days',
      status: 'Scheduled: Oct 31, 00:00 AM'
    },
    activeModel: {
      name: 'TFT v3.2',
      desc: 'Temporal Fusion Transformer'
    },
    pipelineHealth: {
      status: 'Healthy',
      desc: '0 Ingestion Alerts pending'
    }
  },
  executions: [
    { id: 'RUN-1092', trigger: 'Scheduled', start: 'Oct 24, 00:00', duration: '42 min', model: 'TFT v3.2', scope: '3,049 SKUs', status: 'Completed', params: ['SS', 'ABC'] },
    { id: 'RUN-1091', trigger: 'Manual Trigger', start: 'Oct 22, 14:15', duration: '45 min', model: 'TFT v3.2', scope: '3,049 SKUs', status: 'Completed', params: ['SS', 'ABC'] },
    { id: 'RUN-1090', trigger: 'Scheduled', start: 'Oct 17, 00:00', duration: '41 min', model: 'TFT v3.1', scope: '3,037 SKUs', status: 'Completed', params: ['SS', 'ABC'] },
    { id: 'RUN-1089', trigger: 'Scheduled', start: 'Oct 10, 00:00', duration: '44 min', model: 'TFT v3.1', scope: '3,037 SKUs', status: 'Completed', params: ['SS'] },
    { id: 'RUN-1088', trigger: 'Scheduled', start: 'Oct 03, 00:00', duration: '58 min', model: 'LightGBM v2.9', scope: '3,025 SKUs', status: 'Failed', params: [] }
  ]
};
