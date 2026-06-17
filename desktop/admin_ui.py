"""
PulseEntrain Admin — UI shell and the Extract / Open / Create modes.

Self-contained on purpose: it imports only Kivy (+ a lazy import of the content
engine inside the Extract action), so it never imports `main` and there's no
circular-import / __main__ re-execution risk. `main.build()` calls
`make_admin_root(pulsetto_screen)` to combine these modes with the existing
Pulsetto screen under one ScreenManager.

Modes:
  Extract  — pick an MP3, decompose it (engine.binaural_decompose), fill in
             title/strength/description/image, save a self-contained .imed.
  Open     — read-only dose card + beat-over-time visualization. Edit -> Create.
  Create   — (stub for the next slice) editable authoring canvas.
  Pulsetto — the existing device screen, passed in from main.
"""
import base64
import io
import json
import os
import threading
from pathlib import Path

from kivy.clock import mainthread
from kivy.core.image import Image as CoreImage
from kivy.graphics import Color, Line, RoundedRectangle
from kivy.metrics import dp, sp
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.filechooser import FileChooserListView
from kivy.uix.image import Image as KivyImage
from kivy.uix.label import Label
from kivy.uix.popup import Popup
from kivy.uix.screenmanager import FadeTransition, Screen, ScreenManager
from kivy.uix.scrollview import ScrollView
from kivy.uix.slider import Slider
from kivy.uix.textinput import TextInput
from kivy.uix.widget import Widget
from kivy.utils import get_color_from_hex as hexcolor

# Mirror the desktop theme (kept local so this module stays decoupled from main).
COLORS = {
    "bg_dark": "#0F1419",
    "bg_card": "#1A1F2E",
    "bg_card_light": "#252B3D",
    "text_primary": "#FFFFFF",
    "text_secondary": "#9CA3AF",
    "text_muted": "#6B7280",
    "accent_blue": "#3B82F6",
    "accent_green": "#10B981",
    "accent_red": "#EF4444",
    "divider": "#374151",
    "button_bg": "#374151",
}
NOISE_CAP_HZ = 13.0  # Nova strobe ceiling, drawn as a reference on the timeline


def C(key):
    return hexcolor(COLORS[key])


def default_dir():
    """File dialogs open in the repo's entrainment_assets/ (fallback: home)."""
    d = Path(__file__).resolve().parents[1] / "entrainment_assets"
    return str(d) if d.is_dir() else os.path.expanduser("~")


# ----------------------------------------------------------------------------- #
# Small styled widgets
# ----------------------------------------------------------------------------- #
class PillButton(Button):
    def __init__(self, text="", color_key="accent_blue", height=None, **kw):
        super().__init__(text=text, **kw)
        self.background_normal = ""
        self.background_down = ""
        self.background_color = (0, 0, 0, 0)
        self.color = C("text_primary")
        self.bold = True
        self.font_size = sp(15)
        self.size_hint_y = None
        self.height = height or dp(48)
        with self.canvas.before:
            self._c = Color(rgba=C(color_key))
            self._r = RoundedRectangle(pos=self.pos, size=self.size, radius=[dp(22)])
        self.bind(pos=self._upd, size=self._upd)

    def _upd(self, *a):
        self._r.pos = self.pos
        self._r.size = self.size

    def set_color(self, key):
        self._c.rgba = C(key)


class Panel(BoxLayout):
    """Rounded card container."""

    def __init__(self, **kw):
        kw.setdefault("orientation", "vertical")
        kw.setdefault("padding", dp(16))
        kw.setdefault("spacing", dp(10))
        super().__init__(**kw)
        with self.canvas.before:
            Color(rgba=C("bg_card"))
            self._r = RoundedRectangle(pos=self.pos, size=self.size, radius=[dp(16)])
        self.bind(pos=self._u, size=self._u)

    def _u(self, *a):
        self._r.pos = self.pos
        self._r.size = self.size


