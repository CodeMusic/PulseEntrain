"""
PulseEntrain Admin — UI shell and the unified dose screen.

Self-contained (imports only Kivy + a lazy import of the content engine inside
Extract), so it never imports `main` and there's no circular-import risk.
`main.build()` calls `make_admin_root(pulsetto_screen)`.

Model: three *entry-point buttons* — Extract (open an MP3 -> decompose),
Open (open an .imed), Create (new blank) — all load ONE DoseScreen showing the
image / title / strength / description / beat graph. The graph is read-only with
an Edit button; in edit mode you add notes, drag them or type a value, then Done
returns to read-only. Save writes the .imed. (Pulsetto remains reachable for the
device side.)
"""
import base64
import io
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from kivy.clock import Clock, mainthread
from kivy.core.image import Image as CoreImage
from kivy.core.text import Label as CoreLabel
from kivy.graphics import Color, Line, PopMatrix, PushMatrix, Rectangle, RoundedRectangle, Rotate
from kivy.metrics import dp, sp
from kivy.uix.anchorlayout import AnchorLayout
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.dropdown import DropDown
from kivy.uix.filechooser import FileChooserListView
from kivy.uix.floatlayout import FloatLayout
from kivy.uix.image import Image as KivyImage
from kivy.uix.label import Label
from kivy.uix.popup import Popup
from kivy.uix.screenmanager import FadeTransition, Screen, ScreenManager
from kivy.uix.scrollview import ScrollView
from kivy.uix.slider import Slider
from kivy.uix.spinner import Spinner
from kivy.uix.textinput import TextInput
from kivy.uix.widget import Widget
from kivy.utils import get_color_from_hex as hexcolor

COLORS = {
    "bg_dark": "#0F1419", "bg_card": "#1A1F2E", "bg_card_light": "#252B3D",
    "text_primary": "#FFFFFF", "text_secondary": "#9CA3AF", "text_muted": "#6B7280",
    "accent_blue": "#3B82F6", "accent_green": "#10B981", "accent_red": "#EF4444",
    "divider": "#374151", "button_bg": "#374151",
}
NOISE_CAP_HZ = 13.0
BEAT_MAX = 45.0
NOISE_OPTIONS = ["none", "white", "pink", "brown", "blue", "violet", "grey"]


def slugify(name):
    return "".join(ch if ch.isalnum() else "_" for ch in str(name).lower()).strip("_") or "session"


def C(key):
    return hexcolor(COLORS[key])


def default_dir():
    """File dialogs open in the repo's entrainment_assets/ (fallback: home)."""
    d = Path(__file__).resolve().parents[1] / "entrainment_assets"
    return str(d) if d.is_dir() else os.path.expanduser("~")


def fmt_time(t):
    t = max(0, int(t))
    return f"{t // 60}:{t % 60:02d}"


# ----------------------------------------------------------------------------- #
# Small styled widgets
# ----------------------------------------------------------------------------- #
class PillButton(Button):
    def __init__(self, text="", color_key="accent_blue", height=None, **kw):
        super().__init__(text=text, **kw)
        self.background_normal = self.background_down = ""
        self.background_color = (0, 0, 0, 0)
        self.color = C("text_primary")
        self.bold = True
        self.font_size = sp(14)
        self.size_hint_y = None
        self.height = height or dp(46)
        with self.canvas.before:
            self._c = Color(rgba=C(color_key))
            self._r = RoundedRectangle(pos=self.pos, size=self.size, radius=[dp(20)])
        self.bind(pos=self._u, size=self._u)

    def _u(self, *a):
        self._r.pos, self._r.size = self.pos, self.size

    def set_color(self, key):
        self._c.rgba = C(key)


class LoadingArc(Widget):
    """A small spinning arc used as a loading indicator."""

    def __init__(self, **kw):
        kw.setdefault("size_hint", (None, None))
        kw.setdefault("size", (dp(44), dp(44)))
        super().__init__(**kw)
        self._angle = 0
        self._rot = None
        self._ev = None
        self.bind(pos=self._draw, size=self._draw)

    def _draw(self, *a):
        self.canvas.clear()
        cx, cy = self.center
        r = min(self.width, self.height) / 2 - dp(3)
        with self.canvas:
            PushMatrix()
            self._rot = Rotate(angle=self._angle, origin=(cx, cy))
            Color(rgba=C("accent_blue"))
            Line(circle=(cx, cy, r, 0, 270), width=dp(3), cap="round")
            PopMatrix()

    def start(self):
        self.stop()
        self._ev = Clock.schedule_interval(self._tick, 1 / 30.0)

    def _tick(self, dt):
        self._angle = (self._angle + 12) % 360
        if self._rot is not None:
            self._rot.angle = self._angle

    def stop(self):
        if self._ev:
            self._ev.cancel()
            self._ev = None


