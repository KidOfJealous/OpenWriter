import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const releaseDir = join(rootDir, 'release');
const rootPackage = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf-8'));

const allTargets = ['win32', 'linux', 'darwin'];
const targets = parseTargets(process.argv.slice(2));
const skipBuild = process.argv.includes('--skip-build');

if (!skipBuild) {
  runPackageBuild();
}

await mkdir(releaseDir, { recursive: true });

for (const platform of targets) {
  try {
    await packageTarget(platform);
    console.log(`Packaged ${platform} successfully!`);
  } catch (err) {
    console.error(`Failed to package ${platform}:`, err);
  }
}

async function packageTarget(platform) {
  console.log(`Packaging for ${platform}...`);
  const targetName = targetLabel(platform);
  const packageName = `openwriter-${rootPackage.version}-${targetName}`;
  const packageDir = join(releaseDir, packageName);
  console.log(`Package directory: ${packageDir}`);

  await rm(packageDir, { recursive: true, force: true });
  await rm(join(releaseDir, `${packageName}.zip`), { force: true });
  await rm(join(releaseDir, `${packageName}.tar.gz`), { force: true });
  await mkdir(join(packageDir, 'bin'), { recursive: true });
  await mkdir(join(packageDir, 'node_modules', '@openwriter'), { recursive: true });

  await writeRuntimePackage(packageDir, platform);
  await cp(join(rootDir, 'configs'), join(packageDir, 'configs'), { recursive: true });

  for (const packageName of ['core', 'agents', 'connectors', 'cli']) {
    await copyWorkspacePackage(packageName, packageDir);
  }

  // Copy CLI dependencies for TUI
  const cliPackageJson = JSON.parse(await readFile(join(rootDir, 'packages', 'cli', 'package.json'), 'utf-8'));
  const cliDependencies = Object.keys(cliPackageJson.dependencies || {}).filter(
    name => !name.startsWith('@openwriter')
  );
  
  for (const packageName of cliDependencies) {
    await copyExternalPackage(packageName, packageDir);
  }

  await writeLauncher(packageDir, platform);
  if (platform === 'win32') {
    await writeWindowsInstallers(packageDir);
  }
  await writeReadme(packageDir, platform);
  await archivePackage(packageName, platform);
}

async function writeRuntimePackage(packageDir, platform) {
  const isWindows = platform === 'win32';
  const runtimePackage = {
    name: 'openwriter-runtime',
    version: rootPackage.version,
    private: true,
    type: 'module',
    bin: {
      wa: isWindows ? './bin/wa.cmd' : './bin/wa',
    },
    engines: rootPackage.engines,
  };

  await writeFile(
    join(packageDir, 'package.json'),
    `${JSON.stringify(runtimePackage, null, 2)}\n`,
    'utf-8',
  );
}

async function copyWorkspacePackage(packageName, packageDir) {
  const sourceDir = join(rootDir, 'packages', packageName);
  const targetDir = join(packageDir, 'node_modules', '@openwriter', packageName);
  const packageJson = JSON.parse(await readFile(join(sourceDir, 'package.json'), 'utf-8'));

  await mkdir(targetDir, { recursive: true });
  await cp(join(sourceDir, 'dist'), join(targetDir, 'dist'), {
    recursive: true,
    filter: source => !/\.test\.(js|d\.ts|js\.map|d\.ts\.map)$/.test(source),
  });
  await writeFile(
    join(targetDir, 'package.json'),
    `${JSON.stringify(toRuntimePackageJson(packageName, packageJson), null, 2)}\n`,
    'utf-8',
  );
}

function toRuntimePackageJson(packageName, packageJson) {
  return {
    ...packageJson,
    private: true,
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    bin: packageName === 'cli'
      ? { wa: './dist/index.js' }
      : packageJson.bin,
  };
}

async function copyExternalPackage(packageName, packageDir) {
  const sourceDir = join(rootDir, 'node_modules', packageName);
  if (!existsSync(sourceDir)) {
    throw new Error(`Missing dependency ${packageName}. Run npm install first.`);
  }
  
  // Copy the package itself
  const targetDir = join(packageDir, 'node_modules', packageName);
  await cp(sourceDir, targetDir, {
    recursive: true,
    filter: source => {
      // Skip nested node_modules - we'll handle dependencies separately
      if (source.includes(`${packageName}${sep()}node_modules${sep()}`)) {
        return false;
      }
      // Skip cache directories
      if (source.includes('.cache')) {
        return false;
      }
      return true;
    },
  });
  
  // Recursively copy dependencies
  const pkgJsonPath = join(sourceDir, 'package.json');
  if (existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
    const deps = Object.keys(pkgJson.dependencies || {});
    for (const dep of deps) {
      const depTargetDir = join(packageDir, 'node_modules', dep);
      if (!existsSync(depTargetDir)) {
        await copyExternalPackage(dep, packageDir);
      }
    }
  }
}

async function writeLauncher(packageDir, platform) {
  const target = join(packageDir, 'node_modules', '@openwriter', 'cli', 'dist', 'index.js');

  if (platform === 'win32') {
    const content = [
      '@echo off',
      'setlocal',
      'node "%~dp0\\..\\node_modules\\@openwriter\\cli\\dist\\index.js" %*',
      'endlocal',
      '',
    ].join('\r\n');
    await writeFile(join(packageDir, 'bin', 'wa.cmd'), content, 'utf-8');
    return;
  }

  const relativeTarget = target
    .slice(packageDir.length + 1)
    .replaceAll('\\', '/');
  const content = [
    '#!/usr/bin/env sh',
    'set -e',
    'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
    `exec node "$SCRIPT_DIR/../${relativeTarget}" "$@"`,
    '',
  ].join('\n');

  const launcherPath = join(packageDir, 'bin', 'wa');
  await writeFile(launcherPath, content, 'utf-8');
  await chmod(launcherPath, 0o755);
}

