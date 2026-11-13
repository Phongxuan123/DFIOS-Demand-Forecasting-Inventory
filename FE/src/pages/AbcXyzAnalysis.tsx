import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Settings,
  RefreshCw,
  X,
  AlertCircle,
  AlertTriangle,
  Check,
  Search,
  ShieldCheck,
  Activity,
  Zap,
  Layers,
  LayoutGrid,
  Table,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import {
  api,
  type CalibrationStateItem,
  type CalibrationStatusResponse,
  type PolicySelectionItem,
} from '../services/api.ts';
import {
  buildCalibrationTrajectory,
  findPolicySelectionForClass,
} from '../utils/dfiosAnalytics.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import './AbcXyzAnalysis.css';

interface TrajectoryPointItem {
  cycle: string;
  k: number;
  availability: number;
  target: number;
  theta: number;
  phase: string;
  reviewDate?: string;
  multiplier?: number;
  errorRate?: number;
  atBoundary?: boolean;
  eta?: number;
}

interface SegmentC3Profile {
  segment: string;
  labelEn: string;
  labelVi: string;
  priorityEn: string;
  priorityVi: string;
  defaultTau: number; // Target service level % (e.g. 98.0, 95.0, 90.0)
  observedAvail: number; // Observed 4-period rolling availability %
  theta: number; // C³-OUT safety multiplier in [0, 2]
  mParam: number; // m_g multiplier
  kappaParam: number; // kappa_g EOQ batch multiplier
  state: 'ACTIVE' | 'WARM-UP' | 'BOUNDARY';
  reviewDays: number;
  leadDays: number;
  descEn: string;
  descVi: string;
  strategyEn: string;
  strategyVi: string;
  reviewFreqEn: string;
  reviewFreqVi: string;
  repPolicyEn: string;
  repPolicyVi: string;
  bufferPolicyEn: string;
  bufferPolicyVi: string;
}

const SEGMENT_C3_PROFILES: Record<string, SegmentC3Profile> = {
  AX: {
    segment: 'AX',
    labelEn: 'AX — Strategic Core',
    labelVi: 'AX — Chủ lực Chiến lược',
    priorityEn: 'Critical (Tier 1)',
    priorityVi: 'Tối quan trọng (Hạng 1)',
    defaultTau: 98.0,
    observedAvail: 98.4,
    theta: 0.42,
    mParam: 1.0,
    kappaParam: 0.85,
    state: 'ACTIVE',
    reviewDays: 7,
    leadDays: 3,
    descEn:
      'High-revenue, low-volatility flagship SKUs. Controlled via tight periodic review (R=7d, L=3d, H=10d) with LightGBM Global Quantile + C³-OUT safety calibration.',
    descVi:
      'Nhóm SKU chủ lực doanh thu cao, nhu cầu ổn định. Kiểm soát qua chu kỳ (R=7d, L=3d, H=10d) kết hợp dự báo phân vị LightGBM và hiệu chuẩn C³-OUT.',
    strategyEn: 'JIT Periodic Review (R, s, S) with tight EOQ cycle replenishment',
    strategyVi: 'Kiểm kê định kỳ (R, s, S) tinh gọn với lô đặt hàng EOQ tối ưu',
    reviewFreqEn: 'Weekly Periodic Review (R = 7d, Protection Window H = 10d)',
    reviewFreqVi: 'Rà soát định kỳ hàng tuần (R = 7d, Cửa sổ bảo vệ H = 10d)',
    repPolicyEn: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.98) + 0.42·σ̂_H, S = s + ⌈0.85·EOQ⌉',
    repPolicyVi: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.98) + 0.42·σ̂_H, S = s + ⌈0.85·EOQ⌉',
    bufferPolicyEn: 'Lean C³-OUT Buffer (θ_AX = 0.42, τ_A = 98.0%)',
    bufferPolicyVi: 'Đệm an toàn C³-OUT tinh gọn (θ_AX = 0.42, τ_A = 98.0%)',
  },
  AY: {
    segment: 'AY',
    labelEn: 'AY — Strategic Dynamic',
    labelVi: 'AY — Chủ lực Biến động',
    priorityEn: 'Critical (Tier 1)',
    priorityVi: 'Tối quan trọng (Hạng 1)',
    defaultTau: 98.0,
    observedAvail: 98.1,
    theta: 0.68,
    mParam: 1.15,
    kappaParam: 1.0,
    state: 'ACTIVE',
    reviewDays: 7,
    leadDays: 3,
    descEn:
      'High-revenue SKUs with moderate seasonal or promotional swings. C³-OUT actively maintains θ_g = 0.68 to defend the 98.0% availability setpoint.',
    descVi:
      'SKU doanh thu cao có biến động theo mùa hoặc khuyến mãi. Bộ điều khiển C³-OUT duy trì θ_g = 0.68 để bảo vệ mục tiêu phục vụ 98.0%.',
    strategyEn: 'Dynamic (R, s, S) with promotional quantile uplift & C³-OUT feedback',
    strategyVi: 'Chính sách (R, s, S) linh hoạt kết hợp phân vị khuyến mãi & phản hồi C³-OUT',
    reviewFreqEn: 'Weekly Periodic Review (R = 7d, Protection Window H = 10d)',
    reviewFreqVi: 'Rà soát định kỳ hàng tuần (R = 7d, Cửa sổ bảo vệ H = 10d)',
    repPolicyEn: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.98) + 0.68·σ̂_H, S = s + ⌈1.00·EOQ⌉',
    repPolicyVi: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.98) + 0.68·σ̂_H, S = s + ⌈1.00·EOQ⌉',
    bufferPolicyEn: 'Adaptive C³-OUT Buffer (θ_AY = 0.68, τ_A = 98.0%)',
    bufferPolicyVi: 'Đệm thích ứng C³-OUT (θ_AY = 0.68, τ_A = 98.0%)',
  },
  AZ: {
    segment: 'AZ',
    labelEn: 'AZ — Strategic Volatile',
    labelVi: 'AZ — Chủ lực Thất thường',
    priorityEn: 'High Alert (Tier 1)',
    priorityVi: 'Cảnh báo cao (Hạng 1)',
    defaultTau: 98.0,
    observedAvail: 97.6,
    theta: 1.15,
    mParam: 1.35,
    kappaParam: 1.15,
    state: 'ACTIVE',
    reviewDays: 7,
    leadDays: 3,
    descEn:
      'High-value, erratic-demand SKUs prone to tail spikes. Requires elevated C³-OUT multiplier (θ_AZ = 1.15) to prevent costly Class-A stockouts.',
    descVi:
      'SKU giá trị cao nhưng nhu cầu biến động mạnh. Cần hệ số C³-OUT cao (θ_AZ = 1.15) để ngăn ngừa đứt hàng nhóm A.',
    strategyEn: 'Buffered (R, s, S) with tail-risk quantile protection',
    strategyVi: 'Chính sách (R, s, S) tăng cường đệm bảo vệ rủi ro đuôi phân phối',
    reviewFreqEn: 'Weekly Periodic Review + Exception Alerts (R = 7d, H = 10d)',
    reviewFreqVi: 'Rà soát hàng tuần + Cảnh báo ngoại lệ (R = 7d, H = 10d)',
    repPolicyEn: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.98) + 1.15·σ̂_H, S = s + ⌈1.15·EOQ⌉',
    repPolicyVi: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.98) + 1.15·σ̂_H, S = s + ⌈1.15·EOQ⌉',
    bufferPolicyEn: 'Reinforced C³-OUT Buffer (θ_AZ = 1.15, τ_A = 98.0%)',
    bufferPolicyVi: 'Đệm an toàn tăng cường C³-OUT (θ_AZ = 1.15, τ_A = 98.0%)',
  },
  BX: {
    segment: 'BX',
    labelEn: 'BX — Core Stable',
    labelVi: 'BX — Trung tâm Ổn định',
    priorityEn: 'Standard High (Tier 2)',
    priorityVi: 'Ưu tiên Khá (Hạng 2)',
    defaultTau: 95.0,
    observedAvail: 95.6,
    theta: 0.35,
    mParam: 0.95,
    kappaParam: 1.0,
    state: 'ACTIVE',
    reviewDays: 7,
    leadDays: 3,
    descEn:
      'Moderate revenue contribution with steady demand. Automated periodic review achieves 95.6% fill rate with low holding cost.',
    descVi:
      'Doanh thu trung bình với sức mua ổn định. Đặt hàng tự động theo chu kỳ đạt tỷ lệ đáp ứng 95.6% với chi phí lưu kho thấp.',
    strategyEn: 'Automated Periodic Review (R, s, S) with standard EOQ lots',
    strategyVi: 'Tự động hóa kiểm kê định kỳ (R, s, S) theo cỡ lô EOQ chuẩn',
    reviewFreqEn: 'Weekly Periodic Review (R = 7d, Protection Window H = 10d)',
    reviewFreqVi: 'Rà soát định kỳ hàng tuần (R = 7d, Cửa sổ bảo vệ H = 10d)',
    repPolicyEn: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.95) + 0.35·σ̂_H, S = s + ⌈1.00·EOQ⌉',
    repPolicyVi: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.95) + 0.35·σ̂_H, S = s + ⌈1.00·EOQ⌉',
    bufferPolicyEn: 'Balanced C³-OUT Buffer (θ_BX = 0.35, τ_B = 95.0%)',
    bufferPolicyVi: 'Đệm cân bằng C³-OUT (θ_BX = 0.35, τ_B = 95.0%)',
  },
  BY: {
    segment: 'BY',
    labelEn: 'BY — Core Dynamic',
    labelVi: 'BY — Trung tâm Biến động',
    priorityEn: 'Medium (Tier 2)',
    priorityVi: 'Trung bình (Hạng 2)',
    defaultTau: 95.0,
    observedAvail: 95.2,
    theta: 0.54,
    mParam: 1.05,
    kappaParam: 1.1,
    state: 'ACTIVE',
    reviewDays: 7,
    leadDays: 3,
    descEn:
      'Secondary revenue tier with moderate demand variability. Calibrated via C³-OUT at θ_BY = 0.54 to hold 95.0% service target.',
    descVi:
      'Nhóm doanh thu hạng B có biến động vừa phải. Được hiệu chuẩn qua C³-OUT ở mức θ_BY = 0.54 nhằm giữ vững mục tiêu 95.0%.',
    strategyEn: 'Calibrated (R, s, S) with seasonal forecast features',
    strategyVi: 'Chính sách (R, s, S) hiệu chuẩn theo đặc trưng mùa vụ',
    reviewFreqEn: 'Weekly Periodic Review (R = 7d, Protection Window H = 10d)',
    reviewFreqVi: 'Rà soát định kỳ hàng tuần (R = 7d, Cửa sổ bảo vệ H = 10d)',
    repPolicyEn: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.95) + 0.54·σ̂_H, S = s + ⌈1.10·EOQ⌉',
    repPolicyVi: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.95) + 0.54·σ̂_H, S = s + ⌈1.10·EOQ⌉',
    bufferPolicyEn: 'Moderate C³-OUT Buffer (θ_BY = 0.54, τ_B = 95.0%)',
    bufferPolicyVi: 'Đệm an toàn vừa phải C³-OUT (θ_BY = 0.54, τ_B = 95.0%)',
  },
  BZ: {
    segment: 'BZ',
    labelEn: 'BZ — Seasonal / Spiky',
    labelVi: 'BZ — Thời vụ / Đột biến',
    priorityEn: 'Medium-High (Tier 2)',
    priorityVi: 'Khá cao (Hạng 2)',
    defaultTau: 95.0,
    observedAvail: 94.8,
    theta: 0.92,
    mParam: 1.25,
    kappaParam: 1.25,
    state: 'ACTIVE',
    reviewDays: 7,
    leadDays: 3,
    descEn:
      'Medium-value SKUs with intermittent or spiky demand. C³-OUT elevates θ_BZ = 0.92 to absorb variance over the 10-day protection window.',
    descVi:
      'SKU giá trị trung bình nhưng cầu gián đoạn hoặc đột biến. C³-OUT nâng θ_BZ = 0.92 để hấp thụ phương sai trong cửa sổ 10 ngày.',
    strategyEn: 'Variance-Absorbing (R, s, S) with expanded EOQ batching',
    strategyVi: 'Chính sách (R, s, S) hấp thụ biến thiên với cỡ lô EOQ mở rộng',
    reviewFreqEn: 'Weekly Periodic Review (R = 7d, Protection Window H = 10d)',
    reviewFreqVi: 'Rà soát định kỳ hàng tuần (R = 7d, Cửa sổ bảo vệ H = 10d)',
    repPolicyEn: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.95) + 0.92·σ̂_H, S = s + ⌈1.25·EOQ⌉',
    repPolicyVi: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.95) + 0.92·σ̂_H, S = s + ⌈1.25·EOQ⌉',
    bufferPolicyEn: 'High-Variance C³-OUT Buffer (θ_BZ = 0.92, τ_B = 95.0%)',
    bufferPolicyVi: 'Đệm phương sai cao C³-OUT (θ_BZ = 0.92, τ_B = 95.0%)',
  },
  CX: {
    segment: 'CX',
    labelEn: 'CX — Routine Low-Value',
    labelVi: 'CX — Giá trị thấp Ổn định',
    priorityEn: 'Low-Cost Automated (Tier 3)',
    priorityVi: 'Tự động Chi phí thấp (Hạng 3)',
    defaultTau: 90.0,
    observedAvail: 91.5,
    theta: 0.18,
    mParam: 0.8,
    kappaParam: 1.3,
    state: 'ACTIVE',
    reviewDays: 7,
    leadDays: 3,
    descEn:
      'Low-revenue, predictable SKUs. Uses larger EOQ batch multiplier (κ = 1.30) and minimal safety multiplier (θ_CX = 0.18) to minimize ordering overhead.',
    descVi:
      'SKU doanh thu thấp nhưng cầu đều đặn. Tăng hệ số lô đặt (κ = 1.30) và giảm đệm (θ_CX = 0.18) để tối thiểu hóa chi phí đặt hàng.',
    strategyEn: 'Batch-Consolidated Periodic Review (R, s, S)',
    strategyVi: 'Gộp lô đặt hàng định kỳ (R, s, S) tiết kiệm chi phí',
    reviewFreqEn: 'Weekly Automated Batch Review (R = 7d, H = 10d)',
    reviewFreqVi: 'Rà soát lô tự động hàng tuần (R = 7d, H = 10d)',
    repPolicyEn: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.90) + 0.18·σ̂_H, S = s + ⌈1.30·EOQ⌉',
    repPolicyVi: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.90) + 0.18·σ̂_H, S = s + ⌈1.30·EOQ⌉',
    bufferPolicyEn: 'Minimal Holding Buffer (θ_CX = 0.18, τ_C = 90.0%)',
    bufferPolicyVi: 'Đệm lưu kho tối thiểu (θ_CX = 0.18, τ_C = 90.0%)',
  },
  CY: {
    segment: 'CY',
    labelEn: 'CY — Variable Tail',
    labelVi: 'CY — Đuôi dài Biến động',
    priorityEn: 'Low-Medium (Tier 3)',
    priorityVi: 'Thấp - Trung bình (Hạng 3)',
    defaultTau: 90.0,
    observedAvail: 90.4,
    theta: 0.31,
    mParam: 0.9,
    kappaParam: 1.4,
    state: 'WARM-UP',
    reviewDays: 7,
    leadDays: 3,
    descEn:
      'Low-revenue items with moderate fluctuation. C³-OUT operates in conservative deadband mode (θ_CY = 0.31) to avoid overstocking slow movers.',
    descVi:
      'Mặt hàng doanh thu thấp, biến động vừa. C³-OUT vận hành trong dải chết bảo toàn (θ_CY = 0.31) để tránh ứ đọng vốn.',
    strategyEn: 'Cost-Constrained (R, s, S) with deadband damping',
    strategyVi: 'Kiểm soát (R, s, S) giới hạn chi phí với vùng chết giảm chấn',
    reviewFreqEn: 'Weekly Automated Review (R = 7d, H = 10d)',
    reviewFreqVi: 'Rà soát tự động hàng tuần (R = 7d, H = 10d)',
    repPolicyEn: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.90) + 0.31·σ̂_H, S = s + ⌈1.40·EOQ⌉',
    repPolicyVi: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.90) + 0.31·σ̂_H, S = s + ⌈1.40·EOQ⌉',
    bufferPolicyEn: 'Deadband-Stabilized Buffer (θ_CY = 0.31, τ_C = 90.0%)',
    bufferPolicyVi: 'Đệm ổn định dải chết (θ_CY = 0.31, τ_C = 90.0%)',
  },
  CZ: {
    segment: 'CZ',
    labelEn: 'CZ — Intermittent Long-Tail',
    labelVi: 'CZ — Đuôi dài Gián đoạn',
    priorityEn: 'Strict Cap (Tier 3)',
    priorityVi: 'Giới hạn trần (Hạng 3)',
    defaultTau: 90.0,
    observedAvail: 89.7,
    theta: 0.64,
    mParam: 1.1,
    kappaParam: 1.5,
    state: 'BOUNDARY',
    reviewDays: 7,
    leadDays: 3,
    descEn:
      'Intermittent, zero-inflated long-tail SKUs. C³-OUT clip boundary [0, 2] prevents runaway safety stock while maintaining ~90% availability.',
    descVi:
      'SKU đuôi dài ngắt quãng (nhiều ngày bằng 0). Ràng buộc cắt ngưỡng [0, 2] của C³-OUT ngăn tồn kho phình đại trong khi giữ ~90% độ sẵn sàng.',
    strategyEn: 'Clipped C³-OUT (R, s, S) with consolidated order batches',
    strategyVi: 'Chính sách (R, s, S) cắt biên C³-OUT kết hợp gom lô đặt hàng',
    reviewFreqEn: 'Weekly Periodic Review (R = 7d, Protection Window H = 10d)',
    reviewFreqVi: 'Rà soát định kỳ hàng tuần (R = 7d, Cửa sổ bảo vệ H = 10d)',
    repPolicyEn: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.90) + 0.64·σ̂_H, S = s + ⌈1.50·EOQ⌉',
    repPolicyVi: 'REFIT-RSS-EOQ-G: s = Q̂_H(0.90) + 0.64·σ̂_H, S = s + ⌈1.50·EOQ⌉',
    bufferPolicyEn: 'Boundary-Protected Buffer (θ_CZ = 0.64, clip ∈ [0, 2])',
    bufferPolicyVi: 'Đệm bảo vệ biên (θ_CZ = 0.64, giới hạn ∈ [0, 2])',
  },
};

