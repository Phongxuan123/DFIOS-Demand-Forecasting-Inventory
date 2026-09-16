import { 
  mockDashboard, 
  mockForecastExplorer, 
  mockReplenishment, 
  mockAbcXyz, 
  mockModelPerformance, 
  mockReports, 
  mockProducts, 
  mockSettings 
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
    }
  },
  models: {
    getPerformanceMetrics: async () => {
      await delay(600);
      return mockModelPerformance;
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
    }
  }
};
