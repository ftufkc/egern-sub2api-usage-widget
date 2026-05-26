const COLORS = {
  background: { light: '#F6F8FA', dark: '#111827' },
  panel: { light: '#FFFFFF', dark: '#1F2937' },
  title: { light: '#111827', dark: '#F9FAFB' },
  muted: { light: '#6B7280', dark: '#A7B0C0' },
  value: { light: '#0F766E', dark: '#2DD4BF' },
  warning: { light: '#B45309', dark: '#FBBF24' },
  danger: { light: '#B91C1C', dark: '#FCA5A5' },
};

const METRICS = [
  { label: '请求数', key: 'totalRequests', formatter: formatNumber },
  { label: 'Tokens', key: 'totalTokens', formatter: formatNumber },
  { label: '消费', key: 'totalActualCost', formatter: formatCost },
  { label: '耗时', key: 'averageDurationMs', formatter: formatDuration },
];

export default async function sub2apiUsageWidget(ctx) {
  try {
    const usage = await fetchTodayUsage(ctx);
    return renderUsageWidget(ctx, usage);
  } catch (error) {
    return renderErrorWidget(error);
  }
}

export async function fetchTodayUsage(ctx) {
  const env = ctx?.env ?? {};
  const baseUrl = normalizeBaseUrl(env.BASE_URL);
  const email = trimString(env.EMAIL);
  const password = trimString(env.PASSWORD);

  if (!baseUrl || !email || !password) {
    throw new WidgetError('配置缺失', '请在模块 Env 中填写 BASE_URL、EMAIL、PASSWORD');
  }

  const loginResponse = await postJson(ctx, `${baseUrl}/api/v1/auth/login`, {
    email,
    password,
  });
  const loginPayload = unwrapApiResponse(loginResponse, '登录失败');
  const accessToken = trimString(loginPayload.access_token);
  const refreshToken = trimString(loginPayload.refresh_token);

  if (!accessToken) {
    if (loginPayload.requires_2fa) {
      throw new WidgetError('需要 2FA', '当前账号启用了双因素验证，小组件无法自动登录');
    }
    throw new WidgetError('登录失败', '登录响应缺少 access_token');
  }

  let stats;
  try {
    const timezone = getTimezone();
    const statsResponse = await getJson(ctx, buildStatsUrl(baseUrl, timezone), {
      Authorization: `Bearer ${accessToken}`,
    });
    stats = unwrapApiResponse(statsResponse, '读取失败');
  } finally {
    await logout(ctx, baseUrl, refreshToken);
  }

  return {
    totalRequests: toFiniteNumber(stats.total_requests),
    totalTokens: toFiniteNumber(stats.total_tokens),
    totalActualCost: toFiniteNumber(stats.total_actual_cost),
    averageDurationMs: toFiniteNumber(stats.average_duration_ms),
  };
}

export function normalizeBaseUrl(value) {
  let url = trimString(value);
  if (!url) return '';

  url = url.replace(/\/+$/, '');
  url = url.replace(/\/admin\/usage$/i, '');
  url = url.replace(/\/api\/v1$/i, '');
  return url.replace(/\/+$/, '');
}

export function buildStatsUrl(baseUrl, timezone) {
  const params = new URLSearchParams({
    period: 'today',
    timezone: timezone || 'Asia/Shanghai',
  });
  return `${normalizeBaseUrl(baseUrl)}/api/v1/admin/usage/stats?${params.toString()}`;
}

export function formatNumber(value) {
  const number = toFiniteNumber(value);
  const absolute = Math.abs(number);
  if (absolute >= 1_000_000_000) return `${trimTrailingZeros(number / 1_000_000_000)}B`;
  if (absolute >= 1_000_000) return `${trimTrailingZeros(number / 1_000_000)}M`;
  if (absolute >= 1_000) return `${trimTrailingZeros(number / 1_000)}K`;
  return String(Math.round(number));
}

export function formatCost(value) {
  const number = toFiniteNumber(value);
  if (number === 0) return '$0.00';
  if (Math.abs(number) < 1) return `$${trimTrailingZeros(number, 6)}`;
  return `$${trimTrailingZeros(number, 4)}`;
}

export function formatDuration(value) {
  const ms = toFiniteNumber(value);
  if (ms >= 1000) return `${trimTrailingZeros(ms / 1000)} s`;
  return `${Math.round(ms)} ms`;
}

async function postJson(ctx, url, body) {
  const response = await ctx.http.post(url, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, '请求失败');
}

async function getJson(ctx, url, headers) {
  const response = await ctx.http.get(url, { headers });
  return parseJsonResponse(response, '请求失败');
}

async function logout(ctx, baseUrl, refreshToken) {
  if (!refreshToken) return;

  try {
    await postJson(ctx, `${baseUrl}/api/v1/auth/logout`, {
      refresh_token: refreshToken,
    });
  } catch {
    // Logout is best-effort. Usage data is still valid if token revocation fails.
  }
}

