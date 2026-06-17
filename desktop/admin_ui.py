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
from kivy.graphics import Color, Line, PopMatrix, PushMatrix, RoundedRectangle, Rotate
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
        if not name.endswith(".imed"):
            name += ".imed"
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
        self._freq_lbls = [self._tick("right") for _ in range(5)]
        self._time_lbls = [self._tick("center") for _ in range(5)]
        for l in self._freq_lbls + self._time_lbls:
            self.add_widget(l)
        self.bind(pos=self._redraw, size=self._redraw)
        from kivy.core.window import Window
        Window.bind(mouse_pos=self._on_mouse_pos)

    def _tick(self, halign):
        return Label(text="", font_size=sp(10), color=C("text_muted"),
                     size_hint=(None, None), size=(dp(46), dp(16)),
                     halign=halign, valign="middle")

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
        bmax = max(beats + [NOISE_CAP_HZ, 1.0])
        bmin = min(beats + [0.0])
        pad_l, pad_b, pad_t, pad_r = dp(54), dp(28), dp(12), dp(16)
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
        for l in self._freq_lbls + self._time_lbls:
            l.text = ""
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
            Color(rgba=C("accent_red"))
            cy = self._Y(min(NOISE_CAP_HZ, bmax))
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
        # axis ticks
        for i, l in enumerate(self._freq_lbls):
            f = i / (len(self._freq_lbls) - 1)
            l.text = f"{bmin + f * (bmax - bmin):.1f} Hz"
            l.text_size = l.size
            l.pos = (x0 - l.width - dp(6), (y0 + f * h) - l.height / 2)
        for i, l in enumerate(self._time_lbls):
            f = i / (len(self._time_lbls) - 1)
            l.text = fmt_time(f * dur)
            l.text_size = l.size
            l.pos = ((x0 + f * w) - l.width / 2, y0 - l.height - dp(6))

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
        for (nx, ny, s) in self._nodes:
            if abs(nx - pos[0]) <= dp(12) and abs(ny - pos[1]) <= dp(12):
                return s
        return None

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


class DoseScreen(Screen):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.imed = None
        root = BoxLayout(orientation="vertical", padding=dp(18), spacing=dp(12), size_hint_y=None)
        root.bind(minimum_height=root.setter("height"))

        # --- header: cover + metadata fields ---
        header = BoxLayout(size_hint_y=None, height=dp(190), spacing=dp(16))
        left = BoxLayout(orientation="vertical", size_hint_x=None, width=dp(130), spacing=dp(8))
        self.cover = KivyImage(size_hint_y=None, height=dp(110))
        img_btn = PillButton(text="Image…", color_key="button_bg", height=dp(32))
        img_btn.bind(on_release=lambda *_: choose_file(
            self._on_image, filters=["*.png", "*.jpg", "*.jpeg", "*.webp"], title="Choose cover image"))
        left.add_widget(self.cover)
        left.add_widget(img_btn)
        header.add_widget(left)

        meta = BoxLayout(orientation="vertical", spacing=dp(8))
        tbox, self.f_title = labelled_field("Title")
        meta.add_widget(tbox)
        srow = BoxLayout(size_hint_y=None, height=dp(40), spacing=dp(10))
        srow.add_widget(Label(text="Strength", color=C("text_secondary"), font_size=sp(12),
                              size_hint_x=None, width=dp(64), halign="left", valign="middle"))
        self.s_slider = Slider(min=1, max=7, step=1, value=4)
        self.s_val = Label(text="4", color=C("text_primary"), bold=True, size_hint_x=None, width=dp(26))
        self.s_slider.bind(value=lambda _, v: setattr(self.s_val, "text", str(int(v))))
        self.f_slabel = TextInput(hint_text="label", multiline=False, size_hint_x=None, width=dp(150),
                                  background_color=C("bg_card_light"), foreground_color=C("text_primary"),
                                  cursor_color=C("accent_blue"), padding=[dp(8), dp(10)])
        srow.add_widget(self.s_slider)
        srow.add_widget(self.s_val)
        srow.add_widget(self.f_slabel)
        meta.add_widget(srow)
        cbox, self.f_cat = labelled_field("Category")
        meta.add_widget(cbox)
        header.add_widget(meta)
        root.add_widget(header)

        dbox, self.f_desc = labelled_field("Description", multiline=True)
        root.add_widget(dbox)

        # --- graph + edit controls ---
        gtop = BoxLayout(size_hint_y=None, height=dp(30), spacing=dp(10))
        gtop.add_widget(Label(text="Beat over time", color=C("text_muted"), font_size=sp(12),
                             halign="left", valign="middle"))
        gtop.children[0].bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        self.edit_btn = PillButton(text="Edit", color_key="accent_blue", height=dp(30))
        self.edit_btn.size_hint_x = None
        self.edit_btn.width = dp(90)
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

        save = PillButton(text="Save .imed…", color_key="accent_green")
        save.bind(on_release=self._on_save)
        root.add_widget(save)

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
        scenes = imed.setdefault("entrainment", {}).setdefault("scenes", [])
        self.graph.load(scenes, m.get("durationSec"))
        self._set_edit(False)
        self.status.text = status

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
        return self.imed

    def _on_save(self, *a):
        if not self.imed:
            return
        imed = self._collect()
        slug = "".join(ch if ch.isalnum() else "_" for ch in imed["meta"]["name"].lower()).strip("_") or "session"
        imed["id"] = slug
        save_file(self._write, default_name=f"{slug}.imed")

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

    def _open(self):
        def picked(path):
            try:
                with open(path) as fh:
                    imed = json.load(fh)
                self.dose.load_imed(imed, status=f"Opened {os.path.basename(path)}")
                self._to_dose()
            except Exception as e:
                self.dose.load_imed(self.dose.imed or blank_imed(), status=f"[!] open: {e}")
        choose_file(picked, filters=["*.imed", "*.json"], title="Open a .imed session")

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