class SegmentedNav(BoxLayout):
    """Top mode switcher (Extract / Open / Create / Pulsetto)."""

    def __init__(self, options, on_select, **kw):
        super().__init__(**kw)
        self.orientation = "horizontal"
        self.spacing = dp(8)
        self._on_select = on_select
        self.buttons = []
        for i, opt in enumerate(options):
            btn = Button(
                text=opt, font_size=sp(13), bold=True,
                background_normal="", background_down="",
                background_color=(0, 0, 0, 0), color=C("text_primary"),
            )
            with btn.canvas.before:
                btn._bg = Color(rgba=(0, 0, 0, 0))
                btn._rect = RoundedRectangle(pos=btn.pos, size=btn.size, radius=[dp(10)])
            btn.bind(pos=self._mk_upd(btn), size=self._mk_upd(btn))
            btn.bind(on_press=self._mk_press(i))
            self.buttons.append(btn)
            self.add_widget(btn)
        self.select(0, fire=False)

    def _mk_upd(self, btn):
        def _u(*a):
            btn._rect.pos = btn.pos
            btn._rect.size = btn.size
        return _u

    def _mk_press(self, i):
        def _p(*a):
            self.select(i)
        return _p

    def select(self, index, fire=True):
        for i, btn in enumerate(self.buttons):
            on = i == index
            btn._bg.rgba = C("accent_blue") if on else C("bg_card_light")
            btn.color = C("text_primary") if on else C("text_secondary")
        if fire and self._on_select:
            self._on_select(index)