def labelled_field(label, multiline=False, text=""):
    box = BoxLayout(orientation="vertical", size_hint_y=None, spacing=dp(4))
    lbl = Label(text=label, color=C("text_secondary"), font_size=sp(12),
                size_hint_y=None, height=dp(18), halign="left", valign="middle")
    lbl.bind(size=lambda *_: setattr(lbl, "text_size", lbl.size))
    ti = TextInput(text=text or "", multiline=multiline, size_hint_y=None,
                   height=dp(80) if multiline else dp(40),
                   background_color=C("bg_card_light"), foreground_color=C("text_primary"),
                   cursor_color=C("accent_blue"), padding=[dp(10), dp(10)])
    box.height = ti.height + dp(22)
    box.add_widget(lbl)
    box.add_widget(ti)
    return box, ti


def choose_file(on_pick, filters=None, title="Choose file"):
    chooser = FileChooserListView(filters=filters or [], path=default_dir())
    box = BoxLayout(orientation="vertical", spacing=dp(8), padding=dp(8))
    box.add_widget(chooser)
    row = BoxLayout(size_hint_y=None, height=dp(46), spacing=dp(8))
    popup = Popup(title=title, content=box, size_hint=(0.9, 0.9))
    cancel = PillButton(text="Cancel", color_key="button_bg")
    cancel.bind(on_release=lambda *_: popup.dismiss())
    sel = PillButton(text="Select", color_key="accent_blue")

    def pick(*a):
        if chooser.selection:
            s = chooser.selection[0]
            popup.dismiss()
            on_pick(s)
    sel.bind(on_release=pick)
    row.add_widget(cancel)
    row.add_widget(sel)
    box.add_widget(row)
    popup.open()


def save_file(on_save, default_name="session.imed", title="Save .imed"):
    chooser = FileChooserListView(path=default_dir(), dirselect=True)
    box = BoxLayout(orientation="vertical", spacing=dp(8), padding=dp(8))
    box.add_widget(chooser)
    name_ti = TextInput(text=default_name, multiline=False, size_hint_y=None, height=dp(40),
                        background_color=C("bg_card_light"), foreground_color=C("text_primary"))
    box.add_widget(name_ti)
    row = BoxLayout(size_hint_y=None, height=dp(46), spacing=dp(8))
    popup = Popup(title=title, content=box, size_hint=(0.9, 0.9))
    cancel = PillButton(text="Cancel", color_key="button_bg")
    cancel.bind(on_release=lambda *_: popup.dismiss())
    save = PillButton(text="Save", color_key="accent_green")

    def do(*a):
        s = chooser.selection[0] if chooser.selection else chooser.path
        target = os.path.dirname(s) if os.path.isfile(s) else s
        name = name_ti.text.strip() or default_name
        if not name.endswith((".imed", ".imedx")):
            name += ".imedx"
        popup.dismiss()
        on_save(os.path.join(target, name))
    save.bind(on_release=do)
    row.add_widget(cancel)
    row.add_widget(save)
    box.add_widget(row)
    popup.open()


def encode_image_data_uri(path, max_px=512, quality=82):
    from PIL import Image as PILImage
    img = PILImage.open(path).convert("RGB")
    img.thumbnail((max_px, max_px))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def texture_from_image(value):
    try:
        if not value:
            return None
        if value.startswith("data:"):
            head, b64 = value.split(",", 1)
            ext = "jpeg" if ("jpeg" in head or "jpg" in head) else "png"
            return CoreImage(io.BytesIO(base64.b64decode(b64)), ext=ext).texture
        if os.path.isfile(value):
            return CoreImage(value).texture
    except Exception:
        return None
    return None


