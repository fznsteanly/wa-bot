// ============================================================
// WA-BOT — Bot WhatsApp otomatis (whatsapp-web.js)
// Fitur: balas otomatis (kata kunci), perintah (!menu dll),
//        stiker (.s), stiker -> foto (.toimg),
//        anti view-once (.vo), cuaca (.cuaca),
//        jadwal sholat (.jadwalsholat), pengingat (.ingetin),
//        tag semua anggota grup (.tagall),
//        pesan terjadwal, dan log sederhana.
// Jalankan: npm install  lalu  npm start  lalu scan QR di HP
//           (atau pakai kode pairing — lihat config.botNumber).
// Bisa jalan di VPS maupun di Termux (Android).
// Catatan: stiker video (animasi) & .toimg butuh ffmpeg terinstal.
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const schedule = require('node-schedule');
const config = require('./config');

const log = (...args) => console.log(new Date().toISOString(), ...args);

// Cooldown per chat supaya bot tidak nge-spam
const lastReplyAt = new Map();

function isOnCooldown(chatId) {
  const last = lastReplyAt.get(chatId);
  if (!last) return false;
  return Date.now() - last < config.replyCooldownSeconds * 1000;
}

// Cari balasan dari aturan kata kunci
function findAutoReply(text) {
  const lower = text.toLowerCase();
  for (const rule of config.autoReplies) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return rule.reply;
    }
  }
  return null;
}

// Cari media dari pesan yang di-reply, atau dari pesan itu sendiri
// (misal foto dikirim dengan caption perintah). Dipakai .s, .vo, .toimg.
async function findMediaMessage(msg) {
  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      if (quoted && quoted.hasMedia) return quoted;
    } catch (e) {
      log('⚠️ Gagal ambil pesan reply:', e.message);
    }
  }
  if (msg.hasMedia) return msg;
  return null;
}

// Ambil JSON dari URL dengan batas waktu (untuk API cuaca & jadwal sholat)
async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Terjemahan deskripsi cuaca wttr.in (Inggris -> Indonesia)
const WEATHER_ID = {
  'Clear': 'Cerah', 'Sunny': 'Cerah',
  'Partly cloudy': 'Berawan sebagian', 'Partly Cloudy': 'Berawan sebagian',
  'Cloudy': 'Berawan', 'Overcast': 'Mendung',
  'Mist': 'Berkabut', 'Fog': 'Berkabut tebal', 'Freezing fog': 'Kabut beku',
  'Patchy rain possible': 'Berpotensi hujan',
  'Patchy light drizzle': 'Gerimis ringan setempat',
  'Light drizzle': 'Gerimis ringan', 'Drizzle': 'Gerimis',
  'Light rain': 'Hujan ringan', 'Patchy light rain': 'Hujan ringan setempat',
  'Moderate rain': 'Hujan sedang', 'Patchy moderate rain': 'Hujan sedang setempat',
  'Heavy rain': 'Hujan lebat', 'Patchy heavy rain': 'Hujan lebat setempat',
  'Light rain shower': 'Hujan gerimis',
  'Moderate or heavy rain shower': 'Hujan deras',
  'Torrential rain shower': 'Hujan sangat deras',
  'Thundery outbreaks possible': 'Berpotensi petir',
  'Patchy light rain with thunder': 'Hujan ringan disertai petir',
  'Moderate or heavy rain with thunder': 'Hujan disertai petir',
  'Thunderstorm': 'Badai petir',
  'Light snow': 'Salju ringan', 'Heavy snow': 'Salju lebat',
  'Light sleet': 'Hujan es ringan', 'Moderate or heavy sleet': 'Hujan es',
};
function translateWeather(desc) {
  return WEATHER_ID[desc] || desc;
}