class BeatTimeline(Widget):
    """beatHz over time from the scene keyframes: labelled axes (Hz left, time
    bottom), the Nova 13 Hz cap line, and a hover tooltip on each keyframe node."""

    def __init__(self, **kw):
        kw.setdefault("size_hint_y", None)
        kw.setdefault("height", dp(200))
        super().__init__(**kw)
        self.scenes = []
        self.duration = 0.0
        self._nodes = []   # (abs_x, abs_y, beatHz, atSec) in parent space
        self._tip = None
        self._freq_lbls = [self._mk_tick("right") for _ in range(5)]
        self._time_lbls = [self._mk_tick("center") for _ in range(5)]
        for lbl in self._freq_lbls + self._time_lbls:
            self.add_widget(lbl)
        self.bind(pos=self._redraw, size=self._redraw)
        from kivy.core.window import Window
        Window.bind(mouse_pos=self._on_mouse_pos)

    def _mk_tick(self, halign):
        lbl = Label(text="", font_size=sp(10), color=C("text_muted"),
                    size_hint=(None, None), size=(dp(46), dp(16)),
                    halign=halign, valign="middle")
        return lbl

    def set_scenes(self, scenes, duration=None):
        self.scenes = scenes or []
        self.duration = duration or (self.scenes[-1]["atSec"] if self.scenes else 0.0)
        self._redraw()

    def _redraw(self, *a):
        self.canvas.clear()
        for lbl in self._freq_lbls + self._time_lbls:
            lbl.text = ""
        self._nodes = []
        if len(self.scenes) < 1 or self.width < 80 or self.height < 80:
            return
        beats = [s["beatHz"] for s in self.scenes]
        bmax = max(beats + [NOISE_CAP_HZ, 1.0])
        bmin = min(beats + [0.0])
        pad_l, pad_b, pad_t, pad_r = dp(54), dp(28), dp(12), dp(16)
        x0, y0 = self.x + pad_l, self.y + pad_b
        w, h = self.width - pad_l - pad_r, self.height - pad_b - pad_t
        dur = self.duration or 1.0
        span = (bmax - bmin) or 1.0

        def X(t):
            return x0 + (t / dur) * w

        def Y(b):
            return y0 + ((b - bmin) / span) * h

        pts = []
        for s in self.scenes:
            pts += [X(s["atSec"]), Y(s["beatHz"])]
        if len(self.scenes) == 1:  # single keyframe -> a flat segment
            pts = [x0, Y(beats[0]), x0 + w, Y(beats[0])]

        with self.canvas:
            Color(rgba=C("divider"))
            Line(points=[x0, y0, x0 + w, y0], width=1)              # time axis
            Line(points=[x0, y0, x0, y0 + h], width=1)              # freq axis
            Color(rgba=C("accent_red"))                             # Nova cap
            cap_y = Y(min(NOISE_CAP_HZ, bmax))
            Line(points=[x0, cap_y, x0 + w, cap_y], width=1, dash_offset=4, dash_length=6)
            Color(rgba=C("accent_blue"))                            # beat curve
            Line(points=pts, width=1.6)
            Color(rgba=C("accent_green"))                           # keyframe dots
            for s in self.scenes:
                cx, cy = X(s["atSec"]), Y(s["beatHz"])
                Line(circle=(cx, cy, dp(4)), width=1.4)
                self._nodes.append((cx, cy, s["beatHz"], s["atSec"]))

        # Frequency ticks (left axis)
        nf = len(self._freq_lbls)
        for i, lbl in enumerate(self._freq_lbls):
            frac = i / (nf - 1)
            yy = y0 + frac * h
            lbl.text = f"{bmin + frac * (bmax - bmin):.1f} Hz"
            lbl.text_size = lbl.size
            lbl.pos = (x0 - lbl.width - dp(6), yy - lbl.height / 2)
        # Time ticks (bottom axis)
        nt = len(self._time_lbls)
        for i, lbl in enumerate(self._time_lbls):
            frac = i / (nt - 1)
            xx = x0 + frac * w
            t = frac * dur
            lbl.text = f"{int(t // 60)}:{int(t % 60):02d}"
            lbl.text_size = lbl.size
            lbl.pos = (xx - lbl.width / 2, y0 - lbl.height - dp(6))

    # ---- hover tooltip ----
    def _on_mouse_pos(self, window, pos):
        if not self.get_root_window() or not self._nodes:
            self._hide_tip()
            return
        for (cx, cy, beat, t) in self._nodes:
            wx, wy = self.to_window(cx, cy)
            if abs(wx - pos[0]) <= dp(10) and abs(wy - pos[1]) <= dp(10):
                self._show_tip(beat, t, pos)
                return
        self._hide_tip()

    def _show_tip(self, beat, t, pos):
        from kivy.core.window import Window
        if self._tip is None:
            self._tip = Label(font_size=sp(12), color=C("text_primary"),
                              size_hint=(None, None))
            with self._tip.canvas.before:
                self._tip._c = Color(rgba=C("bg_card_light"))
                self._tip._r = RoundedRectangle(radius=[dp(6)])
            self._tip.bind(pos=self._tip_bg, size=self._tip_bg)
        self._tip.text = f"{beat:.1f} Hz · {int(t // 60)}:{int(t % 60):02d}"
        self._tip.texture_update()
        self._tip.size = (self._tip.texture_size[0] + dp(16), self._tip.texture_size[1] + dp(8))
        self._tip.pos = (pos[0] + dp(12), pos[1] + dp(12))
        if self._tip.parent is None:
            Window.add_widget(self._tip)

    def _tip_bg(self, *a):
        self._tip._r.pos = self._tip.pos
        self._tip._r.size = self._tip.size

    def _hide_tip(self):
        if self._tip is not None and self._tip.parent is not None:
            self._tip.parent.remove_widget(self._tip)