# ----------------------------------------------------------------------------- #
# The beat graph — read-only by default, editable on demand
# ----------------------------------------------------------------------------- #
class BeatGraph(Widget):
    """Plots scene `beatHz` over time. Read-only shows a hover tooltip; editable
    lets you tap-to-add, drag, and (via the editor bar) type values for a node."""

    def __init__(self, on_select=None, on_change=None, **kw):
        kw.setdefault("size_hint_y", None)
        kw.setdefault("height", dp(240))
        super().__init__(**kw)
        self.scenes = []
        self.duration = 600.0
        self.editable = False
        self.sel = None              # selected scene dict
        self.on_select = on_select   # callback(scene_or_None)
        self.on_change = on_change   # callback() after any edit
        self._nodes = []             # (x, y, scene)
        self._geom = None
        self._tip = None
        self.bind(pos=self._redraw, size=self._redraw)
        from kivy.core.window import Window
        Window.bind(mouse_pos=self._on_mouse_pos)

    def _label_tex(self, text):
        # Axis labels are drawn on the canvas (not child widgets) so they always
        # render and never intercept touches on nearby nodes.
        cl = CoreLabel(text=text, font_size=sp(11), color=C("text_muted"))
        cl.refresh()
        return cl.texture

    # ---- data ----
    def load(self, scenes, duration):
        self.scenes = scenes
        self.duration = duration or (scenes[-1]["atSec"] if scenes else 600.0) or 600.0
        self.sel = None
        self._redraw()

    def set_editable(self, on):
        self.editable = on
        if not on:
            self.sel = None
        self._redraw()

    # ---- geometry / mapping ----
    def _compute_geom(self):
        beats = [s["beatHz"] for s in self.scenes] or [0.0]
        bmax = max(beats + [1.0])   # top of the axis = the upper frequency actually used
        bmin = 0.0
        pad_l, pad_b, pad_t, pad_r = dp(70), dp(28), dp(14), dp(20)
        x0, y0 = self.x + pad_l, self.y + pad_b
        w, h = self.width - pad_l - pad_r, self.height - pad_b - pad_t
        self._geom = (x0, y0, w, h, bmin, bmax, max(self.duration, 1.0), (bmax - bmin) or 1.0)
        return self._geom

    def _X(self, t):
        x0, _, w, _, _, _, dur, _ = self._geom
        return x0 + (t / dur) * w

    def _Y(self, b):
        _, y0, _, h, bmin, _, _, span = self._geom
        return y0 + ((b - bmin) / span) * h

    def _inv(self, px, py):
        x0, y0, w, h, bmin, bmax, dur, span = self._geom
        t = (px - x0) / w * dur if w else 0
        b = (py - y0) / h * span + bmin if h else 0
        return max(0, min(dur, t)), max(0, min(BEAT_MAX, b))

    # ---- draw ----
    def _redraw(self, *a):
        self.canvas.clear()
        self._nodes = []
        if self.width < 80 or self.height < 80:
            return
        self._compute_geom()
        x0, y0, w, h, bmin, bmax, dur, span = self._geom
        pts = []
        for s in self.scenes:
            pts += [self._X(s["atSec"]), self._Y(s["beatHz"])]
        if len(self.scenes) == 1:
            b0 = self.scenes[0]["beatHz"]
            pts = [x0, self._Y(b0), x0 + w, self._Y(b0)]
        with self.canvas:
            Color(rgba=C("divider"))
            Line(points=[x0, y0, x0 + w, y0], width=1)
            Line(points=[x0, y0, x0, y0 + h], width=1)
            if NOISE_CAP_HZ <= bmax:                       # cap line only when it's on-scale
                Color(rgba=C("accent_red"))
                cy = self._Y(NOISE_CAP_HZ)
                Line(points=[x0, cy, x0 + w, cy], width=1, dash_offset=4, dash_length=6)
            if len(pts) >= 4:
                Color(rgba=C("accent_blue"))
                Line(points=pts, width=1.6)
            for s in self.scenes:
                nx, ny = self._X(s["atSec"]), self._Y(s["beatHz"])
                if s is self.sel:
                    Color(rgba=C("accent_green"))
                    Line(circle=(nx, ny, dp(7)), width=2)
                else:
                    Color(rgba=C("accent_green") if self.editable else C("accent_blue"))
                    Line(circle=(nx, ny, dp(4)), width=1.6)
                self._nodes.append((nx, ny, s))
            # axis bounds drawn on the canvas: "0" at origin, max beat top-left,
            # duration bottom-right (always visible, never intercept node touches)
            Color(1, 1, 1, 1)
            t0 = self._label_tex("0")
            Rectangle(texture=t0, size=t0.size, pos=(x0 - t0.width - dp(6), y0 - t0.height / 2))
            tm = self._label_tex(f"{bmax:.1f} Hz")
            Rectangle(texture=tm, size=tm.size, pos=(x0 - tm.width - dp(6), (y0 + h) - tm.height / 2))
            td = self._label_tex(fmt_time(dur))
            Rectangle(texture=td, size=td.size, pos=(x0 + w - td.width, y0 - td.height - dp(6)))

    # ---- hover tooltip (read-only) ----
    def _on_mouse_pos(self, window, pos):
        if self.editable or not self.get_root_window() or not self._nodes:
            return self._hide_tip()
        for (nx, ny, s) in self._nodes:
            wx, wy = self.to_window(nx, ny)
            if abs(wx - pos[0]) <= dp(10) and abs(wy - pos[1]) <= dp(10):
                return self._show_tip(s, pos)
        self._hide_tip()

    def _show_tip(self, s, pos):
        from kivy.core.window import Window
        if self._tip is None:
            self._tip = Label(font_size=sp(12), color=C("text_primary"), size_hint=(None, None))
            with self._tip.canvas.before:
                Color(rgba=C("bg_card_light"))
                self._tip._r = RoundedRectangle(radius=[dp(6)])
            self._tip.bind(pos=self._tipbg, size=self._tipbg)
        self._tip.text = f"{s['beatHz']:.1f} Hz · {fmt_time(s['atSec'])}"
        self._tip.texture_update()
        self._tip.size = (self._tip.texture_size[0] + dp(16), self._tip.texture_size[1] + dp(8))
        self._tip.pos = (pos[0] + dp(12), pos[1] + dp(12))
        if self._tip.parent is None:
            Window.add_widget(self._tip)

    def _tipbg(self, *a):
        self._tip._r.pos, self._tip._r.size = self._tip.pos, self._tip.size

    def _hide_tip(self):
        if self._tip is not None and self._tip.parent is not None:
            self._tip.parent.remove_widget(self._tip)

    # ---- editing (touch) ----
    def _hit(self, pos):
        best, best_d = None, dp(14)
        for (nx, ny, s) in self._nodes:
            d = ((nx - pos[0]) ** 2 + (ny - pos[1]) ** 2) ** 0.5
            if d <= best_d:
                best, best_d = s, d
        return best

    def on_touch_down(self, touch):
        if not self.editable or not self.collide_point(*touch.pos):
            return super().on_touch_down(touch)
        s = self._hit(touch.pos)
        if s is None:  # tap empty -> add a node here
            t, b = self._inv(*touch.pos)
            s = {"atSec": round(t, 1), "beatHz": round(b, 2)}
            self.scenes.append(s)
            self.scenes.sort(key=lambda d: d["atSec"])
        self.sel = s
        touch.grab(self)
        self._redraw()
        self._emit_select()
        self._emit_change()
        return True

    def on_touch_move(self, touch):
        if touch.grab_current is self and self.sel is not None:
            t, b = self._inv(*touch.pos)
            self.sel["atSec"] = round(t, 1)
            self.sel["beatHz"] = round(b, 2)
            self._redraw()
            self._emit_select()
            return True
        return super().on_touch_move(touch)

    def on_touch_up(self, touch):
        if touch.grab_current is self:
            touch.ungrab(self)
            self.scenes.sort(key=lambda d: d["atSec"])
            self._redraw()
            self._emit_change()
            return True
        return super().on_touch_up(touch)

    # ---- programmatic edits from the editor bar ----
    def set_selected(self, t=None, b=None):
        if self.sel is None:
            return
        if t is not None:
            self.sel["atSec"] = max(0, min(self.duration, float(t)))
        if b is not None:
            self.sel["beatHz"] = max(0, min(BEAT_MAX, float(b)))
        self.scenes.sort(key=lambda d: d["atSec"])
        self._redraw()
        self._emit_change()

    def add_midpoint(self):
        t = self.duration / 2
        beats = [s["beatHz"] for s in self.scenes] or [8.0]
        s = {"atSec": round(t, 1), "beatHz": round(sum(beats) / len(beats), 2)}
        self.scenes.append(s)
        self.scenes.sort(key=lambda d: d["atSec"])
        self.sel = s
        self._redraw()
        self._emit_select()
        self._emit_change()

    def delete_selected(self):
        if self.sel in self.scenes:
            self.scenes.remove(self.sel)
            self.sel = None
            self._redraw()
            self._emit_select()
            self._emit_change()

    def _emit_select(self):
        if self.on_select:
            self.on_select(self.sel)

    def _emit_change(self):
        if self.on_change:
            self.on_change()




