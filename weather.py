"""Weather data via Open-Meteo (free, no API key needed)."""
import requests

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

WMO = {
    0: ("Clear sky", "☀️"),
    1: ("Mainly clear", "🌤️"),
    2: ("Partly cloudy", "⛅"),
    3: ("Overcast", "☁️"),
    45: ("Fog", "🌫️"),
    48: ("Rime fog", "🌫️"),
    51: ("Light drizzle", "🌦️"),
    53: ("Drizzle", "🌦️"),
    55: ("Dense drizzle", "🌧️"),
    61: ("Light rain", "🌦️"),
    63: ("Rain", "🌧️"),
    65: ("Heavy rain", "🌧️"),
    66: ("Freezing rain", "🌨️"),
    67: ("Freezing rain", "🌨️"),
    71: ("Light snow", "🌨️"),
    73: ("Snow", "❄️"),
    75: ("Heavy snow", "❄️"),
    77: ("Snow grains", "🌨️"),
    80: ("Rain showers", "🌦️"),
    81: ("Rain showers", "🌧️"),
    82: ("Violent showers", "⛈️"),
    85: ("Snow showers", "🌨️"),
    86: ("Snow showers", "❄️"),
    95: ("Thunderstorm", "⛈️"),
    96: ("Thunderstorm + hail", "⛈️"),
    99: ("Thunderstorm + hail", "⛈️"),
}


def wmo(code):
    return WMO.get(code, ("Unknown", "❓"))


def geocode(query):
    """Return list of (name, country, lat, lon, admin1)."""
    r = requests.get(GEO_URL, params={"name": query, "count": 8, "language": "fa",
                                      "format": "json"}, timeout=15)
    r.raise_for_status()
    data = r.json().get("results", [])
    out = []
    for d in data:
        out.append((d.get("name", ""), d.get("country", ""),
                    d.get("latitude"), d.get("longitude"), d.get("admin1", "")))
    return out


def forecast(lat, lon, tz="auto"):
    """7-day daily forecast + current."""
    params = {
        "latitude": lat, "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,"
                 "precipitation_sum,wind_speed_10m_max,sunrise,sunset,uv_index_max",
        "timezone": tz, "forecast_days": 7, "wind_speed_unit": "ms",
    }
    r = requests.get(FORECAST_URL, params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def format_current(c):
    desc, icon = wmo(c.get("weather_code", 0))
    lines = [
        f"{icon} {desc}",
        f"🌡️ دما: {c['temperature_2m']:.1f}°C  (حس می‌شه {c['apparent_temperature']:.1f}°C)",
        f"💧 رطوبت: {c['relative_humidity_2m']:.0f}%",
        f"🌬️ باد: {c['wind_speed_10m']:.1f} m/s",
        f"🌧️ بارش: {c['precipitation']:.1f} mm",
    ]
    return "\n".join(lines)


def format_daily(d, idx):
    day = d["time"][idx]
    desc, icon = wmo(d["weather_code"][idx])
    lines = [
        f"{icon} {day} — {desc}",
        f"  🔺 {d['temperature_2m_max'][idx]:.0f}°  🔻 {d['temperature_2m_min'][idx]:.0f}°",
        f"  🌧️ {d['precipitation_sum'][idx]:.1f}mm   💨 {d['wind_speed_10m_max'][idx]:.0f}m/s",
    ]
    if d.get("uv_index_max") is not None:
        lines.append(f"  ☀️ UV: {d['uv_index_max'][idx]:.0f}")
    return "\n".join(lines)
