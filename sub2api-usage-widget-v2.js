const COLORS = {
  background: { light: '#EAF8F5', dark: '#101B1F' },
  panel: { light: '#FFFFFF', dark: '#1B252B' },
  title: { light: '#697080', dark: '#B8C0CC' },
  value: { light: '#121827', dark: '#F5F7FA' },
  muted: { light: '#737987', dark: '#9EA8B5' },
  blue: { light: '#2F6FCB', dark: '#83B7FF' },
  blueBg: { light: '#E4F0FF', dark: '#21344B' },
  amber: { light: '#D28A1A', dark: '#FFD37C' },
  amberBg: { light: '#FFF4CD', dark: '#4A3920' },
  green: { light: '#23A45D', dark: '#6EE7A0' },
  greenBg: { light: '#DDF8E7', dark: '#1D4430' },
  purple: { light: '#8D39D5', dark: '#D7A8FF' },
  purpleBg: { light: '#F1E3FA', dark: '#3E2D4C' },
  shadow: { light: '#9CB7B2', dark: '#000000' },
  warning: { light: '#B45309', dark: '#FBBF24' },
  danger: { light: '#B91C1C', dark: '#FCA5A5' },
};

const TOKEN_LABEL_TEXT_STYLE = {
  font: { size: 'headline', weight: 'semibold' },
  textColor: COLORS.title,
  maxLines: 1,
  minScale: 0.62,
};

const MUTED_SUBTITLE_TEXT_STYLE = {
  font: { size: 'subheadline', weight: 'regular' },
  textColor: COLORS.muted,
  maxLines: 2,
  minScale: 0.55,
};

const METRICS = [
  {
    label: '总请求数',
    key: 'totalRequests',
    formatter: (value) => formatNumber(value, { compact: false }),
    subtitle: () => '今日范围内',
    subtitleStyle: TOKEN_LABEL_TEXT_STYLE,
    icon: 'sf-symbol:doc.text',
    iconColor: COLORS.blue,
    iconBackground: COLORS.blueBg,
  },
  {
    label: '总 Token',
    key: 'totalTokens',
    formatter: formatNumber,
    subtitle: (usage) => `输入: ${formatNumber(usage.inputTokens)} / 输出: ${formatNumber(usage.outputTokens)}`,
    icon: 'sf-symbol:cube',
    iconColor: COLORS.amber,
    iconBackground: COLORS.amberBg,
  },
  {
    label: '总消费',
    key: 'totalActualCost',
    formatter: formatCost,
    subtitle: (usage) => `实际 / ${formatCost(usage.standardCost)} 标准`,
    icon: 'sf-symbol:dollarsign.circle',
    iconColor: COLORS.green,
    iconBackground: COLORS.greenBg,
    valueColor: COLORS.green,
  },
  {
    label: '平均耗时',
    key: 'averageDurationMs',
    formatter: formatDuration,
    subtitle: () => '每次请求',
    subtitleStyle: TOKEN_LABEL_TEXT_STYLE,
    icon: 'sf-symbol:clock',
    iconColor: COLORS.purple,
    iconBackground: COLORS.purpleBg,
  },
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
  }, '登录失败');
  const loginPayload = unwrapApiResponse(loginResponse, '登录失败');
  const accessToken = trimString(loginPayload.access_token);

  if (!accessToken) {
    if (loginPayload.requires_2fa) {
      throw new WidgetError('需要 2FA', '当前账号启用了双因素验证，小组件无法自动登录');
    }
    throw new WidgetError('登录失败', '登录响应缺少 access_token');
  }

  const timezone = getTimezone();
  const statsResponse = await getJson(ctx, buildStatsUrl(baseUrl, timezone), {
    Authorization: `Bearer ${accessToken}`,
  });
  const stats = unwrapApiResponse(statsResponse, '读取失败');

  return {
    totalRequests: toFiniteNumber(stats.today_requests),
    totalTokens: toFiniteNumber(stats.today_tokens),
    inputTokens: toFiniteNumber(stats.today_input_tokens),
    outputTokens: toFiniteNumber(stats.today_output_tokens),
    standardCost: toFiniteNumber(stats.today_cost),
    totalActualCost: toFiniteNumber(stats.today_actual_cost),
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
    timezone: timezone || 'Asia/Shanghai',
  });
  return `${normalizeBaseUrl(baseUrl)}/api/v1/usage/dashboard/stats?${params.toString()}`;
}