# ----------------------------------------------------------------------------- #
# Helpers: labelled fields, file dialogs, image <-> data-uri
# ----------------------------------------------------------------------------- #
def labelled_field(label, multiline=False, text=""):
    box = BoxLayout(orientation="vertical", size_hint_y=None, spacing=dp(4))
    lbl = Label(text=label, color=C("text_secondary"), font_size=sp(12),
                size_hint_y=None, height=dp(18), halign="left", valign="middle")
    lbl.bind(size=lambda *_: setattr(lbl, "text_size", lbl.size))
    ti = TextInput(
        text=text, multiline=multiline, size_hint_y=None,
        height=dp(84) if multiline else dp(40),
        background_color=C("bg_card_light"), foreground_color=C("text_primary"),
        cursor_color=C("accent_blue"), padding=[dp(10), dp(10)],
    )
    box.height = ti.height + dp(22)
    box.add_widget(lbl)
    box.add_widget(ti)
    return box, ti


def choose_file(on_pick, filters=None, title="Choose file"):
    chooser = FileChooserListView(filters=filters or [], path=default_dir())
    box = BoxLayout(orientation="vertical", spacing=dp(8), padding=dp(8))
    box.add_widget(chooser)
    row = BoxLayout(size_hint_y=None, height=dp(48), spacing=dp(8))
    popup = Popup(title=title, content=box, size_hint=(0.9, 0.9))
    cancel = PillButton(text="Cancel", color_key="button_bg")
    cancel.bind(on_release=lambda *_: popup.dismiss())
    select = PillButton(text="Select", color_key="accent_blue")

    def pick(*a):
        if chooser.selection:
            sel = chooser.selection[0]
            popup.dismiss()
            on_pick(sel)
    select.bind(on_release=pick)
    row.add_widget(cancel)
    row.add_widget(select)
    box.add_widget(row)
    popup.open()


def save_file(on_save, default_name="session.imed", title="Save .imed"):
    chooser = FileChooserListView(path=default_dir(), dirselect=True)
    box = BoxLayout(orientation="vertical", spacing=dp(8), padding=dp(8))
    box.add_widget(chooser)
    name_ti = TextInput(text=default_name, multiline=False, size_hint_y=None, height=dp(40),
                        background_color=C("bg_card_light"), foreground_color=C("text_primary"))
    box.add_widget(name_ti)
    row = BoxLayout(size_hint_y=None, height=dp(48), spacing=dp(8))
    popup = Popup(title=title, content=box, size_hint=(0.9, 0.9))
    cancel = PillButton(text="Cancel", color_key="button_bg")
    cancel.bind(on_release=lambda *_: popup.dismiss())
    save = PillButton(text="Save", color_key="accent_green")

    def do(*a):
        sel = chooser.selection[0] if chooser.selection else chooser.path
        target_dir = os.path.dirname(sel) if os.path.isfile(sel) else sel
        name = name_ti.text.strip() or default_name
        if not name.endswith(".imed"):
            name += ".imed"
        popup.dismiss()
        on_save(os.path.join(target_dir, name))
    save.bind(on_release=do)
    row.add_widget(cancel)
    row.add_widget(save)
    box.add_widget(row)
    popup.open()


def encode_image_data_uri(path, max_px=512, quality=82):
    """Scale + JPEG-encode an image to a base64 data URI for a self-contained .imed."""
    from PIL import Image as PILImage

    img = PILImage.open(path).convert("RGB")
    img.thumbnail((max_px, max_px))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def texture_from_image(value):
    """value may be a data URI or a file path. Returns a Kivy texture or None."""
    try:
        if not value:
            return None
        if value.startswith("data:"):
            head, b64 = value.split(",", 1)
            ext = "jpeg" if "jpeg" in head or "jpg" in head else "png"
            return CoreImage(io.BytesIO(base64.b64decode(b64)), ext=ext).texture
        if os.path.isfile(value):
            return CoreImage(value).texture
    except Exception:
        return None
    return None


def scroll(content_box):
    sv = ScrollView()
    content_box.size_hint_y = None
    content_box.bind(minimum_height=content_box.setter("height"))
    sv.add_widget(content_box)
    return sv