async function writeWindowsInstallers(packageDir) {
  const installCmd = [
    '@echo off',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"',
    '',
  ].join('\r\n');
  const uninstallCmd = [
    '@echo off',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"',
    '',
  ].join('\r\n');
  const installPs1 = [
    "$ErrorActionPreference = 'Stop'",
    "$bin = (Join-Path $PSScriptRoot 'bin')",
    "$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "$parts = @($userPath -split ';' | Where-Object { $_ })",
    "if ($parts -notcontains $bin) {",
    "  [Environment]::SetEnvironmentVariable('Path', (($parts + $bin) -join ';'), 'User')",
    "  Write-Host \"Added OpenWriter to user PATH: $bin\"",
    '} else {',
    "  Write-Host \"OpenWriter is already on user PATH: $bin\"",
    '}',
    "Write-Host 'Open a new cmd window, then run: wa --help'",
    '',
  ].join('\r\n');
  const uninstallPs1 = [
    "$ErrorActionPreference = 'Stop'",
    "$bin = (Join-Path $PSScriptRoot 'bin')",
    "$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "$parts = @($userPath -split ';' | Where-Object { $_ -and $_ -ne $bin })",
    "[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')",
    "Write-Host \"Removed OpenWriter from user PATH: $bin\"",
    "Write-Host 'Open a new cmd window for PATH changes to take effect.'",
    '',
  ].join('\r\n');

  await writeFile(join(packageDir, 'install.cmd'), installCmd, 'utf-8');
  await writeFile(join(packageDir, 'uninstall.cmd'), uninstallCmd, 'utf-8');
  await writeFile(join(packageDir, 'install.ps1'), installPs1, 'utf-8');
  await writeFile(join(packageDir, 'uninstall.ps1'), uninstallPs1, 'utf-8');
}

async function writeReadme(packageDir, platform) {
  const content = platform === 'win32'
    ? [
      `OpenWriter ${rootPackage.version}`,
      '',
      'Requirements: Node.js >= 22.',
      '',
      'Install for cmd:',
      '  1. Extract this folder somewhere stable, for example C:\\Tools\\OpenWriter.',
      '  2. Run install.cmd.',
      '  3. Open a new cmd window.',
      '  4. Run wa --help.',
      '',
      'Portable usage without installing:',
      '  bin\\wa.cmd --help',
      '',
      'Examples:',
      '  wa init "My Writing Project"',
      '  wa write --task "write chapter one"',
      '',
      'Set DEEPSEEK_API_KEY or OPENAI_API_KEY before calling hosted models.',
      '',
    ].join('\n')
    : [
      `OpenWriter ${rootPackage.version}`,
      '',
      'Requirements: Node.js >= 22.',
      '',
      'Usage:',
      '  ./bin/wa init "My Writing Project"',
      '  ./bin/wa write --task "write chapter one"',
      '',
      'Set DEEPSEEK_API_KEY or OPENAI_API_KEY before calling hosted models.',
      '',
    ].join('\n');

  await writeFile(join(packageDir, 'README.txt'), content, 'utf-8');
}

async function archivePackage(packageName, platform) {
  const archiveName = platform === 'win32'
    ? `${packageName}.zip`
    : `${packageName}.tar.gz`;
  try {
    if (platform === 'win32') {
      runPowerShell([
        'Compress-Archive',
        '-LiteralPath',
        packageName,
        '-DestinationPath',
        archiveName,
        '-Force',
      ], releaseDir);
    } else {
      run('tar', ['-czf', archiveName, packageName], releaseDir);
    }
  } catch {
    console.warn(`Could not create ${archiveName}; packaged directory is still available.`);
  }
}

function parseTargets(args) {
  if (args.includes('--all')) return allTargets;

  const platformArg = args.find(arg => arg.startsWith('--platform='));
  const splitArg = args.findIndex(arg => arg === '--platform');
  const rawPlatform = platformArg
    ? platformArg.slice('--platform='.length)
    : splitArg >= 0
      ? args[splitArg + 1]
      : process.platform;

  const platform = normalizePlatform(rawPlatform);
  if (!allTargets.includes(platform)) {
    throw new Error(`Unsupported platform: ${rawPlatform}`);
  }
  return [platform];
}

function normalizePlatform(platform) {
  const normalized = platform.toLowerCase();
  if (['win', 'windows', 'win32'].includes(normalized)) return 'win32';
  if (['mac', 'macos', 'darwin'].includes(normalized)) return 'darwin';
  if (['linux'].includes(normalized)) return 'linux';
  return normalized;
}

function targetLabel(platform) {
  switch (platform) {
    case 'win32':
      return 'windows-x64';
    case 'darwin':
      return 'macos-x64';
    case 'linux':
      return 'linux-x64';
    default:
      return platform;
  }
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function runPackageBuild() {
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd run build'], rootDir);
    return;
  }

  if (process.env.npm_execpath) {
    run(process.execPath, [process.env.npm_execpath, 'run', 'build'], rootDir);
    return;
  }

  run('npm', ['run', 'build'], rootDir);
}

function runPowerShell(args, cwd) {
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ...args], cwd);
}

function sep() {
  return process.platform === 'win32' ? '\\' : '/';
}
