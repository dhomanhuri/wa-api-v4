# WhatsApp API Gateway (Baileys)

Simple WhatsApp API Gateway menggunakan library [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) dan Express.js.

## Fitur

- **Kirim Pesan**: API endpoint untuk mengirim pesan teks.
- **Webhook**: Meneruskan pesan masuk ke URL webhook yang dikonfigurasi.
- **Auto Reconnect**: Otomatis menyambung kembali jika koneksi terputus.
- **Multi-Device Support**: Mendukung fitur multi-device WhatsApp.
- **QR Code**: Menampilkan QR Code via terminal dan endpoint API.

## Instalasi

1.  Clone repository ini (atau unduh).
2.  Install dependensi:
    ```bash
    npm install
    ```

## Konfigurasi

Buat file `.env` di root folder (jika belum ada) dan sesuaikan konfigurasinya:

```env
PORT=3000
WEBHOOK_URL=http://localhost:3000/webhook-test
SESSION_PATH=./auth_info_baileys
```

- `PORT`: Port server berjalan.
- `WEBHOOK_URL`: URL dimana pesan masuk akan di-POST kan.
- `SESSION_PATH`: Folder penyimpanan sesi login WhatsApp.

## Menjalankan Server

### Menggunakan Node.js (Manual)

```bash
node index.js
```

### Menggunakan Docker Compose

Pastikan Docker dan Docker Compose sudah terinstall.

```bash
docker compose up -d --build
```

Perintah di atas akan:
1.  Membangun image dari `Dockerfile`.
2.  Menjalankan container di background (`-d`).
3.  Mapping port sesuai `.env` (default 3000).
4.  Mapping volume `./auth_info_baileys` agar sesi login tidak hilang saat container dihapus.

Untuk melihat log:
```bash
docker compose logs -f
```

Untuk menghentikan:
```bash
docker compose down
```

Saat pertama kali dijalankan, scan QR Code yang muncul di terminal (lihat logs) atau akses endpoint QR di browser.

## Dokumentasi API

Base URL: `http://localhost:3000` (default)

### 1. Cek Status Koneksi
Mendapatkan status koneksi WhatsApp.

- **URL**: `/api/status`
- **Method**: `GET`
- **Response**:
    ```json
    {
      "status": "connected",
      "user": { ... }
    }
    ```

### 2. Scan QR Code
Mendapatkan tampilan QR Code untuk login (jika belum terhubung).

- **URL**: `/api/qr`
- **Method**: `GET`
- **Response**: HTML Page containing QR Code image.

### 3. Kirim Pesan
Mengirim pesan teks atau media ke nomor tertentu.

- **URL**: `/api/send-message`
- **Method**: `POST`
- **Body (Text)**:
    ```json
    {
      "jid": "628123456789@s.whatsapp.net",
      "message": {
        "text": "Halo, ini pesan dari API!"
      }
    }
    ```

- **Body (Image URL)**:
    ```json
    {
      "jid": "628123456789@s.whatsapp.net",
      "message": {
        "image": "https://example.com/image.jpg",
        "caption": "Ini gambar dari URL"
      }
    }
    ```

- **Body (Image Base64)**:
    ```json
    {
      "jid": "628123456789@s.whatsapp.net",
      "message": {
        "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
        "caption": "Ini gambar dari Base64"
      }
    }
    ```
    *Catatan: `jid` harus diakhiri dengan `@s.whatsapp.net` untuk personal chat.*

## Webhook Payload

Ketika pesan diterima, server akan mengirim POST request ke `WEBHOOK_URL` dengan format body:

```json
{
  "event": "messages.upsert",
  "data": {
    "key": {
      "remoteJid": "628xxx@s.whatsapp.net",
      "fromMe": false,
      "id": "..."
    },
    "message": {
      "conversation": "Isi pesan..."
    },
    ...
  }
}
```
