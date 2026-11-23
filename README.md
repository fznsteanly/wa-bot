# WA-BOT — Bot WhatsApp Otomatis

Bot WhatsApp berbasis [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js): jalan sebagai WhatsApp Web, login dengan scan QR dari HP.

## Fitur

- **Balas otomatis** berdasarkan kata kunci (atur di `config.js`)
- **Perintah**: `!menu`, `!ping`, `!jam`, `!owner`
- **Stiker**: reply foto/video lalu ketik `.s` — bot mengubahnya jadi stiker (video pendek jadi stiker animasi)
- **Pesan terjadwal** (format cron, misal tiap hari jam 08:00)
- **Cooldown** anti-spam per chat
- Sesi tersimpan otomatis (QR cukup scan sekali)

## Stiker (`.s`)

1. Reply sebuah foto atau video, lalu ketik `.s` dan kirim — bot membalas dengan stikernya.
2. Bisa juga kirim foto/video dengan caption `.s` (tanpa reply).
3. `.s` diikuti teks akan memakai teks itu sebagai nama stiker, misal `.s lucu banget`.
4. Nama & pembuat default diatur di `config.js` (`stickerName`, `stickerAuthor`).

Stiker video (animasi) butuh `ffmpeg` terinstal di server:

```bash
sudo apt update && sudo apt install -y ffmpeg
```

## Cara pakai

```bash
npm install
npm start
```

Lalu scan QR yang muncul di terminal dengan WhatsApp di HP:
**WhatsApp → titik tiga → Perangkat tertaut → Tautkan perangkat.**

## Kustomisasi

Semua pengaturan ada di **`config.js`** — tidak perlu ubah `index.js`:

- `ownerNumber`: nomor owner (format `62812...`, tanpa `+`)
- `replyInGroups`: `true` kalau bot boleh balas di grup
- `autoReplies`: daftar kata kunci → balasan
- `fallbackReply`: balasan kalau tidak ada kata kunci yang cocok
- `scheduledMessages`: pesan terjadwal (cron). ID grup: lihat dari log saat bot menerima pesan grup (`...@g.us`)

## Menjalankan 24/7 (di VPS)

Bot harus terus jalan supaya bisa membalas. Di VPS, pakai `pm2`:

```bash
npm install -g pm2
pm2 start index.js --name wa-bot
pm2 save
pm2 startup   # ikuti instruksi yang muncul agar bot hidup lagi setelah reboot
```

Lihat log: `pm2 logs wa-bot`. Berhentikan: `pm2 stop wa-bot`.

## ⚠️ Peringatan penting

1. **Pakai nomor kedua, BUKAN nomor utama.** Bot ini memakai cara tidak resmi (otomatisasi WhatsApp Web). WhatsApp bisa memblokir nomor yang terdeteksi bot, terutama kalau mengirim banyak pesan.
2. **Jangan kirim pesan massal / spam.** Kirim ke banyak nomor yang tidak dikenal adalah cara tercepat kena blokir. Bot ini sengaja tidak punya fitur broadcast massal.
3. **Jaga folder `.wwebjs_auth`.** Isinya sesi login bot — siapa pun yang punya folder itu bisa memakai akun WhatsApp yang tertaut. Jangan dibagikan atau di-upload ke GitHub (sudah ada di `.gitignore`).
4. Bot butuh koneksi internet stabil. Kalau server mati, bot ikut mati sampai server dinyalakan lagi.

## Kebutuhan sistem

- Node.js 18 atau lebih baru
- ~1 GB RAM bebas (Chromium headless) dan ~500 MB disk untuk dependensi
