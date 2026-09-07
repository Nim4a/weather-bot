// Telegram Weather Bot & WebApp - Cloudflare Worker
const DEFAULT_LOCATIONS = [
  { name: "تهران", lat: 35.6892, lon: 51.3890, country: "ایران", admin1: "تهران" },
  { name: "اصفهان", lat: 32.6546, lon: 51.6680, country: "ایران", admin1: "اصفهان" },
  { name: "مشهد", lat: 36.2605, lon: 59.6168, country: "ایران", admin1: "خراسان رضوی" },
  { name: "شیراز", lat: 29.5918, lon: 52.5837, country: "ایران", admin1: "فارس" },
  { name: "تبریز", lat: 38.0800, lon: 46.2919, country: "ایران", admin1: "آذربایجان شرقی" }
];

const WMO = {
  0: ["آسمان صاف", "☀️"],
  1: ["غالباً صاف", "🌤️"],
  2: ["نیمه ابری", "⛅"],
  3: ["تمام ابری", "☁️"],
  45: ["مه‌آلود", "🌫️"],
  48: ["مه یخبندان", "🌫️"],
  51: ["نم‌نم باران", "🌦️"],
  53: ["باران ملایم", "🌦️"],
  55: ["باران متناوب", "🌧️"],
  61: ["باران پراکنده", "🌧️"],
  63: ["باران مداوم", "🌧️"],
  65: ["باران رگباری شدید", "🌧️"],
  71: ["بارش برف خفیف", "🌨️"],
  73: ["بارش برف", "❄️"],
  75: ["بارش برف سنگین", "❄️"],
  80: ["رگبار باران", "🌦️"],
  81: ["رگبار شدید", "⛈️"],
  82: ["طوفان و رگبار", "⛈️"],
  95: ["رعد و برق", "⛈️"],
  96: ["رعد و برق با تگرگ", "⛈️"]
};

