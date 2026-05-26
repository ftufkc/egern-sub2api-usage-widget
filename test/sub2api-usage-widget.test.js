import assert from 'node:assert/strict';
import test from 'node:test';

import widget, {
  buildStatsUrl,
  fetchTodayUsage,
  formatCost,
  formatDuration,
  formatNumber,
  normalizeBaseUrl,
} from '../sub2api-usage-widget.js';

function createResponse(body, status = 200) {
  return {
    status,
    async json() {
      return body;
    },
  };
}

function createContext({ env = {}, responses = [] } = {}) {
  const calls = [];
  return {
    ctx: {
      widgetFamily: 'systemMedium',
      env,
      http: {
        async post(url, options) {
          calls.push({ method: 'POST', url, options });
          return responses.shift();
        },
        async get(url, options) {
          calls.push({ method: 'GET', url, options });
          return responses.shift();
        },
      },
    },
    calls,
  };
}

test('normalizes the base URL and builds the today stats URL', () => {
  assert.equal(normalizeBaseUrl(' https://example.com/admin/usage '), 'https://example.com');
  assert.equal(normalizeBaseUrl('https://example.com/'), 'https://example.com');
  assert.equal(
    buildStatsUrl('https://example.com', 'Asia/Shanghai'),
    'https://example.com/api/v1/admin/usage/stats?period=today&timezone=Asia%2FShanghai'
  );
});

test('formats numbers, cost, and duration for compact widget display', () => {
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(12_345), '12.3K');
  assert.equal(formatNumber(12_345_678), '12.3M');
  assert.equal(formatCost(0), '$0.00');
  assert.equal(formatCost(1.234), '$1.234');
  assert.equal(formatDuration(987.6), '988 ms');
  assert.equal(formatDuration(12_345), '12.3 s');
});

test('fetches today usage with credentials from env', async () => {
  const { ctx, calls } = createContext({
    env: {
      BASE_URL: 'https://sub2api.example.com/admin/usage',
      EMAIL: 'owner@example.invalid',
      PASSWORD: 'secret',
    },
    responses: [
      createResponse({
        code: 0,
        data: {
          access_token: 'access-token',
          user: { role: 'admin' },
        },
      }),
      createResponse({
        code: 0,
        data: {
          total_requests: 42,
          total_tokens: 123456,
          total_actual_cost: 1.2345,
          average_duration_ms: 678.9,
        },
      }),
    ],
  });

  const usage = await fetchTodayUsage(ctx);

  assert.deepEqual(usage, {
    totalRequests: 42,
    totalTokens: 123456,
    totalActualCost: 1.2345,
    averageDurationMs: 678.9,
  });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://sub2api.example.com/api/v1/auth/login');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    email: 'owner@example.invalid',
    password: 'secret',
  });
  assert.equal(calls[1].method, 'GET');
  assert.equal(
    calls[1].url,
    'https://sub2api.example.com/api/v1/admin/usage/stats?period=today&timezone=Asia%2FShanghai'
  );
  assert.equal(calls[1].options.headers.Authorization, 'Bearer access-token');
});

test('renders a medium widget with the four requested metrics', async () => {
  const { ctx } = createContext({
    env: {
      BASE_URL: 'https://sub2api.example.com',
      EMAIL: 'owner@example.invalid',
      PASSWORD: 'secret',
    },
    responses: [
      createResponse({ code: 0, data: { access_token: 'access-token' } }),
      createResponse({
        code: 0,
        data: {
          total_requests: 42,
          total_tokens: 123456,
          total_actual_cost: 1.2345,
          average_duration_ms: 678.9,
        },
      }),
    ],
  });

  const result = await widget(ctx);
  const serialized = JSON.stringify(result);

  assert.equal(result.type, 'widget');
  assert.match(serialized, /今日用量/);
  assert.match(serialized, /42/);
  assert.match(serialized, /123\.5K/);
  assert.match(serialized, /\$1\.2345/);
  assert.match(serialized, /679 ms/);
  assert.ok(Date.parse(result.refreshAfter) > Date.now());
});

test('renders a useful error widget when credentials are missing', async () => {
  const { ctx } = createContext();

  const result = await widget(ctx);
  const serialized = JSON.stringify(result);

  assert.equal(result.type, 'widget');
  assert.match(serialized, /配置缺失/);
  assert.match(serialized, /BASE_URL/);
});
