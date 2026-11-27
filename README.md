# WA-BOT — Bot WhatsApp Otomatis

Bot WhatsApp berbasis [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js): jalan sebagai WhatsApp Web, login dengan scan QR dari HP.

## Fitur

- **Balas otomatis** berdasarkan kata kunci (atur di `config.js`)
- **Perintah**: `!menu`, `!ping`, `!jam`, `!owner`
- **Stiker**: reply foto/video lalu ketik `.s` — bot mengubahnya jadi stiker (video pendek jadi stiker animasi)
- **Stiker → foto**: reply stiker lalu ketik `.toimg`
- **Anti view-once**: reply foto/video sekali lihat lalu ketik `.vo` — diubah jadi foto/video biasa
- **Stiker audio**: `.audio` — simpan pesan suara dengan nama, kirim ulang sebagai pesan suara kapan pun
- **Cuaca**: `.cuaca [kota]` — cuaca terkini (wttr.in, gratis)
- **Jadwal sholat**: `.jadwalsholat [kota]` — jadwal sholat hari ini, metode Kemenag RI (Aladhan, gratis)
- **Pengingat**: `.ingetin 30m minum obat` — bot mengingatkan setelah waktunya tiba
- **Tag semua**: `.tagall [pesan]` — sebut semua anggota grup (khusus admin grup)
- **Broadcast**: `.bc <pesan>` — kirim promosi ke semua grup bot, jeda 1 menit per grup (khusus owner)
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

## Anti view-once (foto sekali lihat → foto biasa)

Reply foto/video sekali lihat lalu ketik `.vo` (atau `.lihat`) — bot mengunduh dan mengirim ulang medianya sebagai foto/video biasa.

Konversi otomatis **nonaktif secara default**. Kalau mau setiap foto/video sekali lihat yang masuk langsung diubah otomatis tanpa perintah, atur `antiViewOnce: true` di `config.js`.

## Stiker → foto (`.toimg`)

Reply sebuah stiker lalu ketik `.toimg` — bot mengubahnya jadi foto biasa (WebP dikonversi ke JPG, butuh `ffmpeg`; kalau tidak ada ffmpeg, WebP asli tetap dikirim sebagai gambar).

## Stiker audio (`.audio`)

WhatsApp tidak punya format stiker audio khusus — fitur ini menirunya: potongan suara disimpan dengan nama, lalu dikirim ulang sebagai **pesan suara** (voice note).

- Reply sebuah pesan suara/audio lalu ketik `.audio simpan ketawa` — suara itu tersimpan dengan nama `ketawa`.
- Ketik `.audio ketawa` di chat mana pun — bot mengirim suaranya sebagai pesan suara.
- `.audio list` — lihat semua stiker audio tersimpan.
- `.audio hapus ketawa` — hapus (khusus owner).

Audio disimpan sebagai `.ogg` (opus) di folder `audio-stickers/` (tidak ikut ke Git). Pesan suara WhatsApp memang sudah `.ogg`; file audio lain (mp3 dll) dikonversi otomatis — konversi butuh `ffmpeg` terinstal.

## Cuaca (`.cuaca`) & jadwal sholat (`.jadwalsholat`)

- `.cuaca` — cuaca kota default (`defaultCity` di `config.js`, awalnya Palu)
- `.cuaca Jakarta` — cuaca kota lain
- `.jadwalsholat` / `.jadwalsholat Makassar` — jadwal sholat hari ini, metode Kemenag RI

Keduanya memakai API gratis tanpa API key (wttr.in dan Aladhan). Butuh internet di server/HP yang menjalankan bot.

## Pengingat (`.ingetin`)

```
.ingetin 30m minum obat      -> ingatkan 30 menit lagi
.ingetin 1j30m berangkat     -> ingatkan 1 jam 30 menit lagi
.ingetin 10s cek oven        -> ingatkan 10 detik lagi
.ingetin list                -> lihat pengingat aktif
.ingetin batal 1             -> batalkan pengingat nomor 1
```

Satuan waktu: `s` detik, `m` menit, `j` jam (boleh digabung, misal `1j30m`). Maksimal 24 jam. Catatan: pengingat tersimpan di memori — hilang kalau bot dimatikan/restart.

## Tag semua anggota grup (`.tagall`)

`.tagall` atau `.tagall ada pengumuman` — bot menyebut semua anggota grup. Hanya bisa dipakai di grup, hanya oleh admin grup (atau owner), dan hanya kalau `replyInGroups: true` di `config.js`.

## Broadcast promosi (`.bc`) — khusus owner

Kirim pesan promosi ke **semua grup** yang diikuti bot, satu per satu dengan jeda (default 1 menit per grup, atur di `broadcastDelaySec`).

```
.bc Promo diskon 20% hari ini!     -> tampilkan pratinjau + daftar grup
.bc kirim                           -> mulai kirim
.bc status                          -> lihat progres
.bc batal                           -> batalkan
```

Alurnya: ketik `.bc <pesan>` dulu — bot menampilkan pratinjau dan jumlah grup — lalu konfirmasi dengan `.bc kirim`. Grup pertama dikirim langsung, grup berikutnya tiap jeda. Setelah selesai, bot mengirim laporan ke owner (berapa terkirim/gagal).

Hanya owner (`ownerNumber` di `config.js`) yang bisa memakai perintah ini, dan hanya lewat chat pribadi dengan bot.

⚠️ **Peringatan:** broadcast massal melanggar ketentuan WhatsApp. Jeda 1 menit mengurangi risiko, tapi tidak menghilangkan — nomor bot tetap bisa diblokir, dan grup bisa mengeluarkan bot. Pakai seperlunya, dan hanya ke grup yang memang mengizinkan promosi.

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

## Menjalankan di Termux (Android) — BISA ✅

Bot ini bisa jalan di Termux. Bot otomatis memakai Chromium Termux kalau tersedia.

```bash
pkg update && pkg upgrade
pkg install nodejs git chromium ffmpeg
git clone https://github.com/fznsteanly/wa-bot.git
cd wa-bot
npm install
npm start
```

**Login tanpa scan QR (disarankan di Termux):** isi `botNumber` di `config.js` dengan nomor WhatsApp bot (format `62812...`), lalu `npm start` — bot menampilkan kode pairing 8 huruf. Masukkan kode itu di WhatsApp nomor bot: **titik tiga → Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon**. Kalau `botNumber` dikosongkan, login tetap pakai scan QR (butuh HP kedua untuk scan).

**Supaya bot tetap hidup di Termux:**

```bash
termux-wake-lock   # cegah HP tidur/mematikan Termux
```

Juga matikan optimasi baterai untuk Termux (Pengaturan → Aplikasi → Termux → Baterai → Tidak dibatasi). Catatan: bot mati kalau Termux ditutup/dimatikan Android atau HP kehabisan baterai — untuk 24/7 yang stabil, VPS tetap lebih baik.

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
