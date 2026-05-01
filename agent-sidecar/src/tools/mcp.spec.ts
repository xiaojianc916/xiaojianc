import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import { dirname, join, resolve } from 'node:path';

import { createMcpClientBundle, getMcpRuntimeStatus, loadMcpServerConfigs } from './mcp.js';

const WORKSPACE_ROOT = resolve('D:/com.xiaojianc/my_desktop_app');
const MEMORY_FILE_PATH = join(WORKSPACE_ROOT, 'tmp', 'mcp-memory-test.jsonl');
const UVX_FIXTURE_PATH = join(tmpdir(), 'xiaojianc-mcp-fixtures', 'uvx.exe');
const GIT_FIXTURE_PATH = join(tmpdir(), 'xiaojianc-mcp-fixtures', 'git.exe');

mkdirSync(dirname(UVX_FIXTURE_PATH), { recursive: true });
writeFileSync(UVX_FIXTURE_PATH, '', 'utf8');
writeFileSync(GIT_FIXTURE_PATH, '', 'utf8');

const defaultEnv = {
  AGENT_MCP_MEMORY_FILE_PATH: MEMORY_FILE_PATH,
  AGENT_MCP_UVX_PATH: UVX_FIXTURE_PATH,
  AGENT_MCP_GIT_EXECUTABLE_PATH: GIT_FIXTURE_PATH,
  TAVILY_API_KEY: 'tvly-test-key',
};

describe('MCP sidecar config', () => {
  it('loads the built-in Anthropic and Tavily MCP servers', () => {
    const loaded = loadMcpServerConfigs({
      workspaceRootPath: WORKSPACE_ROOT,
      env: defaultEnv,
      platform: 'win32',
    });

    assert.deepEqual(loaded.errors, []);
    assert.deepEqual(loaded.configs.map((config) => config.name), [
      'filesystem',
      'git',
      'memory',
      'sequential-thinking',
      'time',
      'tavily-mcp',
    ]);
  });

  it('wires workspace, memory, time and Tavily settings into server configs', () => {
    const loaded = loadMcpServerConfigs({
      workspaceRootPath: WORKSPACE_ROOT,
      env: {
        ...defaultEnv,
        AGENT_MCP_LOCAL_TIMEZONE: 'Asia/Shanghai',
      },
      platform: 'win32',
    });
    const filesystem = loaded.configs.find((config) => config.name === 'filesystem');
    const git = loaded.configs.find((config) => config.name === 'git');
    const memory = loaded.configs.find((config) => config.name === 'memory');
    const time = loaded.configs.find((config) => config.name === 'time');
    const tavily = loaded.configs.find((config) => config.name === 'tavily-mcp');

    assert.equal(filesystem?.args[0], WORKSPACE_ROOT);
    assert.equal(git?.command, UVX_FIXTURE_PATH);
    assert.deepEqual(git?.args, ['mcp-server-git==2026.1.14', '--repository', WORKSPACE_ROOT]);
    assert.equal(git?.env.GIT_PYTHON_GIT_EXECUTABLE, GIT_FIXTURE_PATH);
    assert.equal(memory?.env.MEMORY_FILE_PATH, MEMORY_FILE_PATH);
    assert.equal(time?.command, UVX_FIXTURE_PATH);
    assert.deepEqual(time?.args, ['mcp-server-time==2026.1.26', '--local-timezone=Asia/Shanghai']);
    assert.equal(tavily?.env.TAVILY_API_KEY, 'tvly-test-key');
  });

  it('skips Tavily when its API key is missing', () => {
    const loaded = loadMcpServerConfigs({
      workspaceRootPath: WORKSPACE_ROOT,
      env: {
        AGENT_MCP_MEMORY_FILE_PATH: MEMORY_FILE_PATH,
        AGENT_MCP_UVX_PATH: UVX_FIXTURE_PATH,
        AGENT_MCP_GIT_EXECUTABLE_PATH: GIT_FIXTURE_PATH,
      },
      platform: 'win32',
    });

    assert.equal(loaded.configs.some((config) => config.name === 'tavily-mcp'), false);
    assert.equal(loaded.errors.length, 1);
    assert.match(loaded.errors[0] ?? '', /TAVILY_API_KEY/u);
  });

  it('ignores legacy arbitrary MCP JSON so old tools are not loaded', () => {
    const loaded = loadMcpServerConfigs({
      workspaceRootPath: WORKSPACE_ROOT,
      env: {
        ...defaultEnv,
        AGENT_MCP_SERVERS_JSON: JSON.stringify({
          mcpServers: {
            oldSearch: {
              command: 'node',
              args: ['D:/old/search.js'],
            },
          },
        }),
      },
      platform: 'win32',
    });

    assert.equal(loaded.configs.some((config) => config.name === 'oldSearch'), false);
    assert.deepEqual(loaded.configs.map((config) => config.name), [
      'filesystem',
      'git',
      'memory',
      'sequential-thinking',
      'time',
      'tavily-mcp',
    ]);
  });

  it('skips Git MCP when Windows git.exe cannot be resolved', () => {
    const loaded = loadMcpServerConfigs({
      workspaceRootPath: WORKSPACE_ROOT,
      env: {
        ...defaultEnv,
        AGENT_MCP_GIT_EXECUTABLE_PATH: 'D:/missing/git.exe',
        ProgramFiles: join(tmpdir(), 'xiaojianc-missing-program-files'),
        'ProgramFiles(x86)': join(tmpdir(), 'xiaojianc-missing-program-files-x86'),
        LOCALAPPDATA: join(tmpdir(), 'xiaojianc-missing-local-app-data'),
      },
      platform: 'win32',
    });

    assert.equal(loaded.configs.some((config) => config.name === 'git'), false);
    assert.equal(
      loaded.errors.some((error) => error.includes('AGENT_MCP_GIT_EXECUTABLE_PATH')),
      true,
    );
  });

  it('exposes MCP health status for the Tauri health contract', () => {
    assert.deepEqual(getMcpRuntimeStatus({
      workspaceRootPath: WORKSPACE_ROOT,
      env: defaultEnv,
      platform: 'win32',
    }), {
      configuredServers: 6,
      serverNames: [
        'filesystem',
        'git',
        'memory',
        'sequential-thinking',
        'time',
        'tavily-mcp',
      ],
      errors: [],
    });
  });

  it('keeps healthy MCP tools when one configured server closes', async () => {
    const bundle = await createMcpClientBundle({
      workspaceRootPath: WORKSPACE_ROOT,
      env: defaultEnv,
      platform: 'win32',
    });

    try {
      assert.equal(bundle.tools.some((tool) => tool.name === 'read_file'), true);
      assert.equal(bundle.tools.some((tool) => tool.name === 'sequentialthinking'), true);
      assert.equal(
        bundle.errors.some((error) => error.includes('git') || error.includes('time')),
        true,
      );
    } finally {
      await bundle.disconnectAll();
    }
  });
});
