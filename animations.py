"""Generate animated weather charts (GIF) from forecast data."""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle
import matplotlib.animation as animation

WMO_ICON = {
    0: "SUN", 1: "MC", 2: "PC", 3: "CLOUD", 45: "FOG", 48: "FOG",
    51: "DRIZ", 53: "DRIZ", 55: "RAIN", 61: "DRIZ", 63: "RAIN", 65: "RAIN",
    71: "SNOW", 73: "SNOW", 75: "SNOW", 80: "DRIZ", 81: "RAIN", 82: "STORM",
    85: "SNOW", 86: "SNOW", 95: "STORM", 96: "STORM", 99: "STORM",
}


def build_animation(forecast, title="Weather", out_path=None, fps=2):
    """Animated 7-day temp curve that draws itself + per-day weather icons."""
    daily = forecast["daily"]
    days = [t[5:] for t in daily["time"]]  # MM-DD
    tmax = daily["temperature_2m_max"]
    tmin = daily["temperature_2m_min"]
    codes = daily["weather_code"]
    x = np.arange(len(days))

    if out_path is None:
        out_path = os.path.join(os.path.dirname(__file__), "weather_anim.gif")

    fig, ax = plt.subplots(figsize=(9, 4.5), dpi=110)
    fig.patch.set_facecolor("#0f1830")
    ax.set_facecolor("#0f1830")
    ax.set_ylim(min(tmin) - 4, max(tmax) + 4)
    ax.set_xticks(x)
    ax.set_xticklabels(days, color="#aab8d8")
    ax.tick_params(axis="y", colors="#aab8d8")
    ax.set_title(title, color="white", fontsize=14, fontweight="bold")
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color("#33406b")

    # gridlines
    ax.grid(True, color="#1d2950", alpha=0.6)

    line_max, = ax.plot([], [], "o-", color="#ff7a59", lw=2.2, label="Max")
    line_min, = ax.plot([], [], "o-", color="#4fc3f7", lw=2.2, label="Min")
    fill = ax.fill_between(x, tmin, tmax, color="#2a3a66", alpha=0.35)
    fill.set_visible(False)
    ax.legend(facecolor="#0f1830", labelcolor="white", frameon=False, loc="upper left")

    # weather icons as text
    icon_texts = []

    def init():
        line_max.set_data([], [])
        line_min.set_data([], [])
        return (line_max, line_min)

    def update(frame):
        # draw progressively
        fx = x[:frame + 1]
        line_max.set_data(fx, tmax[:frame + 1])
        line_min.set_data(fx, tmin[:frame + 1])
        # icons at completed points
        for i, t in zip(range(frame + 1), icon_texts[:frame + 1]):
            t.set_text(WMO_ICON.get(codes[i], "❓"))
            t.set_visible(True)
        return (line_max, line_min, *icon_texts[:frame + 1])

    # pre-create icon text objects above max points
    for i in range(len(days)):
        t = ax.text(x[i], tmax[i] + 1.2, "", ha="center", va="bottom",
                    fontsize=16, color="white")
        t.set_visible(False)
        icon_texts.append(t)

    anim = animation.FuncAnimation(fig, update, frames=len(days),
                                   init_func=init, blit=False, interval=1000 / fps,
                                   repeat=True, repeat_delay=1200)
    anim.save(out_path, writer="pillow", fps=fps)
    plt.close(fig)
    return out_path


if __name__ == "__main__":
    import weather
    f = weather.forecast(35.69, 51.39)
    print(build_animation(f, "Tehran"))