function getWmo(code) {
  return WMO[code] || ["نامشخص", "🌡️"];
}

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function getLocations(env, uid) {
  if (!uid) return DEFAULT_LOCATIONS;
  try {
    const raw = await env.LOCATIONS.get("locs:" + uid);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return DEFAULT_LOCATIONS;
}

async function saveLocations(env, uid, locs) {
  if (!uid) return;
  await env.LOCATIONS.put("locs:" + uid, JSON.stringify(locs));
}

async function getOrCreateSecret(env, uid) {
  try {
    let secret = await env.LOCATIONS.get("u:" + uid);
    if (secret) return secret;
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    let s = "";
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    for (let i = 0; i < 12; i++) s += chars[arr[i] % chars.length];
    await env.LOCATIONS.put("u:" + uid, s);
    await env.LOCATIONS.put("s:" + s, String(uid));
    return s;
  } catch (e) {
    return "guest_" + uid;
  }
}

async function resolveUid(env, url) {
  const tgid = url.searchParams.get("tgid");
  if (tgid) return tgid;
  const secret = url.searchParams.get("u");
  if (secret) {
    try {
      const uid = await env.LOCATIONS.get("s:" + secret);
      if (uid) return uid;
    } catch (e) {}
  }
  return null;
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto`;
  const r = await fetch(url, { headers: { "User-Agent": "WeatherNimBot/2.0" } });
  return r.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = env.BOT_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN";

    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        await handleUpdate(update, env, token, url.origin);
      } catch (e) {
        console.error("Webhook error:", e);
      }
      return new Response("OK");
    }

    if (url.pathname === "/" || url.pathname === "/ui" || url.pathname === "/panel") {
      return new Response(HTML_PAGE, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        }
      });
    }

    if (url.pathname.startsWith("/api/")) {
      const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      };

      if (url.pathname === "/api/whoami") {
        const uid = await resolveUid(env, url);
        const locs = await getLocations(env, uid);
        return new Response(JSON.stringify({ uid, locs }), { headers });
      }

      if (url.pathname === "/api/weather") {
        const uid = await resolveUid(env, url);
        const locs = await getLocations(env, uid);
        const idx = parseInt(url.searchParams.get("i") || "0", 10);
        const loc = locs[idx] || locs[0] || DEFAULT_LOCATIONS[0];
        try {
          const wData = await fetchWeather(loc.lat, loc.lon);
          return new Response(JSON.stringify(wData), { headers });
        } catch (e) {
          return new Response(JSON.stringify({ error: "خطا در دریافت اطلاعات هواشناسی" }), { headers, status: 500 });
        }
      }

      // Fetch weather for ALL locations in one request, with limited concurrency + fallback
      if (url.pathname === "/api/all") {
        const uid = await resolveUid(env, url);
        const locs = await getLocations(env, uid);
        const results = new Array(locs.length).fill(null);
        // Process with concurrency 2 so we don't hit Open-Meteo rate limits
        const CONC = 2;
        let pos = 0;
        async function workerFn() {
          while (pos < locs.length) {
            const i = pos++;
            const loc = locs[i] || DEFAULT_LOCATIONS[0];
            try {
              results[i] = await fetchWeather(loc.lat, loc.lon);
            } catch (e) {
              results[i] = { error: 1 }; // mark as failed, client shows placeholder
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONC, locs.length) }, workerFn));
        return new Response(JSON.stringify({ results, uid, locs }), { headers });
      }

      if (url.pathname === "/api/geocode") {
        const q = url.searchParams.get("q") || "";
        if (!q.trim()) return new Response(JSON.stringify({ results: [] }), { headers });
        try {
          const gUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=fa&format=json`;
          const gRes = await fetch(gUrl);
          const gData = await gRes.json();
          return new Response(JSON.stringify(gData), { headers });
        } catch (e) {
          return new Response(JSON.stringify({ results: [] }), { headers });
        }
      }

      if (url.pathname === "/api/locs") {
        const uid = await resolveUid(env, url);
        if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { headers, status: 401 });
        let locs = await getLocations(env, uid);

        if (request.method === "POST") {
          const newLoc = await request.json();
          if (newLoc && newLoc.name && newLoc.latitude !== undefined && newLoc.longitude !== undefined) {
            locs.push({
              name: newLoc.name,
              lat: newLoc.latitude,
              lon: newLoc.longitude,
              country: newLoc.country || "",
              admin1: newLoc.admin1 || ""
            });
            await saveLocations(env, uid, locs);
          }
          return new Response(JSON.stringify({ success: true, locs }), { headers });
        }

        if (request.method === "DELETE") {
          const idx = parseInt(url.searchParams.get("i") || "-1", 10);
          if (idx >= 0 && idx < locs.length) {
            locs.splice(idx, 1);
            await saveLocations(env, uid, locs);
          }
          return new Response(JSON.stringify({ success: true, locs }), { headers });
        }
      }
    }

    return new Response("Weather Bot is running.", { status: 200 });
  }
};

async function handleUpdate(upd, env, token, origin) {
  const msg = upd.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const uid = msg.from.id;
  const text = msg.text.trim();

  if (text.startsWith("/start")) {
    const secret = await getOrCreateSecret(env, uid);
    const webAppUrl = `${origin}/ui?tgid=${uid}`;
    const directUrl = `${origin}/ui?u=${secret}`;

    const welcomeText = `🌿 *سلام ${msg.from.first_name || ""} عزیز! به سامانه هوشمند هواشناسی خوش آمدید.*\n\n` +
      `برای مشاهده وضعیت لحظه‌ای آب و هوا، پیش‌بینی ۵ روزه و مدیریت شهرهای منتخب، روی دکمه زیر کلیک کنید:`;

    await tg(token, "sendMessage", {
      chat_id: chatId,
      text: welcomeText,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🌤️ باز کردن پنل هواشناسی", web_app: { url: webAppUrl } }
          ],
          [
            { text: "🔗 لینک مستقیم مرورگر", url: directUrl }
          ]
        ]
      }
    });
  }
}

