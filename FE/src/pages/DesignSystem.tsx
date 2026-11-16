/**
 * Dev-only gallery (route /design-system, not registered in production builds).
 * Renders every component twice, once with data-theme="light" and once with "dark",
 * so a change can be checked in both themes side by side.
 */
import React, { useMemo, useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Download, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  Checkbox,
  DataSourceNote,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  KpiTile,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Section,
  Select,
  Skeleton,
  StatusPill,
  Switch,
  Table,
  Tabs,
  Tooltip,
  Unavailable,
  useChartTheme,
  useConfirm,
  useRowSelection,
  useToast,
  IconButton,
  type Column,
} from '../components/ui/index.ts';
import { useFormat, useI18n } from '../i18n/index.tsx';
import './design-system.css';

interface Row {
  sku: string;
  name: string;
  abc: 'A' | 'B' | 'C';
  onHand: number;
  csl: number | null;
  status: 'ok' | 'low' | 'out';
}

const ROWS: Row[] = Array.from({ length: 47 }, (_, i) => ({
  sku: `FOODS_${String(i + 1).padStart(3, '0')}`,
  name: `Product ${i + 1}`,
  abc: (['A', 'B', 'C'] as const)[i % 3],
  onHand: (i * 37) % 180,
  csl: i % 7 === 0 ? null : 0.8 + ((i * 13) % 19) / 100,
  status: i % 9 === 0 ? 'out' : i % 4 === 0 ? 'low' : 'ok',
}));

const SERIES = Array.from({ length: 28 }, (_, i) => {
  const base = 40 + 12 * Math.sin(i / 3.2) + i * 0.4;
  return { day: i + 1, actual: i < 20 ? Math.round(base + ((i * 7) % 9)) : null, p50: Math.round(base), p10: Math.round(base - 9), p90: Math.round(base + 11) };
});

