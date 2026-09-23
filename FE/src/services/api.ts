import { 
  mockDashboard, 
  mockForecastExplorer, 
  mockReplenishment, 
  mockAbcXyz, 
  mockModelPerformance, 
  mockReports, 
  mockProducts, 
  mockSettings,
  mockUsers,
  mockSuppliers,
  mockDataImports,
  mockEvents,
  mockAdjustments,
  mockReplenishmentDashboard,
  mockCostSimulation,
  mockAuditLogs,
  mockDataQuality,
  mockMlPipeline
} from '../data/mockData.ts';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const api = {
  dashboard: {
    getOverview: async () => {
      await delay(400);
      return mockDashboard;
    }
  },
  forecasting: {
    getExplorerData: async () => {
      await delay(500);
      return mockForecastExplorer;
    }
  },
  inventory: {
    getReplenishmentAlerts: async () => {
      await delay(450);
      return mockReplenishment;
    },
    getAbcXyzLogs: async () => {
      await delay(400);
      return mockAbcXyz;
    },
    getProducts: async () => {
      await delay(550);
      return mockProducts;
    },
    getReplenishmentDashboard: async () => {
      await delay(300);
      return mockReplenishmentDashboard;
    }
  },
  models: {
    getPerformanceMetrics: async () => {
      await delay(600);
      return mockModelPerformance;
    },
    getCostSimulation: async () => {
      await delay(400);
      return mockCostSimulation;
    }
  },
  reports: {
    getRecentLogs: async () => {
      await delay(350);
      return mockReports;
    }
  },
  settings: {
    getConfig: async () => {
      await delay(200);
      return mockSettings;
    },
    getUsers: async () => {
      await delay(200);
      return mockUsers;
    },
    getAuditLogs: async () => {
      await delay(300);
      return mockAuditLogs;
    },
    getDataQuality: async () => {
      await delay(300);
      return mockDataQuality;
    },
    getMlPipeline: async () => {
      await delay(250);
      return mockMlPipeline;
    }
  },
  products: {
    getSuppliers: async () => {
      await delay(250);
      return mockSuppliers;
    },
    getDataImports: async () => {
      await delay(200);
      return mockDataImports;
    },
    getEvents: async () => {
      await delay(150);
      return mockEvents;
    },
    getAdjustments: async () => {
      await delay(200);
      return mockAdjustments;
    }
  }
};