// Nama bulan Hijriah (untuk jadwal sholat)
const HIJRI_MONTHS = ['Muharram', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Syaban', 'Ramadan', 'Syawal', 'Zulkaidah', 'Zulhijah'];

// Parse durasi pengingat: 30m, 2j, 1h30m, 45d, 10s, "1j 30m", angka saja = menit.
// Kembalikan milidetik, atau null kalau format tidak dikenali.
function parseDuration(str) {
  const s = (str || '').trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 60000;
  const re = /(\d+)\s*(jam|j|h|menit|mnt|m|detik|dtk|s)/g;
  let ms = 0, found = false, match;
  while ((match = re.exec(s)) !== null) {
    found = true;
    const n = parseInt(match[1], 10);
    const u = match[2];
    if (u === 'jam' || u === 'j' || u === 'h') ms += n * 3600000;
    else if (u === 'menit' || u === 'mnt' || u === 'm') ms += n * 60000;
    else ms += n * 1000;
  }
  if (!found) return null;
  const cleaned = s.replace(/(\d+)\s*(jam|j|h|menit|mnt|m|detik|dtk|s)\s*/g, '');
  if (cleaned.trim() !== '') return null;
  return ms > 0 ? ms : null;
}

function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h} jam`);
  if (m) parts.push(`${m} menit`);
  if (s || parts.length === 0) parts.push(`${s} detik`);
  return parts.join(' ');
}

// Konversi stiker WebP -> JPG pakai ffmpeg. Kembalikan base64 JPG,
// atau null kalau ffmpeg tidak ada / gagal (pemanggil pakai WebP asli).
function webpToJpg(base64) {
  return new Promise((resolve) => {
    let tmp;
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-'));
      const input = path.join(tmp, 'in.webp');
      const output = path.join(tmp, 'out.jpg');
      fs.writeFileSync(input, Buffer.from(base64, 'base64'));
      execFile('ffmpeg', ['-y', '-v', 'error', '-i', input, output], (err) => {
        let result = null;
        if (!err && fs.existsSync(output)) result = fs.readFileSync(output).toString('base64');
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
        resolve(result);
      });
    } catch (e) {
      if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
      resolve(null);
    }
  });
}

// Tangani perintah yang diawali !
async function handleCommand(msg, text) {
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case '!menu':
    case '!help':
      return config.menuText;
    case '!ping':
      return 'Pong! 🏓 Bot aktif dan siap melayani.';
    case '!jam': {
      const now = new Date();
      const hour = parseInt(now.toLocaleString('en-US', {
        timeZone: 'Asia/Makassar', hour: 'numeric', hourCycle: 'h23',
      }), 10);
      const greet = hour >= 5 && hour < 11 ? '☀️ Selamat pagi!'
        : hour >= 11 && hour < 15 ? '🌤️ Selamat siang!'
        : hour >= 15 && hour < 18 ? '🌇 Selamat sore!'
        : '🌙 Selamat malam!';
      const dateStr = now.toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        timeZone: 'Asia/Makassar',
      });
      const timeStr = now.toLocaleTimeString('id-ID', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Asia/Makassar',
      }).replace(/\./g, ':');
      return `${greet}\n🗓️ ${dateStr}\n🕐 ${timeStr} WITA`;
    }
    case '!owner':
      return config.ownerNumber
        ? `Owner: +${config.ownerNumber}`
        : 'Kontak owner belum diatur di config.js.';
    default:
      return null; // perintah tidak dikenal -> lanjut ke aturan biasa
  }
}

// Ubah foto/video menjadi stiker.
// Cara pakai: reply foto/video lalu ketik .s
//   .s            -> stiker dengan nama dari config.js
//   .s teks bebas -> stiker dengan nama "teks bebas"
// Bisa juga kirim foto/video dengan caption .s (tanpa reply).
// Foto -> stiker biasa, video/gif pendek -> stiker animasi
// (stiker video butuh ffmpeg terinstal di server).
async function handleSticker(msg, text) {
  const customName = text.trim().split(/\s+/).slice(1).join(' ');

  const mediaMsg = await findMediaMessage(msg);
  if (!mediaMsg) {
    return 'Caranya: *reply foto/video* lalu ketik *.s*\n' +
      'Contoh: tahan foto > Reply > ketik *.s* > kirim.\n' +
      'Bisa juga kirim foto dengan caption *.s*.';
  }

  const media = await mediaMsg.downloadMedia();
  if (!media || !media.data) {
    return 'Gagal mengunduh medianya. Coba kirim ulang fotonya lalu *.s* lagi ya.';
  }

  const isVideo = (media.mimetype || '').startsWith('video/');
  await client.sendMessage(msg.from, media, {
    sendMediaAsSticker: true,
    stickerName: customName || config.stickerName,
    stickerAuthor: config.stickerAuthor,
    quotedMessageId: msg.id._serialized,
  });
  log(`🏷️ Stiker ${isVideo ? 'video' : 'foto'} dikirim ke ${msg.from}`);
  return null; // sudah dibalas langsung, tidak perlu balasan teks
}

// Kirim ulang sebuah media sebagai foto/video biasa (bukan sekali lihat).
// Dipakai oleh konversi otomatis maupun perintah .vo.
async function resendAsNormalMedia(msg, mediaMsg) {
  const media = await mediaMsg.downloadMedia();
  if (!media || !media.data) return false;
  const isVideo = (media.mimetype || '').startsWith('video/');
  await client.sendMessage(msg.from, media, {
    caption: isVideo
      ? '🎬 Video sekali lihat — disimpan sebagai video biasa'
      : '📸 Foto sekali lihat — disimpan sebagai foto biasa',
  });
  log(`👁️ Media sekali lihat dikirim ulang sebagai ${isVideo ? 'video' : 'foto'} biasa ke ${msg.from}`);
  return true;
}

// Perintah .vo / .lihat — reply ke foto/video sekali lihat untuk
// mengubahnya jadi foto/video biasa. Ini cara utama memakai fitur
// anti view-once (konversi otomatis nonaktif secara default).
async function handleViewOnceCommand(msg) {
  const mediaMsg = await findMediaMessage(msg);
  if (!mediaMsg) {
    return 'Caranya: *reply foto/video sekali lihat* lalu ketik *.vo*\n' +
      'Bot akan mengirim ulang medianya sebagai foto/video biasa.';
  }
  const ok = await resendAsNormalMedia(msg, mediaMsg);
  if (!ok) return 'Gagal mengunduh medianya — mungkin sudah tidak tersedia lagi.';
  return null; // sudah dibalas langsung
}

// Perintah .toimg — reply stiker/foto untuk mengubahnya jadi foto biasa.
// Stiker WebP dikonversi ke JPG (butuh ffmpeg); kalau ffmpeg tidak ada,
// WebP asli tetap dikirim sebagai gambar.
async function handleToImg(msg) {
  const mediaMsg = await findMediaMessage(msg);
  if (!mediaMsg) {
    return 'Caranya: *reply stiker/foto* lalu ketik *.toimg*';
  }
  const media = await mediaMsg.downloadMedia();
  if (!media || !media.data) {
    return 'Gagal mengunduh medianya. Coba lagi ya.';
  }
  let outMedia = media;
  if ((media.mimetype || '') === 'image/webp') {
    const jpg = await webpToJpg(media.data);
    if (jpg) outMedia = new MessageMedia('image/jpeg', jpg, 'sticker.jpg');
  }
  await client.sendMessage(msg.from, outMedia, {
    caption: '🖼️ Stiker diubah jadi foto',
    quotedMessageId: msg.id._serialized,
  });
  log(`🖼️ Stiker diubah jadi foto untuk ${msg.from}`);
  return null; // sudah dibalas langsung
}

// Perintah .cuaca [kota] — cuaca terkini dari wttr.in (gratis, tanpa API key).
// Tanpa kota, pakai config.defaultCity.
async function handleWeather(msg, city) {
  const query = (city || '').trim() || config.defaultCity;
  try {
    const data = await fetchJson(`https://wttr.in/${encodeURIComponent(query)}?format=j1`);
    const cur = data && data.current_condition && data.current_condition[0];
    if (!cur) return `Cuaca untuk "${query}" tidak ditemukan. Coba nama kota lain ya.`;
    const today = data.weather && data.weather[0];
    const desc = translateWeather(cur.weatherDesc[0].value);
    let reply = `🌤️ *Cuaca ${query}*\n\n${desc}\n` +
      `🌡️ ${cur.temp_C}°C (terasa ${cur.FeelsLikeC}°C)\n` +
      `💧 Kelembapan ${cur.humidity}%\n` +
      `💨 Angin ${cur.windspeedKmph} km/jam ${cur.winddir16Point}\n` +
      `🌧️ Hujan ${cur.precipMM} mm`;
    if (today) reply += `\n📈 Hari ini: ${today.mintempC}–${today.maxtempC}°C`;
    return reply;
  } catch (err) {
    log('❌ Gagal ambil cuaca:', err.message);
    return 'Gagal mengambil data cuaca. Coba lagi sebentar ya.';
  }
}

