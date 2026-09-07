"""Telegram weather bot with multi-location support and animated charts.
Usage:
    python bot.py  (needs BOT_TOKEN env var, or set TOKEN below)
"""
import os
import json
import asyncio
import tempfile
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (Application, CommandHandler, MessageHandler,
                          CallbackQueryHandler, ContextTypes, filters)

import weather
import animations

TOKEN = os.environ.get("WEATHER_BOT_TOKEN", "")
if not TOKEN:
    # fallback: read from token.txt if present
    try:
        TOKEN = open(os.path.join(os.path.dirname(__file__), "token.txt")).read().strip()
    except Exception:
        TOKEN = ""

LOC_FILE = os.path.join(os.path.dirname(__file__), "locations.json")

# user_id -> list of {name, country, lat, lon, admin1}
USER_LOCS = {}


def load_locations():
    global USER_LOCS
    try:
        USER_LOCS = json.load(open(LOC_FILE, encoding="utf-8"))
    except Exception:
        USER_LOCS = {}


def save_locations():
    json.dump(USER_LOCS, open(LOC_FILE, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)


def locs(uid):
    return USER_LOCS.setdefault(str(uid), [])


def menu_kb(uid):
    ls = locs(uid)
    kb = []
    row = []
    for i, l in enumerate(ls):
        label = l["name"]
        if l["admin1"]:
            label += f"/{l['admin1']}"
        row.append(InlineKeyboardButton(f"📍 {label}", callback_data=f"show:{i}"))
        if len(row) == 2:
            kb.append(row)
            row = []
    if row:
        kb.append(row)
    kb.append([InlineKeyboardButton("➕ افزودن شهر", callback_data="add")])
    if ls:
        kb.append([InlineKeyboardButton("🗑️ حذف آخرین", callback_data="del")])
    return InlineKeyboardMarkup(kb)


async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🌤️ بات هواشناسی\n"
        "اسم شهر رو بنویس تا اضافه‌اش کنم. بعد از دکمه‌ها می‌تونی بین شهرها سوییچ کنی "
        "و نمودار متحرک ۷ روزه بگیری.\n\n"
        "مثال: Tehran یا تهران یا London",
        reply_markup=menu_kb(update.effective_user.id),
    )


async def handle_city(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.message.text.strip()
    try:
        results = weather.geocode(q)
    except Exception as e:
        await update.message.reply_text("⚠️ خطا در جستجو. دوباره امتحان کن.")
        return
    if not results:
        await update.message.reply_text("🔍 شهر پیدا نشد. دقیق‌تر بنویس.")
        return
    kb = []
    for i, (name, country, lat, lon, admin1) in enumerate(results):
        lbl = f"{name} ({country})"
        kb.append([InlineKeyboardButton(lbl, callback_data=f"pick:{i}:{name}")])
    ctx.user_data["geo"] = results
    await update.message.reply_text("کدوم رو انتخاب می‌کنی؟",
                                    reply_markup=InlineKeyboardMarkup(kb))


async def button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.answer()
    cb = update.callback_query
    uid = str(cb.from_user.id)
    data = cb.data

    if data == "add":
        await cb.message.reply_text("🔎 اسم شهر رو بنویس:")
        return
    if data == "del":
        ls = locs(uid)
        if ls:
            ls.pop()
            save_locations()
        await cb.message.edit_reply_markup(reply_markup=menu_kb(cb.from_user.id))
        return
    if data.startswith("pick:"):
        _, idx, name = data.split(":", 2)
        r = ctx.user_data.get("geo", [])[int(idx)]
        name, country, lat, lon, admin1 = r
        locs(uid).append({"name": name, "country": country,
                          "lat": lat, "lon": lon, "admin1": admin1})
        save_locations()
        await cb.message.reply_text(f"✅ افزوده شد: {name}")
        await cb.message.edit_reply_markup(reply_markup=menu_kb(cb.from_user.id))
        return
    if data.startswith("show:"):
        idx = int(data.split(":", 1)[1])
        await show_location(update, ctx, uid, idx, cb.message)
        return


async def show_location(update, ctx, uid, idx, msg):
    ls = locs(uid)
    if idx >= len(ls):
        return
    loc = ls[idx]
    try:
        fc = weather.forecast(loc["lat"], loc["lon"])
    except Exception:
        await msg.reply_text("⚠️ خطا در دریافت هواشناسی.")
        return
    c = fc["current"]
    cur = weather.format_current(c)
    header = f"🌍 <b>{loc['name']}</b>"
    if loc["admin1"]:
        header += f" / {loc['admin1']}"
    if loc["country"]:
        header += f" / {loc['country']}"
    daily_txt = "\n\n".join(weather.format_daily(fc["daily"], i)
                            for i in range(len(fc["daily"]["time"])))
    text = f"{header}\n\n🌡️ <b>الان:</b>\n{cur}\n\n📅 <b>۷ روز آینده:</b>\n{daily_txt}"

    kb = menu_kb(uid)
    await msg.reply_text(text, parse_mode="HTML", reply_markup=kb)

    # animation
    await msg.reply_text("🎞️ در حال ساخت نمودار متحرک…")
    tmp = os.path.join(tempfile.gettempdir(), f"wx_{uid}_{idx}.gif")
    try:
        path = animations.build_animation(fc, title=f"{loc['name']} - 7 day", out_path=tmp)
        with open(path, "rb") as f:
            await msg.reply_animation(f, caption="📊 نمودار متحرک دمای ۷ روزه")
    except Exception as e:
        await msg.reply_text(f"⚠️ ساخت انیمیشن نشد: {e}")


def main():
    if not TOKEN:
        print("ERROR: set WEATHER_BOT_TOKEN or put token in token.txt")
        return
    load_locations()
    from telegram.request import HTTPXRequest
    request = HTTPXRequest(
        connect_timeout=20,
        read_timeout=30,
        pool_timeout=20,
        http_version="1.1",
    )
    app = Application.builder().token(TOKEN).request(request).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(button))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_city))
    print("Bot started. Press Ctrl+C to stop.")
    app.run_polling(allowed_updates=Update.ALL_TYPES, timeout=5)


if __name__ == "__main__":
    main()