# ----------------------------------------------------------------------------- #
# The one shared dose screen
# ----------------------------------------------------------------------------- #
def blank_imed():
    return {
        "formatVersion": 2, "id": "new_session",
        "meta": {"name": "New session", "description": None, "category": None,
                 "strength": 4, "strengthLabel": None, "durationSec": 600,
                 "image": None, "rating": None, "playCount": 0},
        "generation": {"source": "studio",
                       "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds")},
        "entrainment": {"ramp": "linear",
                        "scenes": [{"atSec": 0, "beatHz": 10}, {"atSec": 600, "beatHz": 6}]},
        "audio": {"binaural": {"carrierHz": 200, "follow": "beat"}, "beds": [], "masterVolume": 1.0},
        "nova": {"mode": "follow", "maxHz": 13, "brightness": 1.0},
        "pulsetto": {"enabled": False, "follow": "scenes", "intensityClamp": [1, 9]},
    }


def legacy_to_imed(legacy):
    """Map a legacy schema_version:1 .imed (mp3/image references + metadata) into
    the v2 model. Scenes/noise are filled later by analyzing the referenced MP3;
    the referenced image is embedded by the caller."""
    u = legacy.get("user", {}) or {}
    return {
        "formatVersion": 2,
        "id": slugify(legacy.get("name", "session")),
        "meta": {
            "name": legacy.get("name", "Untitled"),
            "description": legacy.get("description"),
            "category": legacy.get("category"),
            "strength": legacy.get("strength"),
            "strengthLabel": legacy.get("strength_label"),
            "durationSec": legacy.get("length_seconds", 0) or 0,
            "image": None,
            "rating": u.get("rating"),
            "playCount": u.get("play_count", 0),
        },
        "generation": {"source": "binaural_decompose", "legacy": True,
                       "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds")},
        "entrainment": {"ramp": "linear", "scenes": []},
        "audio": {"binaural": {"carrierHz": 200, "follow": "beat"}, "beds": [], "masterVolume": 1.0},
        "nova": {"mode": "follow", "maxHz": 13, "brightness": 1.0},
        "pulsetto": {"enabled": False, "follow": "scenes", "intensityClamp": [1, 9]},
    }


