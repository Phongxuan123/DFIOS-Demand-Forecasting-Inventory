import React, { useState } from 'react';
import { Alert, Card, Select, Switch } from '../../components/ui/index.ts';
import { useI18n, useT, type Locale } from '../../i18n/index.tsx';
import { useTheme, type ThemePreference } from '../../theme/ThemeContext.tsx';

const NOTIF_KEY = 'dfios_notification_prefs';
type NotifPrefs = { stock: boolean; replenishment: boolean; system: boolean };
const DEFAULT_NOTIFS: NotifPrefs = { stock: true, replenishment: true, system: true };

function readNotifs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(NOTIF_KEY);
    if (raw) return { ...DEFAULT_NOTIFS, ...(JSON.parse(raw) as Partial<NotifPrefs>) };
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  return DEFAULT_NOTIFS;
}

export const PrefsTab: React.FC = () => {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const { preference, setPreference } = useTheme();
  const [notifs, setNotifs] = useState<NotifPrefs>(readNotifs);

  const setNotif = (key: keyof NotifPrefs, value: boolean) => {
    const next = { ...notifs, [key]: value };
    setNotifs(next);
    try {
      localStorage.setItem(NOTIF_KEY, JSON.stringify(next));
    } catch {
      /* ignore: preference stays in memory for this session */
    }
  };

  return (
    <div className="ui-grid ui-grid--2">
      <Card title={t('settings.prefs.language_title')} description={t('settings.prefs.language_description')}>
        <Select<Locale>
          aria-label={t('settings.prefs.language_title')}
          value={locale}
          onChange={setLocale}
          options={[
            { value: 'vi', label: 'Tiếng Việt' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Card>
      <Card title={t('settings.prefs.theme_title')} description={t('settings.prefs.theme_description')}>
        <Select<ThemePreference>
          aria-label={t('settings.prefs.theme_title')}
          value={preference}
          onChange={setPreference}
          options={[
            { value: 'system', label: t('settings.prefs.theme_system') },
            { value: 'light', label: t('common.theme.light') },
            { value: 'dark', label: t('common.theme.dark') },
          ]}
        />
      </Card>
      <Card title={t('settings.prefs.notifications_title')} description={t('settings.prefs.notifications_description')} className="set-span">
        <div className="ui-stack">
          <Switch checked={notifs.stock} onChange={(v) => setNotif('stock', v)} label={t('settings.prefs.notif_stock')} />
          <Switch checked={notifs.replenishment} onChange={(v) => setNotif('replenishment', v)} label={t('settings.prefs.notif_replenishment')} />
          <Switch checked={notifs.system} onChange={(v) => setNotif('system', v)} label={t('settings.prefs.notif_system')} />
          <Alert tone="info">{t('settings.prefs.local_only')}</Alert>
        </div>
      </Card>
    </div>
  );
};