export function formatNumber(value, options = {}) {
  const number = toFiniteNumber(value);
  if (options.compact === false) {
    return Math.round(number).toLocaleString('en-US');
  }

  const absolute = Math.abs(number);
  if (absolute >= 1_000_000_000) return `${trimTrailingZeros(number / 1_000_000_000, 2)}B`;
  if (absolute >= 1_000_000) return `${trimTrailingZeros(number / 1_000_000, 2)}M`;
  if (absolute >= 1_000) return `${trimTrailingZeros(number / 1_000, 2)}K`;
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

async function postJson(ctx, url, body, fallbackTitle = '请求失败') {
  const response = await ctx.http.post(url, {
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return parseJsonResponse(response, fallbackTitle, url);
}

async function getJson(ctx, url, headers) {
  const response = await ctx.http.get(url, { headers });
  return parseJsonResponse(response, '请求失败', url);
}

async function parseJsonResponse(response, fallbackTitle, url = '') {
  if (!response) {
    throw new WidgetError(fallbackTitle, '没有收到服务器响应');
  }

  const status = Number(response.status ?? 200);
  const route = summarizeUrl(url);
  let payload;
  try {
    payload = await response.json();
  } catch {
    const preview = await safeResponsePreview(response);
    const statusText = Number.isFinite(status) ? `HTTP ${status}` : 'HTTP 状态未知';
    throw new WidgetError(fallbackTitle, `${route}${statusText}，非 JSON 响应：${preview}`);
  }

  if (status < 200 || status >= 300) {
    throw new WidgetError(fallbackTitle, `${route}${readableMessage(payload) || `HTTP ${status}`}`);
  }

  return payload;
}

async function safeResponsePreview(response) {
  if (typeof response.text !== 'function') return '无响应正文';
  try {
    return compactText(await response.text()).slice(0, 120) || '空响应';
  } catch {
    return '无法读取响应正文';
  }
}

function summarizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}：`;
  } catch {
    return '';
  }
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
  const content = compact ? compactMetricRows(usage) : dashboardGrid(usage);

  return {
    type: 'widget',
    refreshAfter: refreshAfter(10),
    padding: compact ? 12 : 10,
    gap: compact ? 7 : 0,
    backgroundColor: COLORS.background,
    children: [content],
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
      gap: 7,
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
          textColor: metric.valueColor || COLORS.value,
          textAlign: 'right',
          maxLines: 1,
          minScale: 0.65,
        },
      ],
    })),
  };
}

function dashboardGrid(usage) {
  const rows = [];
  for (let index = 0; index < METRICS.length; index += 2) {
    rows.push({
      type: 'stack',
      direction: 'row',
      gap: 10,
      flex: 1,
      children: [
        metricCard(METRICS[index], usage),
        metricCard(METRICS[index + 1], usage),
      ],
    });
  }
  return {
    type: 'stack',
    direction: 'column',
    gap: 10,
    flex: 1,
    children: rows,
  };
}

function metricCard(metric, usage) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
    padding: [10, 12],
    backgroundColor: COLORS.panel,
    borderRadius: 18,
    shadowColor: COLORS.shadow,
    shadowRadius: 3,
    shadowOffset: { x: 0, y: 1 },
    children: [
      {
        type: 'stack',
        direction: 'column',
        alignItems: 'center',
        width: 46,
        height: 46,
        padding: 11,
        backgroundColor: metric.iconBackground,
        borderRadius: 12,
        children: [
          {
            type: 'image',
            src: metric.icon,
            width: 24,
            height: 24,
            color: metric.iconColor,
          },
        ],
      },
      {
        type: 'stack',
        direction: 'column',
        alignItems: 'start',
        flex: 1,
        gap: 3,
        children: [
          {
            type: 'text',
            text: metric.label,
            ...TOKEN_LABEL_TEXT_STYLE,
          },
          {
            type: 'text',
            text: metric.formatter(usage[metric.key]),
            font: { size: 'largeTitle', weight: 'bold' },
            textColor: metric.valueColor || COLORS.value,
            maxLines: 1,
            minScale: 0.45,
          },
          {
            type: 'text',
            text: metric.subtitle(usage),
            ...(metric.subtitleStyle || MUTED_SUBTITLE_TEXT_STYLE),
          },
        ],
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

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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