class DoseScreen(Screen):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.imed = None
        self._preview = None
        root = BoxLayout(orientation="vertical", padding=dp(18), spacing=dp(10), size_hint_y=None)
        root.bind(minimum_height=root.setter("height"))

        def cap(text, w, ha="left"):
            l = Label(text=text, color=C("text_secondary"), font_size=sp(12),
                      halign=ha, valign="middle", size_hint_x=None, width=w)
            l.bind(size=lambda x, *_: setattr(x, "text_size", x.size))
            return l

        def vcap(text):
            l = Label(text=text, color=C("text_secondary"), font_size=sp(12), halign="left",
                      valign="middle", size_hint_y=None, height=dp(18))
            l.bind(size=lambda x, *_: setattr(x, "text_size", x.size))
            return l

        def tinput(hint="", flex=True, w=None, fs=14, big=False):
            ti = TextInput(hint_text=hint, multiline=False, background_color=C("bg_card_light"),
                           foreground_color=C("text_primary"), cursor_color=C("accent_blue"),
                           padding=[dp(10), dp(12) if big else dp(10)], font_size=sp(fs))
            if not flex:
                ti.size_hint_x = None
                ti.width = w
            return ti

        # --- header: cover (left) + title/strength row + category row ---
        header = BoxLayout(size_hint_y=None, height=dp(150), spacing=dp(16))
        left = BoxLayout(orientation="vertical", size_hint_x=None, width=dp(130), spacing=dp(8))
        self.cover = KivyImage(size_hint_y=None, height=dp(110))
        img_btn = PillButton(text="Image…", color_key="button_bg", height=dp(32))
        img_btn.bind(on_release=lambda *_: choose_file(
            self._on_image, filters=["*.png", "*.jpg", "*.jpeg", "*.webp"], title="Choose cover image"))
        left.add_widget(self.cover)
        left.add_widget(img_btn)
        header.add_widget(left)

        meta = BoxLayout(orientation="vertical", spacing=dp(12))
        # row 1: title + strength slider + value + strength label, all on one line
        row1 = BoxLayout(size_hint_y=None, height=dp(44), spacing=dp(10))
        self.f_title = tinput("Title", fs=16, big=True)
        self.s_slider = Slider(min=1, max=7, step=1, value=4, size_hint_x=None, width=dp(170))
        self.s_val = Label(text="4", color=C("text_primary"), bold=True, size_hint_x=None, width=dp(22))
        self.s_slider.bind(value=lambda _, v: setattr(self.s_val, "text", str(int(v))))
        self.f_slabel = tinput("strength label", flex=False, w=dp(150))
        row1.add_widget(self.f_title)
        row1.add_widget(cap("Strength", dp(58), "right"))
        row1.add_widget(self.s_slider)
        row1.add_widget(self.s_val)
        row1.add_widget(self.f_slabel)
        meta.add_widget(row1)
        # row 2: category label + value adjacent
        row2 = BoxLayout(size_hint_y=None, height=dp(40), spacing=dp(10))
        self.f_cat = tinput("category")
        row2.add_widget(cap("Category", dp(72)))
        row2.add_widget(self.f_cat)
        meta.add_widget(row2)
        meta.add_widget(Widget())  # take up remaining height so rows sit at the top
        header.add_widget(meta)
        root.add_widget(header)

        # --- description with the noise control to its right ---
        drow = BoxLayout(size_hint_y=None, height=dp(96), spacing=dp(14))
        dcol = BoxLayout(orientation="vertical", spacing=dp(4))
        dcol.add_widget(vcap("Description"))
        self.f_desc = TextInput(multiline=True, background_color=C("bg_card_light"),
                                foreground_color=C("text_primary"), cursor_color=C("accent_blue"),
                                padding=[dp(10), dp(10)])
        dcol.add_widget(self.f_desc)
        drow.add_widget(dcol)
        ncol = BoxLayout(orientation="vertical", size_hint_x=None, width=dp(170), spacing=dp(4))
        ncol.add_widget(vcap("Noise"))
        self.noise_spin = Spinner(text="none", values=NOISE_OPTIONS, size_hint_y=None, height=dp(40),
                                  background_normal="", background_color=C("bg_card_light"),
                                  color=C("text_primary"), font_size=sp(14))
        self.noise_spin.bind(text=lambda _, v: self._set_noise(v))
        ncol.add_widget(self.noise_spin)
        ncol.add_widget(Widget())
        drow.add_widget(ncol)
        root.add_widget(drow)

        # --- graph header: title + duration editor + Edit ---
        gtop = BoxLayout(size_hint_y=None, height=dp(36), spacing=dp(10))
        beat_lbl = Label(text="Beat over time", color=C("text_muted"), font_size=sp(12),
                         halign="left", valign="middle")
        beat_lbl.bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        gtop.add_widget(beat_lbl)
        gtop.add_widget(cap("Duration", dp(64), "right"))
        self.dur_field = tinput("m:ss", flex=False, w=dp(96))
        self.dur_field.halign = "center"
        self.dur_field.size_hint_y = None
        self.dur_field.height = dp(30)
        self.dur_field.bind(on_text_validate=self._on_duration)
        gtop.add_widget(self.dur_field)
        self.edit_btn = PillButton(text="Edit", color_key="accent_blue", height=dp(30),
                                   size_hint_x=None, width=dp(90))
        self.edit_btn.bind(on_release=self._toggle_edit)
        gtop.add_widget(self.edit_btn)
        root.add_widget(gtop)

        self.graph = BeatGraph(on_select=self._on_node_select, on_change=self._sync_status)
        # In a FloatLayout a child needs an explicit pos_hint, else it pins to the
        # window's (0,0) and overlaps everything below. Fill the wrapper instead.
        self.graph.size_hint = (1, 1)
        self.graph.pos_hint = {"x": 0, "y": 0}
        self.graph_wrap = FloatLayout(size_hint_y=None, height=dp(280))
        self.graph_wrap.add_widget(self.graph)
        # loading overlay (spinner + message), centered over the graph
        self.loading = BoxLayout(orientation="vertical", size_hint=(None, None), size=(dp(280), dp(96)),
                                 pos_hint={"center_x": 0.5, "center_y": 0.5}, spacing=dp(10),
                                 opacity=0, disabled=True)
        arc_anchor = AnchorLayout(size_hint_y=None, height=dp(48))
        self.spinner = LoadingArc()
        arc_anchor.add_widget(self.spinner)
        self.loading_lbl = Label(text="", color=C("text_secondary"), font_size=sp(13),
                                 halign="center", valign="middle", size_hint_y=None, height=dp(30))
        self.loading_lbl.bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        self.loading.add_widget(arc_anchor)
        self.loading.add_widget(self.loading_lbl)
        self.graph_wrap.add_widget(self.loading)
        root.add_widget(self.graph_wrap)

        # editor bar (hidden until Edit)
        self.editbar = BoxLayout(size_hint_y=None, height=dp(0), spacing=dp(8), opacity=0, disabled=True)
        self.e_time = TextInput(hint_text="time s", multiline=False, size_hint_x=None, width=dp(90),
                               background_color=C("bg_card_light"), foreground_color=C("text_primary"))
        self.e_beat = TextInput(hint_text="beat Hz", multiline=False, size_hint_x=None, width=dp(90),
                               background_color=C("bg_card_light"), foreground_color=C("text_primary"))
        self.e_time.bind(on_text_validate=lambda *_: self._apply_fields())
        self.e_beat.bind(on_text_validate=lambda *_: self._apply_fields())
        add_btn = PillButton(text="+ Add", color_key="button_bg", height=dp(36))
        add_btn.bind(on_release=lambda *_: self.graph.add_midpoint())
        del_btn = PillButton(text="Delete", color_key="accent_red", height=dp(36))
        del_btn.bind(on_release=lambda *_: self.graph.delete_selected())
        apply_btn = PillButton(text="Set", color_key="accent_blue", height=dp(36))
        apply_btn.bind(on_release=lambda *_: self._apply_fields())
        for w in (self.e_time, self.e_beat, apply_btn, add_btn, del_btn):
            self.editbar.add_widget(w)
        root.add_widget(self.editbar)

        self.status = Label(text="", color=C("text_secondary"), font_size=sp(12),
                           size_hint_y=None, height=dp(22), halign="left", valign="middle")
        self.status.bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        root.add_widget(self.status)

        bottom = BoxLayout(size_hint_y=None, height=dp(50), spacing=dp(12))
        self.preview_btn = PillButton(text="Preview", color_key="accent_blue",
                                      size_hint_x=None, width=dp(170))
        self.preview_btn.bind(on_release=self._toggle_preview)
        save = PillButton(text="Save .imedx…", color_key="accent_green")
        save.bind(on_release=self._on_save)
        bottom.add_widget(self.preview_btn)
        bottom.add_widget(save)
        root.add_widget(bottom)

        sv = ScrollView()
        sv.add_widget(root)
        self.add_widget(sv)

    # ---- load entry points ----
    def load_imed(self, imed, status=""):
        self.imed = imed
        m = imed.get("meta", {})
        self.f_title.text = m.get("name", "") or ""
        self.f_desc.text = m.get("description") or ""
        self.f_cat.text = m.get("category") or ""
        self.f_slabel.text = m.get("strengthLabel") or ""
        self.s_slider.value = m.get("strength") or 4
        self.cover.texture = texture_from_image(m.get("image"))
        beds = imed.setdefault("audio", {}).setdefault("beds", [])
        ntype = next((b.get("type") for b in beds if b.get("source") == "noise"), "none")
        self.noise_spin.text = ntype or "none"
        scenes = imed.setdefault("entrainment", {}).setdefault("scenes", [])
        self.graph.load(scenes, m.get("durationSec"))
        self.dur_field.text = fmt_time(self.graph.duration)
        self._set_edit(False)
        self.status.text = status

    def _on_duration(self, *a):
        txt = self.dur_field.text.strip()
        try:
            secs = (int(txt.split(":")[0]) * 60 + int(txt.split(":")[1])) if ":" in txt else float(txt)
            self.graph.duration = max(1.0, secs)
            self.graph._redraw()
        except (ValueError, IndexError):
            pass

    def _set_noise(self, t):
        if self.imed is None:
            return
        beds = self.imed.setdefault("audio", {}).setdefault("beds", [])
        existing = next((b for b in beds if b.get("source") == "noise"), None)
        level = existing.get("level", 0.25) if existing else 0.25
        beds[:] = [b for b in beds if b.get("source") != "noise"]
        if t and t != "none":
            beds.append({"source": "noise", "type": t, "level": level})

    def load_blank(self):
        self.load_imed(blank_imed(), status="New session — Edit the graph, then Save.")

    # ---- loading overlay ----
    def show_loading(self, msg):
        self.loading_lbl.text = msg
        self.loading.opacity = 1
        self.loading.disabled = False
        self.spinner.start()

    def hide_loading(self):
        self.spinner.stop()
        self.loading.opacity = 0
        self.loading.disabled = True

    # ---- image ----
    def _on_image(self, path):
        try:
            uri = encode_image_data_uri(path)
            self.imed.setdefault("meta", {})["image"] = uri
            self.cover.texture = texture_from_image(uri)
        except Exception as e:
            self.status.text = f"[!] image: {e}"

    # ---- edit mode ----
    def _toggle_edit(self, *a):
        self._set_edit(not self.graph.editable)

    def _set_edit(self, on):
        self.graph.set_editable(on)
        self.edit_btn.text = "Done" if on else "Edit"
        self.edit_btn.set_color("accent_green" if on else "accent_blue")
        self.editbar.opacity = 1 if on else 0
        self.editbar.disabled = not on
        self.editbar.height = dp(40) if on else dp(0)
        if on:
            self.status.text = "Tap to add a note · drag to move · select + type a value · Done when finished."
        else:
            self._sync_status()

    def _on_node_select(self, scene):
        if scene is None:
            self.e_time.text = self.e_beat.text = ""
        else:
            self.e_time.text = f"{scene['atSec']:.1f}"
            self.e_beat.text = f"{scene['beatHz']:.2f}"

    def _apply_fields(self):
        if self.graph.sel is None:
            return
        try:
            t = float(self.e_time.text) if self.e_time.text.strip() else None
            b = float(self.e_beat.text) if self.e_beat.text.strip() else None
            self.graph.set_selected(t=t, b=b)
        except ValueError:
            self.status.text = "[!] enter numbers for time / beat"

    # ---- preview (render + play, matching the mobile engine) ----
    def _toggle_preview(self, *a):
        if self._preview is not None:
            self._stop_preview()
            return
        try:
            from engine.synth import BinauralPreview
            self._preview = BinauralPreview(self._collect())
            self._preview.on_finish = lambda: Clock.schedule_once(lambda *_: self._stop_preview(), 0)
            self._preview.start()
            self.preview_btn.text = "Stop"
            self.preview_btn.set_color("accent_red")
            self.status.text = "Previewing… (binaural + noise, as the mobile app will render it)"
        except Exception as e:
            self._preview = None
            self.status.text = f"[!] preview needs the audio engine: {e}"

    def _stop_preview(self, *a):
        if self._preview is not None:
            self._preview.stop()
            self._preview = None
        self.preview_btn.text = "Preview"
        self.preview_btn.set_color("accent_blue")

    def _sync_status(self):
        scenes = self.graph.scenes
        if scenes:
            beats = [s["beatHz"] for s in scenes]
            self.status.text = f"{len(scenes)} note(s) · beat {min(beats):.1f}–{max(beats):.1f} Hz"

    # ---- save ----
    def _collect(self):
        m = self.imed.setdefault("meta", {})
        m["name"] = self.f_title.text.strip() or "Untitled"
        m["description"] = self.f_desc.text.strip() or None
        m["category"] = self.f_cat.text.strip() or None
        m["strengthLabel"] = self.f_slabel.text.strip() or None
        m["strength"] = int(self.s_slider.value)
        m["durationSec"] = round(self.graph.duration)
        return self.imed

    def _on_save(self, *a):
        if not self.imed:
            return
        imed = self._collect()
        slug = slugify(imed["meta"]["name"])
        imed["id"] = slug
        save_file(self._write, default_name=f"{slug}.imedx")

    def _write(self, path):
        try:
            self._validate(self.imed)
            with open(path, "w") as fh:
                json.dump(self.imed, fh, indent=2)
            self.status.text = f"Saved → {path}"
        except Exception as e:
            self.status.text = f"[!] save: {e}"

    def _validate(self, imed):
        try:
            from jsonschema import Draft202012Validator
            schema_path = Path(__file__).resolve().parents[1] / "docs" / "session.schema.json"
            v = Draft202012Validator(json.loads(schema_path.read_text()))
            errs = sorted(v.iter_errors(imed), key=lambda e: list(e.path))
            if errs:
                raise ValueError(errs[0].message)
        except (FileNotFoundError, ImportError):
            pass  # validation is best-effort


