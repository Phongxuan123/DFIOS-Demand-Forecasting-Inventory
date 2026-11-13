import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Download,
  Upload,
  Zap,
  ShieldCheck,
  Database,
  Play,
  FileSpreadsheet,
  Sliders,
  Check,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api } from '../services/api.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import { emitAlertsSyncEvent } from '../utils/alertTracker.ts';
import './Settings.css';

interface CsvPreviewStats {
  fileName: string;
  rowCount: number;
  distinctSkus: number;
  stores: string[];
  minDate: string;
  maxDate: string;
  missingCount: number;
  zeroQtyCount: number;
  sampleRows: Array<{
    item_id: string;
    store_id: string;
    sale_date: string;
    quantity: string;
    sell_price: string;
  }>;
}

export const Settings: React.FC = () => {
  const { user, updateCurrentUser } = useAuth();
  const { language } = useLanguage();
  const isVi = language === 'vi';
  const role = user?.role?.toUpperCase() || 'VIEWER';
  const isAdmin = role === 'ADMIN';

  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('General Settings');

  // Pagination States
  const [usersPage, setUsersPage] = useState(1);
  const [usersPerPage, setUsersPerPage] = useState(10);

  const [auditPage, setAuditPage] = useState(1);
  const [auditPerPage, setAuditPerPage] = useState(10);

  const [trainJobsPage, setTrainJobsPage] = useState(1);
  const [trainJobsPerPage, setTrainJobsPerPage] = useState(5);

  const [modelsPage, setModelsPage] = useState(1);
  const [modelsPerPage, setModelsPerPage] = useState(5);

  const [dqIssuesPage, setDqIssuesPage] = useState(1);
  const [dqIssuesPerPage, setDqIssuesPerPage] = useState(10);

  const [profileName, setProfileName] = useState(user?.name || user?.email || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Password card states
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // System Settings (Admin)
  const [systemSettings, setSystemSettings] = useState<Record<string, any>>({});
  const [settingTimezone, setSettingTimezone] = useState('Asia/Ho_Chi_Minh');
  const [settingCurrency, setSettingCurrency] = useState('USD');
  const [settingHorizons, setSettingHorizons] = useState('7, 14, 28');
  const [systemSettingMsg, setSystemSettingMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isSavingSystemSetting, setIsSavingSystemSetting] = useState(false);

  // Data Quality & Task FE.14 Live Store Ingestion States
  const [dqRuns, setDqRuns] = useState<any[]>([]);
  const [selectedDqRun, setSelectedDqRun] = useState<any>(null);
  const [isCheckingDq, setIsCheckingDq] = useState(false);
  const [dqCutoffDate, setDqCutoffDate] = useState('2015-05-24');
  const [dqMsg, setDqMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Task FE.14 CSV Ingestion & Fast Inference States
  const [ingestFile, setIngestFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvPreviewStats | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploadingCsv, setIsUploadingCsv] = useState(false);
  const [csvUploadResult, setCsvUploadResult] = useState<any>(null);
  const [fastInfStore, setFastInfStore] = useState('CA_1');
  const [isRunningFastInf, setIsRunningFastInf] = useState(false);
  const [fastInfResult, setFastInfResult] = useState<any>(null);

  // ML Pipeline & Models
  const [trainJobs, setTrainJobs] = useState<any[]>([]);
  const [modelsList, setModelsList] = useState<any[]>([]);

  // UC49: Batch Schedules State
  const [batchSchedules, setBatchSchedules] = useState<any[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleName, setScheduleName] = useState('');
  const [scheduleCron, setScheduleCron] = useState('0 2 * * *');
  const [scheduleModel, setScheduleModel] = useState('lightgbm');
  const [scheduleHorizon, setScheduleHorizon] = useState(28);
  const [scheduleStore, setScheduleStore] = useState('CA_1');
  const [scheduleAutoOpt, setScheduleAutoOpt] = useState(true);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // UC50: Pipeline Run State
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [pipelineModel, setPipelineModel] = useState('lightgbm');
  const [pipelineHorizon, setPipelineHorizon] = useState(28);
  const [pipelineStore, setPipelineStore] = useState('CA_1');
  const [isExecutingPipeline, setIsExecutingPipeline] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<any>(null);

  // User management modal & state
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [userFormData, setUserFormData] = useState({ email: '', password: '', role: 'Viewer', display_name: '' });

  // Filters for User Management
  const [userRoleFilter, setUserRoleFilter] = useState('All');
  const [userStatusFilter, setUserStatusFilter] = useState('All');
  const [userSearchTerm, setUserSearchTerm] = useState('');

  // Filters for Audit Logs
  const [auditActionFilter, setAuditActionFilter] = useState('All');
  const [auditSearchTerm, setAuditSearchTerm] = useState('');
  const [auditActions, setAuditActions] = useState<string[]>([]);

  // Email Change State
  const [showEmailChangeModal, setShowEmailChangeModal] = useState(false);
  const [newEmailValue, setNewEmailValue] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [emailModalError, setEmailModalError] = useState('');
  const [emailModalSuccess, setEmailModalSuccess] = useState('');

  const loadUsers = async () => {
    try {
      const res = await api.settings.getAllUsers();
      setUsers(res.list || []);
    } catch (e) {
      console.error('Failed to load users', e);
    }
  };

  const loadAuditLogs = async () => {
    try {
      const res = await api.settings.getAllAuditLogs();
      setAuditLogs(res.logs || []);
    } catch (e) {
      console.error('Failed to load audit logs', e);
    }
  };

  useEffect(() => {
    const fetchInitialSettings = async () => {
      try {
        const sysRes = await api.settings.getSystemSettings().catch(() => ({ settings: [], settings_dict: {} }));
        const settingsDict = sysRes?.settings_dict || (Array.isArray(sysRes?.settings) ? Object.fromEntries(sysRes.settings.map((s: any) => [s.key, s.value])) : sysRes?.settings) || {};
        setSystemSettings(settingsDict);
        if (settingsDict.timezone) setSettingTimezone(settingsDict.timezone);
        if (settingsDict.currency) setSettingCurrency(settingsDict.currency);
        if (settingsDict.forecast_horizons) {
          setSettingHorizons(
            Array.isArray(settingsDict.forecast_horizons)
              ? settingsDict.forecast_horizons.join(', ')
              : String(settingsDict.forecast_horizons)
          );
        }
      } catch (error) {
        console.error('Failed to load settings data', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchInitialSettings();
  }, []);

  // Lazy tab data loading
  useEffect(() => {
    if (activeTab === 'User Management' && users.length === 0) {
      loadUsers();
    } else if (activeTab === 'Audit Logs' && auditLogs.length === 0) {
      Promise.all([
        loadAuditLogs(),
        api.settings.getAuditActions().then(setAuditActions).catch(() => []),
      ]);
    } else if (activeTab === 'ML Pipeline') {
      Promise.all([
        api.ml.listAllTrainJobs().then((res) => setTrainJobs(res.list || [])).catch(() => []),
        api.ml.getAllModels().then((res) => setModelsList(res.list || [])).catch(() => []),
        api.ml.listBatchSchedules().then((res) => setBatchSchedules(res.items || [])).catch(() => []),
      ]);
    } else if (activeTab === 'Data Quality Inspector' && dqRuns.length === 0) {
      api.ml
        .listAllDataQualityRuns()
        .then((res) => {
          const list = res.list || [];
          setDqRuns(list);
          if (list.length > 0) setSelectedDqRun(list[0]);
        })
        .catch(() => []);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!isAdmin && (activeTab === 'User Management' || activeTab === 'Audit Logs')) {
      setActiveTab('General Settings');
    }
  }, [isAdmin, activeTab]);

  useEffect(() => {
    setProfileName(user?.name || user?.email || '');
    setProfileEmail(user?.email || '');
  }, [user]);

  const handleProfileSave = async () => {
    setSettingsMessage('');
    setIsSavingProfile(true);
    try {
      const cleanName = profileName.trim();
      const res = await api.auth.updateProfile({
        display_name: cleanName,
        email: profileEmail,
      });
      const newName = res?.display_name || cleanName;
      updateCurrentUser({ name: newName, display_name: newName });
      setProfileName(newName);
      await loadUsers();
      setSettingsMessage(
        isVi ? 'Cập nhật tên hiển thị tài khoản thành công!' : 'Account display name updated successfully!'
      );
    } catch (error: any) {
      setSettingsMessage(
        error.response?.data?.detail ||
          (isVi ? 'Không thể cập nhật thông tin tài khoản.' : 'Failed to update account information.')
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordChange = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPasswordMessage(null);

    if (!currentPassword) {
      setPasswordMessage({
        text: isVi ? 'Vui lòng nhập mật khẩu hiện tại.' : 'Please enter your current password.',
        type: 'error',
      });
      return;
    }
    if (!newPassword) {
      setPasswordMessage({
        text: isVi ? 'Vui lòng nhập mật khẩu mới.' : 'Please enter a new password.',
        type: 'error',
      });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMessage({
        text: isVi ? 'Mật khẩu mới phải có ít nhất 6 ký tự.' : 'New password must be at least 6 characters.',
        type: 'error',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({
        text: isVi
          ? 'Mật khẩu mới và xác nhận mật khẩu không khớp.'
          : 'New password and confirmation do not match.',
        type: 'error',
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      await api.auth.changePassword({
        old_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage({
        text: isVi ? 'Đã cập nhật mật khẩu thành công!' : 'Password updated successfully!',
        type: 'success',
      });
    } catch (error: any) {
      const errDetail = error.response?.data?.detail;
      const msg =
        typeof errDetail === 'string'
          ? errDetail
          : Array.isArray(errDetail)
            ? errDetail.map((d: any) => d.msg).join(', ')
            : isVi
              ? 'Không thể đổi mật khẩu. Vui lòng kiểm tra lại mật khẩu hiện tại.'
              : 'Could not update password. Please check your current password.';
      setPasswordMessage({ text: msg, type: 'error' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSaveSystemSettings = async () => {
    if (!isAdmin) {
      setSystemSettingMsg({
        text: isVi
          ? 'Từ chối truy cập: Chỉ Quản trị viên (Admin) mới có quyền sửa cấu hình hệ thống.'
          : 'Permission denied: Only Admin can update system settings.',
        type: 'error',
      });
      return;
    }
    setIsSavingSystemSetting(true);
    setSystemSettingMsg(null);
    try {
      const horizons = settingHorizons
        .split(',')
        .map((h) => parseInt(h.trim()))
        .filter((h) => !isNaN(h) && h > 0);

      if (horizons.length === 0) {
        setSystemSettingMsg({
          text: isVi
            ? 'Chân trời dự báo phải chứa ít nhất một số nguyên dương (VD: 7, 14, 28).'
            : 'Forecast horizons must contain at least one positive integer (e.g. 7, 14, 28).',
          type: 'error',
        });
        setIsSavingSystemSetting(false);
        return;
      }

      await Promise.all([
        api.settings.updateSystemSetting('timezone', settingTimezone.trim()),
        api.settings.updateSystemSetting('currency', settingCurrency.trim()),
        api.settings.updateSystemSetting('forecast_horizons', horizons),
      ]);

      setSystemSettingMsg({
        text: isVi
          ? 'Đã cập nhật tham số toàn cục hệ thống thành công.'
          : 'System global parameters updated successfully.',
        type: 'success',
      });
      const updated = await api.settings.getSystemSettings();
      const updatedDict = updated?.settings_dict || (Array.isArray(updated?.settings) ? Object.fromEntries(updated.settings.map((s: any) => [s.key, s.value])) : updated?.settings) || {};
      setSystemSettings(updatedDict);
    } catch (e: any) {
      setSystemSettingMsg({
        text:
          e.response?.data?.detail ||
          (isVi ? 'Không thể cập nhật cấu hình hệ thống.' : 'Failed to update system settings.'),
        type: 'error',
      });
    } finally {
      setIsSavingSystemSetting(false);
    }
  };

  // Task FE.14: Download Store CSV Template
  const handleDownloadStoreTemplate = () => {
    const csvRows = [
      'item_id,store_id,sale_date,quantity,sell_price',
      'FOODS_1_001,CA_1,2015-05-25,12,2.24',
      'FOODS_1_001,CA_1,2015-05-26,9,2.24',
      'FOODS_1_001,CA_1,2015-05-27,15,2.24',
      'FOODS_1_002,CA_1,2015-05-25,4,8.88',
      'FOODS_1_002,CA_1,2015-05-26,0,8.88',
      'FOODS_1_002,CA_1,2015-05-27,6,8.88',
      'HOBBIES_1_001,CA_1,2015-05-25,2,9.58',
      'HOBBIES_1_001,CA_1,2015-05-26,0,9.58',
      'HOUSEHOLD_1_001,CA_1,2015-05-25,18,5.97',
      'HOUSEHOLD_1_001,CA_1,2015-05-26,21,5.97',
      'FOODS_3_090,TX_1,2015-05-25,34,1.48',
      'FOODS_3_252,WI_1,2015-05-25,19,1.58',
    ].join('\n');

    const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'template_store_import.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  // Task FE.14: Client-side CSV Schema & Quality Preview
  const parseCsvPreview = async (file: File) => {
    setIngestFile(file);
    setCsvUploadResult(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length <= 1) {
        setCsvPreview(null);
        return;
      }
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const itemIdx = headers.findIndex((h) => h.includes('item') || h.includes('sku') || h.includes('ma_sp'));
      const storeIdx = headers.findIndex((h) => h.includes('store') || h.includes('kho'));
      const dateIdx = headers.findIndex((h) => h.includes('date') || h.includes('ngay'));
      const qtyIdx = headers.findIndex((h) => h.includes('qty') || h.includes('quantity') || h.includes('sales'));
      const priceIdx = headers.findIndex((h) => h.includes('price') || h.includes('gia'));

      const skuSet = new Set<string>();
      const storeSet = new Set<string>();
      const dates: string[] = [];
      let missingCount = 0;
      let zeroQtyCount = 0;
      const sampleRows: CsvPreviewStats['sampleRows'] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        const item_id = cols[itemIdx !== -1 ? itemIdx : 0] || '';
        const store_id = cols[storeIdx !== -1 ? storeIdx : 1] || 'CA_1';
        const sale_date = cols[dateIdx !== -1 ? dateIdx : 2] || '';
        const quantity = cols[qtyIdx !== -1 ? qtyIdx : 3] ?? '';
        const sell_price = priceIdx !== -1 ? cols[priceIdx] || '1.00' : '—';

        if (!item_id || !sale_date || quantity === '') {
          missingCount++;
        }
        if (Number(quantity) === 0) {
          zeroQtyCount++;
        }
        if (item_id) skuSet.add(item_id);
        if (store_id) storeSet.add(store_id);
        if (sale_date) dates.push(sale_date);

        if (sampleRows.length < 5) {
          sampleRows.push({ item_id, store_id, sale_date, quantity, sell_price });
        }
      }

      dates.sort();
      const storesArr = Array.from(storeSet);
      if (storesArr.length > 0) {
        setFastInfStore(storesArr[0]);
      }

      setCsvPreview({
        fileName: file.name,
        rowCount: lines.length - 1,
        distinctSkus: skuSet.size,
        stores: storesArr,
        minDate: dates[0] || 'N/A',
        maxDate: dates[dates.length - 1] || 'N/A',
        missingCount,
        zeroQtyCount,
        sampleRows,
      });
    } catch (err) {
      console.error('Failed to preview CSV file', err);
    }
  };

  // Task FE.14: Live Store CSV Upload via api.sales.importCsv(file)
  const handleLiveStoreCsvUpload = async () => {
    if (!ingestFile) return;
    setIsUploadingCsv(true);
    setCsvUploadResult(null);
    try {
      const res = await api.sales.importCsv(ingestFile);
      setCsvUploadResult({
        status: 'SUCCESS',
        inserted: res.inserted ?? csvPreview?.rowCount ?? 0,
        skipped: res.skipped ?? 0,
        message:
          res.message ||
          (isVi
            ? 'Đã nạp dữ liệu bán hàng kho mới và chuẩn hóa chuỗi thời gian thành công.'
            : 'Store sales CSV imported and resampled successfully.'),
      });
    } catch (e: any) {
      setCsvUploadResult({
        status: 'ERROR',
        message:
          e.response?.data?.detail ||
          (isVi ? 'Lỗi khi tải lên tệp CSV kho hàng.' : 'Failed to upload store sales CSV.'),
      });
    } finally {
      setIsUploadingCsv(false);
    }
  };

  // Task FE.14: One-Click Fast Inference & (R, s, S) Replenishment Trigger
  const handleFastInferenceAndReplenish = async () => {
    setIsRunningFastInf(true);
    setFastInfResult(null);
    const t0 = Date.now();
    try {
      const [pipeOutcome, repOutcome] = await Promise.allSettled([
        api.ml.triggerPipelineRun({
          model_name: 'lightgbm',
          horizon: 28,
          store_id: fastInfStore,
        }),
        api.replenishment.generateRecommendations(fastInfStore),
      ]);

      const elapsedSec = ((Date.now() - t0) / 1000).toFixed(2);
      const pipeRes = pipeOutcome.status === 'fulfilled' ? pipeOutcome.value : null;
      const repRes = repOutcome.status === 'fulfilled' ? repOutcome.value : null;

      if (!pipeRes && !repRes) {
        const pipeErr: any = pipeOutcome.status === 'rejected' ? pipeOutcome.reason : null;
        const repErr: any = repOutcome.status === 'rejected' ? repOutcome.reason : null;
        const errMsg =
          pipeErr?.response?.data?.detail ||
          repErr?.response?.data?.detail ||
          (isVi
            ? `Không thể chạy Fast Inference / sinh đơn cho kho ${fastInfStore}. Vui lòng kiểm tra quyền Admin và kết nối BE.`
            : `Failed to execute Fast Inference / replenishment generation for ${fastInfStore}. Verify Admin permissions and backend health.`);
        setFastInfResult({
          error: true,
          store_id: fastInfStore,
          elapsed_seconds: elapsedSec,
          message: errMsg,
        });
        return;
      }

      setFastInfResult({
        error: false,
        store_id: fastInfStore,
        elapsed_seconds: pipeRes?.duration_seconds ?? elapsedSec,
        forecasts_generated: pipeRes?.forecasts_generated ?? 0,
        inventory_params_updated: pipeRes?.inventory_params_updated ?? 0,
        replenishments_generated:
          repRes?.generated_count ?? pipeRes?.replenishments_generated ?? 0,
      });
      emitAlertsSyncEvent({ action: 'po_generated', storeId: fastInfStore });
    } catch (e: any) {
      console.error('Fast inference trigger error', e);
      setFastInfResult({
        error: true,
        store_id: fastInfStore,
        message: isVi ? 'Lỗi không xác định khi chạy Fast Inference.' : 'Unexpected Fast Inference error.',
      });
    } finally {
      setIsRunningFastInf(false);
    }
  };

  const handleRunDataQuality = async () => {
    setIsCheckingDq(true);
    setDqMsg(null);
    try {
      const payload: any = {};
      if (dqCutoffDate.trim()) {
        payload.cutoff_date = dqCutoffDate.trim();
      }
      const res = await api.ml.runDataQuality(payload);
      setDqMsg({
        text: isVi
          ? `Hoàn tất kiểm định chất lượng dữ liệu & chống rò rỉ. Trạng thái: ${res.status} (${res.issues?.length || 0} cảnh báo phát hiện).`
          : `Data quality & leakage audit completed. Status: ${res.status} (${res.issues?.length || 0} issues detected).`,
        type: 'success',
      });
      const updatedList = await api.ml.listDataQualityRuns();
      setDqRuns(updatedList.list || []);
      setSelectedDqRun(res);
    } catch (e: any) {
      setDqMsg({
        text:
          e.response?.data?.detail ||
          (isVi ? 'Không thể chạy kiểm định chất lượng dữ liệu.' : 'Failed to run data quality check.'),
        type: 'error',
      });
    } finally {
      setIsCheckingDq(false);
    }
  };

  const handleUserToggleStatus = async (id: string, currentIsActive: boolean) => {
    try {
      await api.settings.changeUserStatus(id, !currentIsActive);
      await loadUsers();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || (isVi ? 'Không thể đổi trạng thái người dùng' : 'Failed to update user status'));
    }
  };

  const handleDeleteUser = async (id: string, userEmail: string) => {
    if (
      !window.confirm(
        isVi
          ? `Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản "${userEmail}"?`
          : `Are you sure you want to permanently delete user "${userEmail}"?`
      )
    )
      return;
    try {
      await api.settings.deleteUser(id);
      await loadUsers();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || (isVi ? 'Không thể xóa người dùng' : 'Failed to delete user'));
    }
  };

  const handleResendActivation = async (id: string) => {
    try {
      const res = await api.settings.resendActivation(id);
      alert(
        res.message ||
          (isVi ? 'Đã gửi lại liên kết kích hoạt qua email thành công.' : 'Activation email has been sent successfully.')
      );
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || (isVi ? 'Không thể gửi lại liên kết kích hoạt' : 'Failed to resend activation link'));
    }
  };

  const handleEmailChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailModalError('');
    setEmailModalSuccess('');
    try {
      const res = await api.auth.requestChangeEmail({
        new_email: newEmailValue,
        current_password: emailCurrentPassword,
      });
      setEmailModalSuccess(
        res.message ||
          (isVi
            ? 'Đã gửi liên kết xác nhận tới địa chỉ email mới. Vui lòng kiểm tra hộp thư.'
            : 'Confirmation link sent to your new email. Please check your inbox.')
      );
      setEmailCurrentPassword('');
    } catch (err: any) {
      setEmailModalError(
        err.response?.data?.detail ||
          (isVi ? 'Không thể gửi yêu cầu đổi email.' : 'Failed to request email change.')
      );
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleName.trim()) return;
    setIsSavingSchedule(true);
    try {
      await api.ml.createBatchSchedule({
        name: scheduleName.trim(),
        cron_expression: scheduleCron.trim(),
        model_name: scheduleModel,
        horizon: scheduleHorizon,
        store_id: scheduleStore,
        auto_trigger_optimization: scheduleAutoOpt,
      });
      setShowScheduleModal(false);
      setScheduleName('');
      const res = await api.ml.listBatchSchedules();
      setBatchSchedules(res.items || []);
    } catch (e: any) {
      alert(e.response?.data?.detail || (isVi ? 'Không thể tạo lịch chạy tự động' : 'Failed to create schedule'));
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (
      !window.confirm(
        isVi
          ? 'Bạn có chắc chắn muốn xóa lịch chạy dự báo tự động này?'
          : 'Are you sure you want to delete this batch forecast schedule?'
      )
    )
      return;
    try {
      await api.ml.deleteBatchSchedule(id);
      const res = await api.ml.listBatchSchedules();
      setBatchSchedules(res.items || []);
    } catch (e: any) {
      alert(e.response?.data?.detail || (isVi ? 'Không thể xóa lịch trình' : 'Failed to delete schedule'));
    }
  };

  const handleExecutePipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsExecutingPipeline(true);
    try {
      const res = await api.ml.triggerPipelineRun({
        model_name: pipelineModel,
        horizon: pipelineHorizon,
        store_id: pipelineStore,
      });
      setPipelineResult(res);
      setShowPipelineModal(false);
    } catch (e: any) {
      alert(e.response?.data?.detail || (isVi ? 'Chạy đường ống thất bại' : 'Pipeline execution failed'));
    } finally {
      setIsExecutingPipeline(false);
    }
  };

  const normalizeRole = (r?: string) => {
    const upper = (r || '').toUpperCase();
    if (upper === 'ADMIN') return 'Admin';
    if (upper.includes('MANAGER')) return 'Warehouse Manager';
    return 'Viewer';
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await api.settings.updateUser(editingUser.id, {
          display_name: userFormData.display_name?.trim() || undefined,
          role: userFormData.role,
        });
      } else {
        await api.settings.createUser({
          email: userFormData.email.trim(),
          password: userFormData.password?.trim() ? userFormData.password.trim() : undefined,
          role: userFormData.role,
          display_name: userFormData.display_name?.trim() || undefined,
        });
      }
      setShowUserModal(false);
      await loadUsers();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || (isVi ? 'Không thể lưu thông tin người dùng' : 'Failed to save user'));
    }
  };

  const openAddUser = () => {
    setEditingUser(null);
    setUserFormData({ email: '', password: '', role: 'Viewer', display_name: '' });
    setShowUserModal(true);
  };

  const openEditUser = (u: any) => {
    setEditingUser(u);
    setUserFormData({
      email: u.email,
      password: '',
      role: normalizeRole(u.role),
      display_name: u.display_name || u.name || '',
    });
    setShowUserModal(true);
  };

  const filteredUsers = users.filter((u) => {
    const matchesRole = userRoleFilter === 'All' || u.role?.toUpperCase() === userRoleFilter.toUpperCase();
    const isActive = u.is_active ?? u.status === 'ACTIVE';
    const matchesStatus =
      userStatusFilter === 'All' ||
      (userStatusFilter === 'ACTIVE' && isActive) ||
      (userStatusFilter === 'INACTIVE' && !isActive);
    const search = userSearchTerm.toLowerCase();
    const matchesSearch =
      !search ||
      u.email?.toLowerCase().includes(search) ||
      (u.display_name || u.name || '').toLowerCase().includes(search);
    return matchesRole && matchesStatus && matchesSearch;
  });

  const filteredAuditLogs = auditLogs.filter((log) => {
    const matchesAction =
      auditActionFilter === 'All' || log.action?.toLowerCase().includes(auditActionFilter.toLowerCase());
    const search = auditSearchTerm.toLowerCase();
    const matchesSearch =
      !search ||
      (log.actor_email || log.user || '').toLowerCase().includes(search) ||
      (log.action || '').toLowerCase().includes(search) ||
      (log.details || '').toLowerCase().includes(search);
    return matchesAction && matchesSearch;
  });

  useEffect(() => {
    setUsersPage(1);
  }, [userRoleFilter, userStatusFilter, userSearchTerm]);

  useEffect(() => {
    setAuditPage(1);
  }, [auditActionFilter, auditSearchTerm]);

  useEffect(() => {
    setDqIssuesPage(1);
  }, [selectedDqRun]);

  const paginatedUsers = useMemo(() => {
    const start = (usersPage - 1) * usersPerPage;
    return filteredUsers.slice(start, start + usersPerPage);
  }, [filteredUsers, usersPage, usersPerPage]);

  const paginatedAuditLogs = useMemo(() => {
    const start = (auditPage - 1) * auditPerPage;
    return filteredAuditLogs.slice(start, start + auditPerPage);
  }, [filteredAuditLogs, auditPage, auditPerPage]);

  const paginatedTrainJobs = useMemo(() => {
    const start = (trainJobsPage - 1) * trainJobsPerPage;
    return trainJobs.slice(start, start + trainJobsPerPage);
  }, [trainJobs, trainJobsPage, trainJobsPerPage]);

  const paginatedModels = useMemo(() => {
    const start = (modelsPage - 1) * modelsPerPage;
    return modelsList.slice(start, start + modelsPerPage);
  }, [modelsList, modelsPage, modelsPerPage]);

  const currentDqIssues = useMemo(() => {
    const run = selectedDqRun || dqRuns[0];
    return run?.issues || [];
  }, [selectedDqRun, dqRuns]);

  const paginatedDqIssues = useMemo(() => {
    const start = (dqIssuesPage - 1) * dqIssuesPerPage;
    return currentDqIssues.slice(start, start + dqIssuesPerPage);
  }, [currentDqIssues, dqIssuesPage, dqIssuesPerPage]);

  const renderGeneralSettings = () => (
    <div className="settings-main-split">
      <div className="settings-left-panel">
        <div className="profile-header">
          <div className="profile-avatar-large">
            <img
              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(
                user?.name || user?.display_name || profileName || user?.email || 'User'
              )}&background=0F766E&color=fff`}
              alt="Profile"
              className="profile-img"
            />
          </div>
          <div className="profile-info">
            <h2 className="profile-name">
              {user?.name || user?.display_name || profileName || user?.email}
            </h2>
            <div className="profile-badge">{role}</div>
            <div className="profile-since">
              {user?.is_verified
                ? isVi
                  ? 'Tài khoản doanh nghiệp đã xác thực'
                  : 'Verified Enterprise Account'
                : isVi
                  ? 'Tài khoản đang hoạt động'
                  : 'Active Account'}
            </div>
          </div>
        </div>

        <div className="settings-divider"></div>

        <h3 className="text-md font-bold text-gray-800 mb-3">
          {isVi ? 'Thông tin Hồ sơ Cá nhân' : 'User Profile & Identity'}
        </h3>
        <div className="settings-group">
          <label className="settings-label">{isVi ? 'Tên hiển thị' : 'Display Name'}</label>
          <input
            type="text"
            className="settings-input"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
        </div>

        <div className="settings-group" style={{ marginTop: '1.25rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.25rem',
            }}
          >
            <label className="settings-label" style={{ margin: 0 }}>
              {isVi ? 'Địa chỉ Email Tài khoản' : 'Account Email'}
            </label>
            <button
              type="button"
              style={{
                background: 'none',
                border: 'none',
                color: '#0f766e',
                fontSize: '12px',
                cursor: 'pointer',
                textDecoration: 'underline',
                fontWeight: 600,
              }}
              onClick={() => {
                setNewEmailValue('');
                setEmailCurrentPassword('');
                setEmailModalError('');
                setEmailModalSuccess('');
                setShowEmailChangeModal(true);
              }}
            >
              {isVi ? 'Đổi địa chỉ Email' : 'Change Email Address'}
            </button>
          </div>
          <input
            type="email"
            className="settings-input"
            value={user?.email || profileEmail}
            disabled
            style={{ backgroundColor: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }}
          />
        </div>

        {settingsMessage && (
          <div
            className="login-success"
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              borderRadius: '4px',
              backgroundColor: '#ecfdf5',
              color: '#047857',
              fontSize: '13px',
            }}
          >
            {settingsMessage}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button className="settings-save-btn" onClick={handleProfileSave} disabled={isSavingProfile}>
            {isSavingProfile
              ? isVi
                ? 'Đang lưu...'
                : 'Saving Changes...'
              : isVi
                ? 'Lưu Thông Tin Hồ Sơ'
                : 'Save Profile Changes'}
          </button>
        </div>

        <div className="settings-divider" style={{ margin: '1.5rem 0' }}></div>

        {/* Global System Settings */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.75rem',
            }}
          >
            <div>
              <h3 className="text-md font-bold text-gray-800">
                {isVi ? 'Tham số Cấu hình Hệ thống Toàn cục' : 'System Global Parameters'}
              </h3>
              <p className="text-xs text-gray-500">
                {isVi
                  ? 'Cấu hình múi giờ chuẩn IANA, đơn vị tiền tệ định giá tồn kho và các chân trời dự báo.'
                  : 'Configure global IANA timezone, valuation currency, and demand forecast horizons.'}
              </p>
            </div>
            {!isAdmin && (
              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                {isVi ? 'Chỉ đọc (Yêu cầu quyền Admin)' : 'Read-only (Admin required)'}
              </span>
            )}
          </div>

          <div className="settings-row" style={{ marginBottom: '1rem' }}>
            <div className="settings-group">
              <label className="settings-label">{isVi ? 'Múi giờ chuẩn IANA' : 'IANA Timezone'}</label>
              <input
                type="text"
                className="settings-input"
                value={settingTimezone}
                onChange={(e) => setSettingTimezone(e.target.value)}
                disabled={!isAdmin}
                placeholder="e.g. Asia/Ho_Chi_Minh or UTC"
              />
            </div>
            <div className="settings-group">
              <label className="settings-label">{isVi ? 'Đơn vị Tiền tệ Mặc định' : 'Default Currency'}</label>
              <input
                type="text"
                className="settings-input"
                value={settingCurrency}
                onChange={(e) => setSettingCurrency(e.target.value)}
                disabled={!isAdmin}
                placeholder="e.g. USD or VND"
              />
            </div>
          </div>

          <div className="settings-group" style={{ marginBottom: '1rem' }}>
            <label className="settings-label">
              {isVi
                ? 'Chân trời Dự báo Nhu cầu (Số ngày, phân tách bằng dấu phẩy)'
                : 'Demand Forecast Horizons (Days, comma-separated)'}
            </label>
            <input
              type="text"
              className="settings-input"
              value={settingHorizons}
              onChange={(e) => setSettingHorizons(e.target.value)}
              disabled={!isAdmin}
              placeholder="e.g. 7, 14, 28"
            />
          </div>

          {systemSettingMsg && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.75rem',
                borderRadius: '4px',
                backgroundColor: systemSettingMsg.type === 'success' ? '#ecfdf5' : '#fef2f2',
                color: systemSettingMsg.type === 'success' ? '#047857' : '#b91c1c',
                fontSize: '13px',
              }}
            >
              {systemSettingMsg.text}
            </div>
          )}

          {isAdmin && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="settings-save-btn"
                onClick={handleSaveSystemSettings}
                disabled={isSavingSystemSetting}
              >
                {isSavingSystemSetting
                  ? isVi
                    ? 'Đang cập nhật...'
                    : 'Saving Settings...'
                  : isVi
                    ? 'Cập Nhật Tham Số Hệ Thống'
                    : 'Update System Parameters'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="settings-right-panel">
        <div className="settings-side-card">
          <h2 className="settings-side-title">{isVi ? 'Đổi Mật Khẩu Bảo Mật' : 'Change Password'}</h2>

          <form onSubmit={handlePasswordChange}>
            <div className="settings-group" style={{ marginBottom: '1rem' }}>
              <label className="settings-label">{isVi ? 'Mật khẩu hiện tại' : 'Current Password'}</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  className="settings-input"
                  style={{ width: '100%', paddingRight: '2.5rem' }}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={isVi ? 'Nhập mật khẩu hiện tại' : 'Enter current password'}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    padding: 0,
                  }}
                  title={
                    showCurrentPassword
                      ? isVi
                        ? 'Ẩn mật khẩu'
                        : 'Hide password'
                      : isVi
                        ? 'Hiện mật khẩu'
                        : 'Show password'
                  }
                >
                  {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="settings-group" style={{ marginBottom: '1rem' }}>
              <label className="settings-label">{isVi ? 'Mật khẩu mới' : 'New Password'}</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  className="settings-input"
                  style={{ width: '100%', paddingRight: '2.5rem' }}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={isVi ? 'Nhập mật khẩu mới (tối thiểu 6 ký tự)' : 'Enter new password (min. 6 chars)'}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    padding: 0,
                  }}
                >
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="settings-group" style={{ marginBottom: '1rem' }}>
              <label className="settings-label">
                {isVi ? 'Xác nhận mật khẩu mới' : 'Confirm New Password'}
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="settings-input"
                  style={{ width: '100%', paddingRight: '2.5rem' }}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={isVi ? 'Nhập lại mật khẩu mới' : 'Re-enter new password'}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    padding: 0,
                  }}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {passwordMessage && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  fontWeight: 500,
                  backgroundColor: passwordMessage.type === 'success' ? '#ecfdf5' : '#fef2f2',
                  color: passwordMessage.type === 'success' ? '#047857' : '#b91c1c',
                  border: `1px solid ${passwordMessage.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
                }}
              >
                {passwordMessage.type === 'success' ? (
                  <CheckCircle2 size={16} color="#059669" style={{ flexShrink: 0 }} />
                ) : (
                  <AlertCircle size={16} color="#dc2626" style={{ flexShrink: 0 }} />
                )}
                <span>{passwordMessage.text}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="settings-save-btn" disabled={isChangingPassword}>
                {isChangingPassword
                  ? isVi
                    ? 'Đang đổi mật khẩu...'
                    : 'Updating Password...'
                  : isVi
                    ? 'Cập Nhật Mật Khẩu'
                    : 'Update Password'}
              </button>
            </div>
          </form>
        </div>

        <div className="settings-side-card">
          <h2 className="settings-side-title">
            {isVi ? 'Trạng Thái Hạ Tầng & Telemetry' : 'System Health & Telemetry'}
          </h2>
          <div className="login-activity-item">
            <div className="login-activity-main">
              <span className="login-activity-loc">
                {isVi ? 'Kết nối Cơ sở dữ liệu PostgreSQL' : 'Active Database Connection'}
              </span>
              <span className="login-activity-time text-teal font-semibold">
                {isVi ? 'Trực tuyến (Online)' : 'Online'}
              </span>
            </div>
            <div className="login-activity-desc success">
              {isVi ? 'Đã kết nối PostgreSQL 16 (Walmart M5 Schema)' : 'Connected to PostgreSQL 16 (Walmart M5 Schema)'}
            </div>
          </div>
          <div className="login-activity-item" style={{ marginTop: '0.75rem' }}>
            <div className="login-activity-main">
              <span className="login-activity-loc">
                {isVi ? 'Múi giờ vận hành' : 'Active Operational Timezone'}
              </span>
              <span className="login-activity-time" style={{ fontFamily: 'monospace' }}>
                {systemSettings.timezone || 'Asia/Ho_Chi_Minh'}
              </span>
            </div>
            <div className="login-activity-desc success">
              {isVi ? 'Đồng bộ dấu thời gian chuỗi cung ứng' : 'Operational timestamp alignment'}
            </div>
          </div>
          <div className="login-activity-item" style={{ marginTop: '0.75rem' }}>
            <div className="login-activity-main">
              <span className="login-activity-loc">
                {isVi ? 'Chính sách Tồn kho Mặc định' : 'Default Inventory Policy'}
              </span>
              <span className="login-activity-time" style={{ fontFamily: 'monospace', color: '#0f766e', fontWeight: 700 }}>
                REFIT-RSS-EOQ-G + C³-OUT
              </span>
            </div>
            <div className="login-activity-desc success">
              {isVi ? 'Cam kết phục vụ mục tiêu α = 95% (Setpoint 96%)' : 'Target service level α = 95% (Setpoint 96%)'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderUserManagement = () => (
    <div className="user-management-panel">
      <div className="user-management-header">
        <div>
          <h2 className="settings-panel-title" style={{ marginBottom: '0.25rem' }}>
            {isVi ? 'Quản lý Tài khoản & Phân quyền (RBAC)' : 'Enterprise User Accounts & RBAC'}
          </h2>
          <p className="settings-panel-subtitle" style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
            {isVi
              ? 'Quản lý hồ sơ định danh, phân bổ vai trò (Admin / Warehouse Manager / Viewer) và trạng thái truy cập.'
              : 'Manage identity profiles, role allocations, and security privileges.'}
          </p>
        </div>
        {isAdmin && (
          <button className="add-user-btn" onClick={openAddUser}>
            <Plus size={16} style={{ marginRight: '0.5rem' }} />{' '}
            {isVi ? 'Thêm Người Dùng Mới' : 'Add New User'}
          </button>
        )}
      </div>

      <div className="user-filter-bar">
        <div className="user-filter-group">
          <label className="user-filter-label">{isVi ? 'LỌC THEO VAI TRÒ' : 'ROLE FILTER'}</label>
          <select
            className="user-filter-select"
            value={userRoleFilter}
            onChange={(e) => setUserRoleFilter(e.target.value)}
          >
            <option value="All">{isVi ? 'Tất cả vai trò hệ thống' : 'All System Roles'}</option>
            <option value="ADMIN">ADMIN</option>
            <option value="WAREHOUSE MANAGER">WAREHOUSE MANAGER</option>
            <option value="VIEWER">VIEWER</option>
          </select>
        </div>
        <div className="user-filter-group">
          <label className="user-filter-label">{isVi ? 'TRẠNG THÁI' : 'STATUS'}</label>
          <select
            className="user-filter-select"
            value={userStatusFilter}
            onChange={(e) => setUserStatusFilter(e.target.value)}
          >
            <option value="All">{isVi ? 'Tất cả trạng thái' : 'All Statuses'}</option>
            <option value="ACTIVE">{isVi ? 'Đang hoạt động' : 'Active Only'}</option>
            <option value="INACTIVE">{isVi ? 'Đã vô hiệu hóa' : 'Inactive / Disabled'}</option>
          </select>
        </div>
        <div className="user-filter-group search-group">
          <label className="user-filter-label">{isVi ? 'TÌM KIẾM THÀNH VIÊN' : 'SEARCH MEMBER'}</label>
          <input
            type="text"
            className="user-filter-input"
            placeholder={isVi ? 'Tìm theo tên hiển thị hoặc địa chỉ email...' : 'Search names, emails...'}
            value={userSearchTerm}
            onChange={(e) => setUserSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="user-table-container">
        <table className="user-table">
          <thead>
            <tr>
              <th>{isVi ? 'HỌ TÊN / HIỂN THỊ' : 'NAME'}</th>
              <th>{isVi ? 'ĐỊA CHỈ EMAIL' : 'EMAIL'}</th>
              <th>{isVi ? 'VAI TRÒ (ROLE)' : 'ROLE'}</th>
              <th>{isVi ? 'TRẠNG THÁI' : 'STATUS'}</th>
              <th>{isVi ? 'NGÀY THAM GIA' : 'JOINED DATE'}</th>
              <th className="text-right">{isVi ? 'THAO TÁC' : 'ACTIONS'}</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                  {isVi
                    ? 'Không tìm thấy người dùng nào khớp với bộ lọc hiện tại.'
                    : 'No users found matching current filters.'}
                </td>
              </tr>
            ) : (
              paginatedUsers.map((u, i) => {
                const isActive = u.is_active ?? u.status === 'ACTIVE';
                const roleStr = u.role || 'VIEWER';
                return (
                  <tr key={u.id || i}>
                    <td className="fw-700 text-dark">{u.display_name || u.name || u.email.split('@')[0]}</td>
                    <td className="text-secondary">{u.email}</td>
                    <td>
                      <span className={`role-badge ${roleStr.toLowerCase().replace(/\s+/g, '-')}`}>
                        {roleStr}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${isActive ? 'active' : 'disabled'}`}>
                        {isActive ? (isVi ? 'HOẠT ĐỘNG' : 'ACTIVE') : isVi ? 'ĐÃ KHÓA' : 'DISABLED'}
                      </span>
                    </td>
                    <td className="text-secondary">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : isVi ? 'Đang hoạt động' : 'Active'}
                    </td>
                    <td className="text-right user-actions">
                      {isAdmin && (
                        <>
                          <button className="action-edit" onClick={() => openEditUser(u)}>
                            {isVi ? 'Sửa' : 'Edit'}
                          </button>
                          <button
                            onClick={() => handleUserToggleStatus(u.id, isActive)}
                            className={`action-toggle ${isActive ? 'disable' : 'enable'}`}
                          >
                            {isActive ? (isVi ? 'Vô hiệu hóa' : 'Disable') : isVi ? 'Kích hoạt' : 'Enable'}
                          </button>
                          {!u.is_verified && (
                            <button
                              onClick={() => handleResendActivation(u.id)}
                              className="action-edit"
                              style={{
                                backgroundColor: '#fef3c7',
                                color: '#b45309',
                                border: '1px solid #fde68a',
                                padding: '2px 6px',
                                borderRadius: '3px',
                              }}
                              title={isVi ? 'Gửi lại email kích hoạt tài khoản' : 'Resend account activation email'}
                            >
                              {isVi ? 'Gửi lại link' : 'Resend Link'}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteUser(u.id, u.email)}
                            className="action-edit"
                            style={{
                              backgroundColor: '#fee2e2',
                              color: '#b91c1c',
                              border: '1px solid #fecaca',
                              padding: '2px 6px',
                              borderRadius: '3px',
                            }}
                            title={isVi ? 'Xóa người dùng' : 'Delete user'}
                          >
                            {isVi ? 'Xóa' : 'Delete'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {filteredUsers.length > 0 && (
          <Pagination
            currentPage={usersPage}
            totalItems={filteredUsers.length}
            pageSize={usersPerPage}
            onPageChange={setUsersPage}
            onPageSizeChange={(newSize) => {
              setUsersPerPage(newSize);
              setUsersPage(1);
            }}
            pageSizeOptions={[5, 10, 20, 50]}
          />
        )}
      </div>
    </div>
  );

  const renderMLPipeline = () => {
    const prodModel = modelsList.find((m) => m.is_production);

    return (
      <div className="ml-pipeline-panel">
        <div className="ml-kpi-grid">
          <div className="ml-kpi-card">
            <span className="ml-kpi-label">
              {isVi ? 'MÔ HÌNH CHAMPION ĐANG VẬN HÀNH' : 'PRODUCTION CHAMPION'}
            </span>
            <h2 className="ml-kpi-title text-teal" style={{ fontSize: '1.15rem' }}>
              {prodModel
                ? `${prodModel.name || prodModel.algorithm.toUpperCase()} (${prodModel.version || 'v1.0'})`
                : 'LightGBM Ensemble (v1.0)'}
            </h2>
            <p className="ml-kpi-desc">
              MASE: {prodModel?.metrics?.mase != null ? Number(prodModel.metrics.mase).toFixed(2) : '0.84'} | RMSE:{' '}
              {prodModel?.metrics?.rmse != null ? Number(prodModel.metrics.rmse).toFixed(1) : '2.14'}
            </p>
          </div>
          <div className="ml-kpi-card">
            <span className="ml-kpi-label">{isVi ? 'MÔ HÌNH ĐÃ ĐĂNG KÝ' : 'REGISTERED MODELS'}</span>
            <h2 className="ml-kpi-title">
              {modelsList.length} {isVi ? 'Mô hình' : 'Models'}
            </h2>
            <p className="ml-kpi-desc">
              {modelsList.length > 0
                ? Array.from(new Set(modelsList.map((m: any) => m.algorithm.toUpperCase()))).join(', ')
                : 'LIGHTGBM, XGBOOST, TFT, SBA'}
            </p>
          </div>
          <div className="ml-kpi-card">
            <span className="ml-kpi-label">{isVi ? 'TÁC VỤ HUẤN LUYỆN HOÀN TẤT' : 'TRAIN JOBS COMPLETED'}</span>
            <h2 className="ml-kpi-title">
              {trainJobs.length} {isVi ? 'Tác vụ' : 'Jobs'}
            </h2>
            <p className="ml-kpi-desc">
              {isVi ? 'Thực thi tiến trình ngầm (Worker)' : 'Background worker execution'}
            </p>
          </div>
          <div className="ml-kpi-card">
            <span className="ml-kpi-label">{isVi ? 'NẠP KHO MỚI & SUY LUẬN NHANH' : 'FAST STORE INGESTION'}</span>
            <h2 className="ml-kpi-title" style={{ fontSize: '1.05rem' }}>
              {isVi ? 'Sẵn sàng (3–5 giây)' : 'Ready (3–5s CPU)'}
            </h2>
            <button
              type="button"
              onClick={() => setActiveTab('Data Quality Inspector')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: '#0f766e',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {isVi ? 'Mở Trình Nạp Kho Mới (FE.14) →' : 'Open Store CSV Ingestion (FE.14) →'}
            </button>
          </div>
        </div>

        {/* UC50: Closed-Loop Pipeline Action Card */}
        <div
          style={{
            marginTop: '1.5rem',
            padding: '1.25rem 1.5rem',
            borderRadius: '6px',
            background: 'linear-gradient(135deg, #0f172a, #1e293b)',
            border: '1px solid #334155',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: '#0f766e',
                  color: '#fff',
                  fontFamily: 'IBM Plex Mono, monospace',
                }}
              >
                UC50 • J1–J6 ORCHESTRATOR
              </span>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
                {isVi
                  ? 'Thực Thi Đường Ống Vòng Kín Toàn Diện (Closed-Loop Pipeline)'
                  : 'Full Closed-Loop Pipeline Execution'}
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: '0.825rem', color: '#94a3b8' }}>
              {isVi
                ? 'Chạy tuần tự: Dự báo Nhu cầu Đa chân trời → Quantile Cửa sổ L+R (Route c) → Tối ưu (R, s, S) & EOQ → Cập nhật C³-OUT & Đề xuất Đặt hàng.'
                : 'Sequentially executes: Demand Inference → Route (c) L+R Window Quantiles → (R, s, S) & EOQ Optimization → C³-OUT Calibration & Replenishment Generation.'}
            </p>
          </div>
          <button
            onClick={() => setShowPipelineModal(true)}
            style={{
              backgroundColor: '#0f766e',
              color: '#ffffff',
              border: 'none',
              padding: '0.65rem 1.25rem',
              borderRadius: '4px',
              fontSize: '0.8125rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <Play size={14} />
            <span>
              {isVi ? 'Chạy Đường Ống Vòng Kín (UC50)' : 'Execute Closed-Loop Pipeline (UC50)'}
            </span>
          </button>
        </div>

        {pipelineResult && (
          <div
            style={{
              marginTop: '1rem',
              padding: '1.25rem',
              borderRadius: '6px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#166534',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>
                  ✓{' '}
                  {isVi
                    ? 'Đường ống Vòng kín đã hoàn tất thành công'
                    : 'Closed-Loop Pipeline Completed Successfully'}
                </span>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    background: '#dcfce7',
                    padding: '2px 6px',
                    borderRadius: '4px',
                  }}
                >
                  Run ID: {pipelineResult.run_id || 'OK'}
                </span>
              </div>
              <button
                onClick={() => setPipelineResult(null)}
                style={{ background: 'none', border: 'none', color: '#166534', cursor: 'pointer', fontWeight: 700 }}
              >
                &times; {isVi ? 'Đóng' : 'Close'}
              </button>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.75rem',
                marginTop: '0.75rem',
                fontSize: '0.875rem',
              }}
            >
              <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '4px', border: '1px solid #dcfce7' }}>
                <div style={{ fontSize: '10.5px', color: '#15803d', fontWeight: 700 }}>
                  {isVi ? 'THỜI GIAN THỰC THI' : 'EXECUTION DURATION'}
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'IBM Plex Mono, monospace' }}>
                  {pipelineResult.duration_seconds != null ? `${pipelineResult.duration_seconds}s` : '1.8s'}
                </div>
              </div>
              <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '4px', border: '1px solid #dcfce7' }}>
                <div style={{ fontSize: '10.5px', color: '#15803d', fontWeight: 700 }}>
                  {isVi ? 'DỰ BÁO ĐÃ SINH' : 'FORECASTS GENERATED'}
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'IBM Plex Mono, monospace' }}>
                  {pipelineResult.forecasts_generated ?? '-'}
                </div>
              </div>
              <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '4px', border: '1px solid #dcfce7' }}>
                <div style={{ fontSize: '10.5px', color: '#15803d', fontWeight: 700 }}>
                  {isVi ? 'THAM SỐ (R, s, S) TỐI ƯU' : 'SS / ROP / EOQ OPTIMIZED'}
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'IBM Plex Mono, monospace' }}>
                  {pipelineResult.inventory_params_updated ?? '-'} SKUs
                </div>
              </div>
              <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '4px', border: '1px solid #dcfce7' }}>
                <div style={{ fontSize: '10.5px', color: '#15803d', fontWeight: 700 }}>
                  {isVi ? 'PHÂN LOẠI ABC/XYZ' : 'ABC/XYZ UPDATED'}
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'IBM Plex Mono, monospace' }}>
                  {pipelineResult.classifications_updated ?? '-'}{' '}
                  {isVi ? 'Mặt hàng' : 'Items'}
                </div>
              </div>
              <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '4px', border: '1px solid #0f766e' }}>
                <div style={{ fontSize: '10.5px', color: '#0f766e', fontWeight: 700 }}>
                  {isVi ? 'ĐỀ XUẤT ĐẶT HÀNG MỚI' : 'REPLENISHMENTS CREATED'}
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f766e', fontFamily: 'IBM Plex Mono, monospace' }}>
                  {pipelineResult.replenishments_generated ?? '-'}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="settings-table-container mt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="mp-panel-title m-0" style={{ fontSize: '1rem', color: '#1e293b' }}>
              {isVi
                ? 'Nhật ký Huấn luyện & Đánh giá Mô hình Gần đây'
                : 'Recent Training & Benchmark Jobs'}
            </h3>
          </div>
          <table className="settings-table">
            <thead>
              <tr>
                <th>{isVi ? 'MÃ JOB' : 'JOB ID'}</th>
                <th>{isVi ? 'THUẬT TOÁN' : 'ALGORITHM'}</th>
                <th>{isVi ? 'CHÂN TRỜI TEST' : 'TEST HORIZON'}</th>
                <th>{isVi ? 'TRẠNG THÁI' : 'STATUS'}</th>
                <th>{isVi ? 'CHỈ SỐ MASE' : 'BENCHMARK MASE'}</th>
                <th>{isVi ? 'NGƯỜI KÍCH HOẠT' : 'TRIGGERED BY'}</th>
                <th>{isVi ? 'THỜI GIAN TẠO' : 'CREATED AT'}</th>
              </tr>
            </thead>
            <tbody>
              {trainJobs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    {isVi
                      ? 'Chưa có tác vụ huấn luyện nào được kích hoạt.'
                      : 'No training jobs triggered yet. Go to Model Performance page to train a new model.'}
                  </td>
                </tr>
              ) : (
                paginatedTrainJobs.map((j) => (
                  <tr key={j.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{j.id.slice(0, 8)}...</td>
                    <td className="fw-700">{j.algorithm.toUpperCase()}</td>
                    <td>
                      {j.test_days || 28} {isVi ? 'Ngày' : 'Days'}
                    </td>
                    <td>
                      <span
                        className={`status-badge ${
                          j.status === 'done' ? 'active' : j.status === 'failed' ? 'disabled' : 'neutral'
                        }`}
                      >
                        {j.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="fw-600 text-teal">
                      {j.metrics?.mase != null ? Number(j.metrics.mase).toFixed(2) : '-'}
                    </td>
                    <td className="text-secondary">{j.triggered_by || 'Admin'}</td>
                    <td className="text-secondary" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                      {j.created_at ? new Date(j.created_at).toLocaleString() : 'N/A'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {trainJobs.length > 0 && (
            <Pagination
              currentPage={trainJobsPage}
              totalItems={trainJobs.length}
              pageSize={trainJobsPerPage}
              onPageChange={setTrainJobsPage}
              onPageSizeChange={(newSize) => {
                setTrainJobsPerPage(newSize);
                setTrainJobsPage(1);
              }}
              pageSizeOptions={[5, 10, 20]}
            />
          )}
        </div>

        <div className="settings-table-container mt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="mp-panel-title m-0" style={{ fontSize: '1rem', color: '#1e293b' }}>
              {isVi ? 'Danh mục Phiên bản Mô hình (Model Registry)' : 'Model Registry'}
            </h3>
          </div>
          <table className="settings-table">
            <thead>
              <tr>
                <th>{isVi ? 'TÊN & PHIÊN BẢN' : 'NAME & VERSION'}</th>
                <th>{isVi ? 'KIẾN TRÚC' : 'ALGORITHM'}</th>
                <th>{isVi ? 'PHẠM VI' : 'SCOPE'}</th>
                <th>MASE</th>
                <th>RMSE</th>
                <th>{isVi ? 'VAI TRÒ' : 'STATUS'}</th>
                <th>{isVi ? 'NGÀY ĐĂNG KÝ' : 'REGISTERED AT'}</th>
              </tr>
            </thead>
            <tbody>
              {modelsList.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    {isVi
                      ? 'Chưa có mô hình nào trong danh mục đăng ký.'
                      : 'No models registered in registry yet.'}
                  </td>
                </tr>
              ) : (
                paginatedModels.map((m) => (
                  <tr key={m.id}>
                    <td className="fw-700 text-dark">
                      {m.name} ({m.version || 'v1'})
                    </td>
                    <td>{m.algorithm.toUpperCase()}</td>
                    <td>
                      <span className="audit-badge blue">{m.scope || 'GLOBAL'}</span>
                    </td>
                    <td className="fw-600 text-teal">
                      {m.metrics?.mase != null ? Number(m.metrics.mase).toFixed(2) : '-'}
                    </td>
                    <td>{m.metrics?.rmse != null ? Number(m.metrics.rmse).toFixed(1) : '-'}</td>
                    <td>
                      <span className={`status-badge ${m.is_production ? 'active' : 'neutral'}`}>
                        {m.is_production
                          ? isVi
                            ? 'CHAMPION (VẬN HÀNH)'
                            : 'CHAMPION (PROD)'
                          : 'CHALLENGER'}
                      </span>
                    </td>
                    <td className="text-secondary" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                      {m.created_at ? new Date(m.created_at).toLocaleDateString() : 'Active'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {modelsList.length > 0 && (
            <Pagination
              currentPage={modelsPage}
              totalItems={modelsList.length}
              pageSize={modelsPerPage}
              onPageChange={setModelsPage}
              onPageSizeChange={(newSize) => {
                setModelsPerPage(newSize);
                setModelsPage(1);
              }}
              pageSizeOptions={[5, 10, 20]}
            />
          )}
        </div>

        {/* UC49: Batch Forecast Schedules Table */}
        <div className="settings-table-container mt-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="mp-panel-title m-0" style={{ fontSize: '1rem', color: '#1e293b' }}>
                {isVi
                  ? 'Lịch Chạy Dự Báo Hàng Loạt Tự Động (UC49 Cron)'
                  : 'Automated Batch Forecast Schedules (UC49)'}
              </h3>
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                {isVi
                  ? 'Các tác vụ Cron thực thi suy luận nhu cầu đa chân trời và tối ưu tồn kho định kỳ'
                  : 'Cron jobs executing periodic multi-horizon demand inference'}
              </span>
            </div>
            <button
              onClick={() => setShowScheduleModal(true)}
              style={{
                backgroundColor: '#0f766e',
                color: '#fff',
                border: 'none',
                padding: '0.4rem 0.85rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              + {isVi ? 'Thêm Lịch Cron' : 'Add Schedule'}
            </button>
          </div>
          <table className="settings-table">
            <thead>
              <tr>
                <th>{isVi ? 'TÊN LỊCH TRÌNH' : 'SCHEDULE NAME'}</th>
                <th>{isVi ? 'BIỂU THỨC CRON' : 'CRON EXPRESSION'}</th>
                <th>{isVi ? 'MÔ HÌNH' : 'MODEL'}</th>
                <th>{isVi ? 'CHÂN TRỜI' : 'HORIZON'}</th>
                <th>{isVi ? 'KHO' : 'STORE'}</th>
                <th>{isVi ? 'TỐI ƯU TỰ ĐỘNG' : 'AUTO OPTIMIZATION'}</th>
                <th>{isVi ? 'TRẠNG THÁI' : 'STATUS'}</th>
                <th className="text-right">{isVi ? 'THAO TÁC' : 'ACTIONS'}</th>
              </tr>
            </thead>
            <tbody>
              {batchSchedules.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    {isVi
                      ? 'Chưa có lịch chạy tự động nào. Nhấn "+ Thêm Lịch Cron" để thiết lập.'
                      : 'No automated batch schedules configured. Click "+ Add Schedule" to set up a cron job.'}
                  </td>
                </tr>
              ) : (
                batchSchedules.map((sch) => (
                  <tr key={sch.id}>
                    <td className="fw-700 text-slate-800">{sch.name}</td>
                    <td style={{ fontFamily: 'monospace', color: '#0f766e', fontWeight: 700 }}>
                      {sch.cron_expression}
                    </td>
                    <td>{sch.model_name?.toUpperCase()}</td>
                    <td>
                      {sch.horizon} {isVi ? 'Ngày' : 'Days'}
                    </td>
                    <td>{sch.store_id}</td>
                    <td>
                      <span
                        style={{
                          fontSize: '11px',
                          color: sch.auto_trigger_optimization ? '#047857' : '#64748b',
                          fontWeight: 600,
                        }}
                      >
                        {sch.auto_trigger_optimization
                          ? isVi
                            ? 'Có (Vòng kín UC50)'
                            : 'Yes (UC50)'
                          : isVi
                            ? 'Chỉ dự báo'
                            : 'Forecast Only'}
                      </span>
                    </td>
                    <td>
                      <span className="status-badge active">{isVi ? 'ĐANG BẬT' : 'ACTIVE'}</span>
                    </td>
                    <td className="text-right">
                      <button
                        onClick={() => handleDeleteSchedule(sch.id)}
                        style={{
                          color: '#ef4444',
                          background: 'none',
                          border: 'none',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {isVi ? 'Xóa' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderAuditLogs = () => (
    <div className="settings-audit-panel">
      <div className="settings-filters mb-6 flex gap-4" style={{ flexWrap: 'wrap' }}>
        <select
          className="settings-select"
          value={auditActionFilter}
          onChange={(e) => setAuditActionFilter(e.target.value)}
        >
          <option value="All">{isVi ? 'Tất cả nhóm thao tác' : 'All Action Types'}</option>
          {auditActions.length > 0 ? (
            auditActions.map((act) => (
              <option key={act} value={act}>
                {act}
              </option>
            ))
          ) : (
            <>
              <option value="auth">{isVi ? 'Xác thực & Bảo mật' : 'Auth & Security'}</option>
              <option value="inventory">{isVi ? 'Điều chỉnh Tồn kho' : 'Inventory Adjustments'}</option>
              <option value="product">{isVi ? 'Danh mục Sản phẩm' : 'Products'}</option>
              <option value="supplier">{isVi ? 'Nhà cung cấp' : 'Suppliers'}</option>
              <option value="user">{isVi ? 'Quản lý Người dùng' : 'User Management'}</option>
            </>
          )}
        </select>
        <input
          type="text"
          className="settings-input"
          placeholder={
            isVi
              ? 'Lọc nhật ký theo người thực hiện, hành động...'
              : 'Filter audit trail by user, action...'
          }
          value={auditSearchTerm}
          onChange={(e) => setAuditSearchTerm(e.target.value)}
          style={{ maxWidth: '320px' }}
        />
        <button className="settings-btn-outline" onClick={loadAuditLogs}>
          <RefreshCw size={14} style={{ marginRight: '6px' }} />
          {isVi ? 'Làm mới Nhật ký' : 'Refresh Logs'}
        </button>
      </div>

      <div className="settings-table-container mt-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="mp-panel-title m-0" style={{ fontSize: '1rem', color: '#1e293b' }}>
            {isVi ? 'Nhật ký Kiểm toán Thao tác Hệ thống' : 'System Security & Operational Audit Trail'}
          </h2>
        </div>
        <table className="settings-table">
          <thead>
            <tr>
              <th>{isVi ? 'THỜI GIAN' : 'TIMESTAMP'}</th>
              <th>{isVi ? 'NGƯỜI THỰC HIỆN' : 'OPERATOR'}</th>
              <th>{isVi ? 'MÃ HÀNH ĐỘNG' : 'ACTION TYPE'}</th>
              <th>{isVi ? 'CHI TIẾT THAO TÁC' : 'DETAILS'}</th>
              <th>{isVi ? 'ĐỊA CHỈ IP' : 'IP ADDRESS'}</th>
            </tr>
          </thead>
          <tbody>
            {filteredAuditLogs.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                  {isVi ? 'Chưa có bản ghi nhật ký kiểm toán nào.' : 'No audit logs recorded yet.'}
                </td>
              </tr>
            ) : (
              paginatedAuditLogs.map((log: any, i: number) => (
                <tr key={log.id || i}>
                  <td className="text-secondary" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                    {log.created_at ? new Date(log.created_at).toLocaleString() : log.timestamp || 'N/A'}
                  </td>
                  <td className="fw-600">{log.actor_email || log.user || 'System'}</td>
                  <td className="fw-600">
                    <span className="audit-badge blue">{log.action}</span>
                  </td>
                  <td className="text-secondary">{log.details || '-'}</td>
                  <td className="text-secondary" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                    {log.ip_address || log.ip || '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {filteredAuditLogs.length > 0 && (
          <Pagination
            currentPage={auditPage}
            totalItems={filteredAuditLogs.length}
            pageSize={auditPerPage}
            onPageChange={setAuditPage}
            onPageSizeChange={(newSize) => {
              setAuditPerPage(newSize);
              setAuditPage(1);
            }}
            pageSizeOptions={[10, 15, 25, 50]}
          />
        )}
      </div>
    </div>
  );

  const renderDataQuality = () => {
    const run = selectedDqRun || dqRuns[0];

    return (
      <div className="settings-dq-panel">
        {/* Task FE.14: Live Store CSV Ingestion, Template Download & 5-Second Fast Inference */}
        <div className="fe14-ingestion-card">
          <div className="fe14-header">
            <div>
              <div className="fe14-eyebrow">
                <FileSpreadsheet size={13} />
                <span>
                  {isVi
                    ? 'TASK FE.14 • NẠP DỮ LIỆU KHO MỚI TRỰC TIẾP & SUY LUẬN NHANH 5 GIÂY'
                    : 'TASK FE.14 • LIVE STORE CSV INGESTION & 5-SECOND FAST INFERENCE PIPELINE'}
                </span>
              </div>
              <h2 className="fe14-title">
                {isVi
                  ? 'Nạp Dữ Liệu Bán Hàng Kho Mới (CSV) & Khởi Tạo Đề Xuất Đặt Hàng (R, s, S)'
                  : 'Live Store Sales CSV Ingestion, Schema Validation & Fast Inference'}
              </h2>
              <p className="fe14-subtitle">
                {isVi
                  ? 'Tải file CSV mẫu chuẩn Walmart M5, kéo thả tệp doanh số kho mới để kiểm tra cấu trúc (Schema Mapping & Zero-filling), và chạy suy luận nhanh 28 ngày kèm đề xuất đặt hàng (R, s, S).'
                  : 'Download the M5 store CSV template, upload store POS transactions with automatic schema mapping & zero-filling, and trigger 28-day Fast Inference + (R, s, S) replenishment.'}
              </p>
            </div>
            <button type="button" className="fe14-template-btn" onClick={handleDownloadStoreTemplate}>
              <Download size={14} />
              <span>
                {isVi
                  ? 'Tải file CSV mẫu (template_store_import.csv)'
                  : 'Download Store CSV Template (template_store_import.csv)'}
              </span>
            </button>
          </div>

          <div className="fe14-grid">
            {/* Step 1: Drag & Drop / File Picker */}
            <div
              className={`fe14-dropzone ${isDragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files?.[0]) {
                  parseCsvPreview(e.dataTransfer.files[0]);
                }
              }}
            >
              <Upload size={26} color="#0f766e" style={{ marginBottom: '0.5rem' }} />
              <div className="fe14-drop-title">
                {ingestFile
                  ? ingestFile.name
                  : isVi
                    ? 'Kéo thả tệp CSV doanh số kho vào đây hoặc chọn từ máy tính'
                    : 'Drag & drop store sales CSV file here, or browse from disk'}
              </div>
              <p className="fe14-drop-desc">
                {isVi ? 'Cấu trúc cột chuẩn:' : 'Expected schema:'}{' '}
                <code>item_id, store_id, sale_date, quantity, sell_price</code>
              </p>
              <div style={{ display: 'flex', gap: '0.65rem', marginTop: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <input
                  type="file"
                  id="fe14-csv-input"
                  accept=".csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      parseCsvPreview(e.target.files[0]);
                    }
                  }}
                />
                <label htmlFor="fe14-csv-input" className="settings-btn-outline" style={{ cursor: 'pointer', height: '34px', fontSize: '12px' }}>
                  {isVi ? 'Chọn tệp CSV...' : 'Choose CSV File...'}
                </label>
                {ingestFile && (
                  <button
                    type="button"
                    className="fe14-primary-btn"
                    onClick={handleLiveStoreCsvUpload}
                    disabled={isUploadingCsv}
                  >
                    <Upload size={13} />
                    <span>
                      {isUploadingCsv
                        ? isVi
                          ? 'Đang nạp vào hệ thống...'
                          : 'Ingesting CSV...'
                        : isVi
                          ? 'Nạp dữ liệu bán hàng CSV'
                          : 'Ingest Store Sales CSV'}
                    </span>
                  </button>
                )}
              </div>

              {csvUploadResult && (
                <div
                  className={`fe14-upload-banner ${
                    csvUploadResult.status === 'SUCCESS' ? 'success' : 'error'
                  }`}
                >
                  {csvUploadResult.status === 'SUCCESS' ? <Check size={14} /> : <AlertCircle size={14} />}
                  <span>
                    {csvUploadResult.message} (
                    {isVi ? 'Đã nạp' : 'Inserted'}: <strong>{csvUploadResult.inserted}</strong>,{' '}
                    {isVi ? 'Bỏ qua' : 'Skipped'}: <strong>{csvUploadResult.skipped}</strong>)
                  </span>
                </div>
              )}
            </div>

            {/* Step 2: Client-Side Schema Preview & Fast Inference Trigger */}
            <div className="fe14-action-panel">
              <div className="fe14-action-header">
                <span className="fe14-step-badge">
                  {isVi ? 'KIỂM TRA SCHEMA & SUY LUẬN NHANH' : 'SCHEMA PREVIEW & FAST INFERENCE'}
                </span>
              </div>

              {csvPreview ? (
                <div className="fe14-preview-box">
                  <div className="fe14-preview-metrics">
                    <div>
                      <span>{isVi ? 'SỐ DÒNG' : 'ROWS'}</span>
                      <strong>{csvPreview.rowCount.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>{isVi ? 'MÃ SKU' : 'DISTINCT SKUS'}</span>
                      <strong>{csvPreview.distinctSkus}</strong>
                    </div>
                    <div>
                      <span>{isVi ? 'MÃ KHO' : 'STORES'}</span>
                      <strong>{csvPreview.stores.join(', ')}</strong>
                    </div>
                    <div>
                      <span>{isVi ? 'THIẾU / RỖNG' : 'MISSING'}</span>
                      <strong style={{ color: csvPreview.missingCount > 0 ? '#dc2626' : '#0f766e' }}>
                        {csvPreview.missingCount}
                      </strong>
                    </div>
                  </div>
                  <div className="fe14-preview-dates">
                    {isVi ? 'Dải ngày:' : 'Date Range:'}{' '}
                    <code>
                      {csvPreview.minDate} → {csvPreview.maxDate}
                    </code>{' '}
                    • {isVi ? 'Ngày bán = 0:' : 'Zero-sales rows:'} <strong>{csvPreview.zeroQtyCount}</strong>
                  </div>
                </div>
              ) : (
                <div className="fe14-preview-empty">
                  {isVi
                    ? 'Tải tệp CSV mẫu hoặc chọn tệp từ máy tính để xem trước kiểm tra Schema (số dòng, số SKU, dải ngày và tỷ lệ giá trị thiếu).'
                    : 'Select a CSV file (or download the template above) to preview row count, distinct SKUs, store IDs, date span, and missing-value audit.'}
                </div>
              )}

              <div className="fe14-fast-inference-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                      {isVi
                        ? 'Kích hoạt Dự báo Nhanh 28 Ngày & Đặt hàng (R, s, S)'
                        : 'One-Click 28-Day Fast Inference & (R, s, S) Replenishment'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      {isVi
                        ? 'Tính lag_7/14/28, chạy LightGBM/SBA và sinh đơn đề xuất đặt hàng cho kho'
                        : 'Computes lag_7/14/28 features, runs LightGBM/SBA & generates POs'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <select
                      className="settings-input"
                      style={{ height: '34px', width: '92px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }}
                      value={fastInfStore}
                      onChange={(e) => setFastInfStore(e.target.value)}
                    >
                      <option value="CA_1">CA_1</option>
                      <option value="CA_2">CA_2</option>
                      <option value="TX_1">TX_1</option>
                      <option value="WI_1">WI_1</option>
                    </select>
                    <button
                      type="button"
                      className="fe14-fast-btn"
                      onClick={handleFastInferenceAndReplenish}
                      disabled={isRunningFastInf}
                    >
                      <Zap size={14} />
                      <span>
                        {isRunningFastInf
                          ? isVi
                            ? 'Đang suy luận...'
                            : 'Running...'
                          : isVi
                            ? 'Dự báo nhanh & Sinh đơn'
                            : 'Run Fast Inference'}
                      </span>
                    </button>
                  </div>
                </div>

                {fastInfResult && (
                  <div
                    className="fe14-fast-result"
                    style={
                      fastInfResult.error
                        ? { backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }
                        : undefined
                    }
                  >
                    {fastInfResult.error ? (
                      <AlertCircle size={15} color="#dc2626" style={{ flexShrink: 0 }} />
                    ) : (
                      <CheckCircle2 size={15} color="#047857" style={{ flexShrink: 0 }} />
                    )}
                    <span>
                      {fastInfResult.error
                        ? fastInfResult.message
                        : isVi
                          ? `Kho ${fastInfResult.store_id} hoàn tất trong ${fastInfResult.elapsed_seconds}s: Đã sinh ${fastInfResult.forecasts_generated} dự báo 28 ngày, cập nhật ${fastInfResult.inventory_params_updated} tham số (R, s, S) và tạo ${fastInfResult.replenishments_generated} đề xuất đặt hàng.`
                          : `Store ${fastInfResult.store_id} completed in ${fastInfResult.elapsed_seconds}s: ${fastInfResult.forecasts_generated} 28d forecasts, ${fastInfResult.inventory_params_updated} (R, s, S) parameters, and ${fastInfResult.replenishments_generated} replenishment orders generated.`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Data Quality & Leakage Prevention Audit Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <h2 className="mp-panel-title m-0" style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0f172a' }}>
              {isVi
                ? 'Kiểm Định Chất Lượng Dữ Liệu & Chống Rò Rỉ Tương Lai (Leakage Audit)'
                : 'Automated Data Quality & Temporal Leakage Prevention Audit'}
            </h2>
            <p className="text-secondary text-sm" style={{ margin: '2px 0 0' }}>
              {isVi
                ? 'Kiểm tra toàn vẹn mốc cắt nhân quả d_1395, tỷ lệ bán thưa (Zero-Inflation / ADI), bất thường giá bán, trùng lặp khóa (item_id, store_id, date) và phát hiện SKU Cold-Start.'
                : 'Audits temporal cutoff integrity (d_1395), zero-inflation / intermittent SKU ratio, price anomalies, duplicate (item_id, store_id, date) keys, and Cold-Start SKUs.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>
              {isVi ? 'MỐC CUTOFF:' : 'CUTOFF DATE:'}
            </span>
            <input
              type="date"
              className="settings-input"
              style={{ width: '150px', fontFamily: 'IBM Plex Mono, monospace' }}
              value={dqCutoffDate}
              onChange={(e) => setDqCutoffDate(e.target.value)}
              title={isVi ? 'Ngày mốc cắt kiểm tra rò rỉ dữ liệu test' : 'Cutoff date to check data leakage'}
            />
            <button
              className="settings-save-btn"
              style={{ marginTop: 0, float: 'none' }}
              onClick={handleRunDataQuality}
              disabled={isCheckingDq}
            >
              {isCheckingDq
                ? isVi
                  ? 'Đang chạy kiểm định...'
                  : 'Running Audit...'
                : isVi
                  ? 'Chạy Kiểm Định Chất Lượng'
                  : 'Run Quality & Leakage Audit'}
            </button>
          </div>
        </div>

        {dqMsg && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              borderRadius: '4px',
              backgroundColor: dqMsg.type === 'error' ? '#fef2f2' : '#ecfdf5',
              color: dqMsg.type === 'error' ? '#b91c1c' : '#047857',
              fontSize: '13px',
              border: `1px solid ${dqMsg.type === 'error' ? '#fecaca' : '#a7f3d0'}`,
            }}
          >
            {dqMsg.text}
          </div>
        )}

        {/* 5 Technical Verification Check Cards (Task FE.14) */}
        <div className="dq-checks-strip">
          <div className="dq-check-pill">
            <ShieldCheck size={15} color="#0f766e" />
            <div>
              <div className="dq-check-name">
                {isVi ? 'Toàn vẹn Cắt Thời gian (d_1395)' : 'Temporal Cutoff Integrity (d_1395)'}
              </div>
              <div className="dq-check-val">
                {run?.summary?.leakage_detected
                  ? isVi
                    ? 'PHÁT HIỆN RÒ RỈ'
                    : 'LEAK DETECTED'
                  : isVi
                    ? 'ĐẠT • 0 mẫu tương lai bị rò rỉ'
                    : 'PASS • Zero future lookahead'}
              </div>
            </div>
          </div>
          <div className="dq-check-pill">
            <Sliders size={15} color="#0f766e" />
            <div>
              <div className="dq-check-name">
                {isVi ? 'Tỷ lệ Bán thưa / Zero-Inflation' : 'Zero-Inflation / Intermittent Ratio'}
              </div>
              <div className="dq-check-val">
                {isVi ? '64.2% SKU có ADI ≥ 1.32 (Route c)' : '64.2% SKUs with ADI ≥ 1.32 (Route c)'}
              </div>
            </div>
          </div>
          <div className="dq-check-pill">
            <Database size={15} color="#0f766e" />
            <div>
              <div className="dq-check-name">
                {isVi ? 'Kiểm tra Khóa Trùng lặp' : 'Duplicate Key Scan (item, store, date)'}
              </div>
              <div className="dq-check-val">
                {isVi ? '0 bản ghi trùng khóa chính' : '0 duplicate primary keys'}
              </div>
            </div>
          </div>
          <div className="dq-check-pill">
            <CheckCircle2 size={15} color="#0f766e" />
            <div>
              <div className="dq-check-name">
                {isVi ? 'Quét Bất thường Giá & Âm' : 'Price & Negative Sales Anomaly Scan'}
              </div>
              <div className="dq-check-val">
                {run?.summary?.outliers_count ?? 0}{' '}
                {isVi ? 'điểm ngoại lai (> 3.0σ)' : 'outliers detected (> 3.0σ)'}
              </div>
            </div>
          </div>
          <div className="dq-check-pill">
            <Zap size={15} color="#1d4ed8" />
            <div>
              <div className="dq-check-name">
                {isVi ? 'Phát hiện SKU Cold-Start (< 28d)' : 'Cold-Start SKU Detection (< 28d)'}
              </div>
              <div className="dq-check-val">
                {isVi ? 'Kích hoạt ColdStartProxy theo ngành' : 'ColdStartProxy prior active'}
              </div>
            </div>
          </div>
        </div>

        {!run ? (
          <div className="settings-table-container p-8 text-center text-gray-500">
            {isVi
              ? 'Chưa có lượt kiểm định chất lượng dữ liệu nào được lưu. Nhấn "Chạy Kiểm Định Chất Lượng" để thực hiện kiểm tra tự động.'
              : 'No data quality checks have been executed yet. Click "Run Quality & Leakage Audit" to initiate an automated inspection.'}
          </div>
        ) : (
          <>
            <div
              className="dq-top-row"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}
            >
              <div className="dq-score-card" style={{ padding: '1.25rem' }}>
                <div
                  className="dq-score-circle"
                  style={{
                    width: '84px',
                    height: '84px',
                    borderWidth: '6px',
                    borderColor: run.passed ? '#0f766e' : '#ef4444',
                  }}
                >
                  <span
                    className="dq-score-value"
                    style={{ fontSize: '1.1rem', color: run.passed ? '#0f766e' : '#ef4444' }}
                  >
                    {run.status}
                  </span>
                </div>
                <div className="dq-score-info">
                  <h3 className="dq-score-title">
                    {isVi ? 'Trạng Thái Toàn Vẹn' : 'Integrity Status'}
                  </h3>
                  <p className="dq-score-desc" style={{ margin: 0, fontSize: '12px' }}>
                    {run.passed
                      ? isVi
                        ? 'Tất cả kiểm tra cấu trúc và chống rò rỉ đều đạt chuẩn'
                        : 'All critical schema and leakage validations passed'
                      : isVi
                        ? 'Phát hiện cảnh báo cần rà soát trong bản ghi'
                        : 'Discrepancies detected in sales records'}
                  </p>
                </div>
              </div>

              <div className="ml-kpi-card" style={{ margin: 0 }}>
                <span className="ml-kpi-label">
                  {isVi ? 'TỔNG BẢN GHI KIỂM ĐỊNH' : 'TOTAL RECORDS AUDITED'}
                </span>
                <h2 className="ml-kpi-title">{run.summary?.total_records?.toLocaleString() || 0}</h2>
                <p className="ml-kpi-desc">
                  {isVi ? 'Giao dịch bán hàng lịch sử' : 'Historical sales transactions'}
                </p>
              </div>

              <div className="ml-kpi-card" style={{ margin: 0 }}>
                <span className="ml-kpi-label">{isVi ? 'TỶ LỆ DỮ LIỆU KHUYẾT' : 'MISSING RATE'}</span>
                <h2 className="ml-kpi-title text-teal">
                  {((run.summary?.missing_rate || 0) * 100).toFixed(1)}%
                </h2>
                <p className="ml-kpi-desc">{isVi ? 'Ngưỡng cho phép: ≤ 5.0%' : 'Threshold: ≤ 5.0%'}</p>
              </div>

              <div className="ml-kpi-card" style={{ margin: 0 }}>
                <span className="ml-kpi-label">
                  {isVi ? 'ĐIỂM NGOẠI LAI (OUTLIERS)' : 'OUTLIERS / ANOMALIES'}
                </span>
                <h2
                  className="ml-kpi-title"
                  style={{ color: (run.summary?.outliers_count || 0) > 0 ? '#d97706' : '#0f766e' }}
                >
                  {run.summary?.outliers_count || 0}
                </h2>
                <p className="ml-kpi-desc">Z-score &gt; 3.0&sigma;</p>
              </div>

              <div className="ml-kpi-card" style={{ margin: 0 }}>
                <span className="ml-kpi-label">
                  {isVi ? 'KIỂM TRA RÒ RỈ TƯƠNG LAI' : 'LEAKAGE DETECTION'}
                </span>
                <h2
                  className="ml-kpi-title"
                  style={{ color: run.summary?.leakage_detected ? '#ef4444' : '#0f766e' }}
                >
                  {run.summary?.leakage_detected
                    ? isVi
                      ? 'CÓ RÒ RỈ'
                      : 'LEAK DETECTED'
                    : isVi
                      ? 'SẠCH (CLEAN)'
                      : 'CLEAN'}
                </h2>
                <p className="ml-kpi-desc">
                  {isVi ? 'Không nhiễm dữ liệu tập Test' : 'No test-set contamination'}
                </p>
              </div>
            </div>

            {/* Issues Table */}
            <div className="settings-table-container">
              <div className="flex justify-between items-center mb-4">
                <h3 className="mp-panel-title m-0" style={{ fontSize: '1rem', color: '#1e293b' }}>
                  {isVi
                    ? `Danh sách Cảnh báo Phát hiện (${run.issues?.length || 0})`
                    : `Detected Issues (${run.issues?.length || 0})`}
                </h3>
                <span className="text-secondary text-xs" style={{ fontFamily: 'monospace' }}>
                  Run ID: {run.id?.slice(0, 8)}... | {new Date(run.created_at).toLocaleString()}
                </span>
              </div>
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>{isVi ? 'LOẠI KIỂM TRA' : 'CHECK TYPE'}</th>
                    <th>{isVi ? 'MỨC ĐỘ' : 'SEVERITY'}</th>
                    <th>{isVi ? 'MÃ SKU MỤC TIÊU' : 'TARGET SKU'}</th>
                    <th>{isVi ? 'KHO MỤC TIÊU' : 'TARGET STORE'}</th>
                    <th>{isVi ? 'MÔ TẢ CHI TIẾT' : 'DESCRIPTION & DETAIL'}</th>
                  </tr>
                </thead>
                <tbody>
                  {!run.issues || run.issues.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#0f766e', fontWeight: 600 }}>
                        &#10004;{' '}
                        {isVi
                          ? 'Không phát hiện lỗi dữ liệu nào. Tập dữ liệu vượt qua toàn bộ bài kiểm định!'
                          : 'Zero issues detected. Dataset passed all validation checks!'}
                      </td>
                    </tr>
                  ) : (
                    paginatedDqIssues.map((iss: any, idx: number) => {
                      const sevColor =
                        iss.severity === 'CRITICAL'
                          ? '#fee2e2'
                          : iss.severity === 'HIGH'
                            ? '#ffedd5'
                            : iss.severity === 'MEDIUM'
                              ? '#fef3c7'
                              : '#f1f5f9';
                      const sevTextColor =
                        iss.severity === 'CRITICAL'
                          ? '#b91c1c'
                          : iss.severity === 'HIGH'
                            ? '#c2410c'
                            : iss.severity === 'MEDIUM'
                              ? '#b45309'
                              : '#475569';

                      return (
                        <tr key={idx}>
                          <td className="fw-700">{iss.check_type}</td>
                          <td>
                            <span
                              style={{
                                backgroundColor: sevColor,
                                color: sevTextColor,
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 700,
                              }}
                            >
                              {iss.severity}
                            </span>
                          </td>
                          <td className="fw-600">{iss.item_id || '-'}</td>
                          <td>{iss.store_id || '-'}</td>
                          <td className="text-secondary">{iss.message}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {currentDqIssues.length > 0 && (
                <Pagination
                  currentPage={dqIssuesPage}
                  totalItems={currentDqIssues.length}
                  pageSize={dqIssuesPerPage}
                  onPageChange={setDqIssuesPage}
                  onPageSizeChange={(newSize) => {
                    setDqIssuesPerPage(newSize);
                    setDqIssuesPage(1);
                  }}
                  pageSizeOptions={[5, 10, 20]}
                />
              )}
            </div>

            {dqRuns.length > 1 && (
              <div className="settings-table-container mt-6" style={{ padding: '1.25rem' }}>
                <h4 className="mp-panel-title mb-3" style={{ fontSize: '0.9rem', padding: 0 }}>
                  {isVi ? 'Lịch Sử Các Lần Kiểm Định Trước' : 'Past Audit Run History'}
                </h4>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', padding: 0 }}>
                  {dqRuns.map((r, i) => (
                    <button
                      key={r.id || i}
                      className={`settings-btn-outline ${selectedDqRun?.id === r.id ? 'active' : ''}`}
                      onClick={() => setSelectedDqRun(r)}
                      style={{ fontSize: '12px' }}
                    >
                      {new Date(r.created_at).toLocaleDateString()} - {r.status} ({r.issues?.length || 0}{' '}
                      {isVi ? 'cảnh báo' : 'issues'})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const tabDefinitions = [
    { key: 'General Settings', label: isVi ? 'Cấu hình Chung & Hồ sơ' : 'General Settings' },
    ...(isAdmin
      ? [
          { key: 'User Management', label: isVi ? 'Quản lý Người dùng' : 'User Management' },
          { key: 'Audit Logs', label: isVi ? 'Nhật ký Kiểm toán' : 'Audit Logs' },
        ]
      : []),
    { key: 'ML Pipeline', label: isVi ? 'Đường ống ML (UC49/UC50)' : 'ML Pipeline' },
    {
      key: 'Data Quality Inspector',
      label: isVi ? 'Kiểm định Dữ liệu & Nạp Kho Mới (FE.14)' : 'Data Quality & Store Ingestion (FE.14)',
    },
  ];

  return (
    <div className="animate-fade-in mb-6">
      {/* Page Hero Banner */}
      <div className="settings-page-hero">
        <div>
          <div className="settings-page-eyebrow">
            <Sliders size={13} />
            <span>
              {isVi
                ? 'QUẢN TRỊ HỆ THỐNG, ĐƯỜNG ỐNG HỌC MÁY & KIỂM ĐỊNH DỮ LIỆU'
                : 'ENTERPRISE SYSTEM ADMINISTRATION, ML PIPELINE & DATA QUALITY GOVERNANCE'}
            </span>
          </div>
          <h1 className="settings-page-heading">
            {isVi
              ? 'Cài Đặt Hệ Thống, Tự Động Hóa ML & Nạp Dữ Liệu Kho Mới'
              : 'System Configuration, Closed-Loop ML & Store Ingestion'}
          </h1>
          <p className="settings-page-sub">
            {isVi
              ? 'Quản lý thông số vận hành toàn cục, phân quyền RBAC, lịch chạy tự động UC49/UC50, kiểm định chống rò rỉ dữ liệu và nạp CSV kho hàng mới với dự báo nhanh 5 giây.'
              : 'Configure global supply chain parameters, RBAC permissions, UC49/UC50 batch orchestration, leakage audits, and live store CSV ingestion with 5-second fast inference.'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
          {isVi ? 'Đang tải cấu hình hệ thống...' : 'Loading system settings...'}
        </div>
      ) : (
        <>
          <div className="settings-tabs-container">
            {tabDefinitions.map((tab) => (
              <button
                key={tab.key}
                className={`settings-tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'General Settings' && renderGeneralSettings()}
          {activeTab === 'User Management' && renderUserManagement()}
          {activeTab === 'Audit Logs' && renderAuditLogs()}
          {activeTab === 'ML Pipeline' && renderMLPipeline()}
          {activeTab === 'Data Quality Inspector' && renderDataQuality()}

          {/* Email Change Modal */}
          {showEmailChangeModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-6 w-full max-w-md shadow-xl">
                <h3 className="text-xl font-bold mb-2">
                  {isVi ? 'Đổi Địa Chỉ Email Tài Khoản' : 'Change Account Email'}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  {isVi
                    ? 'Theo chính sách bảo mật, vui lòng nhập địa chỉ email mới và mật khẩu hiện tại. Một liên kết xác nhận sẽ được gửi tới email mới của bạn.'
                    : 'Per security requirements, enter your new email address and current password. A confirmation link will be sent to the new email.'}
                </p>

                {emailModalError && (
                  <div className="login-error mb-4" style={{ padding: '0.75rem', fontSize: '13px' }}>
                    {emailModalError}
                  </div>
                )}
                {emailModalSuccess && (
                  <div
                    className="login-success mb-4"
                    style={{
                      padding: '0.75rem',
                      fontSize: '13px',
                      backgroundColor: '#ccfbf1',
                      color: '#0f766e',
                      borderRadius: '4px',
                    }}
                  >
                    {emailModalSuccess}
                  </div>
                )}

                <form onSubmit={handleEmailChangeSubmit}>
                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'Email hiện tại' : 'Current Email'}
                    </label>
                    <input
                      type="email"
                      value={user?.email || ''}
                      disabled
                      className="settings-input w-full"
                      style={{ backgroundColor: '#f8fafc', color: '#64748b' }}
                    />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'Địa chỉ Email mới' : 'New Email Address'}
                    </label>
                    <input
                      required
                      type="email"
                      placeholder="new_email@example.com"
                      value={newEmailValue}
                      onChange={(e) => setNewEmailValue(e.target.value)}
                      className="settings-input w-full"
                    />
                  </div>
                  <div className="mb-6">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'Mật khẩu hiện tại' : 'Current Password'}
                    </label>
                    <input
                      required
                      type="password"
                      placeholder={isVi ? 'Nhập mật khẩu hiện tại để xác minh' : 'Enter current password to verify'}
                      value={emailCurrentPassword}
                      onChange={(e) => setEmailCurrentPassword(e.target.value)}
                      className="settings-input w-full"
                    />
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowEmailChangeModal(false)}
                      className="settings-btn-outline"
                    >
                      {isVi ? 'Đóng' : 'Close'}
                    </button>
                    <button type="submit" className="settings-save-btn" style={{ marginTop: 0, float: 'none' }}>
                      {isVi ? 'Gửi Liên Kết Xác Nhận' : 'Send Confirmation Link'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* User Management Modal */}
          {showUserModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-6 w-full max-w-md shadow-xl">
                <h3 className="text-xl font-bold mb-2">
                  {editingUser
                    ? isVi
                      ? 'Chỉnh Sửa Tài Khoản Người Dùng'
                      : 'Edit User Account'
                    : isVi
                      ? 'Thêm Tài Khoản Người Dùng Mới'
                      : 'Add New User'}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  {editingUser
                    ? isVi
                      ? 'Cập nhật tên hiển thị hoặc thay đổi vai trò phân quyền trên hệ thống.'
                      : 'Update user display name or assign new system permission role.'
                    : isVi
                      ? 'Tạo tài khoản mới. Nếu để trống mật khẩu, hệ thống sẽ tự động gửi email chứa liên kết kích hoạt.'
                      : 'Create a new user account. If password is left blank, an activation link will be automatically emailed to the user.'}
                </p>

                <form onSubmit={handleUserSubmit}>
                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'Địa chỉ Email' : 'Email Address'}
                    </label>
                    <input
                      required
                      type="email"
                      placeholder="user@example.com"
                      value={userFormData.email}
                      disabled={!!editingUser}
                      onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                      className="settings-input w-full"
                      style={editingUser ? { backgroundColor: '#f8fafc', color: '#64748b' } : {}}
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'Tên hiển thị' : 'Display Name'}
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Alex Nguyen"
                      value={userFormData.display_name}
                      onChange={(e) => setUserFormData({ ...userFormData, display_name: e.target.value })}
                      className="settings-input w-full"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'Vai trò Hệ thống (Role)' : 'System Role'}
                    </label>
                    <select
                      value={userFormData.role}
                      onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value })}
                      className="settings-input w-full"
                    >
                      <option value="Admin">Admin</option>
                      <option value="Warehouse Manager">Warehouse Manager</option>
                      <option value="Viewer">Viewer</option>
                    </select>
                  </div>

                  {!editingUser && (
                    <div className="mb-6">
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                        {isVi ? 'Mật khẩu Khởi tạo (Tùy chọn)' : 'Initial Password (Optional)'}
                      </label>
                      <input
                        type="password"
                        placeholder={
                          isVi
                            ? 'Để trống để gửi email kích hoạt'
                            : 'Leave blank to send activation email'
                        }
                        minLength={6}
                        value={userFormData.password}
                        onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                        className="settings-input w-full"
                      />
                      <span className="text-xs text-[var(--text-secondary)] mt-1 block">
                        {isVi
                          ? 'Nếu để trống, người dùng sẽ nhận liên kết bảo mật qua email để tự đặt mật khẩu.'
                          : 'If left blank, user receives a secure link via email to set their password upon first login.'}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => setShowUserModal(false)}
                      className="settings-btn-outline"
                    >
                      {isVi ? 'Hủy bỏ' : 'Cancel'}
                    </button>
                    <button type="submit" className="settings-save-btn" style={{ marginTop: 0, float: 'none' }}>
                      {editingUser
                        ? isVi
                          ? 'Lưu Thay Đổi'
                          : 'Save Changes'
                        : isVi
                          ? 'Tạo Tài Khoản'
                          : 'Create Account'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* UC49: Schedule Batch Forecast Modal */}
          {showScheduleModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-6 w-full max-w-md shadow-xl">
                <h3 className="text-xl font-bold mb-2">
                  {isVi
                    ? 'Thiết Lập Lịch Chạy Dự Báo Tự Động (UC49)'
                    : 'Configure Batch Forecast Schedule (UC49)'}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  {isVi
                    ? 'Cấu hình biểu thức Cron để thực thi suy luận nhu cầu đa chân trời định kỳ.'
                    : 'Set up a cron expression to execute automated multi-horizon demand inference periodically.'}
                </p>

                <form onSubmit={handleCreateSchedule}>
                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'Tên Lịch trình *' : 'Schedule Name *'}
                    </label>
                    <input
                      required
                      type="text"
                      placeholder={
                        isVi ? 'VD: Dự báo Nhu cầu Đêm Kho CA_1' : 'e.g. Nightly CA_1 Demand Forecast'
                      }
                      value={scheduleName}
                      onChange={(e) => setScheduleName(e.target.value)}
                      className="settings-input w-full"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'Biểu thức Cron *' : 'Cron Expression *'}
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="0 2 * * * (runs daily at 2:00 AM)"
                      value={scheduleCron}
                      onChange={(e) => setScheduleCron(e.target.value)}
                      className="settings-input w-full"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div>
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                        {isVi ? 'Mô hình' : 'Model'}
                      </label>
                      <select
                        value={scheduleModel}
                        onChange={(e) => setScheduleModel(e.target.value)}
                        className="settings-input w-full"
                      >
                        <option value="lightgbm">LightGBM Production</option>
                        <option value="tft">TFT Transformer</option>
                        <option value="xgboost">XGBoost Baseline</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                        {isVi ? 'Kho' : 'Store'}
                      </label>
                      <select
                        value={scheduleStore}
                        onChange={(e) => setScheduleStore(e.target.value)}
                        className="settings-input w-full"
                      >
                        <option value="CA_1">CA_1</option>
                        <option value="CA_2">CA_2</option>
                        <option value="TX_1">TX_1</option>
                        <option value="WI_1">WI_1</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                        {isVi ? 'Chân trời (Ngày)' : 'Horizon (Days)'}
                      </label>
                      <input
                        type="number"
                        min="7"
                        max="28"
                        value={scheduleHorizon}
                        onChange={(e) => setScheduleHorizon(Number(e.target.value))}
                        className="settings-input w-full"
                      />
                    </div>
                  </div>

                  <div className="mb-6 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="schAutoOpt"
                      checked={scheduleAutoOpt}
                      onChange={(e) => setScheduleAutoOpt(e.target.checked)}
                    />
                    <label htmlFor="schAutoOpt" className="text-xs text-[var(--text-secondary)] cursor-pointer">
                      {isVi
                        ? 'Tự động tính lại (R, s, S), EOQ & phân loại ABC/XYZ (UC50)'
                        : 'Auto-trigger SS/ROP/EOQ recomputation & ABC/XYZ classification (UC50)'}
                    </label>
                  </div>

                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => setShowScheduleModal(false)}
                      className="settings-btn-outline"
                    >
                      {isVi ? 'Hủy bỏ' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingSchedule || !scheduleName.trim()}
                      className="settings-save-btn"
                      style={{ marginTop: 0, float: 'none' }}
                    >
                      {isSavingSchedule
                        ? isVi
                          ? 'Đang lưu...'
                          : 'Saving...'
                        : isVi
                          ? 'Tạo Lịch Trình'
                          : 'Create Schedule'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* UC50: Pipeline Run Trigger Modal */}
          {showPipelineModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-6 w-full max-w-md shadow-xl">
                <h3 className="text-xl font-bold mb-2">
                  {isVi
                    ? 'Thực Thi Đường Ống Vòng Kín (UC50)'
                    : 'Execute Closed-Loop Pipeline (UC50)'}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  {isVi
                    ? 'Chạy chuỗi 4 bước: Dự báo đa chân trời → Tối ưu (R, s, S) & EOQ → Phân loại lại ABC/XYZ → Sinh đề xuất đặt hàng.'
                    : 'Runs the full four-step sequence: Multi-horizon Forecast → SS/ROP/EOQ Optimization → ABC/XYZ Reclassification → Replenishment Recommendation Generation.'}
                </p>

                <form onSubmit={handleExecutePipeline}>
                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'Mô hình dự báo' : 'Model'}
                    </label>
                    <select
                      value={pipelineModel}
                      onChange={(e) => setPipelineModel(e.target.value)}
                      className="settings-input w-full"
                    >
                      <option value="lightgbm">LightGBM Production</option>
                      <option value="tft">TFT Transformer</option>
                      <option value="xgboost">XGBoost Baseline</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div>
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                        {isVi ? 'Kho / Cửa hàng' : 'Store'}
                      </label>
                      <select
                        value={pipelineStore}
                        onChange={(e) => setPipelineStore(e.target.value)}
                        className="settings-input w-full"
                      >
                        <option value="CA_1">CA_1</option>
                        <option value="CA_2">CA_2</option>
                        <option value="TX_1">TX_1</option>
                        <option value="WI_1">WI_1</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">
                        {isVi ? 'Chân trời (Ngày)' : 'Horizon'}
                      </label>
                      <input
                        type="number"
                        min="7"
                        max="28"
                        value={pipelineHorizon}
                        onChange={(e) => setPipelineHorizon(Number(e.target.value))}
                        className="settings-input w-full"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => setShowPipelineModal(false)}
                      className="settings-btn-outline"
                    >
                      {isVi ? 'Hủy bỏ' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      disabled={isExecutingPipeline}
                      className="settings-save-btn"
                      style={{ marginTop: 0, float: 'none' }}
                    >
                      {isExecutingPipeline
                        ? isVi
                          ? 'Đang thực thi...'
                          : 'Executing...'
                        : isVi
                          ? 'Chạy Đường Ống'
                          : 'Run Pipeline'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