const ALL_SEGMENTS = ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'];

export const AbcXyzAnalysis: React.FC = () => {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isVi = language === 'vi';
  const localeStr = isVi ? 'vi-VN' : 'en-US';
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';
  const canManage = isAdmin || user?.role?.toUpperCase() === 'WAREHOUSE MANAGER' || user?.role?.toUpperCase() === 'MANAGER';

  const [matrixData, setMatrixData] = useState<any>(null);
  const [thresholds, setThresholds] = useState<any>({ a_cutoff: 80, b_cutoff: 95, cv_x: 0.5, cv_y: 1.0 });
  const [serviceLevelConfig, setServiceLevelConfig] = useState<any>(null);
  const [skuList, setSkuList] = useState<any[]>([]);
  const [totalSkus, setTotalSkus] = useState(0);

  // Sub-navigation tabs: matrix | trajectory | registry
  type AbcTab = 'matrix' | 'trajectory' | 'registry';
  const [activeTab, setActiveTab] = useState<AbcTab>('matrix');

  // Pagination for SKU table
  const [skuPage, setSkuPage] = useState(1);
  const [skuPageSize, setSkuPageSize] = useState(15);

  // Filters — Auto-select 'AX' by default so Segment Policy & Strategy panel is immediately rich on load!
  const [selectedSegment, setSelectedSegment] = useState<string>('AX');
  const [inspectedSegment, setInspectedSegment] = useState<string>('AX');
  const [selectedAbc, setSelectedAbc] = useState<string>('A');
  const [selectedXyz, setSelectedXyz] = useState<string>('X');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [categories, setCategories] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('revenue');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const selectedStore = 'CA_1';
  const [calibrationStatus, setCalibrationStatus] = useState<CalibrationStatusResponse | null>(null);
  const [calibrationHistory, setCalibrationHistory] = useState<CalibrationStateItem[]>([]);
  const [refittedPolicies, setRefittedPolicies] = useState<PolicySelectionItem[]>([]);
  const [policySelectionId, setPolicySelectionId] = useState<string | null>(null);
  const [isSteppingCalibration, setIsSteppingCalibration] = useState(false);
  const [isRefittingPolicies, setIsRefittingPolicies] = useState(false);
  const [trajectoryScenario, setTrajectoryScenario] = useState<'LIVE' | 'NORMAL' | 'SHOCK_E9C'>('LIVE');

  const [selectedRecommendation, setSelectedRecommendation] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSkus, setIsLoadingSkus] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSavingThresholds, setIsSavingThresholds] = useState(false);
  const [saveStage, setSaveStage] = useState(0);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [configMessage, setConfigMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  // Global Toast
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const notifTimerRef = useRef<any>(null);
  const filterReqIdRef = useRef(0);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    setNotification({ message, type });
    notifTimerRef.current = setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  // Threshold form inputs
  const [formThresholds, setFormThresholds] = useState({
    a_cutoff: 80,
    b_cutoff: 95,
    cv_x: 0.5,
    cv_y: 1.0,
  });

  const loadCalibrationForStore = async (storeId: string) => {
    if (!canManage) {
      setCalibrationStatus(null);
      setCalibrationHistory([]);
      return;
    }
    const [calStatusRes, calHistoryRes] = await Promise.all([
      api.calibration.getStatus(storeId).catch(() => null),
      api.calibration.getHistory({ store_id: storeId, limit: 200 }).catch(() => []),
    ]);
    setCalibrationStatus(calStatusRes);
    setCalibrationHistory(Array.isArray(calHistoryRes) ? calHistoryRes : []);
  };

  const loadData = async (storeIdParam?: string) => {
    const activeStore = storeIdParam || selectedStore || 'CA_1';
    setIsLoading(true);
    try {
      const [matrixRes, threshRes, skusRes, catList, slRes, axRec, calStatusRes, calHistoryRes] = await Promise.all([
        api.classification.getMatrix().catch(() => null),
        api.classification.getThresholds().catch(() => null),
        api.classification
          .getSkus({
            segment: selectedSegment !== 'All' ? selectedSegment : undefined,
            abc: selectedAbc !== 'All' ? selectedAbc : undefined,
            xyz: selectedXyz !== 'All' ? selectedXyz : undefined,
            skip: 0,
            limit: skuPageSize,
            sort_by: sortBy,
            order: sortOrder,
          })
          .catch(() => ({ list: [], total: 0 })),
        api.products.getCategories().catch(() => ['FOODS', 'HOBBIES', 'HOUSEHOLD']),
        canManage ? api.optimization.getServiceLevel().catch(() => null) : Promise.resolve(null),
        canManage ? api.classification.getRecommendation('AX').catch(() => null) : Promise.resolve(null),
        canManage ? api.calibration.getStatus(activeStore).catch(() => null) : Promise.resolve(null),
        canManage ? api.calibration.getHistory({ store_id: activeStore, limit: 200 }).catch(() => []) : Promise.resolve([]),
      ]);

      if (matrixRes) {
        setMatrixData(matrixRes);
      }
      if (threshRes) {
        setThresholds(threshRes);
        setFormThresholds({
          a_cutoff: threshRes.a_cutoff ?? 80,
          b_cutoff: threshRes.b_cutoff ?? 95,
          cv_x: threshRes.cv_x ?? 0.5,
          cv_y: threshRes.cv_y ?? 1.0,
        });
      }
      if (slRes) {
        setServiceLevelConfig(slRes);
      }
      if (axRec) {
        setSelectedRecommendation(axRec);
      }
      setCalibrationStatus(calStatusRes);
      setCalibrationHistory(Array.isArray(calHistoryRes) ? calHistoryRes : []);
      setCategories(catList || []);
      setSkuList(skusRes.list || []);
      setTotalSkus(skusRes.total || (skusRes.list || []).length);
    } catch (error) {
      console.error('Failed to load classification data', error);
      showNotification(
        isVi ? 'Không thể tải ma trận phân loại ABC/XYZ.' : 'Failed to load ABC/XYZ classification matrix.',
        'error'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    return () => {
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    };
  }, []);

  // Reset page when filters change
  useEffect(() => {
    setSkuPage(1);
  }, [searchTerm, selectedSegment, selectedAbc, selectedXyz, selectedCategory, sortBy, sortOrder]);

  useEffect(() => {
    if (isLoading) return;

    const reqId = ++filterReqIdRef.current;
    const timer = setTimeout(async () => {
      setIsLoadingSkus(true);
      try {
        const skusRes = await api.classification.getSkus({
          segment: selectedSegment !== 'All' ? selectedSegment : undefined,
          abc: selectedAbc !== 'All' ? selectedAbc : undefined,
          xyz: selectedXyz !== 'All' ? selectedXyz : undefined,
          category: selectedCategory !== 'All' ? selectedCategory : undefined,
          search: searchTerm.trim() || undefined,
          sort_by: sortBy,
          order: sortOrder,
          skip: (skuPage - 1) * skuPageSize,
          limit: skuPageSize,
        });
        if (reqId !== filterReqIdRef.current) return;
        const totalCount = skusRes.total || (skusRes.list || []).length;
        setSkuList(skusRes.list || []);
        setTotalSkus(totalCount);

        if (skuPage * skuPageSize < totalCount) {
          api.classification
            .getSkus({
              segment: selectedSegment !== 'All' ? selectedSegment : undefined,
              abc: selectedAbc !== 'All' ? selectedAbc : undefined,
              xyz: selectedXyz !== 'All' ? selectedXyz : undefined,
              category: selectedCategory !== 'All' ? selectedCategory : undefined,
              search: searchTerm.trim() || undefined,
              sort_by: sortBy,
              order: sortOrder,
              skip: skuPage * skuPageSize,
              limit: skuPageSize,
            })
            .catch(() => {});
        }
      } catch (e) {
        if (reqId === filterReqIdRef.current) {
          console.error('Failed to filter SKUs', e);
        }
      } finally {
        if (reqId === filterReqIdRef.current) {
          setIsLoadingSkus(false);
        }
      }
    }, 240);

    return () => clearTimeout(timer);
  }, [searchTerm, selectedSegment, selectedAbc, selectedXyz, selectedCategory, sortBy, sortOrder, skuPage, skuPageSize]);

  // Resolve target service level tau_g for a segment, merging with api.optimization.getServiceLevel() if present
  const getSegmentTau = (segCode: string): number => {
    const base = SEGMENT_C3_PROFILES[segCode]?.defaultTau ?? 95.0;
    const abcClass = segCode[0];
    if (serviceLevelConfig?.category_service_levels && serviceLevelConfig.category_service_levels[abcClass] != null) {
      const val = Number(serviceLevelConfig.category_service_levels[abcClass]);
      return val <= 1 ? Math.round(val * 1000) / 10 : val;
    }
    return base;
  };

  // Click cell on matrix
  const handleSelectSegment = async (segment: string) => {
    setInspectedSegment(segment);
    const next = selectedSegment === segment ? 'All' : segment;
    setSelectedSegment(next);
    if (next !== 'All') {
      setSelectedAbc(next[0]);
      setSelectedXyz(next[1]);
      if (canManage) {
        try {
          const rec = await api.classification.getRecommendation(next).catch(() => null);
          setSelectedRecommendation(rec);
        } catch {
          setSelectedRecommendation(null);
        }
      }
    } else {
      setSelectedAbc('All');
      setSelectedXyz('All');
    }
  };

  const handleRunCalibrationStep = async () => {
    if (!isAdmin) return;
    setIsSteppingCalibration(true);
    try {
      const res = await api.calibration.step({
        store_id: selectedStore,
        lead_time_days: 3,
        review_period_days: 7,
      });
      await loadCalibrationForStore(selectedStore);
      const warnSuffix =
        Array.isArray(res.warnings) && res.warnings.length > 0
          ? ` (${res.warnings[0]})`
          : '';
      showNotification(
        `${res.message || (isVi ? `Đã cập nhật C³-OUT chu kỳ k=${res.review_index}` : `C³-OUT stepped to cycle k=${res.review_index}`)}${warnSuffix}`,
        'success'
      );
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      showNotification(
        detail ||
          (isVi
            ? 'Không thể chạy bước hiệu chuẩn C³-OUT (yêu cầu quyền Admin hoặc dữ liệu cycle hợp lệ).'
            : 'Unable to step C³-OUT calibration (requires Admin and available service outcome cycle).'),
        'error'
      );
    } finally {
      setIsSteppingCalibration(false);
    }
  };

  const handleRefitPolicies = async () => {
    if (!isAdmin) return;
    setIsRefittingPolicies(true);
    try {
      const res = await api.optimization.refitPolicies({
        store_id: selectedStore,
      });
      setRefittedPolicies(res.policies || []);
      setPolicySelectionId(res.selection_id || null);
      showNotification(
        res.message ||
          (isVi
            ? `Đã refit ${res.policies?.length || 0} chính sách REFIT-RSS-EOQ-G (${res.selection_id}).`
            : `Refitted ${res.policies?.length || 0} REFIT-RSS-EOQ-G policies (${res.selection_id}).`),
        'success'
      );
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      showNotification(
        detail ||
          (isVi
            ? 'Không thể chạy refit chính sách REFIT-RSS-EOQ-G.'
            : 'Failed to refit REFIT-RSS-EOQ-G policies.'),
        'error'
      );
    } finally {
      setIsRefittingPolicies(false);
    }
  };

  const handleViewAllSegments = () => {
    setSelectedSegment('All');
    setSelectedAbc('All');
    setSelectedXyz('All');
    setActiveTab('registry');
  };

  const handleResetFilters = () => {
    setSelectedSegment('All');
    setSelectedAbc('All');
    setSelectedXyz('All');
    setSelectedCategory('All');
    setSearchTerm('');
    setSortBy('revenue');
    setSortOrder('desc');
  };

  const handleRecompute = async () => {
    setIsRecomputing(true);
    showNotification(
      isVi
        ? 'Đang quét lịch sử bán hàng và phân loại lại toàn bộ danh mục SKU...'
        : 'Scanning sales history and reclassifying entire SKU portfolio...',
      'success'
    );
    try {
      const res = await api.classification.recompute();
      await loadData();
      const count = res.total_skus_classified ?? res.total ?? '';
      showNotification(
        res.message ||
          (isVi ? `Đã phân loại lại thành công cho ${count} SKU sản phẩm!` : `Successfully reclassified ${count} SKUs!`),
        'success'
      );
    } catch (err: any) {
      const errMsg =
        err.response?.data?.detail ||
        (isVi
          ? 'Lỗi khi tính toán lại phân loại. Vui lòng kiểm tra lại.'
          : 'Error recomputing classification. Please try again.');
      showNotification(errMsg, 'error');
    } finally {
      setIsRecomputing(false);
    }
  };

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      setConfigMessage({
        text: isVi
          ? 'Chỉ tài khoản Quản trị viên (Admin) mới có quyền cập nhật cấu hình ngưỡng.'
          : 'Only Administrators can update threshold configurations.',
        isError: true,
      });
      return;
    }
    setConfigMessage(null);
    setIsSavingThresholds(true);
    setSaveStage(1);
    try {
      setSaveStage(2);
      const res = await api.classification.updateThresholds({
        a_cutoff: Number(formThresholds.a_cutoff),
        b_cutoff: Number(formThresholds.b_cutoff),
        cv_x: Number(formThresholds.cv_x),
        cv_y: Number(formThresholds.cv_y),
      });
      setThresholds(res);

      setSaveStage(3);
      await loadData();

      setConfigMessage({
        text: isVi
          ? 'Cập nhật cấu hình ngưỡng và phân loại lại danh mục thành công!'
          : 'Threshold configuration updated and portfolio reclassified successfully!',
        isError: false,
      });
      showNotification(
        isVi ? 'Cấu hình ngưỡng ABC/XYZ đã được lưu và cập nhật!' : 'ABC/XYZ thresholds saved and updated!',
        'success'
      );
      setTimeout(() => {
        setIsConfigOpen(false);
        setConfigMessage(null);
        setSaveStage(0);
      }, 1200);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
          ? detail.map((d: any) => d.msg).join(', ')
          : isVi
          ? 'Không thể cập nhật cấu hình ngưỡng.'
          : 'Failed to update threshold configuration.';
      setConfigMessage({ text: msg, isError: true });
      setSaveStage(0);
    } finally {
      setIsSavingThresholds(false);
    }
  };

  const getCellData = (code: string) => {
    if (matrixData?.matrix && matrixData.matrix[code]) {
      const seg = matrixData.matrix[code];
      return {
        count: seg.sku_count ?? 0,
        pct: (seg.sku_percentage ?? 0).toFixed(1),
        revenue: seg.revenue ?? 0,
      };
    }
    return { count: 0, pct: '0.0', revenue: 0 };
  };

  const getEffectiveProfile = (segCode: string) => {
    const fallback = SEGMENT_C3_PROFILES[segCode] || SEGMENT_C3_PROFILES.AX;
    const stateItem = calibrationStatus?.states?.find(
      (s) => (s.class_id || '').toUpperCase() === segCode.toUpperCase()
    );
    const policyItem = findPolicySelectionForClass(refittedPolicies, segCode);

    const tau = getSegmentTau(segCode);
    const thetaFromStatus =
      calibrationStatus?.thetas?.[segCode] ??
      stateItem?.theta;
    const theta = thetaFromStatus != null ? Number(thetaFromStatus) : fallback.theta;
    const multiplierFromStatus =
      calibrationStatus?.multipliers?.[segCode] ??
      stateItem?.multiplier;
    const observedAvail =
      stateItem != null
        ? Number(((1 - Number(stateItem.error_rate || 0)) * 100).toFixed(1))
        : fallback.observedAvail;
    const atBoundary = Boolean(
      stateItem?.at_boundary ||
        calibrationStatus?.at_boundary_classes?.includes(segCode) ||
        theta >= 2.0
    );

    const state: SegmentC3Profile['state'] =
      stateItem != null
        ? atBoundary
          ? 'BOUNDARY'
          : Math.abs(observedAvail - tau) <= 0.5
          ? 'ACTIVE'
          : 'WARM-UP'
        : fallback.state;

    const mParam = policyItem
      ? Number(policyItem.m_g)
      : multiplierFromStatus != null
      ? Number(multiplierFromStatus)
      : fallback.mParam;
    const kappaParam = policyItem ? Number(policyItem.kappa_g) : fallback.kappaParam;

    return {
      ...fallback,
      theta: Number(theta.toFixed(2)),
      mParam: Number(mParam.toFixed(2)),
      kappaParam: Number(kappaParam.toFixed(2)),
      observedAvail,
      atBoundary,
      state,
      isLiveCalibration: stateItem != null || thetaFromStatus != null,
      policyType: policyItem?.policy_type || null,
      valCost: policyItem?.val_cost ?? null,
      valService: policyItem?.val_service ?? null,
      reviewIndex: stateItem?.review_index ?? calibrationStatus?.latest_review_index ?? null,
      reviewDate: stateItem?.review_date ?? calibrationStatus?.latest_review_date ?? null,
    };
  };

  // Active segment shown in the Policy Panel & Trajectory Chart (never empty!)
  const activePolicyCode = selectedSegment !== 'All' ? selectedSegment : inspectedSegment || 'AX';
  const activeProfile = getEffectiveProfile(activePolicyCode);
  const activeTau = getSegmentTau(activePolicyCode);
  const activeCellStats = getCellData(activePolicyCode);

  const liveTrajectoryPoints = useMemo(
    () => buildCalibrationTrajectory(calibrationHistory, activePolicyCode, isVi),
    [calibrationHistory, activePolicyCode, isVi]
  );

  const trajectoryData = useMemo<TrajectoryPointItem[]>(() => {
    if (trajectoryScenario === 'LIVE') {
      return liveTrajectoryPoints;
    }

    const tau = activeTau;
    const baseTheta = activeProfile.theta;
    const eta = 4.5; // C³-OUT controller gain

    if (trajectoryScenario === 'NORMAL') {
      const theta0 = Math.max(0.08, Math.round((baseTheta - 0.14) * 100) / 100);
      const theta1 = Math.max(0.1, Math.round((baseTheta - 0.08) * 100) / 100);
      const theta2 = Math.max(0.12, Math.round((baseTheta - 0.03) * 100) / 100);
      return [
        { cycle: isVi ? 'Chu kỳ k=1' : 'Cycle k=1', k: 1, availability: Number((tau - 1.4).toFixed(1)), target: tau, theta: theta0, phase: isVi ? 'Khởi tạo (Warm-up)' : 'Initialization' },
        { cycle: isVi ? 'Chu kỳ k=2' : 'Cycle k=2', k: 2, availability: Number((tau - 0.9).toFixed(1)), target: tau, theta: theta1, phase: isVi ? 'Trễ phản hồi d=2' : 'Delay window d=2' },
        { cycle: isVi ? 'Chu kỳ k=3' : 'Cycle k=3', k: 3, availability: Number((tau - 0.3).toFixed(1)), target: tau, theta: theta2, phase: isVi ? 'C³-OUT tăng θ_g' : 'C³-OUT steps up θ_g' },
        { cycle: isVi ? 'Chu kỳ k=4' : 'Cycle k=4', k: 4, availability: Number((tau + 0.1).toFixed(1)), target: tau, theta: baseTheta, phase: isVi ? 'Đạt mục tiêu τ_g' : 'Setpoint achieved' },
        { cycle: isVi ? 'Chu kỳ k=5' : 'Cycle k=5', k: 5, availability: Number((tau + 0.3).toFixed(1)), target: tau, theta: baseTheta, phase: isVi ? 'Trong dải chết (0.5%)' : 'Within deadband (0.5%)' },
        { cycle: isVi ? 'Chu kỳ k=6' : 'Cycle k=6', k: 6, availability: Number((tau + 0.2).toFixed(1)), target: tau, theta: baseTheta, phase: isVi ? 'Ổn định vòng kín' : 'Closed-loop steady' },
        { cycle: isVi ? 'Chu kỳ k=7' : 'Cycle k=7', k: 7, availability: Number((tau + 0.4).toFixed(1)), target: tau, theta: baseTheta, phase: isVi ? 'Ổn định vòng kín' : 'Closed-loop steady' },
        { cycle: isVi ? 'Chu kỳ k=8' : 'Cycle k=8', k: 8, availability: Number(activeProfile.observedAvail.toFixed(1)), target: tau, theta: baseTheta, phase: isVi ? 'Trạng thái hiện tại' : 'Current operating state' },
      ];
    }

    const preTheta = Math.max(0.15, Math.round((baseTheta * 0.65) * 100) / 100);
    const step1Theta = Math.min(2.0, Math.round((preTheta + eta * 0.085) * 100) / 100);
    const step2Theta = Math.min(2.0, Math.round((step1Theta + eta * 0.055) * 100) / 100);
    const finalShockTheta = Math.min(2.0, Math.max(step2Theta, baseTheta));

    return [
      { cycle: isVi ? 'Chu kỳ k=1' : 'Cycle k=1', k: 1, availability: Number((tau + 0.2).toFixed(1)), target: tau, theta: preTheta, phase: isVi ? 'Ổn định trước cú sốc' : 'Pre-shock steady state' },
      { cycle: isVi ? 'Chu kỳ k=2' : 'Cycle k=2', k: 2, availability: Number((tau + 0.1).toFixed(1)), target: tau, theta: preTheta, phase: isVi ? 'Ổn định trước cú sốc' : 'Pre-shock steady state' },
      { cycle: isVi ? 'Chu kỳ k=3 (Sốc E9c)' : 'Cycle k=3 (E9c Shock)', k: 3, availability: 89.4, target: tau, theta: preTheta, phase: isVi ? 'Cú sốc chuyển mô hình chưa hiệu chuẩn (89.4%)' : 'Uncalibrated model-switch shock (89.4%)' },
      { cycle: isVi ? 'Chu kỳ k=4' : 'Cycle k=4', k: 4, availability: 91.8, target: tau, theta: step1Theta, phase: isVi ? 'C³-OUT phát hiện thiếu hụt & nâng θ_g' : 'C³-OUT detects shortfall & raises θ_g' },
      { cycle: isVi ? 'Chu kỳ k=5 (Trễ d=2)' : 'Cycle k=5 (Delay d=2)', k: 5, availability: 94.1, target: tau, theta: step2Theta, phase: isVi ? 'Hiệu lực sau độ trễ d=2 chu kỳ' : 'Feedback takes effect after d=2 delay' },
      { cycle: isVi ? 'Chu kỳ k=6 (Phục hồi)' : 'Cycle k=6 (Recovered)', k: 6, availability: Number(Math.max(95.4, tau - 0.1).toFixed(1)), target: tau, theta: finalShockTheta, phase: isVi ? 'Phục hồi ≥ 95.2% sau 3 chu kỳ' : 'Recovered ≥ 95.2% within 3 cycles' },
      { cycle: isVi ? 'Chu kỳ k=7' : 'Cycle k=7', k: 7, availability: Number(Math.max(96.1, tau + 0.2).toFixed(1)), target: tau, theta: finalShockTheta, phase: isVi ? 'Khóa mục tiêu trong biên [0, 2]' : 'Locked at setpoint within [0, 2]' },
      { cycle: isVi ? 'Chu kỳ k=8' : 'Cycle k=8', k: 8, availability: Number(Math.max(96.3, activeProfile.observedAvail).toFixed(1)), target: tau, theta: finalShockTheta, phase: isVi ? 'Cân bằng mới sau cú sốc' : 'Post-shock equilibrium' },
    ];
  }, [activeTau, activeProfile, trajectoryScenario, liveTrajectoryPoints, isVi]);

  const trajStats = useMemo(() => {
    if (!trajectoryData || trajectoryData.length === 0) {
      return {
        firstAvail: activeProfile.observedAvail,
        troughAvail: activeProfile.observedAvail,
        recoveryAvail: activeProfile.observedAvail,
        firstTheta: activeProfile.theta,
        lastTheta: activeProfile.theta,
        hasPoints: false,
      };
    }
    const first = trajectoryData[0];
    const last = trajectoryData[trajectoryData.length - 1];
    const minAvail = trajectoryData.reduce(
      (min: number, pt: TrajectoryPointItem) => (pt.availability < min ? pt.availability : min),
      first.availability
    );
    const recoveryIdx = trajectoryScenario === 'SHOCK_E9C' ? Math.min(5, trajectoryData.length - 1) : trajectoryData.length - 1;
    const recovery = trajectoryData[recoveryIdx];
    return {
      firstAvail: first.availability,
      troughAvail: minAvail,
      recoveryAvail: recovery.availability,
      firstTheta: first.theta,
      lastTheta: last.theta,
      hasPoints: true,
    };
  }, [trajectoryData, trajectoryScenario, activeProfile]);

  const hasActiveFilter =
    selectedSegment !== 'All' ||
    selectedAbc !== 'All' ||
    selectedXyz !== 'All' ||
    selectedCategory !== 'All' ||
    searchTerm.trim().length > 0;

  const renderStateBadge = (state: SegmentC3Profile['state'], darkBg: boolean = false) => {
    const label =
      state === 'ACTIVE'
        ? isVi
          ? 'HOẠT ĐỘNG'
          : 'ACTIVE'
        : state === 'WARM-UP'
        ? isVi
          ? 'KHỞI ĐỘNG'
          : 'WARM-UP'
        : isVi
        ? 'CHẠM BIÊN'
        : 'BOUNDARY';
    return (
      <span className={`c3-state-badge state-${state.toLowerCase()} ${darkBg ? 'on-dark' : ''}`}>{label}</span>
    );
  };

  const renderMatrixCell = (segCode: string, cellColorClass: string, isDarkText: boolean = false) => {
    const cell = getCellData(segCode);
    const prof = getEffectiveProfile(segCode);
    const tau = getSegmentTau(segCode);
    const isActive = selectedSegment === segCode;
    const isInspected = activePolicyCode === segCode;

    return (
      <div
        key={segCode}
        className={`matrix-cell ${cellColorClass} cursor-pointer ${isActive ? 'active-cell' : ''} ${
          !isActive && isInspected ? 'inspected-cell' : ''
        }`}
        onClick={() => handleSelectSegment(segCode)}
        title={
          isVi
            ? `Nhấp để lọc SKU & xem chính sách C³-OUT phân khúc ${segCode}`
            : `Click to filter SKUs & inspect C³-OUT policy for segment ${segCode}`
        }
      >
        <div className="matrix-cell-top">
          <span className="matrix-cell-label">{isVi ? prof.labelVi : prof.labelEn}</span>
          {renderStateBadge(prof.state, !isDarkText)}
        </div>

        <div className="matrix-cell-main">
          <span className="matrix-cell-count">
            {cell.count.toLocaleString(localeStr)} {isVi ? 'SKU' : 'SKUs'}
          </span>
          <span className="matrix-cell-pct">({cell.pct}%)</span>
        </div>

        {/* Task FE.9: Segment-Level C³-OUT & REFIT-RSS-EOQ-G Telemetry Chips */}
        <div className={`matrix-cell-c3-strip ${isDarkText ? 'strip-light-bg' : 'strip-dark-bg'}`}>
          <span title={isVi ? 'Mục tiêu phục vụ τ_g vs Thực tế Ã_g' : 'Target Setpoint τ_g vs Observed Ã_g'}>
            τ={tau.toFixed(0)}% • Ã={prof.observedAvail.toFixed(1)}%
          </span>
          <span title={isVi ? 'Hệ số hiệu chuẩn C³-OUT θ_g & Tham số (m_g, κ_g)' : 'C³-OUT Multiplier θ_g & Policy (m_g, κ_g)'}>
            θ={prof.theta.toFixed(2)} • m={prof.mParam.toFixed(2)} • κ={prof.kappaParam.toFixed(2)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="abc-page-wrapper animate-fade-in mb-6">
      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
          <RefreshCw size={20} className="animate-spin inline mr-2 text-teal-600" />
          {isVi
            ? 'Đang tải ma trận phân loại ABC/XYZ và thông số hiệu chuẩn C³-OUT...'
            : 'Loading ABC/XYZ classification matrix and C³-OUT calibration parameters...'}
        </div>
      ) : (
        <>
          {/* Top KPI Metrics Strip */}
          <div className="abc-kpi-grid">
            <div className="abc-kpi-card">
              <span className="abc-kpi-card-label">{isVi ? 'Tổng Danh Mục SKU' : 'Total Portfolio'}</span>
              <span className="abc-kpi-card-value">{totalSkus.toLocaleString(localeStr)}</span>
              <span className="abc-kpi-card-sub">{isVi ? '9 phân khúc phân loại' : 'Across 9 ABC/XYZ segments'}</span>
            </div>

            <div className="abc-kpi-card">
              <span className="abc-kpi-card-label">{isVi ? 'Phân Khúc Đang Chọn' : 'Selected Segment'}</span>
              <span className="abc-kpi-card-value" style={{ color: '#0f766e' }}>
                {activePolicyCode} • {isVi ? activeProfile.priorityVi.split(' ')[0] : activeProfile.priorityEn.split(' ')[0]}
              </span>
              <span className="abc-kpi-card-sub">{isVi ? activeProfile.labelVi : activeProfile.labelEn}</span>
            </div>

            <div className="abc-kpi-card">
              <span className="abc-kpi-card-label">{isVi ? 'Mục Tiêu Phục Vụ (τ_g)' : 'Target Service Level'}</span>
              <span className="abc-kpi-card-value text-teal">{activeTau.toFixed(1)}%</span>
              <span className="abc-kpi-card-sub">
                {isVi ? `Thực tế: ${activeProfile.observedAvail.toFixed(1)}%` : `Observed: ${activeProfile.observedAvail.toFixed(1)}%`}
              </span>
            </div>

            <div className="abc-kpi-card">
              <span className="abc-kpi-card-label">{isVi ? 'Hệ Số Đệm C³-OUT (θ_g)' : 'C³-OUT Multiplier'}</span>
              <span className="abc-kpi-card-value">{activeProfile.theta.toFixed(2)}</span>
              <span className="abc-kpi-card-sub">
                {isVi
                  ? `Trạng thái: ${activeProfile.state}${activeProfile.isLiveCalibration ? ` • ${selectedStore}` : ''}`
                  : `State: ${activeProfile.state}${activeProfile.isLiveCalibration ? ` • ${selectedStore}` : ''}`}
              </span>
            </div>
          </div>

          {(calibrationStatus?.has_warning || (calibrationStatus?.at_boundary_classes?.length ?? 0) > 0) && (
            <div className="c3-boundary-alert" role="alert">
              <div className="c3-boundary-alert-main">
                <AlertTriangle size={16} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <strong>
                    {isVi
                      ? `Cảnh báo Chạm biên Suy giảm C³-OUT (${selectedStore})`
                      : `C³-OUT Boundary Saturation Alert (${selectedStore})`}
                  </strong>{' '}
                  —{' '}
                  {isVi
                    ? `Các phân khúc ${(calibrationStatus?.at_boundary_classes || []).join(', ')} đã chạm ngưỡng trần θ_max = 2.0 tại chu kỳ k=${calibrationStatus?.latest_review_index ?? 0}. Cần rà soát lại độ chính xác dự báo hoặc tham số mục tiêu.`
                    : `Segments ${(calibrationStatus?.at_boundary_classes || []).join(', ')} reached upper clip θ_max = 2.0 at cycle k=${calibrationStatus?.latest_review_index ?? 0}. Review underlying forecast bias or policy targets.`}
                </div>
              </div>
              {calibrationStatus?.latest_review_date && (
                <span className="abc-subnav-pill">
                  k={calibrationStatus.latest_review_index} • {String(calibrationStatus.latest_review_date).slice(0, 10)}
                </span>
              )}
            </div>
          )}

          {/* Sub-Navigation Tabs Bar */}
          <div className="abc-subnav-row">
            <div className="abc-tabs-bar" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'matrix'}
                className={`abc-tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
                onClick={() => setActiveTab('matrix')}
              >
                <LayoutGrid size={14} />
                <span>{isVi ? 'Ma Trận 3x3 & Chính Sách' : '3x3 Matrix & Policies'}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'trajectory'}
                className={`abc-tab-btn ${activeTab === 'trajectory' ? 'active' : ''}`}
                onClick={() => setActiveTab('trajectory')}
              >
                <Activity size={14} />
                <span>{isVi ? 'Quỹ Đạo Vòng Kín C³-OUT' : 'C³-OUT Trajectory'}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'registry'}
                className={`abc-tab-btn ${activeTab === 'registry' ? 'active' : ''}`}
                onClick={() => setActiveTab('registry')}
              >
                <Table size={14} />
                <span>{isVi ? 'Danh Mục SKU & Tham Số' : 'SKU Registry'}</span>
                {totalSkus > 0 && (
                  <span className="abc-subnav-pill" style={{ fontSize: '0.65rem', padding: '1px 6px', marginLeft: '4px' }}>
                    {totalSkus.toLocaleString(localeStr)}
                  </span>
                )}
              </button>
            </div>

            <div className="abc-subnav-meta">
              <span className="abc-subnav-pill">
                {activePolicyCode} • τ={activeTau}% • θ={activeProfile.theta.toFixed(2)} • m={activeProfile.mParam.toFixed(2)}×
              </span>
            </div>
          </div>

          {/* TAB 1: 3x3 MATRIX & SEGMENT POLICIES */}
          {activeTab === 'matrix' && (
            <div className="abc-top-split">
              {/* 3x3 Matrix Panel */}
              <div className="abc-matrix-panel">
                <div className="abc-matrix-header">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <h2 className="panel-title">
                        {isVi
                          ? 'Ma Trận Phân Loại ABC/XYZ & Tham Số C³-OUT'
                          : 'ABC/XYZ Classification Matrix & C³-OUT Telemetry'}
                      </h2>
                      <span className="c3-engine-pill">REFIT-RSS-EOQ-G + C³-OUT</span>
                    </div>
                    <p className="panel-subtitle">
                      {isVi ? (
                        <>
                          Pareto doanh thu: <strong>A</strong> ({thresholds.a_cutoff}%) / <strong>B</strong> ({thresholds.b_cutoff}%) / <strong>C</strong>. Biến thiên cầu: <strong>X</strong> (≤{thresholds.cv_x}) / <strong>Y</strong> / <strong>Z</strong> (&gt;{thresholds.cv_y}). Chọn từng ô để xem chính sách và hiệu chuẩn C³-OUT.
                        </>
                      ) : (
                        <>
                          Pareto cutoffs: <strong>A</strong> ({thresholds.a_cutoff}%) / <strong>B</strong> ({thresholds.b_cutoff}%) / <strong>C</strong>. Volatility: <strong>X</strong> (≤{thresholds.cv_x}) / <strong>Y</strong> / <strong>Z</strong> (&gt;{thresholds.cv_y}). Select cells to inspect policy & C³-OUT calibration.
                        </>
                      )}
                    </p>
                  </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        className="configure-btn primary-action"
                        onClick={handleRunCalibrationStep}
                        disabled={isSteppingCalibration}
                        title={
                          isVi
                            ? 'Job J4: Thực thi 1 chu kỳ phản hồi C³-OUT trên Service Outcome mới nhất'
                            : 'Job J4: Step one closed-loop C³-OUT review cycle from latest service outcome'
                        }
                      >
                        <Play size={12} style={{ marginRight: '5px' }} />
                        {isSteppingCalibration
                          ? isVi ? 'Đang chạy J4...' : 'Stepping J4...'
                          : isVi ? 'Bước C³-OUT (J4)' : 'Step C³-OUT (J4)'}
                      </button>
                      <button
                        type="button"
                        className="configure-btn"
                        onClick={handleRefitPolicies}
                        disabled={isRefittingPolicies}
                        title={
                          isVi
                            ? 'Job J5: Tối ưu lại tham số (m_g, κ_g) theo phân khúc bằng REFIT-RSS-EOQ-G'
                            : 'Job J5: Refit class-level (m_g, κ_g) policies via REFIT-RSS-EOQ-G'
                        }
                      >
                        <SlidersHorizontal size={12} style={{ marginRight: '5px' }} />
                        {isRefittingPolicies
                          ? isVi ? 'Đang refit...' : 'Refitting...'
                          : isVi ? 'Refit Chính sách (J5)' : 'Refit Policies (J5)'}
                      </button>
                    </>
                  )}
                  {selectedSegment !== 'All' && (
                    <button
                      type="button"
                      className="configure-btn btn-view-all"
                      onClick={handleViewAllSegments}
                      title={
                        isVi
                          ? 'Hiển thị toàn bộ SKU của cả 9 phân khúc trong bảng bên dưới'
                          : 'Show SKUs across all 9 segments in the registry table below'
                      }
                    >
                      <Layers size={13} style={{ marginRight: '6px' }} />
                      {isVi ? 'Xem tất cả phân khúc' : 'View All Segments'}
                    </button>
                  )}

                  {canManage && (
                    <button
                      type="button"
                      className="configure-btn"
                      onClick={handleRecompute}
                      disabled={isRecomputing}
                      title={
                        isVi
                          ? 'Chạy lại thuật toán phân loại ABC & XYZ cho toàn bộ danh mục SKU'
                          : 'Re-run ABC & XYZ classification for all SKUs'
                      }
                    >
                      <RefreshCw
                        size={13}
                        className={isRecomputing ? 'animate-spin' : ''}
                        style={{ marginRight: '6px' }}
                      />
                      {isRecomputing
                        ? isVi
                          ? 'Đang tính toán...'
                          : 'Recomputing...'
                        : isVi
                        ? 'Tính lại Ma trận'
                        : 'Recompute Matrix'}
                    </button>
                  )}

                  <button
                    type="button"
                    className="configure-btn"
                    onClick={() => {
                      setConfigMessage(null);
                      setSaveStage(0);
                      setIsConfigOpen(true);
                    }}
                    title={
                      isAdmin
                        ? isVi
                          ? 'Cấu hình tham số ngưỡng phân loại ABC/XYZ'
                          : 'Configure ABC/XYZ classification thresholds'
                        : isVi
                        ? 'Xem cấu hình ngưỡng phân loại ABC/XYZ'
                        : 'View ABC/XYZ classification thresholds'
                    }
                  >
                    <Settings size={13} style={{ marginRight: '6px' }} />
                    {isVi ? 'Cấu hình Ngưỡng' : 'Configure Thresholds'}
                  </button>
                </div>
              </div>

              <div className="matrix-grid-container">
                <div></div>
                <div className="matrix-col-header">
                  {isVi ? `X (ỔN ĐỊNH, CV ≤ ${thresholds.cv_x})` : `X (STABLE, CV ≤ ${thresholds.cv_x})`}
                </div>
                <div className="matrix-col-header">
                  {isVi ? `Y (BIẾN ĐỘNG, CV ≤ ${thresholds.cv_y})` : `Y (VARIABLE, CV ≤ ${thresholds.cv_y})`}
                </div>
                <div className="matrix-col-header">
                  {isVi ? `Z (THẤT THƯỜNG, CV > ${thresholds.cv_y})` : `Z (ERRATIC, CV > ${thresholds.cv_y})`}
                </div>

                {/* Row A */}
                <div className="matrix-row-header">
                  <div>{isVi ? `NHÓM A (TOP ${thresholds.a_cutoff}% DT)` : `A (TOP ${thresholds.a_cutoff}% REV)`}</div>
                  <div className="matrix-row-tau">τ_A = {getSegmentTau('AX').toFixed(1)}%</div>
                </div>
                {renderMatrixCell('AX', 'cell-ax', false)}
                {renderMatrixCell('AY', 'cell-ay', false)}
                {renderMatrixCell('AZ', 'cell-az', true)}

                {/* Row B */}
                <div className="matrix-row-header">
                  <div>
                    {isVi
                      ? `NHÓM B (${(thresholds.b_cutoff ?? 95) - (thresholds.a_cutoff ?? 80)}% DT TIẾP)`
                      : `B (NEXT ${(thresholds.b_cutoff ?? 95) - (thresholds.a_cutoff ?? 80)}% REV)`}
                  </div>
                  <div className="matrix-row-tau">τ_B = {getSegmentTau('BX').toFixed(1)}%</div>
                </div>
                {renderMatrixCell('BX', 'cell-bx', false)}
                {renderMatrixCell('BY', 'cell-by', false)}
                {renderMatrixCell('BZ', 'cell-bz', true)}

                {/* Row C */}
                <div className="matrix-row-header">
                  <div>{isVi ? 'NHÓM C (DT CÒN LẠI)' : 'C (REMAINING REV)'}</div>
                  <div className="matrix-row-tau">τ_C = {getSegmentTau('CX').toFixed(1)}%</div>
                </div>
                {renderMatrixCell('CX', 'cell-cx', false)}
                {renderMatrixCell('CY', 'cell-cy', false)}
                {renderMatrixCell('CZ', 'cell-cz', true)}
              </div>
            </div>

            {/* Right-Hand Segment Policy & C³-OUT Calibration Panel (Task FE.9 — Always Populated!) */}
            <div className="abc-policy-panel">
              <div className="policy-panel-header">
                <div>
                  <h2 className="panel-title" style={{ fontSize: '1.025rem', marginBottom: '0.15rem' }}>
                    {isVi ? 'Chính Sách Phân Khúc & Hiệu Chuẩn C³-OUT' : 'Segment Policy & C³-OUT Calibration'}
                  </h2>
                  <span className="policy-panel-sub">
                    {activeProfile.isLiveCalibration
                      ? isVi
                        ? `Hiệu chuẩn thực BE (${selectedStore} • k=${activeProfile.reviewIndex ?? 0})${activeProfile.policyType ? ` • ${activeProfile.policyType}` : ''}`
                        : `Live BE Calibration (${selectedStore} • k=${activeProfile.reviewIndex ?? 0})${activeProfile.policyType ? ` • ${activeProfile.policyType}` : ''}`
                      : isVi
                      ? 'Tham số (R, s, S) và trạng thái phản hồi mức phục vụ'
                      : 'Periodic review (R, s, S) & closed-loop service state'}
                    {policySelectionId ? ` • ${policySelectionId}` : ''}
                  </span>
                </div>
                {renderStateBadge(activeProfile.state)}
              </div>

              {/* Segment Quick-Switch Pills */}
              <div className="policy-segment-switcher">
                {ALL_SEGMENTS.map((seg) => (
                  <button
                    key={seg}
                    type="button"
                    className={`policy-seg-pill ${activePolicyCode === seg ? 'active' : ''}`}
                    onClick={() => handleSelectSegment(seg)}
                  >
                    {seg}
                  </button>
                ))}
              </div>

              <div className="policy-active-banner">
                <div>
                  <span className="policy-seg-title">
                    {isVi ? activeProfile.labelVi : activeProfile.labelEn}
                  </span>
                  <span className="policy-seg-sku-meta">
                    {activeCellStats.count.toLocaleString(localeStr)} {isVi ? 'SKU' : 'SKUs'} ({activeCellStats.pct}%)
                  </span>
                </div>
                <span className="policy-priority-tag">
                  {isVi ? activeProfile.priorityVi : activeProfile.priorityEn}
                </span>
              </div>

              <p className="policy-desc-text">
                {isVi
                  ? activeProfile.descVi
                  : selectedRecommendation?.segment === activePolicyCode && selectedRecommendation?.description
                  ? selectedRecommendation.description
                  : activeProfile.descEn}
              </p>

              {/* Task FE.9: 4-Card C³-OUT Telemetry Grid */}
              <div className="c3-telemetry-grid">
                <div className="c3-metric-box">
                  <span className="c3-metric-lbl">
                    {isVi ? 'Mục tiêu Phục vụ (τ_g)' : 'Target Setpoint (τ_g)'}
                  </span>
                  <span className="c3-metric-val text-teal">{activeTau.toFixed(1)}%</span>
                </div>
                <div className="c3-metric-box">
                  <span className="c3-metric-lbl">
                    {isVi ? 'Độ sẵn sàng thực tế (Ã_g)' : 'Observed Fill Rate (Ã_g)'}
                  </span>
                  <span
                    className={`c3-metric-val ${
                      activeProfile.observedAvail >= activeTau - 0.5 ? 'text-emerald' : 'text-amber'
                    }`}
                  >
                    {activeProfile.observedAvail.toFixed(1)}%
                  </span>
                </div>
                <div className="c3-metric-box">
                  <span className="c3-metric-lbl">
                    {isVi ? 'Hệ số Đệm C³-OUT (θ_g)' : 'C³-OUT Multiplier (θ_g)'}
                  </span>
                  <span className="c3-metric-val">
                    {activeProfile.theta.toFixed(2)} <small>∈ [0, 2]</small>
                  </span>
                </div>
                <div className="c3-metric-box">
                  <span className="c3-metric-lbl">
                    {isVi ? 'Tham số (m_g, κ_g)' : 'Policy (m_g, κ_g)'}
                  </span>
                  <span className="c3-metric-val">
                    {activeProfile.mParam.toFixed(2)} / {activeProfile.kappaParam.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Policy Specifications (bound to Backend api.classification.getRecommendation) */}
              <div className="policy-spec-box">
                <div className="policy-spec-row">
                  <span className="policy-spec-lbl">
                    {isVi ? 'Chiến lược tồn kho:' : 'Inventory Strategy:'}
                  </span>
                  <span className="policy-spec-val">
                    {selectedRecommendation?.segment === activePolicyCode && selectedRecommendation?.strategy
                      ? selectedRecommendation.strategy
                      : isVi
                      ? activeProfile.strategyVi
                      : activeProfile.strategyEn}
                  </span>
                </div>
                <div className="policy-spec-row">
                  <span className="policy-spec-lbl">
                    {isVi ? 'Chu kỳ rà soát:' : 'Review Cycle:'}
                  </span>
                  <span className="policy-spec-val">
                    {selectedRecommendation?.segment === activePolicyCode && selectedRecommendation?.review_frequency
                      ? selectedRecommendation.review_frequency
                      : isVi
                      ? activeProfile.reviewFreqVi
                      : activeProfile.reviewFreqEn}
                  </span>
                </div>
                <div className="policy-spec-row">
                  <span className="policy-spec-lbl">
                    {isVi ? 'Công thức (R, s, S):' : 'Replenishment Rule:'}
                  </span>
                  <code className="policy-spec-code">
                    {selectedRecommendation?.segment === activePolicyCode && selectedRecommendation?.replenishment_policy
                      ? selectedRecommendation.replenishment_policy
                      : isVi
                      ? activeProfile.repPolicyVi
                      : activeProfile.repPolicyEn}
                  </code>
                </div>
                <div className="policy-spec-row">
                  <span className="policy-spec-lbl">
                    {isVi ? 'Mức đệm an toàn:' : 'Safety Buffer:'}
                  </span>
                  <span className="policy-spec-val">
                    {selectedRecommendation?.segment === activePolicyCode && selectedRecommendation?.safety_stock_policy
                      ? selectedRecommendation.safety_stock_policy
                      : isVi
                      ? activeProfile.bufferPolicyVi
                      : activeProfile.bufferPolicyEn}
                  </span>
                </div>
              </div>

              {/* Task FE.9: One-Sided C³-OUT Update Law Callout */}
              <div className="c3-law-box">
                <div className="c3-law-header">
                  <ShieldCheck size={13} className="text-teal-700" />
                  <span>
                    {isVi
                      ? 'Luật Cập Nhật Phản Hồi Một Phía C³-OUT (One-Sided Update Law)'
                      : 'C³-OUT One-Sided Closed-Loop Update Law'}
                  </span>
                </div>
                <code className="c3-law-formula">
                  θ_&#123;g,k&#125; = clip(θ_&#123;g,k-1&#125; + η · max(0, τ_g - Ã_&#123;g,k-d&#125;), 0, 2)
                </code>
                <div className="c3-law-meta">
                  <span>{isVi ? 'Dải chết (Deadband):' : 'Deadband:'} 0.005 (0.5%)</span>
                  <span>•</span>
                  <span>{isVi ? 'Độ trễ phản hồi:' : 'Feedback Delay:'} d = 2 {isVi ? 'chu kỳ' : 'cycles'}</span>
                  <span>•</span>
                  <span>H = L + R = 10d</span>
                </div>
              </div>

              <button
                type="button"
                className="configure-btn"
                onClick={() => setActiveTab('trajectory')}
                style={{ marginTop: '0.85rem', width: '100%', justifyContent: 'center' }}
              >
                <Activity size={13} style={{ marginRight: '6px' }} />
                {isVi ? `Xem biểu đồ quỹ đạo C³-OUT (${activePolicyCode})` : `Inspect C³-OUT Trajectory (${activePolicyCode})`}
              </button>
            </div>
          </div>
        )}

      {/* TAB 2: C³-OUT CLOSED-LOOP TRAJECTORY */}
      {activeTab === 'trajectory' && (
        <div className="c3-trajectory-panel">
            <div className="c3-trajectory-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Activity size={17} className="text-teal-700" />
                  <h2 className="panel-title" style={{ margin: 0 }}>
                    {isVi
                      ? `Quỹ Đạo Phản Hồi Vòng Kín C³-OUT & Độ Sẵn Sàng Trượt 4 Chu Kỳ — Phân khúc ${activePolicyCode}`
                      : `C³-OUT Closed-Loop Calibration Trajectory & 4-Period Rolling Availability — Segment ${activePolicyCode}`}
                  </h2>
                  <span className="c3-engine-pill">
                    {trajectoryScenario === 'LIVE'
                      ? isVi
                        ? `Dữ Liệu Thực BE (${selectedStore} • ${trajectoryData.length} chu kỳ)`
                        : `Live BE History (${selectedStore} • ${trajectoryData.length} cycles)`
                      : trajectoryScenario === 'SHOCK_E9C'
                      ? isVi
                        ? 'Thử nghiệm E9c: Cú sốc chuyển mô hình tại k=3'
                        : 'Experiment E9c: Model-Switch Shock at k=3'
                      : isVi
                      ? 'Vận hành vòng kín tiêu chuẩn (k=1..8)'
                      : 'Normal Closed-Loop Operation (k=1..8)'}
                  </span>
                </div>
                <p className="panel-subtitle" style={{ marginBottom: 0, marginTop: '0.25rem' }}>
                  {trajectoryScenario === 'LIVE'
                    ? isVi
                      ? `Chuỗi lịch sử chu kỳ thực tế của bộ điều khiển C³-OUT tại kho ${selectedStore} cho phân khúc ${activePolicyCode} (θ_${activePolicyCode} = ${activeProfile.theta.toFixed(2)}, m_${activePolicyCode} = ${activeProfile.mParam.toFixed(2)}×).`
                      : `Persisted closed-loop C³-OUT calibration cycles at ${selectedStore} for segment ${activePolicyCode} (θ_${activePolicyCode} = ${activeProfile.theta.toFixed(2)}, m_${activePolicyCode} = ${activeProfile.mParam.toFixed(2)}×).`
                    : trajectoryScenario === 'SHOCK_E9C'
                    ? isVi
                      ? `Mô phỏng cú sốc chuyển sang mô hình chưa hiệu chuẩn ở chu kỳ k=3 (độ sẵn sàng tụt xuống 89.4%): bộ điều khiển C³-OUT tự động nâng θ_${activePolicyCode},k sau độ trễ d=2 chu kỳ và khôi phục mức phục vụ ≥ 95.2% trong vòng 3 chu kỳ rà soát mà vẫn giữ θ_g ∈ [0, 2].`
                      : `Simulates an uncalibrated model-switch shock at cycle k=3 (availability drops to 89.4%): C³-OUT automatically steps up θ_${activePolicyCode},k after delay d=2 and recovers availability to ≥ 95.2% within 3 review cycles while keeping θ_g bounded in [0, 2].`
                    : isVi
                    ? `Theo dõi độ sẵn sàng trượt 4 chu kỳ (Ã_${activePolicyCode},k %) hội tụ về ngưỡng mục tiêu τ_${activePolicyCode[0]} = ${activeTau.toFixed(1)}% với dải chết 0.5% và tham số hiệu chuẩn θ_${activePolicyCode},k = ${activeProfile.theta.toFixed(2)}.`
                    : `Tracks 4-period rolling availability (Ã_${activePolicyCode},k %) converging to target setpoint τ_${activePolicyCode[0]} = ${activeTau.toFixed(1)}% with 0.5% deadband damping and calibrated multiplier θ_${activePolicyCode},k = ${activeProfile.theta.toFixed(2)}.`}
                </p>
              </div>

              <div className="c3-scenario-controls">
                <button
                  type="button"
                  className={`c3-scenario-btn ${trajectoryScenario === 'LIVE' ? 'active' : ''}`}
                  onClick={() => setTrajectoryScenario('LIVE')}
                >
                  <Activity size={13} />
                  <span>{isVi ? 'Dữ liệu Thực (BE)' : 'Live BE History'}</span>
                </button>
                <button
                  type="button"
                  className={`c3-scenario-btn ${trajectoryScenario === 'NORMAL' ? 'active' : ''}`}
                  onClick={() => setTrajectoryScenario('NORMAL')}
                >
                  <ShieldCheck size={13} />
                  <span>{isVi ? 'Chuẩn Tham Chiếu (k=1..8)' : 'Nominal Benchmark'}</span>
                </button>
                <button
                  type="button"
                  className={`c3-scenario-btn ${trajectoryScenario === 'SHOCK_E9C' ? 'active shock-mode' : ''}`}
                  onClick={() => setTrajectoryScenario('SHOCK_E9C')}
                >
                  <Zap size={13} />
                  <span>
                    {isVi ? 'Sốc Mô Hình (E9c @ k=3)' : 'E9c Shock Benchmark'}
                  </span>
                </button>
              </div>
            </div>

            {/* Summary KPI Strip for Trajectory */}
            <div className="c3-trajectory-kpi-strip">
              <div className="c3-traj-kpi">
                <span className="c3-traj-kpi-lbl">
                  {isVi ? 'Điểm đặt mục tiêu (Setpoint τ_g)' : 'Target Setpoint (τ_g)'}
                </span>
                <span className="c3-traj-kpi-val text-teal">{activeTau.toFixed(1)}%</span>
              </div>
              <div className="c3-traj-kpi">
                <span className="c3-traj-kpi-lbl">
                  {trajectoryScenario === 'SHOCK_E9C'
                    ? isVi
                      ? 'Đáy cú sốc tại Chu kỳ k=3'
                      : 'Shock Trough (k=3)'
                    : trajectoryScenario === 'LIVE'
                    ? isVi
                      ? 'Độ sẵn sàng thấp nhất (Min Ã)'
                      : 'Minimum Observed Ã'
                    : isVi
                    ? 'Độ sẵn sàng Chu kỳ k=1'
                    : 'Initial Availability (k=1)'}
                </span>
                <span className={`c3-traj-kpi-val ${trajectoryScenario === 'SHOCK_E9C' ? 'text-red' : ''}`}>
                  {trajStats.troughAvail.toFixed(1)}%
                </span>
              </div>
              <div className="c3-traj-kpi">
                <span className="c3-traj-kpi-lbl">
                  {trajectoryScenario === 'LIVE'
                    ? isVi
                      ? 'Độ sẵn sàng Chu kỳ gần nhất'
                      : 'Latest Cycle Availability'
                    : isVi
                    ? 'Phục hồi sau 3 chu kỳ (k=6)'
                    : 'Recovery after 3 Cycles (k=6)'}
                </span>
                <span className="c3-traj-kpi-val text-emerald">
                  {trajStats.recoveryAvail.toFixed(1)}%
                </span>
              </div>
              <div className="c3-traj-kpi">
                <span className="c3-traj-kpi-lbl">
                  {isVi ? 'Biên độ Hiệu chuẩn θ_{g,k}' : 'Calibrated Multiplier θ_{g,k}'}
                </span>
                <span className="c3-traj-kpi-val">
                  {trajStats.firstTheta.toFixed(2)} → {trajStats.lastTheta.toFixed(2)} <small>∈ [0, 2]</small>
                </span>
              </div>
            </div>

            {trajectoryScenario === 'LIVE' && trajectoryData.length === 0 ? (
              <div
                style={{
                  padding: '2.25rem 1.5rem',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '6px',
                  backgroundColor: '#f8fafc',
                  textAlign: 'center',
                  marginTop: '0.75rem',
                }}
              >
                <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#475569' }}>
                  {!canManage
                    ? isVi
                      ? 'Lịch sử hiệu chuẩn C³-OUT yêu cầu quyền Warehouse Manager hoặc Admin.'
                      : 'Live C³-OUT calibration history requires Warehouse Manager or Admin access.'
                    : isVi
                    ? `Chưa có bản ghi chu kỳ C³-OUT nào cho kho ${selectedStore} / phân khúc ${activePolicyCode}.`
                    : `No persisted C³-OUT review cycles recorded yet for ${selectedStore} / ${activePolicyCode}.`}
                </p>
                <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {isAdmin && (
                    <button
                      type="button"
                      className="configure-btn primary-action"
                      onClick={handleRunCalibrationStep}
                      disabled={isSteppingCalibration}
                    >
                      <Play size={12} style={{ marginRight: '5px' }} />
                      {isSteppingCalibration
                        ? isVi ? 'Đang chạy J4...' : 'Stepping J4...'
                        : isVi ? 'Chạy bước C³-OUT (J4)' : 'Run C³-OUT Step (J4)'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="configure-btn"
                    onClick={() => setTrajectoryScenario('SHOCK_E9C')}
                  >
                    <Zap size={12} style={{ marginRight: '5px' }} />
                    {isVi ? 'Xem kịch bản tham chiếu E9c' : 'View E9c Reference Simulation'}
                  </button>
                </div>
              </div>
            ) : (
            <>
            {/* Dual-Axis Recharts ComposedChart */}
            <div style={{ width: '100%', height: 295, marginTop: '0.5rem' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trajectoryData} margin={{ top: 12, right: 24, left: 4, bottom: 6 }}>
                  <defs>
                    <linearGradient id="availAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0f766e" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#0f766e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="cycle"
                    tick={{ fontSize: 11, fill: '#475569', fontFamily: "'IBM Plex Mono', monospace" }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    domain={[86, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: '#0f766e', fontFamily: "'IBM Plex Mono', monospace" }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                    label={{
                      value: isVi ? 'Độ sẵn sàng Ã_{g,k} (%)' : 'Rolling Availability Ã_{g,k} (%)',
                      angle: -90,
                      position: 'insideLeft',
                      style: { fontSize: 11, fill: '#0f766e', fontWeight: 600 },
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 2.0]}
                    tickFormatter={(v) => Number(v).toFixed(2)}
                    tick={{ fontSize: 11, fill: '#d97706', fontFamily: "'IBM Plex Mono', monospace" }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                    label={{
                      value: isVi ? 'Hệ số C³-OUT θ_{g,k} ∈ [0, 2]' : 'C³-OUT Parameter θ_{g,k} ∈ [0, 2]',
                      angle: 90,
                      position: 'insideRight',
                      style: { fontSize: 11, fill: '#d97706', fontWeight: 600 },
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontFamily: "'IBM Plex Mono', monospace",
                      boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
                    }}
                    formatter={(value: any, name: any) => {
                      const num = Number(value);
                      if (String(name).includes('θ') || String(name).includes('Multiplier')) {
                        return [num.toFixed(2), name];
                      }
                      return [`${num.toFixed(1)}%`, name];
                    }}
                    labelFormatter={(label, payload) => {
                      const p = payload && payload[0]?.payload;
                      return p ? `${label} — ${p.phase}` : label;
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '6px' }} />

                  {/* Target Setpoint Reference Line */}
                  <ReferenceLine
                    yAxisId="left"
                    y={activeTau}
                    stroke="#0f172a"
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                    label={{
                      value: isVi
                        ? `Mục tiêu τ_${activePolicyCode[0]} = ${activeTau.toFixed(1)}%`
                        : `Target Setpoint τ_${activePolicyCode[0]} = ${activeTau.toFixed(1)}%`,
                      position: 'insideTopLeft',
                      fill: '#0f172a',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  />

                  {/* Rolling Availability Area + Line */}
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="availability"
                    name={
                      isVi
                        ? `Độ sẵn sàng trượt 4 chu kỳ (Ã_${activePolicyCode},k %)`
                        : `4-Period Rolling Availability (Ã_${activePolicyCode},k %)`
                    }
                    stroke="#0f766e"
                    strokeWidth={2.5}
                    fill="url(#availAreaGrad)"
                    activeDot={{ r: 5, fill: '#0f766e', stroke: '#ffffff', strokeWidth: 2 }}
                  />

                  {/* C³-OUT Calibration Parameter Line */}
                  <Line
                    yAxisId="right"
                    type="stepAfter"
                    dataKey="theta"
                    name={
                      isVi
                        ? `Tham số hiệu chuẩn C³-OUT (θ_${activePolicyCode},k ∈ [0, 2])`
                        : `C³-OUT Calibration Multiplier (θ_${activePolicyCode},k ∈ [0, 2])`
                    }
                    stroke="#d97706"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#d97706', stroke: '#ffffff', strokeWidth: 1.5 }}
                    activeDot={{ r: 6 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            </>
            )}
          </div>
        )}

      {/* TAB 3: SKU CLASSIFICATION & POLICY REGISTRY */}
      {activeTab === 'registry' && (
        <div className="log-panel">
            <div className="log-header-bar">
              <div>
                <h2 className="log-title" style={{ marginBottom: '2px' }}>
                  {isVi ? 'Danh Mục Phân Loại SKU & Tham Số Tồn Kho' : 'SKU Classification & Policy Registry'}
                </h2>
                <span className="text-xs text-[var(--text-secondary)]">
                  {isVi
                    ? `Hiển thị ${skuList.length} trên tổng số ${totalSkus.toLocaleString(localeStr)} SKU`
                    : `Showing ${skuList.length} of ${totalSkus.toLocaleString(localeStr)} SKUs`}
                  {selectedSegment !== 'All' && (
                    <span>
                      {' '}
                      • {isVi ? 'Phân khúc:' : 'Segment:'} <strong>{selectedSegment}</strong>
                    </span>
                  )}
                  {selectedCategory !== 'All' && (
                    <span>
                      {' '}
                      • {isVi ? 'Ngành hàng:' : 'Category:'} <strong>{selectedCategory}</strong>
                    </span>
                  )}
                  {selectedAbc !== 'All' && (
                    <span>
                      {' '}
                      • ABC: <strong>{isVi ? `Nhóm ${selectedAbc}` : `Class ${selectedAbc}`}</strong>
                    </span>
                  )}
                  {selectedXyz !== 'All' && (
                    <span>
                      {' '}
                      • XYZ: <strong>{isVi ? `Nhóm ${selectedXyz}` : `Class ${selectedXyz}`}</strong>
                    </span>
                  )}
                </span>
              </div>

              {hasActiveFilter && (
                <button
                  type="button"
                  className="configure-btn text-xs"
                  onClick={handleResetFilters}
                  style={{ borderRadius: '4px', padding: '0.35rem 0.75rem', color: '#0f766e', borderColor: '#99f6e4' }}
                >
                  {isVi ? 'Xóa bộ lọc (Xem tất cả 9 ô)' : 'Clear filters (View all 9 cells)'}{' '}
                  <X size={12} className="inline ml-1" />
                </button>
              )}
            </div>

            {/* Filter Dropdowns and Search Bar */}
            <div
              className="abc-filter-row"
              style={{
                display: 'flex',
                gap: '0.75rem',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                marginBottom: '1rem',
              }}
            >
              <div className="abc-filter-item">
                <span className="abc-filter-label">{isVi ? 'PHÂN KHÚC' : 'SEGMENT'}</span>
                <select
                  className="abc-filter-select"
                  value={selectedSegment}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedSegment(val);
                    if (val !== 'All') {
                      setInspectedSegment(val);
                      setSelectedAbc(val[0]);
                      setSelectedXyz(val[1]);
                      api.classification.getRecommendation(val).then(setSelectedRecommendation).catch(() => null);
                    } else {
                      setSelectedAbc('All');
                      setSelectedXyz('All');
                    }
                  }}
                >
                  <option value="All">{isVi ? 'Tất cả phân khúc (9 ô)' : 'All Segments (9 cells)'}</option>
                  {ALL_SEGMENTS.map((seg) => (
                    <option key={seg} value={seg}>
                      {seg} — {isVi ? SEGMENT_C3_PROFILES[seg].labelVi.split('—')[1]?.trim() : SEGMENT_C3_PROFILES[seg].labelEn.split('—')[1]?.trim()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="abc-filter-item">
                <span className="abc-filter-label">{isVi ? 'NGÀNH HÀNG' : 'CATEGORY'}</span>
                <select
                  className="abc-filter-select"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="All">{isVi ? 'Tất cả ngành hàng' : 'All Categories'}</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="abc-filter-item">
                <span className="abc-filter-label">{isVi ? 'NHÓM ABC' : 'ABC CLASS'}</span>
                <select
                  className="abc-filter-select"
                  value={selectedAbc}
                  onChange={(e) => {
                    const nextAbc = e.target.value;
                    setSelectedAbc(nextAbc);
                    if (nextAbc !== 'All' && selectedXyz !== 'All') {
                      const nextSeg = `${nextAbc}${selectedXyz}`;
                      setSelectedSegment(nextSeg);
                      setInspectedSegment(nextSeg);
                    } else {
                      setSelectedSegment('All');
                    }
                  }}
                >
                  <option value="All">{isVi ? 'Tất cả (A, B, C)' : 'All (A, B, C)'}</option>
                  <option value="A">{isVi ? 'Nhóm A (Top Doanh thu)' : 'Class A (Top Revenue)'}</option>
                  <option value="B">{isVi ? 'Nhóm B (Doanh thu Trung bình)' : 'Class B (Mid Revenue)'}</option>
                  <option value="C">{isVi ? 'Nhóm C (Doanh thu Thấp)' : 'Class C (Low Revenue)'}</option>
                </select>
              </div>

              <div className="abc-filter-item">
                <span className="abc-filter-label">{isVi ? 'NHÓM XYZ' : 'XYZ CLASS'}</span>
                <select
                  className="abc-filter-select"
                  value={selectedXyz}
                  onChange={(e) => {
                    const nextXyz = e.target.value;
                    setSelectedXyz(nextXyz);
                    if (selectedAbc !== 'All' && nextXyz !== 'All') {
                      const nextSeg = `${selectedAbc}${nextXyz}`;
                      setSelectedSegment(nextSeg);
                      setInspectedSegment(nextSeg);
                    } else {
                      setSelectedSegment('All');
                    }
                  }}
                >
                  <option value="All">{isVi ? 'Tất cả (X, Y, Z)' : 'All (X, Y, Z)'}</option>
                  <option value="X">{isVi ? 'Nhóm X (Nhu cầu ổn định)' : 'Class X (Stable Demand)'}</option>
                  <option value="Y">{isVi ? 'Nhóm Y (Biến động vừa)' : 'Class Y (Moderate Volatility)'}</option>
                  <option value="Z">{isVi ? 'Nhóm Z (Biến động cao)' : 'Class Z (High Volatility)'}</option>
                </select>
              </div>

              <div className="abc-filter-item">
                <span className="abc-filter-label">{isVi ? 'SẮP XẾP THEO' : 'SORT BY'}</span>
                <select
                  className="abc-filter-select"
                  value={`${sortBy}_${sortOrder}`}
                  onChange={(e) => {
                    const lastUnderscore = e.target.value.lastIndexOf('_');
                    const col = e.target.value.slice(0, lastUnderscore);
                    const ord = e.target.value.slice(lastUnderscore + 1);
                    setSortBy(col);
                    setSortOrder(ord as 'asc' | 'desc');
                  }}
                >
                  <option value="revenue_desc">{isVi ? 'Doanh thu cao nhất' : 'Highest Revenue'}</option>
                  <option value="revenue_asc">{isVi ? 'Doanh thu thấp nhất' : 'Lowest Revenue'}</option>
                  <option value="revenue_share_desc">{isVi ? 'Tỷ trọng doanh thu (%)' : 'Revenue Share (%)'}</option>
                  <option value="cv_asc">{isVi ? 'Độ ổn định cao (CV thấp)' : 'Lowest Volatility (Low CV)'}</option>
                  <option value="cv_desc">{isVi ? 'Độ biến động cao (CV cao)' : 'Highest Volatility (High CV)'}</option>
                  <option value="mean_demand_desc">{isVi ? 'Nhu cầu bình quân cao' : 'Highest Mean Demand'}</option>
                  <option value="item_id_asc">{isVi ? 'Mã SKU (A–Z)' : 'SKU Code (A–Z)'}</option>
                </select>
              </div>

              <div className="abc-filter-item" style={{ flex: 1, minWidth: '220px' }}>
                <span className="abc-filter-label">
                  {isVi ? 'TÌM KIẾM SKU / SẢN PHẨM' : 'SEARCH SKU / PRODUCT'}
                </span>
                <div style={{ position: 'relative' }}>
                  <Search
                    size={14}
                    style={{
                      position: 'absolute',
                      left: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#94a3b8',
                    }}
                  />
                  <input
                    type="text"
                    placeholder={
                      isVi ? 'Tìm theo mã SKU hoặc tên sản phẩm...' : 'Search by SKU code or product name...'
                    }
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="abc-filter-input"
                    style={{ paddingLeft: '32px', width: '100%', height: '36px' }}
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#94a3b8',
                      }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* SKU Table */}
            <div className="log-table-container">
              <div className="log-table">
                <div className="log-header-row">
                  <div className="log-col-header" style={{ width: '16%' }}>
                    {isVi ? 'MÃ SKU' : 'SKU ID'}
                  </div>
                  <div className="log-col-header" style={{ width: '24%' }}>
                    {isVi ? 'TÊN SẢN PHẨM' : 'PRODUCT NAME'}
                  </div>
                  <div className="log-col-header" style={{ width: '10%' }}>
                    {isVi ? 'NHÓM ABC' : 'CLASS ABC'}
                  </div>
                  <div className="log-col-header" style={{ width: '10%' }}>
                    {isVi ? 'NHÓM XYZ' : 'CLASS XYZ'}
                  </div>
                  <div className="log-col-header" style={{ width: '10%' }}>
                    {isVi ? 'PHÂN KHÚC' : 'SEGMENT'}
                  </div>
                  <div className="log-col-header" style={{ width: '10%' }}>
                    {isVi ? 'MỤC TIÊU τ / θ_g' : 'TARGET τ / θ_g'}
                  </div>
                  <div className="log-col-header" style={{ width: '10%' }}>
                    {isVi ? 'DOANH THU' : 'REVENUE'}
                  </div>
                  <div className="log-col-header" style={{ width: '10%' }}>
                    {isVi ? 'HỆ SỐ CV' : 'DEMAND CV'}
                  </div>
                </div>

                <div>
                  {isLoadingSkus ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                      <RefreshCw size={16} className="animate-spin inline mr-2 text-teal-600" />
                      {isVi ? 'Đang lọc danh sách SKU...' : 'Filtering SKU list...'}
                    </div>
                  ) : skuList.length === 0 ? (
                    <div style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8' }}>
                      {hasActiveFilter
                        ? isVi
                          ? 'Không có SKU nào khớp với bộ lọc đã chọn.'
                          : 'No SKUs matched the selected filter criteria.'
                        : isVi
                        ? 'Chưa có bản ghi phân loại SKU. Nhấp "Tính lại Ma trận" ở trên để khởi chạy.'
                        : 'No SKU classification records found. Click "Recompute Matrix" to evaluate.'}
                    </div>
                  ) : (
                    skuList.map((row: any, idx: number) => {
                      const segCode = row.segment || `${row.abc || 'A'}${row.xyz || 'X'}`;
                      const segProf = getEffectiveProfile(segCode);
                      const segTau = getSegmentTau(segCode);

                      return (
                        <div className="log-row" key={row.id || row.item_id || idx}>
                          <div
                            className="fw-700"
                            style={{ width: '16%', fontFamily: "'IBM Plex Mono', monospace", color: '#0f172a' }}
                          >
                            {row.item_id}
                          </div>
                          <div
                            className="text-secondary"
                            style={{
                              width: '24%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              paddingRight: '0.5rem',
                            }}
                          >
                            {row.product_name || row.item_id}
                          </div>
                          <div style={{ width: '10%' }}>
                            <span
                              className={
                                row.abc === 'A'
                                  ? 'text-class-a font-bold'
                                  : row.abc === 'B'
                                  ? 'text-class-b font-bold'
                                  : 'text-class-c'
                              }
                            >
                              {isVi ? `Nhóm ${row.abc}` : `Class ${row.abc}`}
                            </span>
                          </div>
                          <div style={{ width: '10%' }}>
                            <span
                              className={
                                row.xyz === 'X'
                                  ? 'text-class-a font-bold'
                                  : row.xyz === 'Y'
                                  ? 'text-class-b font-bold'
                                  : 'text-class-c'
                              }
                            >
                              {isVi ? `Nhóm ${row.xyz}` : `Class ${row.xyz}`}
                            </span>
                          </div>
                          <div style={{ width: '10%' }}>
                            <span
                              className={`segment-tag ${
                                segCode.startsWith('A') ? 'tag-a' : segCode.startsWith('B') ? 'tag-b' : 'tag-c'
                              }`}
                            >
                              {segCode}
                            </span>
                          </div>
                          <div
                            style={{
                              width: '10%',
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: '0.72rem',
                              color: '#0f766e',
                              fontWeight: 600,
                            }}
                          >
                            {segTau.toFixed(0)}% / θ={segProf.theta.toFixed(2)}
                          </div>
                          <div
                            style={{
                              width: '10%',
                              fontWeight: 600,
                              color: '#0f172a',
                              fontFamily: "'IBM Plex Mono', monospace",
                            }}
                          >
                            ${typeof row.revenue === 'number' ? row.revenue.toLocaleString(localeStr) : row.revenue}
                          </div>
                          <div
                            style={{
                              width: '10%',
                              color: '#64748b',
                              fontFamily: "'IBM Plex Mono', monospace",
                            }}
                          >
                            {typeof row.cv === 'number' ? row.cv.toFixed(2) : row.cv}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {totalSkus > 0 && (
              <Pagination
                currentPage={skuPage}
                totalItems={totalSkus}
                pageSize={skuPageSize}
                onPageChange={setSkuPage}
                onPageSizeChange={(newSize) => {
                  setSkuPageSize(newSize);
                  setSkuPage(1);
                }}
                pageSizeOptions={[10, 15, 25, 50]}
              />
            )}
          </div>
        )}

          {/* Threshold Configuration Modal */}
          {isConfigOpen &&
            createPortal(
              <div className="config-modal-overlay" onClick={() => !isSavingThresholds && setIsConfigOpen(false)}>
                <div className="config-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 className="modal-title" style={{ fontSize: '1.125rem', margin: 0 }}>
                        {isVi ? 'Cấu Hình Ngưỡng Phân Loại ABC/XYZ' : 'Configure ABC/XYZ Classification Thresholds'}
                      </h3>
                      <p className="modal-subtitle" style={{ margin: '0.2rem 0 0 0' }}>
                        {isVi
                          ? 'Điều chỉnh tỷ trọng doanh thu Pareto (A/B/C) và hệ số biến thiên cầu (X/Y/Z).'
                          : 'Adjust cumulative revenue Pareto cutoffs (A/B/C) and demand CV boundaries (X/Y/Z).'}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="reset-btn"
                      onClick={() => !isSavingThresholds && setIsConfigOpen(false)}
                      disabled={isSavingThresholds}
                      style={{ padding: '0.35rem' }}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <form onSubmit={handleSaveThresholds}>
                    <div className="modal-body" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
                      {!isAdmin && (
                        <div
                          className="p-3 mb-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded"
                          style={{ borderRadius: '4px' }}
                        >
                          {isVi
                            ? 'Chế độ chỉ xem: Chỉ tài khoản Quản trị viên (Admin) mới có quyền cập nhật ngưỡng phân loại hệ thống.'
                            : 'View-only mode: Only Administrator accounts have permission to update system classification thresholds.'}
                        </div>
                      )}

                      {configMessage && (
                        <div
                          style={{
                            marginBottom: '1rem',
                            padding: '0.625rem 0.75rem',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '12px',
                            backgroundColor: configMessage.isError ? '#fef2f2' : '#ecfdf5',
                            color: configMessage.isError ? '#b91c1c' : '#047857',
                            border: `1px solid ${configMessage.isError ? '#fecaca' : '#a7f3d0'}`,
                          }}
                        >
                          {configMessage.isError ? (
                            <AlertCircle size={15} style={{ flexShrink: 0 }} />
                          ) : (
                            <Check size={15} style={{ flexShrink: 0 }} />
                          )}
                          <span>{configMessage.text}</span>
                        </div>
                      )}

                      {/* Multi-stage Progress Feedback */}
                      {isSavingThresholds && (
                        <div
                          style={{
                            marginBottom: '1.25rem',
                            padding: '0.75rem',
                            borderRadius: '4px',
                            backgroundColor: '#f0fdfa',
                            border: '1px solid #99f6e4',
                            fontSize: '12px',
                            color: '#0f766e',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontWeight: 600,
                              marginBottom: '6px',
                            }}
                          >
                            <RefreshCw size={13} className="animate-spin" />
                            <span>
                              {isVi
                                ? 'Tiến trình cập nhật ngưỡng & phân loại lại:'
                                : 'Threshold update & reclassification progress:'}
                            </span>
                          </div>
                          <div style={{ paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <span
                              style={{
                                color: saveStage >= 1 ? '#047857' : '#94a3b8',
                                fontWeight: saveStage === 1 ? 600 : 400,
                              }}
                            >
                              {saveStage > 1 ? '✓' : '●'}{' '}
                              {isVi
                                ? 'Giai đoạn 1: Xác thực tham số Cutoff A/B và CV X/Y'
                                : 'Stage 1: Validating Cutoff A/B and CV X/Y parameters'}
                            </span>
                            <span
                              style={{
                                color: saveStage >= 2 ? '#047857' : '#94a3b8',
                                fontWeight: saveStage === 2 ? 600 : 400,
                              }}
                            >
                              {saveStage > 2 ? '✓' : '●'}{' '}
                              {isVi
                                ? 'Giai đoạn 2: Động cơ đang phân loại Pareto doanh thu & CV toàn bộ SKU'
                                : 'Stage 2: Engine evaluating Pareto revenue & demand CV for all SKUs'}
                            </span>
                            <span
                              style={{
                                color: saveStage >= 3 ? '#047857' : '#94a3b8',
                                fontWeight: saveStage === 3 ? 600 : 400,
                              }}
                            >
                              {saveStage === 3 ? '●' : '○'}{' '}
                              {isVi
                                ? 'Giai đoạn 3: Đồng bộ ma trận 3x3 và danh mục SKU'
                                : 'Stage 3: Syncing 3x3 matrix and SKU classification catalog'}
                            </span>
                          </div>
                        </div>
                      )}

                      <h4 className="threshold-section-title" style={{ marginTop: 0 }}>
                        {isVi
                          ? 'Ngưỡng Pareto Doanh Thu Tích Lũy (ABC Cutoffs)'
                          : 'Cumulative Revenue Pareto Thresholds (ABC Cutoffs)'}
                      </h4>
                      <div className="mb-4">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {isVi ? 'Ngưỡng tích lũy nhóm A (Class A Cutoff %):' : 'Cumulative Class A Cutoff (%):'}
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="1"
                          max="99"
                          required
                          disabled={!isAdmin || isSavingThresholds}
                          className="abc-filter-input w-full"
                          value={formThresholds.a_cutoff}
                          onChange={(e) =>
                            setFormThresholds({ ...formThresholds, a_cutoff: parseFloat(e.target.value) || 0 })
                          }
                        />
                        <span className="text-[11px] text-slate-500 mt-1 block">
                          {isVi
                            ? 'Chiếm tỷ trọng doanh thu cao nhất (Mặc định: 80%)'
                            : 'Generates top revenue volume (Default: 80%)'}
                        </span>
                      </div>

                      <div className="mb-4">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {isVi ? 'Ngưỡng tích lũy nhóm B (Class B Cutoff %):' : 'Cumulative Class B Cutoff (%):'}
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="1"
                          max="99.9"
                          required
                          disabled={!isAdmin || isSavingThresholds}
                          className="abc-filter-input w-full"
                          value={formThresholds.b_cutoff}
                          onChange={(e) =>
                            setFormThresholds({ ...formThresholds, b_cutoff: parseFloat(e.target.value) || 0 })
                          }
                        />
                        <span className="text-[11px] text-slate-500 mt-1 block">
                          {isVi
                            ? 'Tầng doanh thu tiếp theo (Mặc định: 95%). Phần còn lại đến 100% thuộc nhóm C.'
                            : 'Next revenue tier (Default: 95%). Remaining up to 100% belongs to Class C.'}
                        </span>
                      </div>

                      <h4 className="threshold-section-title mt-6">
                        {isVi
                          ? 'Ngưỡng Biến Thiên Nhu Cầu (XYZ CV Cutoffs)'
                          : 'Demand Volatility Thresholds (XYZ CV Cutoffs)'}
                      </h4>
                      <div className="mb-4">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {isVi ? 'Ngưỡng hệ số biến thiên nhóm X (Max CV):' : 'Class X Maximum CoV Threshold:'}
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min="0.01"
                          max="5"
                          required
                          disabled={!isAdmin || isSavingThresholds}
                          className="abc-filter-input w-full"
                          value={formThresholds.cv_x}
                          onChange={(e) =>
                            setFormThresholds({ ...formThresholds, cv_x: parseFloat(e.target.value) || 0 })
                          }
                        />
                        <span className="text-[11px] text-slate-500 mt-1 block">
                          {isVi
                            ? 'Nhu cầu ổn định, dễ dự báo: CV ≤ ngưỡng này (Mặc định: 0.5)'
                            : 'Stable, predictable demand: CoV ≤ threshold (Default: 0.5)'}
                        </span>
                      </div>

                      <div className="mb-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {isVi ? 'Ngưỡng hệ số biến thiên nhóm Y (Max CV):' : 'Class Y Maximum CoV Threshold:'}
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min="0.01"
                          max="10"
                          required
                          disabled={!isAdmin || isSavingThresholds}
                          className="abc-filter-input w-full"
                          value={formThresholds.cv_y}
                          onChange={(e) =>
                            setFormThresholds({ ...formThresholds, cv_y: parseFloat(e.target.value) || 0 })
                          }
                        />
                        <span className="text-[11px] text-slate-500 mt-1 block">
                          {isVi
                            ? 'Biến động vừa: cv_x < CV ≤ cv_y (Mặc định: 1.0). Lớn hơn thuộc nhóm Z.'
                            : 'Moderate variability: cv_x < CoV ≤ cv_y (Default: 1.0). Greater belongs to Class Z.'}
                        </span>
                      </div>
                    </div>

                    <div className="modal-footer">
                      <div className="modal-actions">
                        <button
                          type="button"
                          className="reset-btn"
                          onClick={() => setIsConfigOpen(false)}
                          disabled={isSavingThresholds}
                        >
                          {isVi ? 'Đóng' : 'Close'}
                        </button>
                        {isAdmin && (
                          <button
                            type="submit"
                            disabled={isSavingThresholds}
                            className="apply-btn"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                          >
                            {isSavingThresholds && <RefreshCw size={13} className="animate-spin inline" />}
                            <span>
                              {isSavingThresholds
                                ? isVi
                                  ? 'Đang lưu & tính toán...'
                                  : 'Saving & Recomputing...'
                                : isVi
                                ? 'Lưu & Phân loại lại'
                                : 'Save & Reclassify'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </form>
                </div>
              </div>,
              document.body
            )}

          {/* Floating Toast Notification */}
          {notification && (
            <div
              style={{
                position: 'fixed',
                bottom: '24px',
                right: '24px',
                zIndex: 9999,
                backgroundColor: notification.type === 'error' ? '#dc2626' : '#0f766e',
                color: '#ffffff',
                padding: '12px 20px',
                borderRadius: '6px',
                boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {notification.type === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}
              <span>{notification.message}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