# ----------------------------------------------------------------------------- #
# Shell: toolbar of entry-point buttons + the dose screen (+ Pulsetto)
# ----------------------------------------------------------------------------- #
class AdminRoot(BoxLayout):
    def __init__(self, pulsetto_screen, **kw):
        super().__init__(orientation="vertical", **kw)
        self.sm = ScreenManager(transition=FadeTransition(duration=0.12))
        self.dose = DoseScreen(name="dose")
        pulse = Screen(name="pulsetto")
        pulse.add_widget(pulsetto_screen)
        self.sm.add_widget(self.dose)
        self.sm.add_widget(pulse)

        bar = BoxLayout(size_hint_y=None, height=dp(52), padding=[dp(18), dp(8)], spacing=dp(10))
        title = Label(text="PulseEntrain Admin", color=C("text_primary"), bold=True, font_size=sp(16),
                      halign="left", valign="middle")
        title.bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        menu_btn = PillButton(text="Menu", color_key="bg_card_light",
                              size_hint_x=None, width=dp(120), height=dp(40))
        dd = DropDown(auto_width=False, width=dp(200))
        items = [("Extract from MP3…", self._extract), ("Open .imed…", self._open),
                 ("Create new", self._create), ("Pulsetto device", lambda: setattr(self.sm, "current", "pulsetto"))]
        for lbl, cb in items:
            it = Button(text=lbl, size_hint_y=None, height=dp(46), halign="left", valign="middle",
                        background_normal="", background_down="", background_color=C("bg_card_light"),
                        color=C("text_primary"), font_size=sp(14), padding_x=dp(16))
            it.bind(size=lambda w, *_: setattr(w, "text_size", w.size))
            it.bind(on_release=lambda b, cb=cb: (dd.dismiss(), cb()))
            dd.add_widget(it)
        menu_btn.bind(on_release=lambda b: dd.open(b))
        bar.add_widget(title)
        bar.add_widget(menu_btn)
        self.add_widget(bar)
        self.add_widget(self.sm)

        self.dose.load_blank()  # start with something on the dose screen

    def _to_dose(self):
        self.sm.current = "dose"

    def _create(self):
        self.dose.load_blank()
        self._to_dose()

    @staticmethod
    def _is_legacy(data):
        return data.get("schema_version") == 1 or ("files" in data and "entrainment" not in data)

    def _open(self):
        def picked(path):
            try:
                with open(path) as fh:
                    data = json.load(fh)
            except Exception as e:
                self.dose.status.text = f"[!] open: {e}"
                return
            self._to_dose()
            if self._is_legacy(data):
                self._open_legacy(data, os.path.dirname(path), os.path.basename(path))
            else:
                self.dose.load_imed(data, status=f"Opened {os.path.basename(path)}")
        choose_file(picked, filters=["*.imedx", "*.imed", "*.json"],
                    title="Open a session (.imedx / legacy .imed)")

    def _open_legacy(self, legacy, base, fname):
        imed = legacy_to_imed(legacy)
        files = legacy.get("files") or {}
        img = files.get("image")
        if img and os.path.isfile(os.path.join(base, img)):
            try:
                imed["meta"]["image"] = encode_image_data_uri(os.path.join(base, img))
            except Exception:
                pass
        audio = files.get("audio")
        mp3 = os.path.join(base, audio) if audio else None
        if mp3 and os.path.isfile(mp3):
            self.dose.show_loading(f"Analyzing {os.path.basename(mp3)}…")

            def work():
                try:
                    from engine.binaural_decompose import analyze, spec_to_dict_v2
                    spec = analyze(mp3, name=imed["meta"]["name"])
                    self._legacy_done(imed, spec_to_dict_v2(spec), None)
                except Exception as e:
                    self._legacy_done(imed, None, f"{type(e).__name__}: {e}")
            threading.Thread(target=work, daemon=True).start()
        else:
            self.dose.load_imed(imed, status=f"Legacy {fname} — no audio found; add beats via Edit.")

    @mainthread
    def _legacy_done(self, imed, analyzed, err):
        self.dose.hide_loading()
        if analyzed:
            imed["entrainment"] = analyzed["entrainment"]
            imed["audio"]["beds"] = analyzed["audio"]["beds"]
            imed["audio"]["binaural"] = analyzed["audio"]["binaural"]
            status = "Converted legacy .imed → audio analyzed. Save as .imedx."
        else:
            status = f"Legacy converted, but audio analysis failed: {err}"
        self.dose.load_imed(imed, status=status)

    def _extract(self):
        def picked(path):
            self._to_dose()
            self.dose.show_loading(f"Analyzing {os.path.basename(path)}…")

            def work():
                try:
                    from engine.binaural_decompose import analyze, spec_to_dict_v2
                    spec = analyze(path, name=os.path.splitext(os.path.basename(path))[0])
                    imed = spec_to_dict_v2(spec)
                    self._extract_done(imed, None)
                except Exception as e:
                    self._extract_done(None, f"{type(e).__name__}: {e}")
            threading.Thread(target=work, daemon=True).start()
        choose_file(picked, filters=["*.mp3", "*.wav", "*.flac", "*.m4a", "*.ogg"],
                    title="Extract from a binaural MP3")

    @mainthread
    def _extract_done(self, imed, err):
        self.dose.hide_loading()
        if err:
            self.dose.status.text = f"[!] {err}"
            return
        gen = imed.get("generation", {})
        warn = ("  ⚠ " + "; ".join(gen.get("warnings", []))) if gen.get("warnings") else ""
        conf = int(gen.get("confidence", 0) * 100)
        self.dose.load_imed(imed, status=f"Extracted · confidence {conf}%{warn}")


def make_admin_root(pulsetto_screen):
    return AdminRoot(pulsetto_screen)