async function parseJsonResponse(response, fallbackTitle) {
  if (!response) {
    throw new WidgetError(fallbackTitle, '没有收到服务器响应');
  }

  const status = Number(response.status ?? 200);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new WidgetError(fallbackTitle, '服务器返回了无法解析的 JSON');
  }

  if (status < 200 || status >= 300) {
    throw new WidgetError(fallbackTitle, readableMessage(payload) || `HTTP ${status}`);
  }

  return payload;
}

function unwrapApiResponse(payload, fallbackTitle) {
  if (payload && typeof payload === 'object' && 'code' in payload) {
    if (payload.code === 0) return payload.data ?? {};
    throw new WidgetError(fallbackTitle, readableMessage(payload) || `code=${payload.code}`);
  }
  return payload ?? {};
}

function renderUsageWidget(ctx, usage) {
  const compact = isCompactFamily(ctx?.widgetFamily);
  const content = compact ? compactMetricRows(usage) : gridMetricRows(usage);

  return {
    type: 'widget',
    refreshAfter: refreshAfter(10),
    padding: compact ? 12 : 14,
    gap: compact ? 7 : 10,
    backgroundColor: COLORS.background,
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        children: [
          {
            type: 'text',
            text: 'Sub2API 今日用量',
            font: { size: compact ? 'caption1' : 'headline', weight: 'bold' },
            textColor: COLORS.title,
            maxLines: 1,
            minScale: 0.75,
          },
          { type: 'spacer' },
          {
            type: 'date',
            date: new Date().toISOString(),
            format: 'time',
            font: { size: 'caption2', weight: 'medium' },
            textColor: COLORS.muted,
            maxLines: 1,
          },
        ],
      },
      content,
    ],
  };
}

function compactMetricRows(usage) {
  return {
    type: 'stack',
    direction: 'column',
    gap: 5,
    children: METRICS.map((metric) => ({
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 6,
      children: [
        {
          type: 'text',
          text: metric.label,
          font: { size: 'caption2', weight: 'medium' },
          textColor: COLORS.muted,
          maxLines: 1,
        },
        { type: 'spacer' },
        {
          type: 'text',
          text: metric.formatter(usage[metric.key]),
          font: { size: 'caption1', weight: 'semibold' },
          textColor: COLORS.value,
          textAlign: 'right',
          maxLines: 1,
          minScale: 0.65,
        },
      ],
    })),
  };
}

function gridMetricRows(usage) {
  const rows = [];
  for (let index = 0; index < METRICS.length; index += 2) {
    rows.push({
      type: 'stack',
      direction: 'row',
      gap: 8,
      children: [
        metricCard(METRICS[index], usage),
        metricCard(METRICS[index + 1], usage),
      ],
    });
  }
  return {
    type: 'stack',
    direction: 'column',
    gap: 8,
    children: rows,
  };
}

function metricCard(metric, usage) {
  return {
    type: 'stack',
    direction: 'column',
    flex: 1,
    gap: 3,
    padding: [8, 9],
    backgroundColor: COLORS.panel,
    borderRadius: 8,
    children: [
      {
        type: 'text',
        text: metric.label,
        font: { size: 'caption2', weight: 'medium' },
        textColor: COLORS.muted,
        maxLines: 1,
      },
      {
        type: 'text',
        text: metric.formatter(usage[metric.key]),
        font: { size: 'title3', weight: 'bold' },
        textColor: COLORS.value,
        maxLines: 1,
        minScale: 0.55,
      },
    ],
  };
}

function renderErrorWidget(error) {
  const title = error instanceof WidgetError ? error.title : '加载失败';
  const detail = error instanceof WidgetError ? error.detail : readableMessage(error) || '请稍后重试';

  return {
    type: 'widget',
    refreshAfter: refreshAfter(15),
    padding: 14,
    gap: 8,
    backgroundColor: COLORS.background,
    children: [
      {
        type: 'text',
        text: title,
        font: { size: 'headline', weight: 'bold' },
        textColor: title === '配置缺失' ? COLORS.warning : COLORS.danger,
        maxLines: 1,
        minScale: 0.75,
      },
      {
        type: 'text',
        text: detail,
        font: { size: 'caption1', weight: 'regular' },
        textColor: COLORS.muted,
        maxLines: 4,
        minScale: 0.7,
      },
    ],
  };
}

function refreshAfter(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function getTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
}

function isCompactFamily(family) {
  return family === 'systemSmall' || family === 'accessoryRectangular' || family === 'accessoryInline';
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function trimTrailingZeros(value, digits = 1) {
  return Number(value).toFixed(digits).replace(/\.?0+$/, '');
}

function readableMessage(value) {
  if (!value) return '';
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.error === 'string') return value.error;
  if (typeof value.detail === 'string') return value.detail;
  return '';
}

class WidgetError extends Error {
  constructor(title, detail) {
    super(`${title}: ${detail}`);
    this.name = 'WidgetError';
    this.title = title;
    this.detail = detail;
  }
}
