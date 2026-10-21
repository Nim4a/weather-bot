# weather-bot

A Telegram weather bot with multi-location support and an animated forecast chart.
No API key needed — weather data comes from [Open-Meteo](https://open-meteo.com/).

[English](#english) · [فارسی](#فارسی)

## English

### What it does

- 🔍 **City search** in Persian or English (`تهران`, `Tehran`, `London`)
- 📍 **Multiple saved locations per user**, stored in `locations.json`
- 🌡️ **Current conditions + 7-day forecast** — temperature, humidity, wind, precipitation, UV, sunrise/sunset
- 🎞️ **Animated GIF chart** — the max/min temperature curves are drawn progressively, with a weather icon per day (matplotlib)

### How it works

```
User message (city name)
        │
        ▼
   bot.py  ── geocode + forecast ──►  Open-Meteo (no key)
        │                              │
        │◄───────── daily JSON ────────┘
        ▼
 animations.py  ── matplotlib frames ──►  forecast.gif
        │
        ▼
   Telegram chat (inline buttons per saved location)
```

| File | Role |
|---|---|
| `bot.py` | Telegram handlers, multi-location menu, inline buttons |
| `weather.py` | Open-Meteo geocoding + forecast fetch |
| `animations.py` | Builds the animated forecast GIF with matplotlib |
| `locations.json` | Saved locations per user (created on first run) |
| `worker.js` | Optional Cloudflare Worker variant |
| `wrangler.toml` | Worker deploy config |

### Run it

```bash
pip install -r requirements.txt
export WEATHER_BOT_TOKEN=123456:ABC-your-token    # or put the token in token.txt
python bot.py
```

On Windows use `set WEATHER_BOT_TOKEN=...` instead of `export`.

Get a token from [@BotFather](https://t.me/BotFather).

### Use it

1. Send `/start`
2. Type a city name (`تهران`, `Tehran`, `London`)
3. Switch between saved cities with the inline buttons, or ask for the animated chart

### Requirements

`python-telegram-bot`, `requests`, `matplotlib`, `Pillow` — see `requirements.txt`.

---

## فارسی

### بات هواشناسی تلگرام — چند لوکیشن + انیمیشن

**امکانات**

- 🔍 جستجوی شهر (فارسی/انگلیسی) با Open-Meteo (بدون نیاز به کلید API)
- 📍 ذخیره چندین لوکیشن برای هر کاربر (دکمه‌های inline)
- 🌡️ وضعیت فعلی + پیش‌بینی ۷ روزه (دما، رطوبت، باد، بارش، UV، طلوع/غروب)
- 🎞️ نمودار متحرک GIF (رسم تدریجی منحنی ماکس/مین، نماد وضعیت هر روز)

**نصب و اجرا**

```
pip install -r requirements.txt
set WEATHER_BOT_TOKEN=123456:ABC-your-token
python bot.py
```

توکن را از [@BotFather](https://t.me/BotFather) بگیرید، یا آن را در فایل `token.txt` بنویسید.

**استفاده در تلگرام**

- `/start`
- اسم شهر را بنویس (مثلاً `Tehran` یا `تهران` یا `London`)
- از دکمه‌ها بین شهرها سوییچ کن و «نمودار متحرک» را بگیر

**فایل‌ها**

- `weather.py` — دریافت داده از Open-Meteo
- `animations.py` — ساخت GIF متحرک با matplotlib
- `bot.py` — منطق بات + منوی چند لوکیشن
- `locations.json` — لوکیشن‌های ذخیره‌شده (خودکار ساخته می‌شود)

## License

MIT
