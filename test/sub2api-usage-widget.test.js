import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createTextResponse(text, status = 200) {
  return {
    status,
    async json() {
      throw new Error('invalid json');
    },
    async text() {
      return text;
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

function findTextNode(tree, text) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === 'text' && tree.text === text) return tree;

  const children = Array.isArray(tree.children) ? tree.children : [];
  for (const child of children) {
    const result = findTextNode(child, text);
    if (result) return result;
  }

  return null;
}

function textStyle(node) {
  return {
    font: node.font,
    textColor: node.textColor,
    maxLines: node.maxLines,
    minScale: node.minScale,
  };
}

test('normalizes the base URL and builds the today stats URL', () => {
  assert.equal(normalizeBaseUrl(' https://example.com/admin/usage '), 'https://example.com');
  assert.equal(normalizeBaseUrl('https://example.com/'), 'https://example.com');
  assert.equal(
    buildStatsUrl('https://example.com', 'Asia/Shanghai'),
    'https://example.com/api/v1/usage/dashboard/stats?timezone=Asia%2FShanghai'
  );
});

test('uses a single unversioned module and script entrypoint', async () => {
  const moduleYaml = await readFile(new URL('../sub2api-usage.module.yaml', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(moduleYaml, /name: Sub2API 今日用量\n/);
  assert.match(moduleYaml, /name: sub2api-usage-widget\n/);
  assert.match(moduleYaml, /script_url: https:\/\/raw\.githubusercontent\.com\/ftufkc\/egern-sub2api-usage-widget\/main\/sub2api-usage-widget\.js/);
  assert.match(moduleYaml, /script_name: sub2api-usage-widget\n/);
  assert.doesNotMatch(moduleYaml, /v2/);
  assert.match(readme, /main\/sub2api-usage\.module\.yaml/);
  assert.doesNotMatch(readme, /v2/);
});

test('formats numbers, cost, and duration for compact widget display', () => {
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(1_876, { compact: false }), '1,876');
  assert.equal(formatNumber(12_345), '12.35K');
  assert.equal(formatNumber(12_345_678), '12.35M');
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
          user: { role: 'user' },
        },
      }),
      createResponse({
        code: 0,
        data: {
          today_requests: 42,
          today_tokens: 123456,
          today_input_tokens: 120000,
          today_output_tokens: 3456,
          today_cost: 1.5,
          today_actual_cost: 1.2345,
          average_duration_ms: 678.9,
        },
      }),
    ],
  });

  const usage = await fetchTodayUsage(ctx);

  assert.deepEqual(usage, {
    totalRequests: 42,
    totalTokens: 123456,
    inputTokens: 120000,
    outputTokens: 3456,
    standardCost: 1.5,
    totalActualCost: 1.2345,
    averageDurationMs: 678.9,
  });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://sub2api.example.com/api/v1/auth/login');
  assert.deepEqual(calls[0].options.body, {
    email: 'owner@example.invalid',
    password: 'secret',
  });
  assert.equal(calls[1].method, 'GET');
  assert.equal(
    calls[1].url,
    'https://sub2api.example.com/api/v1/usage/dashboard/stats?timezone=Asia%2FShanghai'
  );
  assert.equal(calls[1].options.headers.Authorization, 'Bearer access-token');
  assert.equal(calls.length, 2);
});

test('renders endpoint and response preview when the server returns non JSON', async () => {
  const { ctx } = createContext({
    env: {
      BASE_URL: 'https://sub2api.example.com',
      EMAIL: 'owner@example.invalid',
      PASSWORD: 'secret',
    },
    responses: [createTextResponse('<html><title>Not Found</title></html>', 404)],
  });

  const result = await widget(ctx);
  const serialized = JSON.stringify(result);

  assert.match(serialized, /登录失败/);
  assert.match(serialized, /HTTP 404/);
  assert.match(serialized, /Not Found/);
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
          today_requests: 1876,
          today_tokens: 212670000,
          today_input_tokens: 10370000,
          today_output_tokens: 923120,
          today_cost: 1.5,
          today_actual_cost: 179.8771,
          average_duration_ms: 15440,
        },
      }),
    ],
  });

  const result = await widget(ctx);
  const serialized = JSON.stringify(result);

  assert.equal(result.type, 'widget');
  assert.match(serialized, /总请求数/);
  assert.match(serialized, /总 Token/);
  assert.match(serialized, /总消费/);
  assert.match(serialized, /平均耗时/);
  assert.match(serialized, /今日范围内/);
  assert.match(serialized, /输入: 10\.37M \/ 输出: 923\.12K/);
  assert.match(serialized, /实际 \/ \$1\.5 标准/);
  assert.match(serialized, /每次请求/);
  assert.match(serialized, /sf-symbol:doc\.text/);
  assert.match(serialized, /shadowRadius/);
  assert.match(serialized, /1,876/);
  assert.match(serialized, /212\.67M/);
  assert.match(serialized, /\$179\.8771/);
  assert.match(serialized, /15\.4 s/);
  assert.ok(Date.parse(result.refreshAfter) > Date.now());
});

test('matches requested label and short subtitle styles to the Total Token label only', async () => {
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
          today_requests: 1876,
          today_tokens: 212670000,
          today_input_tokens: 10370000,
          today_output_tokens: 923120,
          today_cost: 1.5,
          today_actual_cost: 179.8771,
          average_duration_ms: 15440,
        },
      }),
    ],
  });

  const result = await widget(ctx);
  const tokenLabelStyle = textStyle(findTextNode(result, '总 Token'));

  for (const text of ['总请求数', '今日范围内', '总消费', '平均耗时', '每次请求']) {
    assert.deepEqual(textStyle(findTextNode(result, text)), tokenLabelStyle);
  }

  assert.notDeepEqual(textStyle(findTextNode(result, '输入: 10.37M / 输出: 923.12K')), tokenLabelStyle);
  assert.notDeepEqual(textStyle(findTextNode(result, '实际 / $1.5 标准')), tokenLabelStyle);
});

test('renders a useful error widget when credentials are missing', async () => {
  const { ctx } = createContext();

  const result = await widget(ctx);
  const serialized = JSON.stringify(result);

  assert.equal(result.type, 'widget');
  assert.match(serialized, /配置缺失/);
  assert.match(serialized, /BASE_URL/);
});