const HTML_PAGE = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>سامانه پایش آب و هوا</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg-main:#141d19;
  --bg-card:#1c2823;
  --bg-card-sub:#24332c;
  --color-silver:#BCC6CC;
  --color-sage:#617C58;
  --color-pine:#4E8975;
  --color-pine-light:#65b59a;
  --text-main:#f2f6f4;
  --text-muted:#8fa39b;
  --border:#2e4238;
  --shadow:0 10px 30px rgba(0,0,0,.45);
}
body{
  background:radial-gradient(circle at 50% 0%,#22322a 0%,var(--bg-main) 75%);
  color:var(--text-main);
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Tahoma,sans-serif;
  min-height:100vh;
  padding:16px;
  direction:rtl;
}
.container{max-width:1100px;margin:0 auto}
header.app-nav{
  display:flex;align-items:center;justify-content:space-between;
  background:linear-gradient(135deg,rgba(78,137,117,.22),rgba(97,124,88,.18));
  border:1px solid var(--border);border-radius:16px;
  padding:14px 20px;margin-bottom:18px;backdrop-filter:blur(10px);
}
.brand{display:flex;align-items:center;gap:12px}
.brand-icon{
  width:44px;height:44px;border-radius:12px;
  background:linear-gradient(135deg,var(--color-pine),var(--color-sage));
  display:flex;align-items:center;justify-content:center;font-size:22px;
  box-shadow:0 4px 14px rgba(78,137,117,.35);
}
.brand-text h1{font-size:18px;font-weight:700;color:var(--text-main)}
.brand-text span{font-size:12px;color:var(--color-silver)}
.nav-actions{display:flex;gap:8px;flex-shrink:0}
@media (max-width:600px){
  header.app-nav{padding:12px 14px;gap:10px;align-items:center}
  .brand{flex:1;min-width:0}
  .brand-text{white-space:nowrap;overflow:hidden}
  .brand-text h1{font-size:15px;}
  .brand-text span{font-size:11px;}
  .brand-icon{width:38px;height:38px;font-size:18px}
  .btn{padding:7px 10px;font-size:12px}
  .nav-actions{display:flex}
  .btn{white-space:nowrap}
}
.btn{
  background:var(--bg-card-sub);color:var(--text-main);
  border:1px solid var(--border);border-radius:10px;
  padding:8px 14px;font-size:13px;font-weight:600;
  cursor:pointer;display:inline-flex;align-items:center;gap:6px;
  text-decoration:none;transition:all .2s;
}
.btn:hover{background:var(--color-pine);border-color:var(--color-pine-light);color:#fff}
.btn-primary{background:var(--color-pine);border-color:var(--color-pine-light);color:#fff}

.search-section{
  position:relative;margin-bottom:20px;
  background:var(--bg-card);border:1px solid var(--border);
  border-radius:14px;padding:6px;display:flex;gap:8px;
}
.search-section input{
  flex:1;background:transparent;border:none;outline:none;
  color:var(--text-main);font-size:15px;padding:10px 14px;
}
.search-section input::placeholder{color:var(--text-muted)}
.search-section .btn-search{
  background:var(--color-sage);color:#fff;border:none;
  padding:0 22px;border-radius:10px;font-weight:700;cursor:pointer;transition:all .2s;
}
.search-section .btn-search:hover{background:var(--color-pine)}
.suggest-box{
  position:absolute;top:calc(100% + 6px);left:0;right:0;
  background:var(--bg-card);border:1px solid var(--border);
  border-radius:12px;max-height:280px;overflow-y:auto;z-index:50;
  display:none;box-shadow:var(--shadow);
}
.suggest-box.active{display:block}
.sug-item{
  padding:12px 16px;display:flex;align-items:center;justify-content:space-between;
  border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;
}
.sug-item:hover{background:var(--bg-card-sub)}
.sug-item .name{font-weight:600}
.sug-item .country{color:var(--color-silver);font-size:12px}

.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px}
.weather-card{
  background:linear-gradient(165deg,var(--bg-card) 0%,#17221d 100%);
  border:1px solid var(--border);border-radius:18px;
  overflow:hidden;box-shadow:var(--shadow);position:relative;
}
.card-header{
  padding:16px 18px;display:flex;align-items:center;justify-content:space-between;
  background:rgba(255,255,255,.02);border-bottom:1px solid var(--border);
}
.loc-info h3{font-size:17px;font-weight:700;color:var(--text-main)}
.loc-info span{font-size:12px;color:var(--color-silver)}
.city-time{
  background:rgba(78,137,117,.1);border:1px solid var(--border);
  border-radius:8px;padding:4px 10px;font-size:13px;font-weight:700;
  color:var(--color-pine);font-variant-numeric:tabular-nums;
  letter-spacing:.5px;min-width:52px;text-align:center;
}
.del-btn{
  background:rgba(255,255,255,.06);border:none;color:var(--color-silver);
  width:30px;height:30px;border-radius:8px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
}
.del-btn:hover{background:#5c2424;color:#ff9e9e}

.current-weather{
  padding:18px;display:flex;align-items:center;justify-content:space-between;
}
.temp-box{display:flex;align-items:baseline;gap:6px}
.temp-box .val{font-size:42px;font-weight:800;color:var(--text-main);line-height:1}
.temp-box .unit{font-size:18px;color:var(--color-silver)}
.weather-desc{text-align:left}
.weather-desc .icon{font-size:36px;display:block;margin-bottom:2px}
.weather-desc .state{font-size:13px;font-weight:600;color:var(--color-silver)}

.metrics-strip{
  display:grid;grid-template-columns:repeat(3,1fr);gap:8px;
  padding:0 18px 16px;
}
.metric-box{
  background:var(--bg-card-sub);border:1px solid rgba(255,255,255,.03);
  border-radius:10px;padding:8px 10px;text-align:center;
}
.metric-box .label{font-size:11px;color:var(--text-muted);display:block}
.metric-box .value{font-size:14px;font-weight:700;color:var(--color-silver);margin-top:2px;display:block}

.chart-wrapper{
  padding:0 18px 16px;height:140px;
}

.forecast-5d{
  padding:16px 18px;
  background:rgba(0,0,0,.22);
  border-top:1px solid var(--border);
}
.forecast-5d-title{
  font-size:13px;font-weight:700;color:var(--color-silver);
  margin-bottom:10px;display:flex;align-items:center;gap:6px;
}
.forecast-list{
  display:flex;flex-direction:column;gap:8px;
}
.forecast-item{
  display:grid;grid-template-columns:75px 28px 1fr 75px 70px;
  align-items:center;
  background:var(--bg-card-sub);
  border:1px solid rgba(255,255,255,.04);
  border-radius:8px;padding:8px 12px;font-size:12px;
}
.forecast-item .day-name{font-weight:600;color:var(--text-main)}
.forecast-item .f-icon{font-size:18px;text-align:center}
.forecast-item .f-desc{color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px}
.forecast-item .f-temp{text-align:left;font-weight:700}
.forecast-item .f-temp .max{color:var(--color-pine-light)}
.forecast-item .f-temp .min{color:var(--color-silver);font-weight:normal}
.forecast-item .f-details{color:var(--color-silver);font-size:11px;text-align:left}

.empty-state{
  text-align:center;padding:60px 20px;
  background:var(--bg-card);border:2px dashed var(--border);border-radius:18px;
}
.empty-state .ico{font-size:48px;margin-bottom:12px;color:var(--color-sage)}
.toast{
  position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
  background:var(--color-pine);color:#fff;padding:10px 22px;border-radius:30px;
  font-size:13px;font-weight:600;box-shadow:var(--shadow);opacity:0;
  transition:all .3s;z-index:999;pointer-events:none;
}
.toast.active{opacity:1;bottom:34px}

@keyframes fadeSlideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes pulseWind{0%{transform:scale(1);opacity:.6}50%{transform:scale(1.2);opacity:1}100%{transform:scale(1);opacity:.6}}
@keyframes sunPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes sunRotate{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes birdFly{from{transform:translateX(0) translateY(0);opacity:.4}25%{transform:translateX(-30px) translateY(-5px)}50%{transform:translateX(-60px) translateY(0)}75%{transform:translateX(-90px) translateY(3px)}to{transform:translateX(-150px) translateY(0);opacity:0}}
@keyframes cloudDrift{from{transform:translateX(0)}to{transform:translateX(-500px)}}
@keyframes rainFall{from{transform:translateY(-10px);opacity:0}10%{opacity:1}90%{opacity:1}to{transform:translateY(110px);opacity:0}}
@keyframes snowFall{from{transform:translateY(-10px) translateX(0);opacity:0}10%{opacity:.8}90%{opacity:.8}to{transform:translateY(110px) translateX(20px);opacity:0}}
@keyframes flash{0%,80%,100%{opacity:0}82%,86%{opacity:1}84%,88%{opacity:.3}}
@keyframes fogDrift{from{transform:translateX(-100%)}to{transform:translateX(100%)}}

.weather-scene{position:relative;height:90px;overflow:hidden;border-radius:18px 18px 0 0;margin:0;background:linear-gradient(180deg,#eef1f3,#e4e9ec);transition:background .5s ease}
.sun-scene{background:linear-gradient(180deg,#f5d382,#e8a93a)}
.cloud-scene{background:linear-gradient(180deg,#c8d2d6,#eef1f3)}
.rain-scene{background:linear-gradient(180deg,#5a6a72,#8fa39b)}
.snow-scene{background:linear-gradient(180deg,#a8c5d9,#e0eaf2)}
.thunder-scene{background:linear-gradient(180deg,#2a353a,#5a6a72)}
.fog-scene{background:linear-gradient(180deg,#d0d8dc,#e4e9ec)}
.sun{position:absolute;top:14px;right:24px;width:32px;height:32px;border-radius:50%;background:#f2b134;box-shadow:0 0 16px rgba(242,177,52,.5);animation:sunPulse 3s ease-in-out infinite}
.sun::before{content:"";position:absolute;top:-10px;left:-10px;right:-10px;bottom:-10px;border-radius:50%;border:2px dashed rgba(242,177,52,.25);animation:sunRotate 12s linear infinite}
.bird{position:absolute;width:8px;height:3px;border-radius:50%;background:#617C58;animation:birdFly 8s linear infinite}
.cloud{position:absolute;background:#fff;border-radius:30px;opacity:.8;animation:cloudDrift linear infinite}
.cloud::before{content:"";position:absolute;width:50%;height:120%;background:#fff;border-radius:50%;top:-40%;left:15%}
.cloud1{width:80px;height:28px;top:30px;right:-40px;animation-duration:18s}
.cloud2{width:60px;height:22px;top:50px;right:-30px;animation-duration:14s;animation-delay:-5s;opacity:.6}
.cloud3{width:100px;height:32px;top:20px;right:-50px;animation-duration:22s;animation-delay:-10s;opacity:.5}
.rain-drop{position:absolute;width:2px;height:10px;background:rgba(255,255,255,.5);border-radius:0 0 2px 2px;animation:rainFall linear infinite}
.snowflake{position:absolute;width:6px;height:6px;background:#fff;border-radius:50%;opacity:.7;animation:snowFall linear infinite}
.lightning{position:absolute;top:0;left:0;right:0;bottom:0;opacity:0;animation:flash 3s infinite}
.lightning1{background:rgba(255,255,255,.2);animation-delay:0s}
.lightning2{background:rgba(255,255,255,.1);animation-delay:1.5s}
.fog-layer{position:absolute;left:0;right:0;height:40px;background:linear-gradient(90deg,transparent,#c8d2d6,transparent);opacity:.35;animation:fogDrift linear infinite}
.fog1{top:20px;animation-duration:12s}
.fog2{top:50px;animation-duration:16s;animation-delay:-4s}
.weather-card{animation:fadeSlideUp .45s cubic-bezier(.22,1,.36,1) both}
.weather-card:nth-child(1){animation-delay:.05s}
.weather-card:nth-child(2){animation-delay:.1s}
.weather-card:nth-child(3){animation-delay:.15s}
.weather-card:nth-child(4){animation-delay:.2s}
.weather-card:nth-child(5){animation-delay:.25s}
.forecast-item{animation:fadeIn .3s ease both}
.forecast-item:nth-child(1){animation-delay:.1s}
.forecast-item:nth-child(2){animation-delay:.15s}
.forecast-item:nth-child(3){animation-delay:.2s}
.forecast-item:nth-child(4){animation-delay:.25s}
.forecast-item:nth-child(5){animation-delay:.3s}
.icon-wind-anim{display:inline-block;animation:pulseWind 2s infinite ease-in-out}
</style>
</head>
<body>
<div class="container">
  <header class="app-nav">
    <div class="brand">
      <div class="brand-icon">🌿</div>
      <div class="brand-text">
        <h1>سامانه پایش آب و هوا</h1>
        <span>داده‌های زنده و پیش‌بینی ۵ روزه</span>
      </div>
    </div>
    <div class="nav-actions">
      <button class="btn btn-primary" onclick="loadAll()">↻ بروزرسانی</button>
    </div>
  </header>

  <div class="search-section">
    <input type="text" id="cityInput" placeholder="جستجوی نام شهر (فارسی یا انگلیسی)..." autocomplete="off">
    <button class="btn-search" onclick="triggerSearch()">جستجو</button>
    <div class="suggest-box" id="sugBox"></div>
  </div>

  <div class="cards-grid" id="grid"></div>
</div>

<div class="toast" id="toast"></div>

<script>
const urlParams = new URLSearchParams(location.search);
const secretKey = urlParams.get("u");
let TG = null, TGID = null;

try {
  if (window.Telegram && window.Telegram.WebApp) {
    TG = window.Telegram.WebApp;
    TG.ready();
    if (TG.initDataUnsafe && TG.initDataUnsafe.user) {
      TGID = TG.initDataUnsafe.user.id;
    }
  }
} catch (e) {}

if (TG) {
  if (TG.expand) TG.expand();
}

const WMO_DATA = {
  0: ["آسمان صاف", "☀️"], 1: ["غالباً صاف", "🌤️"], 2: ["نیمه ابری", "⛅"], 3: ["تمام ابری", "☁️"],
  45: ["مه‌آلود", "🌫️"], 48: ["مه یخبندان", "🌫️"],
  51: ["نم‌نم باران", "🌦️"], 53: ["باران ملایم", "🌦️"], 55: ["باران متناوب", "🌧️"],
  61: ["باران پراکنده", "🌧️"], 63: ["باران مداوم", "🌧️"], 65: ["باران رگباری شدید", "🌧️"],
  71: ["بارش برف خفیف", "🌨️"], 73: ["بارش برف", "❄️"], 75: ["بارش برف سنگین", "❄️"],
  80: ["رگبار باران", "🌦️"], 81: ["رگبار شدید", "⛈️"], 82: ["طوفان و رگبار", "⛈️"],
  95: ["رعد و برق", "⛈️"], 96: ["رعد و برق با تگرگ", "⛈️"]
};

function getWmo(code) {
  return WMO_DATA[code] || ["نامشخص", "🌡️"];
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("active");
  setTimeout(() => t.classList.remove("active"), 2500);
}

async function fetchApi(endpoint, options = {}) {
  const delim = endpoint.includes("?") ? "&" : "?";
  let q = delim;
  if (TGID) q += "tgid=" + TGID;
  else if (secretKey) q += "u=" + secretKey;
  const res = await fetch(endpoint + q, options);
  return res.json();
}

let userLocations = [];

async function loadAll() {
  const grid = document.getElementById("grid");
  grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--color-silver);">در حال دریافت داده‌های هواشناسی...</div>';
  
  const data = await fetchApi("/api/whoami");
  if (data.error) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="ico">🔒</div><h3>خطای دسترسی</h3><p>لطفاً از طریق ربات تلگرام وارد شوید.</p></div>';
    return;
  }

  userLocations = data.locs || [];
  if (!userLocations.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="ico">📍</div><h3>هیچ شهری ثبت نشده است</h3><p>نام شهر مورد نظرتان را در کادر بالا جستجو کنید.</p></div>';
    return;
  }

  grid.innerHTML = userLocations.map((loc, idx) => \`
    <div class="weather-card" id="card-\${idx}">\n      <div class="weather-scene" id="scene-\${idx}"></div>
      <div class="card-header">
        <div class="loc-info">
          <h3>\${loc.name} \${loc.admin1 ? "/ " + loc.admin1 : ""}</h3>
          <span>\${loc.country || ""}</span>
        </div>
        <div class="city-time" id="time-\${idx}">--:--</div>
        <button class="del-btn" onclick="deleteLoc(\${idx})" title="حذف">✕</button>
      </div>

      <div class="current-weather">
        <div class="temp-box">
          <span class="val" id="temp-\${idx}">--</span>
          <span class="unit">°C</span>
        </div>
        <div class="weather-desc">
          <span class="icon" id="icon-\${idx}">⏳</span>
          <span class="state" id="state-\${idx}">در حال دریافت...</span>
        </div>
      </div>

      <div class="metrics-strip" id="metrics-\${idx}"></div>

      <div class="chart-wrapper">
        <canvas id="chart-\${idx}"></canvas>
      </div>

      <div class="forecast-5d">
        <div class="forecast-5d-title">📅 پیش‌بینی ۵ روز آینده (مختصر)</div>
        <div class="forecast-list" id="forecast-\${idx}"></div>
      </div>
    </div>
  \`).join("");

  // Fetch ALL cities in ONE request (fast, no empty cards)
  try {
    const allData = await fetchApi("/api/all");
    if (allData.results) {
      allData.results.forEach((res, idx) => {
        if (res && !res.error) renderCityCard(idx, res);
        else markCityFailed(idx);
      });
    }
  } catch (e) {
    // fallback to per-city as before
    userLocations.forEach((_, idx) => loadCityWeather(idx));
  }
}

function markCityFailed(idx) {
  const te = document.getElementById("temp-" + idx);
  const st = document.getElementById("state-" + idx);
  if (te) te.textContent = "--";
  if (st) st.textContent = "خطا در دریافت داده";
}

function renderCityCard(idx, res) {
  if (!res || res.error || !res.current || !res.daily) {
    markCityFailed(idx);
    return;
  }

  const cur = res.current;
  const wmoInfo = getWmo(cur.weather_code);

  document.getElementById("temp-" + idx).textContent = Math.round(cur.temperature_2m);
  document.getElementById("icon-" + idx).textContent = wmoInfo[1];
  document.getElementById("state-" + idx).textContent = wmoInfo[0];
  renderScene(idx, cur.weather_code);

  // Display local time with timezone from API
  const tz = res.timezone || 'UTC';
  const timeEl = document.getElementById("time-" + idx);
  if (timeEl) {
    function updateCityTime() {
      try {
        const now = new Date();
        const localStr = new Intl.DateTimeFormat('fa-IR', {
          timeZone: tz, hour: '2-digit', minute: '2-digit',
          hour12: false
        }).format(now);
        timeEl.textContent = localStr;
      } catch (e) {
        timeEl.textContent = '--:--';
      }
    }
    updateCityTime();
    // Update every minute
    if (timeEl._timer) clearInterval(timeEl._timer);
    timeEl._timer = setInterval(updateCityTime, 60000);
  }

  document.getElementById("metrics-" + idx).innerHTML = \`
    <div class="metric-box">
      <span class="label">حس واقعی</span>
      <span class="value">\${Math.round(cur.apparent_temperature)}°</span>
    </div>
    <div class="metric-box">
      <span class="label">رطوبت</span>
      <span class="value">\${cur.relative_humidity_2m}%</span>
    </div>
    <div class="metric-box">
      <span class="label">سرعت باد</span>
      <span class="value">\${cur.wind_speed_10m.toFixed(1)}m/s</span>
    </div>
  \`;

  const daily = res.daily;
  const fContainer = document.getElementById("forecast-" + idx);
  let forecastHtml = "";

  const weekdays = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
  for (let k = 0; k < Math.min(5, daily.time.length); k++) {
    const dObj = new Date(daily.time[k]);
    const dayLabel = k === 0 ? "امروز" : (k === 1 ? "فردا" : weekdays[dObj.getDay()]);
    const fWmo = getWmo(daily.weather_code[k]);
    const rain = daily.precipitation_sum ? daily.precipitation_sum[k] : 0;
    const wind = daily.wind_speed_10m_max ? daily.wind_speed_10m_max[k] : 0;

    forecastHtml += \`
      <div class="forecast-item">
        <span class="day-name">\${dayLabel}</span>
        <span class="f-icon">\${fWmo[1]}</span>
        <span class="f-desc">\${fWmo[0]}</span>
        <span class="f-temp">
          <span class="max">\${Math.round(daily.temperature_2m_max[k])}°</span> / 
          <span class="min">\${Math.round(daily.temperature_2m_min[k])}°</span>
        </span>
        <span class="f-details">💨\${Math.round(wind)}m/s \${rain > 0 ? "🌧️" + rain.toFixed(1) : ""}</span>
      </div>
    \`;
  }
  fContainer.innerHTML = forecastHtml;

  const chartLabels = daily.time.slice(0, 5).map(t => t.slice(5));
  const maxTemps = daily.temperature_2m_max.slice(0, 5);
  const minTemps = daily.temperature_2m_min.slice(0, 5);

  new Chart(document.getElementById("chart-" + idx), {
    type: "line",
    data: {
      labels: chartLabels,
      datasets: [
        {
          label: "حداکثر",
          data: maxTemps,
          borderColor: "#65b59a",
          backgroundColor: "rgba(101,181,154,0.15)",
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 3,
          fill: true
        },
        {
          label: "حداقل",
          data: minTemps,
          borderColor: "#BCC6CC",
          backgroundColor: "transparent",
          borderWidth: 2,
          borderDash: [3, 3],
          tension: 0.35,
          pointRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#BCC6CC", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#BCC6CC", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } }
      }
    }
  });
}


function renderScene(idx, code) {
  var el = document.getElementById("scene-" + idx);
  if (!el) return;
  var type = 'sun';
  if ([2,3].indexOf(code) > -1) type = 'cloud';
  else if ([45,48].indexOf(code) > -1) type = 'fog';
  else if ([51,53,55,61,63,65,80,81,82].indexOf(code) > -1) type = 'rain';
  else if ([71,73,75].indexOf(code) > -1) type = 'snow';
  else if ([95,96].indexOf(code) > -1) type = 'thunder';
  el.className = 'weather-scene ' + type + '-scene';
  var inner = '';
  if (type === 'sun') {
    inner = '<div class="sun"></div><div class="bird" style="top:30%;right:30%"></div><div class="bird" style="top:20%;right:50%"></div>';
  } else if (type === 'cloud') {
    inner = '<div class="cloud cloud1"></div><div class="cloud cloud2"></div><div class="cloud cloud3"></div>';
  } else if (type === 'rain') {
    for (var i = 0; i < 20; i++) inner += '<div class="rain-drop" style="left:' + Math.random()*100 + '%;animation-duration:' + (.5+Math.random()*.5) + 's;animation-delay:' + Math.random()*2 + 's"></div>';
  } else if (type === 'snow') {
    for (var i = 0; i < 18; i++) inner += '<div class="snowflake" style="left:' + Math.random()*100 + '%;width:' + (4+Math.random()*6) + 'px;height:' + (4+Math.random()*6) + 'px;animation-duration:' + (2+Math.random()*3) + 's;animation-delay:' + Math.random()*3 + 's"></div>';
  } else if (type === 'thunder') {
    inner = '<div class="lightning lightning1"></div><div class="lightning lightning2"></div>';
    for (var i = 0; i < 15; i++) inner += '<div class="rain-drop" style="left:' + Math.random()*100 + '%;animation-duration:' + (.4+Math.random()*.4) + 's;animation-delay:' + Math.random()*1.5 + 's"></div>';
  } else if (type === 'fog') {
    inner = '<div class="fog-layer fog1"></div><div class="fog-layer fog2"></div>';
  }
  el.innerHTML = inner;
}
async function deleteLoc(idx) {
  if (!confirm("آیا از حذف این شهر اطمینان دارید؟")) return;
  const res = await fetchApi("/api/locs?i=" + idx, { method: "DELETE" });
  if (res.locs) {
    userLocations = res.locs;
    loadAll();
    showToast("شهر حذف شد.");
  }
}

async function triggerSearch() {
  const val = document.getElementById("cityInput").value.trim();
  if (!val) return;
  const res = await fetchApi("/api/geocode?q=" + encodeURIComponent(val));
  const box = document.getElementById("sugBox");
  box.innerHTML = "";
  
  if (!res.results || !res.results.length) {
    box.innerHTML = '<div class="sug-item">موردی یافت نشد.</div>';
    box.classList.add("active");
    return;
  }

  res.results.forEach(item => {
    const el = document.createElement("div");
    el.className = "sug-item";
    el.innerHTML = \`
      <div>
        <span class="name">\${item.name} \${item.admin1 ? "(" + item.admin1 + ")" : ""}</span>
        <span class="country">\${item.country || ""}</span>
      </div>
      <span style="color:var(--color-pine-light); font-weight:bold; font-size:12px;">+ افزودن</span>
    \`;
    el.onclick = () => addLocation(item);
    box.appendChild(el);
  });
  box.classList.add("active");
}

async function addLocation(item) {
  document.getElementById("sugBox").classList.remove("active");
  document.getElementById("cityInput").value = "";
  const res = await fetchApi("/api/locs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item)
  });
  if (res.locs) {
    userLocations = res.locs;
    loadAll();
    showToast(item.name + " اضافه شد.");
  }
}

document.getElementById("cityInput").addEventListener("keydown", e => {
  if (e.key === "Enter") triggerSearch();
});

document.addEventListener("click", e => {
  if (!e.target.closest(".search-section")) {
    document.getElementById("sugBox").classList.remove("active");
  }
});

loadAll();
</script>
</body>
</html>`;