const DemoChart: React.FC = () => {
  const c = useChartTheme();
  const { fmt } = useI18n();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={SERIES} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="day" {...c.axis} />
        <YAxis {...c.axis} width={36} />
        <RTooltip content={<ChartTooltip format={(v) => fmt.integer(v)} />} cursor={c.cursor} />
        <Area dataKey="p90" stroke="none" fill={c.series[0]} fillOpacity={c.bandOpacity} name="P90" isAnimationActive={false} />
        <Area dataKey="p10" stroke="none" fill={c.surface} fillOpacity={1} name="P10" isAnimationActive={false} />
        <Line dataKey="p50" stroke={c.series[0]} strokeWidth={2} dot={false} name="P50" isAnimationActive={false} />
        <Line dataKey="actual" stroke={c.series[1]} strokeWidth={2} dot={false} name="Actual" connectNulls={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

const DemoBars: React.FC = () => {
  const c = useChartTheme();
  const data = [
    { k: 'A', v: 42 },
    { k: 'B', v: 31 },
    { k: 'C', v: 18 },
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="k" {...c.axis} />
        <YAxis {...c.axis} width={36} />
        <RTooltip content={<ChartTooltip />} cursor={{ fill: c.grid }} />
        <Bar dataKey="v" name="SKU" fill={c.series[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
};

const Showcase: React.FC = () => {
  const fmt = useFormat();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [tab, setTab] = useState('a');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('x');
  const [on, setOn] = useState(true);
  const [chk, setChk] = useState(true);
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const selection = useRowSelection();

  const filtered = useMemo(() => ROWS.filter((r) => r.sku.toLowerCase().includes(q.toLowerCase())), [q]);

  const columns: Column<Row>[] = [
    { key: 'sku', header: 'SKU', value: (r) => r.sku, sortable: true },
    { key: 'name', header: 'Name', value: (r) => r.name, sortable: true },
    { key: 'abc', header: 'ABC', cell: (r) => <Badge tone={r.abc === 'A' ? 'accent' : 'neutral'}>{r.abc}</Badge>, value: (r) => r.abc, sortable: true },
    { key: 'onHand', header: 'On hand', align: 'right', value: (r) => r.onHand, cell: (r) => fmt.integer(r.onHand), sortable: true },
    { key: 'csl', header: 'CSL', align: 'right', value: (r) => r.csl, cell: (r) => (r.csl === null ? <Unavailable reason="no service history" /> : fmt.percent(r.csl)), sortable: true },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusPill tone={r.status === 'ok' ? 'success' : r.status === 'low' ? 'warning' : 'danger'}>{r.status === 'ok' ? 'OK' : r.status === 'low' ? 'Low' : 'Out'}</StatusPill>,
    },
  ];

  return (
    <div className="ds-stack">
      <PageHeader
        title="Page title"
        description="One accent colour, neutral surfaces, 1px borders. Numbers use tabular figures."
        actions={
          <>
            <Button leftIcon={<Download size={14} />}>Export</Button>
            <Button variant="primary" leftIcon={<Plus size={14} />}>
              Create
            </Button>
          </>
        }
        meta={<DataSourceNote source="/dashboard/kpi, store CA_1" asOf="30/05/2016" />}
      />

      <Section title="Buttons and badges">
        <div className="ui-row">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" loading>
            Loading
          </Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <IconButton label="Delete" icon={<Trash2 size={16} />} />
        </div>
        <div className="ui-row" style={{ marginTop: 12 }}>
          <Badge>Neutral</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge tone="info">Info</Badge>
          <StatusPill tone="success">Approved</StatusPill>
          <StatusPill tone="warning">Pending</StatusPill>
          <Tooltip content="Tooltip text">
            <Button size="sm" variant="ghost">
              Hover me
            </Button>
          </Tooltip>
        </div>
      </Section>

      <Section title="KPI tiles">
        <div className="ui-grid ui-grid--kpi">
          <KpiTile label="Cycle service level" value={fmt.percent(0.949)} delta={{ value: 2.1, text: '+2,1 pp', label: 'vs baseline' }} hint="target 95%" />
          <KpiTile label="Stockout rate" value={fmt.percent(0.031)} delta={{ value: 0.4, text: '+0,4 pp', goodWhen: 'down' }} />
          <KpiTile label="Inventory value" value={fmt.currency(1284000, { compact: true })} unit="USD" />
          <KpiTile label="WRMSSE" value={null} unavailableReason="no model validated" />
          <KpiTile label="Loading" loading />
        </div>
      </Section>

      <Section title="Alerts and states">
        <div className="ds-stack">
          <Alert tone="info" title="Info">A neutral notice.</Alert>
          <Alert tone="success" title="Saved">Settings were updated.</Alert>
          <Alert tone="warning" title="Heads up">Prices are in USD.</Alert>
          <Alert tone="danger" title="Failed">Could not reach the server.</Alert>
          <div className="ds-grid">
            <Card><EmptyState compact /></Card>
            <Card><EmptyState compact filtered /></Card>
            <Card><ErrorState compact onRetry={() => undefined} /></Card>
            <Card><ErrorState compact error={{ kind: 'forbidden', message: 'x' }} /></Card>
          </div>
          <Card><div className="ds-stack"><Skeleton width="40%" /><Skeleton /><Skeleton width="70%" /></div></Card>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="ds-grid">
          <Input label="Text input" placeholder="Placeholder" hint="Helper text" />
          <Input label="With error" defaultValue="abc" error="This value is not valid" />
          <Select label="Select" value={sel} onChange={setSel} options={[{ value: 'x', label: 'Option X' }, { value: 'y', label: 'Option Y' }]} />
          <div className="ui-field">
            <span className="ui-field__label">Search (debounced)</span>
            <SearchInput value={q} onChange={setQ} />
          </div>
        </div>
        <div className="ui-row" style={{ marginTop: 12, gap: 24 }}>
          <Checkbox label="Checkbox" checked={chk} onChange={setChk} />
          <Checkbox label="Indeterminate" indeterminate />
          <Switch label="Switch" checked={on} onChange={setOn} />
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs value={tab} onChange={setTab} items={[{ id: 'a', label: 'Overview' }, { id: 'b', label: 'Details', count: 12 }, { id: 'c', label: 'Disabled', disabled: true }]} />
      </Section>

      <Section title="Table (client pagination, sorting, selection across pages)">
        <Card flush>
          <Table
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.sku}
            filtered={q.length > 0}
            selection={{ selected: selection.selected, onChange: selection.set }}
            pagination={{ page, pageSize, onPageChange: setPage, onPageSizeChange: setPageSize }}
            maxHeight={420}
          />
        </Card>
        <div style={{ height: 12 }} />
        <Card flush title="States">
          <div className="ds-grid" style={{ padding: 16 }}>
            <Card flush><Table columns={columns} rows={[]} rowKey={(r) => r.sku} loading /></Card>
            <Card flush><Table columns={columns} rows={[]} rowKey={(r) => r.sku} /></Card>
            <Card flush><Table columns={columns} rows={[]} rowKey={(r) => r.sku} error={{ kind: 'server', message: 'x' }} onRetry={() => undefined} /></Card>
            <Card flush><Table columns={columns} rows={[]} rowKey={(r) => r.sku} unavailableReason="calibration not run" /></Card>
          </div>
        </Card>
        <div style={{ height: 12 }} />
        <Card flush><Pagination page={2} pageSize={25} total={248} onPageChange={() => undefined} onPageSizeChange={() => undefined} /></Card>
      </Section>

      <Section title="Charts">
        <div className="ds-grid">
          <ChartFrame
            title="Demand forecast"
            description="P50 with P10–P90 band"
            source="/forecasts/daily, FOODS_3_090 @ CA_1"
            footer={<ChartLegend items={[{ label: 'P50', color: 'var(--chart-1)' }, { label: 'Actual', color: 'var(--chart-2)' }]} />}
          >
            <DemoChart />
          </ChartFrame>
          <ChartFrame title="SKU by ABC class" source="/classification/summary" height={240}>
            <DemoBars />
          </ChartFrame>
          <ChartFrame title="Loading" loading><span /></ChartFrame>
          <ChartFrame title="Unavailable" unavailableReason="no validated model"><span /></ChartFrame>
        </div>
        <div className="ui-row" style={{ marginTop: 12 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="ds-swatch" style={{ background: `var(--chart-${i + 1})` }} title={`--chart-${i + 1}`} />
          ))}
          <span style={{ width: 12 }} />
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="ds-swatch" style={{ background: `var(--chart-seq-${i + 1})` }} title={`--chart-seq-${i + 1}`} />
          ))}
        </div>
      </Section>

      <Section title="Overlays and toasts">
        <div className="ui-row">
          <Button onClick={() => setModal(true)}>Modal</Button>
          <Button onClick={() => setDrawer(true)}>Drawer</Button>
          <Button onClick={async () => toast.info((await confirm({ title: 'Delete item?', description: 'This cannot be undone.', tone: 'danger', confirmLabel: 'Delete' })) ? 'Confirmed' : 'Cancelled')}>Confirm dialog</Button>
          <Button onClick={() => toast.success('Saved', 'Settings were updated.')}>Toast success</Button>
          <Button onClick={() => toast.error('Request failed', 'Server returned 500.')}>Toast error</Button>
        </div>
        <Modal open={modal} onClose={() => setModal(false)} title="Modal title" description="Short description." footer={<><Button onClick={() => setModal(false)}>Cancel</Button><Button variant="primary" onClick={() => setModal(false)}>Save</Button></>}>
          <Input label="Name" autoFocus />
        </Modal>
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Drawer title" footer={<Button onClick={() => setDrawer(false)}>Close</Button>}>
          <SkeletonLines />
        </Drawer>
        {dialog}
      </Section>
    </div>
  );
};

const SkeletonLines: React.FC = () => (
  <div className="ds-stack">
    <Skeleton width="60%" />
    <Skeleton />
    <Skeleton width="80%" />
  </div>
);

export const DesignSystem: React.FC = () => (
  <div>
    <p className="ds-note">
      Dev only. Left: light, right: dark. Toggle the app theme in the topbar to see how the shell follows.
    </p>
    <div className="ds-panels">
      <div className="ds-panel" data-theme="light">
        <Showcase />
      </div>
      <div className="ds-panel" data-theme="dark">
        <Showcase />
      </div>
    </div>
  </div>
);