# ----------------------------------------------------------------------------- #
# Modes
# ----------------------------------------------------------------------------- #
class ExtractScreen(Screen):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.controller = None
        self.imed = None
        self.image_uri = None

        body = BoxLayout(orientation="vertical", padding=dp(20), spacing=dp(14))
        body.add_widget(Label(text="Extract", font_size=sp(24), bold=True,
                              color=C("text_primary"), size_hint_y=None, height=dp(34),
                              halign="left", valign="middle"))
        body.children[0].bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        body.add_widget(Label(
            text="Decompose a rendered binaural MP3 into a space-saving .imed session.",
            color=C("text_secondary"), font_size=sp(13), size_hint_y=None, height=dp(20),
            halign="left", valign="middle"))
        body.children[0].bind(size=lambda w, *_: setattr(w, "text_size", w.size))

        pick = PillButton(text="Choose MP3…", color_key="accent_blue")
        pick.bind(on_release=lambda *_: choose_file(
            self._on_mp3, filters=["*.mp3", "*.wav", "*.flac", "*.m4a", "*.ogg"], title="Choose a binaural MP3"))
        body.add_widget(pick)

        self.status = Label(text="", color=C("text_secondary"), font_size=sp(13),
                            size_hint_y=None, height=dp(40), halign="left", valign="top")
        self.status.bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        body.add_widget(self.status)

        self.timeline = BeatTimeline()
        body.add_widget(self.timeline)

        # Metadata form (hidden until an extract succeeds).
        self.form = BoxLayout(orientation="vertical", size_hint_y=None, spacing=dp(10), opacity=0, disabled=True)
        self.form.bind(minimum_height=self.form.setter("height"))
        tbox, self.f_title = labelled_field("Title")
        dbox, self.f_desc = labelled_field("Description", multiline=True)
        cbox, self.f_cat = labelled_field("Category")
        lbox, self.f_slabel = labelled_field("Strength label (e.g. Gentle, Deep)")
        self.form.add_widget(tbox)
        self.form.add_widget(dbox)
        self.form.add_widget(cbox)
        self.form.add_widget(lbox)

        srow = BoxLayout(size_hint_y=None, height=dp(40), spacing=dp(10))
        srow.add_widget(Label(text="Strength", color=C("text_secondary"), font_size=sp(13),
                              size_hint_x=None, width=dp(80), halign="left", valign="middle"))
        self.s_slider = Slider(min=1, max=7, step=1, value=4)
        self.s_val = Label(text="4", color=C("text_primary"), bold=True, font_size=sp(16),
                          size_hint_x=None, width=dp(30))
        self.s_slider.bind(value=lambda _, v: setattr(self.s_val, "text", str(int(v))))
        srow.add_widget(self.s_slider)
        srow.add_widget(self.s_val)
        self.form.add_widget(srow)

        img_row = BoxLayout(size_hint_y=None, height=dp(96), spacing=dp(12))
        self.img_preview = KivyImage(size_hint_x=None, width=dp(96))
        img_btn = PillButton(text="Choose image…", color_key="button_bg")
        img_btn.bind(on_release=lambda *_: choose_file(
            self._on_image, filters=["*.png", "*.jpg", "*.jpeg", "*.webp"], title="Choose a cover image"))
        img_row.add_widget(self.img_preview)
        img_row.add_widget(img_btn)
        self.form.add_widget(img_row)

        self.save_btn = PillButton(text="Save self-contained .imed…", color_key="accent_green")
        self.save_btn.bind(on_release=self._on_save)
        self.form.add_widget(self.save_btn)

        body.add_widget(self.form)
        self.add_widget(scroll(body))

    def _on_mp3(self, path):
        self.status.text = f"Analyzing {os.path.basename(path)}…"
        self.timeline.set_scenes([])
        self._hide_form()

        def work():
            try:
                from engine.binaural_decompose import analyze, spec_to_dict_v2
                spec = analyze(path, name=os.path.splitext(os.path.basename(path))[0])
                imed = spec_to_dict_v2(spec)
                self._done(imed, None)
            except Exception as e:  # IncompatibleTrack, decode errors, missing deps
                self._done(None, f"{type(e).__name__}: {e}")

        threading.Thread(target=work, daemon=True).start()

    @mainthread
    def _done(self, imed, err):
        if err:
            self.status.text = f"[!] {err}"
            return
        self.imed = imed
        meta = imed.get("meta", {})
        gen = imed.get("generation", {})
        scenes = imed.get("entrainment", {}).get("scenes", [])
        self.timeline.set_scenes(scenes, duration=meta.get("durationSec"))
        beds = imed.get("audio", {}).get("beds", [])
        noise = next((b.get("type") for b in beds if b.get("source") == "noise"), "—")
        warn = ("  ⚠ " + "; ".join(gen.get("warnings", []))) if gen.get("warnings") else ""
        self.status.text = (
            f"{len(scenes)} scene(s) · noise: {noise} · "
            f"confidence {int(gen.get('confidence', 0) * 100)}%{warn}"
        )
        self.f_title.text = meta.get("name", "")
        self.f_desc.text = meta.get("description", "") or ""
        self.f_cat.text = meta.get("category") or ""
        self.f_slabel.text = meta.get("strengthLabel") or ""
        self.s_slider.value = meta.get("strength") or 4
        self.image_uri = None
        self.img_preview.texture = None
        self._show_form()

    def _on_image(self, path):
        try:
            self.image_uri = encode_image_data_uri(path)
            self.img_preview.texture = texture_from_image(self.image_uri)
        except Exception as e:
            self.status.text = f"[!] image: {e}"

    def _on_save(self, *a):
        if not self.imed:
            return
        meta = self.imed.setdefault("meta", {})
        meta["name"] = self.f_title.text.strip() or meta.get("name", "Untitled")
        meta["description"] = self.f_desc.text.strip() or None
        meta["category"] = self.f_cat.text.strip() or None
        meta["strengthLabel"] = self.f_slabel.text.strip() or None
        meta["strength"] = int(self.s_slider.value)
        if self.image_uri:
            meta["image"] = self.image_uri
        slug = "".join(ch if ch.isalnum() else "_" for ch in meta["name"].lower()).strip("_") or "session"
        save_file(self._write, default_name=f"{slug}.imed")

    def _write(self, path):
        try:
            with open(path, "w") as fh:
                json.dump(self.imed, fh, indent=2)
            self.status.text = f"Saved → {path}"
            if self.controller:
                self.controller.show_open(self.imed)
        except OSError as e:
            self.status.text = f"[!] save failed: {e}"

    def _show_form(self):
        self.form.opacity = 1
        self.form.disabled = False

    def _hide_form(self):
        self.form.opacity = 0
        self.form.disabled = True


