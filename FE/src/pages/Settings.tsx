import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api } from '../services/api.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import './Settings.css';

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

  // Password card states (show/hide & scoped message)
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
  const [systemSettingMsg, setSystemSettingMsg] = useState('');
  const [isSavingSystemSetting, setIsSavingSystemSetting] = useState(false);

  // Data Quality Runs
  const [dqRuns, setDqRuns] = useState<any[]>([]);
  const [selectedDqRun, setSelectedDqRun] = useState<any>(null);
  const [isCheckingDq, setIsCheckingDq] = useState(false);
  const [dqCutoffDate, setDqCutoffDate] = useState('');
  const [dqMsg, setDqMsg] = useState('');

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
        const sysRes = await api.settings.getSystemSettings().catch(() => ({ settings: {}, items: [] }));
        const settingsDict = sysRes?.settings || {};
        setSystemSettings(settingsDict);
        if (settingsDict.timezone) setSettingTimezone(settingsDict.timezone);
        if (settingsDict.currency) setSettingCurrency(settingsDict.currency);
        if (settingsDict.forecast_horizons) {
          setSettingHorizons(Array.isArray(settingsDict.forecast_horizons) ? settingsDict.forecast_horizons.join(', ') : String(settingsDict.forecast_horizons));
        }
      } catch (error) {
        console.error('Failed to load settings data', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchInitialSettings();
  }, []);

  // Lazy tab data loading for sub-tabs to maximize load speed
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
        api.ml.listAllTrainJobs().then(res => setTrainJobs(res.list || [])).catch(() => []),
        api.ml.getAllModels().then(res => setModelsList(res.list || [])).catch(() => []),
        api.ml.listBatchSchedules().then(res => setBatchSchedules(res.items || [])).catch(() => []),
      ]);
    } else if (activeTab === 'Data Quality Inspector' && dqRuns.length === 0) {
      api.ml.listAllDataQualityRuns().then(res => {
        const list = res.list || [];
        setDqRuns(list);
        if (list.length > 0) setSelectedDqRun(list[0]);
      }).catch(() => []);
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
      setSettingsMessage(isVi ? 'Cập nhật tên hiển thị tài khoản thành công!' : 'Account display name updated successfully!');
    } catch (error: any) {
      setSettingsMessage(error.response?.data?.detail || (isVi ? 'Không thể cập nhật thông tin tài khoản.' : 'Failed to update account information.'));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordChange = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPasswordMessage(null);

    if (!currentPassword) {
      setPasswordMessage({ text: 'Please enter your current password.', type: 'error' });
      return;
    }
    if (!newPassword) {
      setPasswordMessage({ text: 'Please enter a new password.', type: 'error' });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMessage({ text: 'New password must be at least 6 characters.', type: 'error' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ text: 'New password and confirmation do not match.', type: 'error' });
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
      setPasswordMessage({ text: 'Password updated successfully!', type: 'success' });
    } catch (error: any) {
      const errDetail = error.response?.data?.detail;
      const msg = typeof errDetail === 'string'
        ? errDetail
        : Array.isArray(errDetail)
          ? errDetail.map((d: any) => d.msg).join(', ')
          : 'Could not update password. Please check your current password.';
      setPasswordMessage({ text: msg, type: 'error' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSaveSystemSettings = async () => {
    if (!isAdmin) {
      setSystemSettingMsg('Permission denied: Only Admin can update system settings.');
      return;
    }
    setIsSavingSystemSetting(true);
    setSystemSettingMsg('');
    try {
      const horizons = settingHorizons
        .split(',')
        .map((h) => parseInt(h.trim()))
        .filter((h) => !isNaN(h) && h > 0);

      if (horizons.length === 0) {
        setSystemSettingMsg('Forecast horizons must contain at least one positive integer (e.g. 7, 14, 28).');
        setIsSavingSystemSetting(false);
        return;
      }

      await Promise.all([
        api.settings.updateSystemSetting('timezone', settingTimezone.trim()),
        api.settings.updateSystemSetting('currency', settingCurrency.trim()),
        api.settings.updateSystemSetting('forecast_horizons', horizons),
      ]);

      setSystemSettingMsg('System global parameters updated successfully.');
      const updated = await api.settings.getSystemSettings();
      setSystemSettings(updated.settings || {});
    } catch (e: any) {
      setSystemSettingMsg(e.response?.data?.detail || 'Failed to update system settings.');
    } finally {
      setIsSavingSystemSetting(false);
    }
  };

  const handleRunDataQuality = async () => {
    setIsCheckingDq(true);
    setDqMsg('');
    try {
      const payload: any = {};
      if (dqCutoffDate.trim()) {
        payload.cutoff_date = dqCutoffDate.trim();
      }
      const res = await api.ml.runDataQuality(payload);
      setDqMsg(`Data quality check completed. Status: ${res.status} (${res.issues?.length || 0} issues detected).`);
      const updatedList = await api.ml.listDataQualityRuns();
      setDqRuns(updatedList.list || []);
      setSelectedDqRun(res);
    } catch (e: any) {
      setDqMsg(e.response?.data?.detail || 'Failed to run data quality check.');
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
      alert(e.response?.data?.detail || 'Failed to update user status');
    }
  };

  const handleDeleteUser = async (id: string, userEmail: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete user "${userEmail}"?`)) return;
    try {
      await api.settings.deleteUser(id);
      await loadUsers();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to delete user');
    }
  };

  const handleResendActivation = async (id: string) => {
    try {
      const res = await api.settings.resendActivation(id);
      alert(res.message || 'Activation email has been sent successfully.');
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to resend activation link');
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
      setEmailModalSuccess(res.message || 'Confirmation link sent to your new email. Please check your inbox.');
      setEmailCurrentPassword('');
    } catch (err: any) {
      setEmailModalError(err.response?.data?.detail || 'Failed to request email change.');
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
      alert(e.response?.data?.detail || 'Failed to create schedule');
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this batch forecast schedule?')) return;
    try {
      await api.ml.deleteBatchSchedule(id);
      const res = await api.ml.listBatchSchedules();
      setBatchSchedules(res.items || []);
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Failed to delete schedule');
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
      alert(e.response?.data?.detail || 'Pipeline execution failed');
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
      alert(e.response?.data?.detail || 'Failed to save user');
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
    const isActive = u.is_active ?? (u.status === 'ACTIVE');
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
    const matchesAction = auditActionFilter === 'All' || log.action?.toLowerCase().includes(auditActionFilter.toLowerCase());
    const search = auditSearchTerm.toLowerCase();
    const matchesSearch =
      !search ||
      (log.actor_email || log.user || '').toLowerCase().includes(search) ||
      (log.action || '').toLowerCase().includes(search) ||
      (log.details || '').toLowerCase().includes(search);
    return matchesAction && matchesSearch;
  });

  // Reset pagination on filter changes
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
              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || user?.display_name || profileName || user?.email || 'User')}&background=0D8ABC&color=fff`}
              alt="Profile"
              className="profile-img"
            />
          </div>
          <div className="profile-info">
            <h2 className="profile-name">{user?.name || user?.display_name || profileName || user?.email}</h2>
            <div className="profile-badge">{role}</div>
            <div className="profile-since">{user?.is_verified ? 'Verified account' : 'Active account'}</div>
          </div>
        </div>

        <div className="settings-divider"></div>

        <h3 className="text-md font-bold text-gray-800 mb-3">User Profile</h3>
        <div className="settings-group">
          <label className="settings-label">Display Name</label>
          <input
            type="text"
            className="settings-input"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
        </div>

        <div className="settings-group" style={{ marginTop: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <label className="settings-label" style={{ margin: 0 }}>Account Email</label>
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: '#0d9488', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
              onClick={() => {
                setNewEmailValue('');
                setEmailCurrentPassword('');
                setEmailModalError('');
                setEmailModalSuccess('');
                setShowEmailChangeModal(true);
              }}
            >
              Change Email Address
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
          <div className="login-success" style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '6px', backgroundColor: '#ecfdf5', color: '#047857' }}>
            {settingsMessage}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button
            className="settings-save-btn"
            onClick={handleProfileSave}
            disabled={isSavingProfile}
          >
            {isSavingProfile ? 'Saving Changes...' : 'Save Profile Changes'}
          </button>
        </div>

        <div className="settings-divider" style={{ margin: '1.5rem 0' }}></div>

        {/* Global System Settings */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h3 className="text-md font-bold text-gray-800">System Parameters</h3>
              <p className="text-xs text-gray-500">Configure global timezone, currency, and forecast horizons.</p>
            </div>
            {!isAdmin && (
              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                Read-only (Admin required)
              </span>
            )}
          </div>

          <div className="settings-row" style={{ marginBottom: '1rem' }}>
            <div className="settings-group">
              <label className="settings-label">IANA Timezone</label>
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
              <label className="settings-label">Default Currency</label>
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
            <label className="settings-label">Demand Forecast Horizons (Days, comma-separated)</label>
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
                borderRadius: '6px',
                backgroundColor: systemSettingMsg.includes('success') ? '#ecfdf5' : '#fef2f2',
                color: systemSettingMsg.includes('success') ? '#047857' : '#b91c1c',
                fontSize: '13px',
              }}
            >
              {systemSettingMsg}
            </div>
          )}

          {isAdmin && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="settings-save-btn"
                onClick={handleSaveSystemSettings}
                disabled={isSavingSystemSetting}
              >
                {isSavingSystemSetting ? 'Saving Settings...' : 'Update System Parameters'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="settings-right-panel">
        <div className="settings-side-card">
          <h2 className="settings-side-title">Change Password</h2>

          <form onSubmit={handlePasswordChange}>
            {/* Current Password */}
            <div className="settings-group" style={{ marginBottom: '1rem' }}>
              <label className="settings-label">Current Password</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  className="settings-input"
                  style={{ width: '100%', paddingRight: '2.5rem' }}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
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
                  title={showCurrentPassword ? 'Hide password' : 'Show password'}
                >
                  {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div className="settings-group" style={{ marginBottom: '1rem' }}>
              <label className="settings-label">New Password</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  className="settings-input"
                  style={{ width: '100%', paddingRight: '2.5rem' }}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min. 6 chars)"
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
                  title={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Confirm New Password */}
            <div className="settings-group" style={{ marginBottom: '1rem' }}>
              <label className="settings-label">Confirm New Password</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="settings-input"
                  style={{ width: '100%', paddingRight: '2.5rem' }}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
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
                  title={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Validation & Success Message displayed INSIDE Change Password card */}
            {passwordMessage && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '6px',
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
              <button
                type="submit"
                className="settings-save-btn"
                disabled={isChangingPassword}
              >
                {isChangingPassword ? 'Updating Password...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>

        <div className="settings-side-card">
          <h2 className="settings-side-title">System Health & Metadata</h2>
          <div className="login-activity-item">
            <div className="login-activity-main">
              <span className="login-activity-loc">Active Database Connection</span>
              <span className="login-activity-time text-teal font-semibold">Online</span>
            </div>
            <div className="login-activity-desc success">Connected to Supabase PostgreSQL</div>
          </div>
          <div className="login-activity-item" style={{ marginTop: '0.75rem' }}>
            <div className="login-activity-main">
              <span className="login-activity-loc">Active Timezone</span>
              <span className="login-activity-time">{systemSettings.timezone || 'Asia/Ho_Chi_Minh'}</span>
            </div>
            <div className="login-activity-desc success">Operational timestamp alignment</div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderUserManagement = () => (
    <>
      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-bold mb-4">{editingUser ? 'Edit User Profile' : 'Add New User'}</h3>
            <form onSubmit={handleUserSubmit}>
              <div className="mb-4">
                <label className="block text-sm mb-1 text-[var(--text-secondary)]">Email Address</label>
                <input
                  required
                  type="email"
                  value={userFormData.email}
                  onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                  className="settings-input w-full"
                  disabled={!!editingUser}
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1 text-[var(--text-secondary)]">Display Name</label>
                <input
                  type="text"
                  value={userFormData.display_name}
                  onChange={(e) => setUserFormData({ ...userFormData, display_name: e.target.value })}
                  className="settings-input w-full"
                />
              </div>
              {!editingUser && (
                <div className="mb-4">
                  <label className="block text-sm mb-1 text-[var(--text-secondary)]">Initial Password (min 6 chars)</label>
                  <input
                    required
                    type="password"
                    minLength={6}
                    value={userFormData.password}
                    onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                    className="settings-input w-full"
                  />
                </div>
              )}
              <div className="mb-4">
                <label className="block text-sm mb-1 text-[var(--text-secondary)]">Assigned Role</label>
                <select
                  value={userFormData.role}
                  onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value })}
                  className="settings-select w-full"
                >
                  <option value="Viewer">Viewer</option>
                  <option value="Warehouse Manager">Warehouse Manager</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="px-4 py-2 border border-[var(--border-color)] rounded text-sm hover:bg-[var(--hover-bg)]"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-teal-600 text-white rounded text-sm hover:bg-teal-700">
                  Save User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="user-management-panel">
        <div className="user-management-header">
          <div>
            <h2 className="settings-panel-title" style={{ marginBottom: '0.25rem' }}>User Accounts</h2>
            <p className="settings-panel-subtitle">Manage identity profiles, role allocations, and security privileges.</p>
          </div>
          {isAdmin && (
            <button className="add-user-btn" onClick={openAddUser}>
              <Plus size={16} style={{ marginRight: '0.5rem' }} /> Add New User
            </button>
          )}
        </div>

        <div className="user-filter-bar">
          <div className="user-filter-group">
            <label className="user-filter-label">ROLE FILTER</label>
            <select
              className="user-filter-select"
              value={userRoleFilter}
              onChange={(e) => setUserRoleFilter(e.target.value)}
            >
              <option value="All">All System Roles</option>
              <option value="ADMIN">ADMIN</option>
              <option value="WAREHOUSE MANAGER">WAREHOUSE MANAGER</option>
              <option value="VIEWER">VIEWER</option>
            </select>
          </div>
          <div className="user-filter-group">
            <label className="user-filter-label">STATUS</label>
            <select
              className="user-filter-select"
              value={userStatusFilter}
              onChange={(e) => setUserStatusFilter(e.target.value)}
            >
              <option value="All">All Statuses</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive / Disabled</option>
            </select>
          </div>
          <div className="user-filter-group search-group">
            <label className="user-filter-label">SEARCH MEMBER</label>
            <input
              type="text"
              className="user-filter-input"
              placeholder="Search names, emails..."
              value={userSearchTerm}
              onChange={(e) => setUserSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="user-table-container">
          <table className="user-table">
            <thead>
              <tr>
                <th>NAME</th>
                <th>EMAIL</th>
                <th>ROLE</th>
                <th>STATUS</th>
                <th>JOINED DATE</th>
                <th className="text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    No users found matching current filters.
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((u, i) => {
                  const isActive = u.is_active ?? (u.status === 'ACTIVE');
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
                        <span className={`status-badge ${isActive ? 'active' : 'inactive'}`}>
                          {isActive ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </td>
                      <td className="text-secondary">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'Active'}
                      </td>
                      <td className="text-right user-actions">
                        {isAdmin && (
                          <>
                            <button className="action-edit" onClick={() => openEditUser(u)}>
                              Edit
                            </button>
                            <button
                              onClick={() => handleUserToggleStatus(u.id, isActive)}
                              className={`action-toggle ${isActive ? 'disable' : 'enable'}`}
                            >
                              {isActive ? 'Disable' : 'Enable'}
                            </button>
                            {!u.is_verified && (
                              <button
                                onClick={() => handleResendActivation(u.id)}
                                className="action-edit"
                                style={{ backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}
                                title="Resend account activation email"
                              >
                                Resend Link
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteUser(u.id, u.email)}
                              className="action-edit"
                              style={{ backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' }}
                              title="Delete user"
                            >
                              Delete
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
    </>
  );

  const renderMLPipeline = () => {
    const prodModel = modelsList.find((m) => m.is_production);

    return (
      <div className="ml-pipeline-panel">
        <div className="ml-kpi-grid">
          <div className="ml-kpi-card">
            <span className="ml-kpi-label">PRODUCTION CHAMPION</span>
            <h2 className="ml-kpi-title text-teal" style={{ fontSize: '1.25rem' }}>
              {prodModel ? `${prodModel.name || prodModel.algorithm.toUpperCase()} (${prodModel.version || 'v1'})` : 'None (No active model)'}
            </h2>
            <p className="ml-kpi-desc">
              MASE: {prodModel?.metrics?.mase != null ? Number(prodModel.metrics.mase).toFixed(2) : '-'} | RMSE: {prodModel?.metrics?.rmse != null ? Number(prodModel.metrics.rmse).toFixed(1) : '-'}
            </p>
          </div>
          <div className="ml-kpi-card">
            <span className="ml-kpi-label">REGISTERED MODELS</span>
            <h2 className="ml-kpi-title">{modelsList.length} Models</h2>
            <p className="ml-kpi-desc">{modelsList.length > 0 ? Array.from(new Set(modelsList.map((m: any) => m.algorithm.toUpperCase()))).join(', ') : 'None'}</p>
          </div>
          <div className="ml-kpi-card">
            <span className="ml-kpi-label">TRAIN JOBS COMPLETED</span>
            <h2 className="ml-kpi-title">{trainJobs.length} Jobs</h2>
            <p className="ml-kpi-desc">Background task execution</p>
          </div>
        </div>

        {/* UC50: Closed-Loop Pipeline Action Card */}
        <div style={{
          marginTop: '1.5rem',
          padding: '1.25rem 1.5rem',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95))',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, padding: '2px 8px', borderRadius: '4px', background: '#0d9488', color: '#fff' }}>
                UC50 ENGINE
              </span>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
                Full Closed-Loop Pipeline Execution
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
              Sequentially executes: Demand Inference &rarr; SS/ROP/EOQ Multi-objective Optimization &rarr; Dynamic ABC/XYZ Reclassification &rarr; Actionable Replenishment Recommendations.
            </p>
          </div>
          <button
            onClick={() => setShowPipelineModal(true)}
            style={{
              backgroundColor: '#0d9488',
              color: '#ffffff',
              border: 'none',
              padding: '0.65rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 12px rgba(13, 148, 136, 0.3)',
              transition: 'all 0.2s ease',
            }}
          >
            <span>▶</span> Execute Closed-Loop Pipeline (UC50)
          </button>
        </div>

        {pipelineResult && (
          <div style={{
            marginTop: '1rem',
            padding: '1.25rem',
            borderRadius: '10px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontWeight: 800, fontSize: '1rem' }}>✓ Closed-Loop Pipeline Completed Successfully</span>
                <span style={{ fontFamily: 'monospace', fontSize: '11px', background: '#dcfce7', padding: '2px 6px', borderRadius: '4px' }}>
                  Run ID: {pipelineResult.run_id || 'N/A'}
                </span>
              </div>
              <button
                onClick={() => setPipelineResult(null)}
                style={{ background: 'none', border: 'none', color: '#166534', cursor: 'pointer', fontWeight: 700 }}
              >
                &times; Close
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '0.75rem', fontSize: '0.875rem' }}>
              <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                <div style={{ fontSize: '11px', color: '#65a30d', fontWeight: 700 }}>EXECUTION DURATION</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{pipelineResult.duration_seconds != null ? `${pipelineResult.duration_seconds}s` : 'Instant'}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                <div style={{ fontSize: '11px', color: '#65a30d', fontWeight: 700 }}>FORECASTS GENERATED</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{pipelineResult.forecasts_generated ?? '-'}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                <div style={{ fontSize: '11px', color: '#65a30d', fontWeight: 700 }}>SS / ROP OPTIMIZED</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{pipelineResult.inventory_params_updated ?? '-'} SKUs</div>
              </div>
              <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                <div style={{ fontSize: '11px', color: '#65a30d', fontWeight: 700 }}>ABC/XYZ UPDATED</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{pipelineResult.classifications_updated ?? '-'} Items</div>
              </div>
              <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '6px', border: '1px solid #0d9488' }}>
                <div style={{ fontSize: '11px', color: '#0d9488', fontWeight: 700 }}>REPLENISHMENTS CREATED</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0d9488' }}>{pipelineResult.replenishments_generated ?? '-'}</div>
              </div>
            </div>
          </div>
        )}

        <div className="settings-table-container mt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="mp-panel-title m-0" style={{ fontSize: '1rem', color: '#1e293b' }}>
              Recent Training & Benchmark Jobs
            </h3>
          </div>
          <table className="settings-table">
            <thead>
              <tr>
                <th>JOB ID</th>
                <th>ALGORITHM</th>
                <th>TEST HORIZON</th>
                <th>STATUS</th>
                <th>BENCHMARK MASE</th>
                <th>TRIGGERED BY</th>
                <th>CREATED AT</th>
              </tr>
            </thead>
            <tbody>
              {trainJobs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    No training jobs triggered yet. Go to Model Performance page to train a new model.
                  </td>
                </tr>
              ) : (
                paginatedTrainJobs.map((j) => (
                  <tr key={j.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{j.id.slice(0, 8)}...</td>
                    <td className="fw-700">{j.algorithm.toUpperCase()}</td>
                    <td>{j.test_days || 28} Days</td>
                    <td>
                      <span className={`status-badge ${j.status === 'done' ? 'active' : j.status === 'failed' ? 'inactive' : 'neutral'}`}>
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
              Model Registry
            </h3>
          </div>
          <table className="settings-table">
            <thead>
              <tr>
                <th>NAME & VERSION</th>
                <th>ALGORITHM</th>
                <th>SCOPE</th>
                <th>MASE</th>
                <th>RMSE</th>
                <th>STATUS</th>
                <th>REGISTERED AT</th>
              </tr>
            </thead>
            <tbody>
              {modelsList.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    No models registered in registry yet.
                  </td>
                </tr>
              ) : (
                paginatedModels.map((m) => (
                  <tr key={m.id}>
                    <td className="fw-700 text-dark">{m.name} ({m.version || 'v1'})</td>
                    <td>{m.algorithm.toUpperCase()}</td>
                    <td><span className="audit-badge blue">{m.scope || 'GLOBAL'}</span></td>
                    <td className="fw-600 text-teal">{m.metrics?.mase != null ? Number(m.metrics.mase).toFixed(2) : '-'}</td>
                    <td>{m.metrics?.rmse != null ? Number(m.metrics.rmse).toFixed(1) : '-'}</td>
                    <td>
                      <span className={`status-badge ${m.is_production ? 'active' : 'neutral'}`}>
                        {m.is_production ? 'CHAMPION (PROD)' : 'CHALLENGER'}
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
                Automated Batch Forecast Schedules (UC49)
              </h3>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Cron jobs executing periodic multi-horizon demand inference</span>
            </div>
            <button
              onClick={() => setShowScheduleModal(true)}
              style={{ backgroundColor: '#0ea5e9', color: '#fff', border: 'none', padding: '0.35rem 0.75rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
            >
              + Add Schedule
            </button>
          </div>
          <table className="settings-table">
            <thead>
              <tr>
                <th>SCHEDULE NAME</th>
                <th>CRON EXPRESSION</th>
                <th>MODEL</th>
                <th>HORIZON</th>
                <th>STORE</th>
                <th>AUTO OPTIMIZATION</th>
                <th>STATUS</th>
                <th className="text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {batchSchedules.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    No automated batch schedules configured. Click "+ Add Schedule" to set up a cron job.
                  </td>
                </tr>
              ) : (
                batchSchedules.map((sch) => (
                  <tr key={sch.id}>
                    <td className="fw-700 text-slate-800">{sch.name}</td>
                    <td style={{ fontFamily: 'monospace', color: '#0ea5e9', fontWeight: 700 }}>{sch.cron_expression}</td>
                    <td>{sch.model_name?.toUpperCase()}</td>
                    <td>{sch.horizon} Days</td>
                    <td>{sch.store_id}</td>
                    <td>
                      <span style={{ fontSize: '11px', color: sch.auto_trigger_optimization ? '#10b981' : '#64748b' }}>
                        {sch.auto_trigger_optimization ? 'Yes (UC50)' : 'Forecast Only'}
                      </span>
                    </td>
                    <td>
                      <span className="status-badge active">ACTIVE</span>
                    </td>
                    <td className="text-right">
                      <button
                        onClick={() => handleDeleteSchedule(sch.id)}
                        style={{ color: '#ef4444', background: 'none', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Delete
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
      <div className="settings-filters mb-6 flex gap-4">
        <select
          className="settings-select"
          value={auditActionFilter}
          onChange={(e) => setAuditActionFilter(e.target.value)}
        >
          <option value="All">All Action Types</option>
          {auditActions.length > 0 ? (
            auditActions.map((act) => (
              <option key={act} value={act}>{act}</option>
            ))
          ) : (
            <>
              <option value="auth">Auth & Security</option>
              <option value="inventory">Inventory Adjustments</option>
              <option value="product">Products</option>
              <option value="supplier">Suppliers</option>
              <option value="user">User Management</option>
            </>
          )}
        </select>
        <input
          type="text"
          className="settings-input"
          placeholder="Filter audit trail by user, action..."
          value={auditSearchTerm}
          onChange={(e) => setAuditSearchTerm(e.target.value)}
          style={{ maxWidth: '300px' }}
        />
        <button className="settings-btn-outline" onClick={loadAuditLogs}>
          Refresh Logs
        </button>
      </div>

      <div className="settings-table-container mt-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="mp-panel-title m-0" style={{ fontSize: '1rem', color: '#1e293b' }}>
            System Audit Trail
          </h2>
        </div>
        <table className="settings-table">
          <thead>
            <tr>
              <th>TIMESTAMP</th>
              <th>OPERATOR</th>
              <th>ACTION TYPE</th>
              <th>DETAILS</th>
              <th>IP ADDRESS</th>
            </tr>
          </thead>
          <tbody>
            {filteredAuditLogs.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                  No audit logs recorded yet.
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h2 className="mp-panel-title m-0">Data Quality & Leakage Prevention</h2>
            <p className="text-secondary text-sm">
              Automated audit for negative sales, duplicate timestamps, missing dates, outliers, and test cutoff leakage.
            </p>
          </div>
          {isAdmin && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="date"
                className="settings-input"
                style={{ width: '150px' }}
                value={dqCutoffDate}
                onChange={(e) => setDqCutoffDate(e.target.value)}
                title="Cutoff date to check data leakage"
              />
              <button
                className="settings-save-btn"
                onClick={handleRunDataQuality}
                disabled={isCheckingDq}
              >
                {isCheckingDq ? 'Running Audit...' : 'Run Quality Audit'}
              </button>
            </div>
          )}
        </div>

        {dqMsg && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              borderRadius: '6px',
              backgroundColor: dqMsg.includes('FAILED') ? '#fef2f2' : '#ecfdf5',
              color: dqMsg.includes('FAILED') ? '#b91c1c' : '#047857',
              fontSize: '13px',
            }}
          >
            {dqMsg}
          </div>
        )}

        {!run ? (
          <div className="settings-table-container p-8 text-center text-gray-500">
            No data quality checks have been executed yet. Click "Run Quality Audit" to initiate an automated inspection.
          </div>
        ) : (
          <>
            <div className="dq-top-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="dq-score-card">
                <div className="dq-score-circle" style={{ borderColor: run.passed ? '#0d9488' : '#ef4444' }}>
                  <span className="dq-score-value" style={{ color: run.passed ? '#0d9488' : '#ef4444' }}>
                    {run.status}
                  </span>
                </div>
                <div className="dq-score-info">
                  <h3 className="dq-score-title">Integrity Status</h3>
                  <p className="dq-score-desc">
                    {run.passed ? 'All critical schema and leakage validations passed' : 'Discrepancies detected in sales records'}
                  </p>
                </div>
              </div>

              <div className="ml-kpi-card" style={{ margin: 0 }}>
                <span className="ml-kpi-label">TOTAL RECORDS AUDITED</span>
                <h2 className="ml-kpi-title">{run.summary?.total_records?.toLocaleString() || 0}</h2>
                <p className="ml-kpi-desc">Historical sales transactions</p>
              </div>

              <div className="ml-kpi-card" style={{ margin: 0 }}>
                <span className="ml-kpi-label">MISSING RATE</span>
                <h2 className="ml-kpi-title text-teal">
                  {((run.summary?.missing_rate || 0) * 100).toFixed(1)}%
                </h2>
                <p className="ml-kpi-desc">Threshold: &le; 5.0%</p>
              </div>

              <div className="ml-kpi-card" style={{ margin: 0 }}>
                <span className="ml-kpi-label">OUTLIERS / ANOMALIES</span>
                <h2 className="ml-kpi-title" style={{ color: (run.summary?.outliers_count || 0) > 0 ? '#f59e0b' : '#0d9488' }}>
                  {run.summary?.outliers_count || 0}
                </h2>
                <p className="ml-kpi-desc">Z-score &gt; 3.0&sigma;</p>
              </div>

              <div className="ml-kpi-card" style={{ margin: 0 }}>
                <span className="ml-kpi-label">LEAKAGE DETECTION</span>
                <h2 className="ml-kpi-title" style={{ color: run.summary?.leakage_detected ? '#ef4444' : '#0d9488' }}>
                  {run.summary?.leakage_detected ? 'LEAK DETECTED' : 'CLEAN'}
                </h2>
                <p className="ml-kpi-desc">No test-set contamination</p>
              </div>
            </div>

            {/* Issues Table */}
            <div className="settings-table-container">
              <div className="flex justify-between items-center mb-4">
                <h3 className="mp-panel-title m-0" style={{ fontSize: '1rem', color: '#1e293b' }}>
                  Detected Issues ({run.issues?.length || 0})
                </h3>
                <span className="text-secondary text-xs">
                  Run ID: {run.id?.slice(0, 8)}... | {new Date(run.created_at).toLocaleString()}
                </span>
              </div>
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>CHECK TYPE</th>
                    <th>SEVERITY</th>
                    <th>TARGET SKU</th>
                    <th>TARGET STORE</th>
                    <th>DESCRIPTION & DETAIL</th>
                  </tr>
                </thead>
                <tbody>
                  {!run.issues || run.issues.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#0d9488' }}>
                        &#10004; Zero issues detected. Dataset passed all validation checks!
                      </td>
                    </tr>
                  ) : (
                    paginatedDqIssues.map((iss: any, idx: number) => {
                      const sevColor =
                        iss.severity === 'CRITICAL' ? '#fee2e2' :
                        iss.severity === 'HIGH' ? '#ffedd5' :
                        iss.severity === 'MEDIUM' ? '#fef3c7' : '#f1f5f9';
                      const sevTextColor =
                        iss.severity === 'CRITICAL' ? '#b91c1c' :
                        iss.severity === 'HIGH' ? '#c2410c' :
                        iss.severity === 'MEDIUM' ? '#b45309' : '#475569';

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

            {/* Run History Selector */}
            {dqRuns.length > 1 && (
              <div className="settings-table-container mt-6">
                <h4 className="mp-panel-title mb-3" style={{ fontSize: '0.9rem' }}>
                  Past Audit Run History
                </h4>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {dqRuns.map((r, i) => (
                    <button
                      key={r.id || i}
                      className={`settings-btn-outline ${selectedDqRun?.id === r.id ? 'active' : ''}`}
                      onClick={() => setSelectedDqRun(r)}
                      style={{ fontSize: '12px' }}
                    >
                      {new Date(r.created_at).toLocaleDateString()} - {r.status} ({r.issues?.length || 0} issues)
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

  return (
    <div className="animate-fade-in mb-6">
      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
          Loading system settings...
        </div>
      ) : (
        <>
          <div className="settings-tabs-container">
            {([
              'General Settings',
              ...(isAdmin ? ['User Management', 'Audit Logs'] : []),
              'ML Pipeline',
              'Data Quality Inspector'
            ]).map((tab) => (
              <button
                key={tab}
                className={`settings-tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
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
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-md shadow-xl">
                <h3 className="text-xl font-bold mb-2">Change Account Email</h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Per security requirements, enter your new email address and current password. A confirmation link will be sent to the new email.
                </p>

                {emailModalError && (
                  <div className="login-error mb-4" style={{ padding: '0.75rem', fontSize: '13px' }}>
                    {emailModalError}
                  </div>
                )}
                {emailModalSuccess && (
                  <div className="login-success mb-4" style={{ padding: '0.75rem', fontSize: '13px', backgroundColor: '#ccfbf1', color: '#0f766e', borderRadius: '6px' }}>
                    {emailModalSuccess}
                  </div>
                )}

                <form onSubmit={handleEmailChangeSubmit}>
                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">Current Email</label>
                    <input
                      type="email"
                      value={user?.email || ''}
                      disabled
                      className="settings-input w-full"
                      style={{ backgroundColor: '#f8fafc', color: '#64748b' }}
                    />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">New Email Address</label>
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
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">Current Password</label>
                    <input
                      required
                      type="password"
                      placeholder="Enter current password to verify"
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
                      Close
                    </button>
                    <button
                      type="submit"
                      className="settings-save-btn"
                    >
                      Send Confirmation Link
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* User Management Modal */}
          {showUserModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-md shadow-xl">
                <h3 className="text-xl font-bold mb-2">{editingUser ? 'Edit User Account' : 'Add New User'}</h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  {editingUser
                    ? 'Update user display name or assign new system permission role.'
                    : 'Create a new user account. If password is left blank, an activation link will be automatically emailed to the user.'}
                </p>

                <form onSubmit={handleUserSubmit}>
                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">Email Address</label>
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
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">Display Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Alex Nguyen"
                      value={userFormData.display_name}
                      onChange={(e) => setUserFormData({ ...userFormData, display_name: e.target.value })}
                      className="settings-input w-full"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">System Role</label>
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
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">Initial Password (Optional)</label>
                      <input
                        type="password"
                        placeholder="Leave blank to send activation email"
                        minLength={6}
                        value={userFormData.password}
                        onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                        className="settings-input w-full"
                      />
                      <span className="text-xs text-[var(--text-secondary)] mt-1 block">
                        If left blank, user receives a secure link via email to set their password upon first login.
                      </span>
                    </div>
                  )}

                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => setShowUserModal(false)}
                      className="settings-btn-outline"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="settings-save-btn"
                    >
                      {editingUser ? 'Save Changes' : 'Create Account'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* UC49: Schedule Batch Forecast Modal */}
          {showScheduleModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-md shadow-xl">
                <h3 className="text-xl font-bold mb-2">Configure Batch Forecast Schedule (UC49)</h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Set up a cron expression to execute automated multi-horizon demand inference periodically.
                </p>

                <form onSubmit={handleCreateSchedule}>
                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">Schedule Name *</label>
                    <input
                      required
                      type="text"
                      placeholder="e.g. Nightly CA_1 Demand Forecast"
                      value={scheduleName}
                      onChange={(e) => setScheduleName(e.target.value)}
                      className="settings-input w-full"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">Cron Expression *</label>
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
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">Model</label>
                      <select value={scheduleModel} onChange={(e) => setScheduleModel(e.target.value)} className="settings-input w-full">
                        <option value="lightgbm">LightGBM Production</option>
                        <option value="tft">TFT Transformer</option>
                        <option value="xgboost">XGBoost Baseline</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">Store</label>
                      <select value={scheduleStore} onChange={(e) => setScheduleStore(e.target.value)} className="settings-input w-full">
                        <option value="CA_1">CA_1</option>
                        <option value="CA_2">CA_2</option>
                        <option value="TX_1">TX_1</option>
                        <option value="WI_1">WI_1</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">Horizon (Days)</label>
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
                      Auto-trigger SS/ROP/EOQ recomputation & ABC/XYZ classification (UC50)
                    </label>
                  </div>

                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => setShowScheduleModal(false)}
                      className="settings-btn-outline"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingSchedule || !scheduleName.trim()}
                      className="settings-save-btn"
                    >
                      {isSavingSchedule ? 'Saving...' : 'Create Schedule'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* UC50: Pipeline Run Trigger Modal */}
          {showPipelineModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-md shadow-xl">
                <h3 className="text-xl font-bold mb-2">Execute Closed-Loop Pipeline (UC50)</h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Runs the full four-step sequence: Multi-horizon Forecast &rarr; SS/ROP/EOQ Optimization &rarr; ABC/XYZ Reclassification &rarr; Replenishment Recommendation Generation.
                </p>

                <form onSubmit={handleExecutePipeline}>
                  <div className="mb-4">
                    <label className="block text-sm mb-1 text-[var(--text-secondary)]">Model</label>
                    <select value={pipelineModel} onChange={(e) => setPipelineModel(e.target.value)} className="settings-input w-full">
                      <option value="lightgbm">LightGBM Production</option>
                      <option value="tft">TFT Transformer</option>
                      <option value="xgboost">XGBoost Baseline</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div>
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">Store</label>
                      <select value={pipelineStore} onChange={(e) => setPipelineStore(e.target.value)} className="settings-input w-full">
                        <option value="CA_1">CA_1</option>
                        <option value="CA_2">CA_2</option>
                        <option value="TX_1">TX_1</option>
                        <option value="WI_1">WI_1</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm mb-1 text-[var(--text-secondary)]">Horizon</label>
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
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isExecutingPipeline}
                      className="settings-save-btn"
                    >
                      {isExecutingPipeline ? 'Executing...' : 'Run Pipeline'}
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
