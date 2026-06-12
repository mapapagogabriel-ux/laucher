const { Client, Authenticator } = require('minecraft-launcher-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const client = new Client();

// Game directory
const GAME_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.hiddenwar');

/**
 * Copy bundled resources (mods + java8) from app package to game dir on first install
 */
function copyBundledResources() {
  // Determine bundled path — works in dev and packaged mode
  let bundledPath;
  try {
    const { app } = require('electron');
    bundledPath = path.join(process.resourcesPath || app.getAppPath(), 'bundled');
  } catch {
    bundledPath = path.join(__dirname, 'bundled');
  }
  if (!bundledPath || !fs.existsSync(bundledPath)) {
    bundledPath = path.join(__dirname, 'bundled');
  }
  if (!fs.existsSync(bundledPath)) {
    console.log('[Launcher] No bundled resources found at:', bundledPath);
    return;
  }

  // Copy mods
  const bundledMods = path.join(bundledPath, 'mods');
  const gameMods = path.join(GAME_DIR, 'mods');
  if (fs.existsSync(bundledMods)) {
    fs.mkdirSync(gameMods, { recursive: true });
    const files = fs.readdirSync(bundledMods).filter(f => f.endsWith('.jar'));
    let copied = 0;
    for (const file of files) {
      const dest = path.join(gameMods, file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(bundledMods, file), dest);
        copied++;
      }
    }
    console.log(`[Launcher] Copied ${copied} bundled mods to ${gameMods}`);
  }

  // Copy Java 8
  const bundledJava = path.join(bundledPath, 'runtime', 'java8');
  const gameJava = path.join(GAME_DIR, 'runtime', 'java8');
  if (fs.existsSync(bundledJava) && !fs.existsSync(path.join(gameJava, 'bin', 'javaw.exe'))) {
    console.log('[Launcher] Copying bundled Java 8...');
    copyDirSync(bundledJava, gameJava);
    console.log('[Launcher] Java 8 installed from bundle.');
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Run on import
copyBundledResources();

// Forge config
const FORGE_VERSION = '14.23.5.2860';
const FORGE_MC = '1.12.2';
const FORGE_FULL = `${FORGE_MC}-${FORGE_VERSION}`;
const FORGE_INSTALLER_URL = `https://maven.minecraftforge.net/net/minecraftforge/forge/${FORGE_FULL}/forge-${FORGE_FULL}-installer.jar`;
const FORGE_INSTALLER_PATH = path.join(GAME_DIR, `forge-${FORGE_FULL}-installer.jar`);

// Java 8 config
const JAVA_DIR = path.join(GAME_DIR, 'runtime', 'java8');
const JAVA_EXE = path.join(JAVA_DIR, 'bin', 'javaw.exe');
const JAVA8_ZIP = path.join(GAME_DIR, 'runtime', 'java8.zip');
const JAVA8_URL = 'https://api.adoptium.net/v3/binary/latest/8/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk';

/**
 * Download a file with redirect support and progress
 */
function downloadFile(url, dest, onProgress, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, { headers: { 'User-Agent': 'HiddenWarLauncher/2.4' } }, (response) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        return downloadFile(response.headers.location, dest, onProgress, maxRedirects - 1)
          .then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode} ao baixar ${path.basename(dest)}`));
      }

      const totalBytes = parseInt(response.headers['content-length'], 10);
      let downloadedBytes = 0;
      const file = fs.createWriteStream(dest);

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (onProgress && totalBytes) {
          onProgress(Math.round((downloadedBytes / totalBytes) * 100), downloadedBytes, totalBytes);
        }
      });

      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
      file.on('error', (err) => { fs.unlinkSync(dest); reject(err); });
    }).on('error', (err) => {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

/**
 * Extract a zip file using PowerShell (built-in on Windows)
 */
function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
    { timeout: 120000, stdio: 'pipe' }
  );
}

/**
 * Ensure Java 8 JRE is available
 */
async function ensureJava8(send) {
  // Check if already downloaded
  if (fs.existsSync(JAVA_EXE)) {
    send('launch:status', { status: 'downloading', message: 'Java 8 encontrado.' });
    return JAVA_EXE;
  }

  send('launch:status', { status: 'downloading', message: 'Baixando Java 8 (necessário para Forge 1.12.2)...' });

  // Download Java 8 JRE from Adoptium
  await downloadFile(JAVA8_URL, JAVA8_ZIP, (pct, downloaded, total) => {
    const mb = (downloaded / 1048576).toFixed(1);
    const totalMb = (total / 1048576).toFixed(1);
    send('launch:progress', { type: 'java', task: pct, total: 100, percent: pct });
    send('launch:status', { status: 'downloading', message: `Baixando Java 8... ${mb}MB / ${totalMb}MB (${pct}%)` });
  });

  send('launch:status', { status: 'downloading', message: 'Extraindo Java 8...' });

  // Extract
  const tempExtract = path.join(GAME_DIR, 'runtime', 'java8_temp');
  extractZip(JAVA8_ZIP, tempExtract);

  // Adoptium extracts into a subfolder like "jdk8u382-b05-jre"
  // Find it and move contents to JAVA_DIR
  const extracted = fs.readdirSync(tempExtract);
  const jdkFolder = extracted.find(f => f.startsWith('jdk') || f.startsWith('OpenJDK'));

  if (jdkFolder) {
    const srcPath = path.join(tempExtract, jdkFolder);
    // Move/rename to final location
    if (fs.existsSync(JAVA_DIR)) fs.rmSync(JAVA_DIR, { recursive: true, force: true });
    fs.renameSync(srcPath, JAVA_DIR);
  } else {
    // Contents might be directly in temp folder
    if (fs.existsSync(JAVA_DIR)) fs.rmSync(JAVA_DIR, { recursive: true, force: true });
    fs.renameSync(tempExtract, JAVA_DIR);
  }

  // Cleanup
  if (fs.existsSync(tempExtract)) fs.rmSync(tempExtract, { recursive: true, force: true });
  if (fs.existsSync(JAVA8_ZIP)) fs.unlinkSync(JAVA8_ZIP);

  if (!fs.existsSync(JAVA_EXE)) {
    // Try to find javaw.exe recursively
    const found = findFile(JAVA_DIR, 'javaw.exe');
    if (found) {
      send('launch:status', { status: 'downloading', message: 'Java 8 instalado!' });
      return found;
    }
    throw new Error('Java 8 baixado mas javaw.exe não encontrado. Verifique a pasta: ' + JAVA_DIR);
  }

  send('launch:status', { status: 'downloading', message: 'Java 8 instalado com sucesso!' });
  return JAVA_EXE;
}

/**
 * Recursively find a file
 */
function findFile(dir, filename) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(fullPath, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Ensure Forge installer is downloaded
 */
async function ensureForgeInstaller(send) {
  if (fs.existsSync(FORGE_INSTALLER_PATH)) {
    const stats = fs.statSync(FORGE_INSTALLER_PATH);
    if (stats.size > 1000000) {
      send('launch:status', { status: 'downloading', message: 'Forge installer encontrado.' });
      return FORGE_INSTALLER_PATH;
    }
    fs.unlinkSync(FORGE_INSTALLER_PATH);
  }

  send('launch:status', { status: 'downloading', message: `Baixando Forge ${FORGE_VERSION}...` });

  await downloadFile(FORGE_INSTALLER_URL, FORGE_INSTALLER_PATH, (pct) => {
    send('launch:progress', { type: 'forge', task: pct, total: 100, percent: pct });
    send('launch:status', { status: 'downloading', message: `Baixando Forge... ${pct}%` });
  });

  send('launch:status', { status: 'downloading', message: 'Forge baixado!' });
  return FORGE_INSTALLER_PATH;
}

/**
 * Launch Minecraft 1.12.2 with Forge
 */
async function launchGame({ username, ram, window }) {
  const send = (channel, data) => {
    if (window && !window.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  };

  send('launch:status', { status: 'preparing', message: 'Preparando o launcher...' });

  try {
    // Step 1: Ensure Java 8
    const javaPath = await ensureJava8(send);
    console.log('[Launcher] Java 8 path:', javaPath);

    // Step 2: Ensure Forge installer
    const forgePath = await ensureForgeInstaller(send);
    console.log('[Launcher] Forge path:', forgePath);

    send('launch:status', { status: 'downloading', message: 'Preparando Minecraft 1.12.2 + Forge...' });

    // Step 3: Build launch options
    const opts = {
      authorization: Authenticator.getAuth(username || 'NinjaPlayer'),
      root: GAME_DIR,
      javaPath: javaPath,
      version: {
        number: FORGE_MC,
        type: 'release'
      },
      forge: forgePath,
      memory: {
        max: `${ram || 4}G`,
        min: '1G'
      },
      overrides: {
        detached: false
      }
    };

    // ===== Event Listeners =====
    client.removeAllListeners();

    client.on('progress', (e) => {
      const pct = Math.round((e.task / e.total) * 100);
      send('launch:progress', { type: e.type, task: e.task, total: e.total, percent: pct });
    });

    client.on('download-status', (e) => {
      send('launch:status', {
        status: 'downloading',
        message: `Baixando ${e.type}... (${e.current}/${e.total})`
      });
    });

    client.on('debug', (e) => console.log('[MCLC Debug]', e));

    client.on('arguments', () => {
      send('launch:status', { status: 'launching', message: 'Iniciando Minecraft 1.12.2 + Forge...' });
    });

    client.on('data', (e) => console.log('[Minecraft]', e));

    client.on('close', (code) => {
      console.log('[Minecraft] Closed with code:', code);
      send('launch:status', { status: 'closed', message: 'Minecraft fechado.', code });
    });

    client.on('error', (err) => {
      console.error('[MCLC Error]', err);
      send('launch:status', { status: 'error', message: `Erro: ${err.message || err}` });
    });

    // Step 4: Launch
    send('launch:status', { status: 'downloading', message: 'Verificando arquivos do jogo...' });
    await client.launch(opts);
    send('launch:status', { status: 'running', message: 'Minecraft 1.12.2 + Forge está rodando!' });

  } catch (err) {
    console.error('[Launcher] Launch failed:', err);
    send('launch:status', {
      status: 'error',
      message: `Falha ao iniciar: ${err.message || err}`
    });
  }
}

module.exports = { launchGame, GAME_DIR };