class OpenScreen(Screen):
    """Read-only dose card + beat visualization."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.controller = None
        self.imed = None
        body = BoxLayout(orientation="vertical", padding=dp(20), spacing=dp(14))

        header = BoxLayout(size_hint_y=None, height=dp(120), spacing=dp(16))
        self.cover = KivyImage(size_hint_x=None, width=dp(120))
        meta_col = BoxLayout(orientation="vertical", spacing=dp(6))
        self.title_lbl = Label(text="—", font_size=sp(22), bold=True, color=C("text_primary"),
                              halign="left", valign="middle", size_hint_y=None, height=dp(32))
        self.title_lbl.bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        self.sub_lbl = Label(text="", font_size=sp(13), color=C("text_secondary"),
                            halign="left", valign="top")
        self.sub_lbl.bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        meta_col.add_widget(self.title_lbl)
        meta_col.add_widget(self.sub_lbl)
        header.add_widget(self.cover)
        header.add_widget(meta_col)
        body.add_widget(header)

        self.desc_lbl = Label(text="", font_size=sp(14), color=C("text_secondary"),
                             halign="left", valign="top", size_hint_y=None)
        self.desc_lbl.bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        self.desc_lbl.bind(texture_size=lambda w, v: setattr(w, "height", v[1]))
        body.add_widget(self.desc_lbl)

        body.add_widget(Label(text="Beat over time", color=C("text_muted"), font_size=sp(12),
                             size_hint_y=None, height=dp(18), halign="left", valign="middle"))
        body.children[0].bind(size=lambda w, *_: setattr(w, "text_size", w.size))
        self.timeline = BeatTimeline()
        body.add_widget(self.timeline)

        edit = PillButton(text="Edit", color_key="accent_blue")
        edit.bind(on_release=lambda *_: self.controller and self.controller.show_create(self.imed))
        body.add_widget(edit)

        self.add_widget(scroll(body))

    def load(self, imed):
        self.imed = imed
        meta = imed.get("meta", {})
        scenes = imed.get("entrainment", {}).get("scenes", [])
        self.title_lbl.text = meta.get("name", "—")
        strength = meta.get("strength")
        slabel = meta.get("strengthLabel")
        bits = []
        if meta.get("category"):
            bits.append(meta["category"])
        if strength is not None:
            bits.append(f"strength {strength}" + (f" · {slabel}" if slabel else ""))
        dur = meta.get("durationSec") or 0
        bits.append(f"{int(dur // 60)}:{int(dur % 60):02d}")
        self.sub_lbl.text = "  ·  ".join(bits)
        self.desc_lbl.text = meta.get("description") or ""
        self.cover.texture = texture_from_image(meta.get("image"))
        self.timeline.set_scenes(scenes, duration=dur)


class CreateScreen(Screen):
    """Stub — the editable authoring canvas comes in the next slice."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.controller = None
        box = BoxLayout(orientation="vertical", padding=dp(20), spacing=dp(12))
        box.add_widget(Label(text="Create", font_size=sp(24), bold=True, color=C("text_primary"),
                            size_hint_y=None, height=dp(34)))
        box.add_widget(Label(text="Editable timeline authoring is the next slice.",
                            color=C("text_secondary"), font_size=sp(14)))
        self.add_widget(box)

    def load(self, imed=None):
        self.imed = imed


