// ============================================================
// WA-BOT — Bot WhatsApp otomatis (whatsapp-web.js)
// Fitur: balas otomatis (kata kunci), perintah (!menu dll),
//        stiker (.s — reply foto/video),
//        anti view-once (foto sekali lihat -> foto biasa),
//        pesan terjadwal, dan log sederhana.
// Jalankan: npm install  lalu  npm start  lalu scan QR di HP
//           (atau pakai kode pairing — lihat config.botNumber).
// Bisa jalan di VPS maupun di Termux (Android).
// Catatan: stiker video (animasi) butuh ffmpeg terinstal.
// ============================================================

const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
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
      return `Jam sekarang: ${now.toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} WITA.`;
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

  // Cari media: utamakan pesan yang di-reply, lalu media di pesan itu sendiri
  let mediaMsg = null;
  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      if (quoted && quoted.hasMedia) mediaMsg = quoted;
    } catch (e) {
      log('⚠️ Gagal ambil pesan reply:', e.message);
    }
  }
  if (!mediaMsg && msg.hasMedia) mediaMsg = msg;

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
  let mediaMsg = null;
  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      if (quoted && quoted.hasMedia) mediaMsg = quoted;
    } catch (e) {
      log('⚠️ Gagal ambil pesan reply:', e.message);
    }
  }
  if (!mediaMsg) {
    return 'Caranya: *reply foto/video sekali lihat* lalu ketik *.vo*\n' +
      'Bot akan mengirim ulang medianya sebagai foto/video biasa.';
  }
  const ok = await resendAsNormalMedia(msg, mediaMsg);
  if (!ok) return 'Gagal mengunduh medianya — mungkin sudah tidak tersedia lagi.';
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
