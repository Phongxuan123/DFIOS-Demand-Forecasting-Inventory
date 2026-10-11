import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { api } from '../services/api.ts';
import './Settings.css';

export const Settings: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role?.toUpperCase() || 'VIEWER';
  const isAdmin = role === 'ADMIN';

  const [data, setData] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [dataQuality, setDataQuality] = useState<any>(null);
  const [mlPipeline, setMlPipeline] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('General Settings');

  const [profileName, setProfileName] = useState(user?.name || user?.email || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');

  // User management modal & state
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [userFormData, setUserFormData] = useState({ email: '', password: '', role: 'VIEWER', display_name: '' });

  // Filters for User Management
  const [userRoleFilter, setUserRoleFilter] = useState('All');
  const [userStatusFilter, setUserStatusFilter] = useState('All');
  const [userSearchTerm, setUserSearchTerm] = useState('');

  // Filters for Audit Logs
  const [auditActionFilter, setAuditActionFilter] = useState('All');
  const [auditSearchTerm, setAuditSearchTerm] = useState('');

  const loadUsers = async () => {
    try {
      const res = await api.settings.getUsers();
      setUsers(res.list || []);
    } catch (e) {
      console.error('Failed to load users', e);
    }
  };

  const loadAuditLogs = async () => {
    try {
      const res = await api.settings.getAuditLogs({ limit: '100' });
      setAuditLogs(res.logs || []);
    } catch (e) {
      console.error('Failed to load audit logs', e);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [configResult, usersResult, auditResult, dqResult, mlResult] = await Promise.all([
          api.settings.getConfig(),
          api.settings.getUsers(),
          api.settings.getAuditLogs({ limit: '100' }),
          api.settings.getDataQuality(),
          api.settings.getMlPipeline(),
        ]);
        setData(configResult);
        setUsers(usersResult.list || []);
        setAuditLogs(auditResult.logs || []);
        setDataQuality(dqResult);
        setMlPipeline(mlResult);
      } catch (error) {
        console.error('Failed to load settings data', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    setProfileName(user?.name || user?.email || '');
    setProfileEmail(user?.email || '');
  }, [user]);

  const handleProfileSave = async () => {
    setSettingsMessage('');
    try {
      await api.auth.updateProfile({
        display_name: profileName,
        email: profileEmail,
      });
      const stored = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...stored, name: profileName, display_name: profileName, email: profileEmail }));
      setSettingsMessage('Profile updated successfully.');
    } catch (error: any) {
      setSettingsMessage(error.response?.data?.detail || 'Could not update profile.');
    }
  };

  const handlePasswordChange = async () => {
    setSettingsMessage('');
    if (newPassword !== confirmPassword) {
      setSettingsMessage('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setSettingsMessage('New password must be at least 6 characters.');
      return;
    }
    try {
      await api.auth.changePassword({
        old_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSettingsMessage('Password updated successfully.');
    } catch (error: any) {
      setSettingsMessage(error.response?.data?.detail || 'Could not update password.');
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

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await api.settings.updateUser(editingUser.id, {
          display_name: userFormData.display_name,
          role: userFormData.role,
        });
      } else {
        await api.settings.createUser({
          email: userFormData.email,
          password: userFormData.password,
          role: userFormData.role,
          display_name: userFormData.display_name,
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
    setUserFormData({ email: '', password: '', role: 'VIEWER', display_name: '' });
    setShowUserModal(true);
  };

  const openEditUser = (u: any) => {
    setEditingUser(u);
    setUserFormData({
      email: u.email,
      password: '',
      role: u.role || 'VIEWER',
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

  const renderGeneralSettings = () => (
    <div className="settings-main-split">
      <div className="settings-left-panel">
        <div className="profile-header">
          <div className="profile-avatar-large">
            <img
              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(profileName || user?.email || 'User')}&background=0D8ABC&color=fff`}
              alt="Profile"
              className="profile-img"
            />
          </div>
          <div className="profile-info">
            <h2 className="profile-name">{profileName || user?.email}</h2>
            <div className="profile-badge">{role}</div>
            <div className="profile-since">{user?.is_verified ? 'Verified account' : 'Active account'}</div>
          </div>
        </div>

        <div className="settings-divider"></div>

        <div className="settings-group">
          <label className="settings-label">Display Name</label>
          <input
            type="text"
            className="settings-input"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
        </div>

        <div className="settings-group" style={{ marginTop: '1.5rem' }}>
          <label className="settings-label">Account Email</label>
          <input
            type="email"
            className="settings-input"
            value={profileEmail}
            onChange={(e) => setProfileEmail(e.target.value)}
          />
        </div>

        <div className="settings-group" style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
          <label className="settings-label">System Timezone</label>
          <input type="text" className="settings-input" defaultValue={data?.timezone || "Asia/Saigon"} disabled />
        </div>

        {settingsMessage && (
          <div className="login-success" style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: '6px', backgroundColor: '#ecfdf5', color: '#047857' }}>
            {settingsMessage}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="settings-save-btn" onClick={handleProfileSave}>
            Save Changes
          </button>
        </div>
      </div>

      <div className="settings-right-panel">
        <div className="settings-side-card">
          <h2 className="settings-side-title">Change Password</h2>

          <div className="settings-group" style={{ marginBottom: '1rem' }}>
            <label className="settings-label">Current Password</label>
            <input
              type="password"
              className="settings-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>

          <div className="settings-group" style={{ marginBottom: '1rem' }}>
            <label className="settings-label">New Password</label>
            <input
              type="password"
              className="settings-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <div className="settings-group" style={{ marginBottom: '1.5rem' }}>
            <label className="settings-label">Confirm New Password</label>
            <input
              type="password"
              className="settings-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="settings-save-btn" onClick={handlePasswordChange}>
              Update Password
            </button>
          </div>
        </div>

        <div className="settings-side-card">
          <h2 className="settings-side-title">Session Security</h2>
          <div className="login-activity-item">
            <div className="login-activity-main">
              <span className="login-activity-loc">Active Session Token</span>
              <span className="login-activity-time">Connected</span>
            </div>
            <div className="login-activity-desc success">Authenticated with JWT Bearer Token</div>
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
                  <option value="VIEWER">VIEWER</option>
                  <option value="WAREHOUSE MANAGER">WAREHOUSE MANAGER</option>
                  <option value="ADMIN">ADMIN</option>
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
                filteredUsers.map((u, i) => {
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
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <div className="user-pagination">
            <span className="pagination-info">Showing {filteredUsers.length} of {users.length} active profiles</span>
          </div>
        </div>
      </div>
    </>
  );

  const renderMLPipeline = () => (
    <div className="ml-pipeline-panel">
      <div className="ml-kpi-grid">
        <div className="ml-kpi-card">
          <span className="ml-kpi-label">LAST PIPELINE RUN</span>
          <h2 className="ml-kpi-title">{mlPipeline?.kpis?.lastRun?.time || 'Completed'}</h2>
          <p className="ml-kpi-desc">Engine ready</p>
        </div>
        <div className="ml-kpi-card">
          <span className="ml-kpi-label">CADENCE SCHEDULE</span>
          <h2 className="ml-kpi-title text-teal">Daily (00:00)</h2>
          <p className="ml-kpi-desc">Automated ingestion</p>
        </div>
        <div className="ml-kpi-card">
          <span className="ml-kpi-label">SYSTEM HEALTH</span>
          <h2 className="ml-kpi-title text-teal">Operational</h2>
          <p className="ml-kpi-desc">FastAPI microservice</p>
        </div>
      </div>

      <div className="settings-table-container mt-6">
        <h3 className="mp-panel-title mb-4" style={{ fontSize: '1rem', color: '#1e293b' }}>
          ML Pipeline Status
        </h3>
        <p className="text-secondary" style={{ padding: '1rem' }}>
          Realtime ML training and inference pipeline is managed via background tasks.
        </p>
      </div>
    </div>
  );

  const renderAuditLogs = () => (
    <div className="settings-audit-panel">
      <div className="settings-filters mb-6 flex gap-4">
        <select
          className="settings-select"
          value={auditActionFilter}
          onChange={(e) => setAuditActionFilter(e.target.value)}
        >
          <option value="All">All Action Types</option>
          <option value="auth">Auth & Security</option>
          <option value="inventory">Inventory Adjustments</option>
          <option value="product">Products</option>
          <option value="supplier">Suppliers</option>
          <option value="user">User Management</option>
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
            System Audit Trail (UC45)
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
              filteredAuditLogs.map((log: any, i: number) => (
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

        <div className="flex justify-between items-center mt-4">
          <span className="text-secondary" style={{ fontSize: '12px' }}>
            Showing {filteredAuditLogs.length} of {auditLogs.length} audit records
          </span>
        </div>
      </div>
    </div>
  );

  const renderDataQuality = () => (
    <div className="settings-dq-panel">
      <h2 className="mp-panel-title mb-6">Data Quality & Pipeline Integrity</h2>
      <div className="dq-top-row">
        <div className="dq-score-card">
          <div className="dq-score-circle">
            <span className="dq-score-value">{dataQuality?.score || 100}%</span>
          </div>
          <div className="dq-score-info">
            <h3 className="dq-score-title">Schema Validation Score</h3>
            <p className="dq-score-desc">Data tables adhere strictly to Pydantic and SQLAlchemy schema models.</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in mb-6">
      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
          Loading system settings...
        </div>
      ) : (
        <>
          <div className="settings-tabs-container">
            {['General Settings', 'User Management', 'Audit Logs', 'ML Pipeline', 'Data Quality Inspector'].map((tab) => (
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
        </>
      )}
    </div>
  );
};