# ----------------------------------------------------------------------------- #
# Shell
# ----------------------------------------------------------------------------- #
class AdminController:
    def __init__(self, sm, nav, screens):
        self.sm = sm
        self.nav = nav
        self.screens = screens  # ordered names matching nav

    def _goto(self, name):
        self.sm.current = name
        if name in self.screens:
            self.nav.select(self.screens.index(name), fire=False)

    def show_extract(self):
        self._goto("extract")

    def show_open(self, imed):
        self.sm.get_screen("open").load(imed)
        self._goto("open")

    def show_create(self, imed=None):
        self.sm.get_screen("create").load(imed)
        self._goto("create")


def make_admin_root(pulsetto_screen):
    """Combine the Admin modes + the existing Pulsetto screen under one shell."""
    sm = ScreenManager(transition=FadeTransition(duration=0.15))
    extract, opens, create = ExtractScreen(name="extract"), OpenScreen(name="open"), CreateScreen(name="create")
    pulse = Screen(name="pulsetto")
    pulse.add_widget(pulsetto_screen)
    for s in (extract, opens, create, pulse):
        sm.add_widget(s)

    names = ["extract", "open", "create", "pulsetto"]
    nav = SegmentedNav(["Extract", "Open", "Create", "Pulsetto"],
                       on_select=lambda i: setattr(sm, "current", names[i]))
    controller = AdminController(sm, nav, names)
    for s in (extract, opens, create):
        s.controller = controller

    root = BoxLayout(orientation="vertical")
    navbar = BoxLayout(size_hint_y=None, height=dp(56), padding=[dp(16), dp(10)])
    navbar.add_widget(nav)
    root.add_widget(navbar)
    root.add_widget(sm)
    sm.current = "extract"
    return root