// Perintah .jadwalsholat [kota] — jadwal sholat hari ini dari Aladhan
// (gratis, tanpa API key; metode Kemenag RI). Tanpa kota, pakai defaultCity.
async function handlePrayerTimes(msg, city) {
  const query = (city || '').trim() || config.defaultCity;
  try {
    const data = await fetchJson(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(query)}&country=Indonesia&method=20`);
    if (!data || data.code !== 200 || !data.data) {
      return `Jadwal sholat untuk "${query}" tidak ditemukan. Coba nama kota lain ya.`;
    }
    const t = data.data.timings;
    const h = data.data.date.hijri;
    const dateStr = new Date(data.data.date.timestamp * 1000).toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar',
    });
    const hijriMonth = HIJRI_MONTHS[h.month.number - 1] || h.month.en;
    return `🕌 *Jadwal Sholat ${query}*\n${dateStr}\n${h.day} ${hijriMonth} ${h.year} H\n\n` +
      `Subuh: ${t.Fajr}\nDzuhur: ${t.Dhuhr}\nAshar: ${t.Asr}\n` +
      `Maghrib: ${t.Maghrib}\nIsya: ${t.Isha}\n\n(Metode Kemenag RI)`;
  } catch (err) {
    log('❌ Gagal ambil jadwal sholat:', err.message);
    return 'Gagal mengambil jadwal sholat. Coba lagi sebentar ya.';
  }
}

// ---------- PENGINGAT (.ingetin) ----------
// .ingetin 30m minum obat   -> ingatkan 30 menit lagi
// .ingetin 1j30m rapat      -> ingatkan 1 jam 30 menit lagi
// .ingetin list             -> lihat pengingat aktif di chat ini
// .ingetin batal 1          -> batalkan pengingat nomor 1
// Catatan: pengingat tersimpan di memori — hilang kalau bot restart.
const reminders = new Map(); // chatId -> [{ id, text, fireAt, timer }]
let reminderSeq = 0;

async function handleRemind(msg, argsText) {
  const args = (argsText || '').trim();
  const chatId = msg.from;
  const list = reminders.get(chatId) || [];

  if (!args || args.toLowerCase() === 'help') {
    return 'Cara pakai: *.ingetin <waktu> <pesan>*\n' +
      'Contoh: *.ingetin 30m minum obat*\n' +
      'Waktu: 10s (detik), 30m (menit), 2j (jam), 1j30m. Maksimal 24 jam.\n' +
      '*.ingetin list* — lihat pengingat aktif\n' +
      '*.ingetin batal 1* — batalkan pengingat nomor 1';
  }
  if (args.toLowerCase() === 'list') {
    if (list.length === 0) return 'Tidak ada pengingat aktif di chat ini.';
    const lines = list.map((r, i) =>
      `${i + 1}. ${r.text} (dalam ${formatDuration(r.fireAt - Date.now())})`);
    return `⏰ *Pengingat aktif:*\n${lines.join('\n')}`;
  }
  const cancelMatch = args.match(/^batal\s+(\d+)$/i);
  if (cancelMatch) {
    const idx = parseInt(cancelMatch[1], 10) - 1;
    if (idx < 0 || idx >= list.length) return 'Nomor pengingat tidak ada. Cek dengan *.ingetin list*.';
    const [removed] = list.splice(idx, 1);
    clearTimeout(removed.timer);
    return `Pengingat dibatalkan: ${removed.text}`;
  }

  const parts = args.split(/\s+/);
  const ms = parseDuration(parts[0]);
  const text = parts.slice(1).join(' ');
  if (ms === null || !text) {
    return 'Format tidak dikenali. Contoh: *.ingetin 30m minum obat*';
  }
  if (ms > 24 * 3600000) return 'Maksimal pengingat 24 jam ya.';
  const fireAt = Date.now() + ms;
  const id = ++reminderSeq;
  const timer = setTimeout(async () => {
    try {
      const current = reminders.get(chatId) || [];
      reminders.set(chatId, current.filter((r) => r.id !== id));
      await client.sendMessage(chatId, `⏰ *Pengingat:* ${text}`, {
        quotedMessageId: msg.id._serialized,
      });
      log(`⏰ Pengingat terkirim ke ${chatId}: ${text}`);
    } catch (err) {
      log('❌ Gagal kirim pengingat:', err.message);
    }
  }, ms);
  list.push({ id, text, fireAt, timer });
  reminders.set(chatId, list);
  return `Siap, kuingetin ${formatDuration(ms)} lagi: ${text} ⏰`;
}

// Perintah .tagall [pesan] — sebut semua anggota grup (khusus admin grup).
// Hanya jalan di grup dan hanya jika replyInGroups aktif di config.
async function handleTagAll(msg, text) {
  const chat = await msg.getChat();
  if (!chat.isGroup) return 'Perintah ini cuma bisa dipakai di grup.';
  const senderId = msg.author || msg.from;
  const sender = (chat.participants || []).find((p) => p.id._serialized === senderId);
  const isOwner = config.ownerNumber && senderId.startsWith(config.ownerNumber);
  const isAdmin = sender && (sender.isAdmin || sender.isSuperAdmin);
  if (!isAdmin && !isOwner) return 'Cuma admin grup yang bisa pakai .tagall.';
  const botId = client.info && client.info.wid && client.info.wid._serialized;
  const targets = (chat.participants || []).filter((p) =>
    p.id._serialized.endsWith('@c.us') && p.id._serialized !== botId);
  if (targets.length === 0) return 'Tidak ada anggota grup yang bisa di-tag.';
  const extra = text.trim().split(/\s+/).slice(1).join(' ');
  const CHUNK = 100;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const mentions = chunk.map((p) => p.id._serialized);
    const tags = chunk.map((p) => `@${p.id.user}`).join(' ');
    const body = (extra ? `${extra}\n\n` : '') + `📣 ${tags}`;
    await client.sendMessage(msg.from, body, { mentions });
  }
  log(`📣 .tagall di ${msg.from}: ${targets.length} anggota di-tag`);
  return null; // sudah dibalas langsung
}

const client = new Client({
  authStrategy: new LocalAuth(), // sesi tersimpan di .wwebjs_auth, QR cukup sekali
  puppeteer: {
    headless: true,
    // Termux tidak bisa memakai Chromium bawaan Puppeteer — pakai Chromium Termux
    ...(fs.existsSync('/data/data/com.termux/files/usr/bin/chromium')
      ? { executablePath: '/data/data/com.termux/files/usr/bin/chromium' }
      : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
  // Kalau botNumber diisi di config.js, login pakai kode pairing 8 huruf
  // (tidak perlu scan QR — cocok untuk Termux di HP yang sama).
  ...(config.botNumber
    ? { pairWithPhoneNumber: { phoneNumber: config.botNumber } }
    : {}),
});

client.on('qr', (qr) => {
  console.log('\n=== SCAN QR INI DENGAN WHATSAPP DI HP ===');
  console.log('(WhatsApp > titik tiga > Perangkat tertaut > Tautkan perangkat)\n');
  qrcode.generate(qr, { small: true });
});

client.on('code', (code) => {
  console.log('\n=== KODE PAIRING (masukkan di WhatsApp bot) ===');
  console.log(`\n        ${code}\n`);
  console.log('(WhatsApp bot > titik tiga > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon)\n');
});

client.on('ready', () => {
  log('✅ Bot siap! Terhubung sebagai:', client.info.pushname, `(+${client.info.wid.user})`);
  startScheduledJobs();
});

client.on('authenticated', () => log('🔐 Terautentikasi, sesi tersimpan.'));
client.on('auth_failure', (m) => log('❌ Gagal autentikasi:', m));
client.on('disconnected', (reason) => log('⚠️ Terputus:', reason));

client.on('message', async (msg) => {
  try {
    // Abaikan pesan sendiri, status/story, dan pesan grup (kecuali diizinkan)
    if (msg.fromMe) return;
    if (msg.from === 'status@broadcast') return;
    const isGroup = msg.from.endsWith('@g.us');
    if (isGroup && !config.replyInGroups) return;

    const text = (msg.body || '').trim();

    // Anti view-once otomatis: foto/video sekali lihat langsung dikirim
    // ulang sebagai media biasa (pesan seperti ini tidak punya teks).
    const isViewOnce = msg.rawData && msg.rawData.isViewOnce;
    if (config.antiViewOnce && msg.hasMedia && isViewOnce) {
      try {
        await resendAsNormalMedia(msg, msg);
      } catch (err) {
        log('❌ Gagal konversi view-once:', err.message);
      }
      return;
    }

    if (!text) return; // abaikan pesan tanpa teks (gambar/stiker/dokumen)
    if (isOnCooldown(msg.from)) return;

    log(`📩 ${isGroup ? '[grup] ' : ''}${msg.from}: ${text.slice(0, 120)}`);

    let reply = null;
    const firstWord = text.split(/\s+/)[0].toLowerCase();
    if (firstWord === '.s' || firstWord === '.sticker' || firstWord === '.stiker') {
      // Perintah stiker membalas sendiri (kirim media), jadi selesai di sini
      reply = await handleSticker(msg, text);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.vo' || firstWord === '.lihat') {
      // Perintah view-once membalas sendiri (kirim media), jadi selesai di sini
      reply = await handleViewOnceCommand(msg);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.toimg') {
      // Perintah toimg membalas sendiri (kirim media), jadi selesai di sini
      reply = await handleToImg(msg);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.cuaca') {
      reply = await handleWeather(msg, text.split(/\s+/).slice(1).join(' '));
    } else if (firstWord === '.jadwalsholat' || firstWord === '.sholat') {
      reply = await handlePrayerTimes(msg, text.split(/\s+/).slice(1).join(' '));
    } else if (firstWord === '.ingetin' || firstWord === '.ingat') {
      reply = await handleRemind(msg, text.split(/\s+/).slice(1).join(' '));
    } else if (firstWord === '.tagall' || firstWord === '.tag') {
      // Perintah tagall membalas sendiri (kirim mention), jadi selesai di sini
      reply = await handleTagAll(msg, text);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (text.startsWith('!')) {
      reply = await handleCommand(msg, text);
    }
    if (reply === null) reply = findAutoReply(text);
    if (reply === null) reply = config.fallbackReply || null;

    if (reply) {
      await msg.reply(reply);
      lastReplyAt.set(msg.from, Date.now());
      log(`↩️ Dibalas ke ${msg.from}`);
    }
  } catch (err) {
    log('❌ Error menangani pesan:', err.message);
  }
});

// Pesan terjadwal dari config.js
function startScheduledJobs() {
  for (const job of config.scheduledMessages) {
    const chatId = job.to.includes('@') ? job.to : `${job.to}@c.us`;
    schedule.scheduleJob(job.schedule, async () => {
      try {
        await client.sendMessage(chatId, job.text);
        log(`⏰ Pesan terjadwal terkirim ke ${chatId}`);
      } catch (err) {
        log(`❌ Gagal kirim terjadwal ke ${chatId}:`, err.message);
      }
    });
    log(`⏰ Jadwal aktif: "${job.schedule}" -> ${chatId}`);
  }
  if (config.scheduledMessages.length === 0) {
    log('ℹ️ Tidak ada pesan terjadwal (atur di config.js).');
  }
}

client.initialize();
