# -*- coding: utf-8 -*-
"""Erzeugt die App-Icons für die PWA.

Die Icons müssen PNG sein: Android holt sie aus dem Manifest, iOS aus dem
apple-touch-icon, und beide nehmen kein SVG zuverlässig an. Statt eine
Bildbibliothek vorauszusetzen, zeichnet dieses Skript die paar Formen selbst
und schreibt die Datei mit dem PNG-Grundgerüst aus zlib und struct.

Aufruf aus dem Projektverzeichnis:

    python werkzeuge/icons_bauen.py

Neu erzeugen muss man sie nur, wenn sich das Motiv ändert.
"""
import math
import os
import struct
import zlib

# Die Farben der Spielesammlung: Filzgrün und das Gold der Akzente.
FILZ_INNEN = (0x14, 0x7A, 0x49)
FILZ_AUSSEN = (0x06, 0x33, 0x1E)
GOLD = (0xF2, 0xC9, 0x4C)

ZIEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")


def mische(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def schreibe_png(pfad, breite, hoehe, pixel):
    """Schreibt RGB-Pixel als PNG. `pixel` ist eine Liste von Zeilen."""
    roh = bytearray()
    for zeile in pixel:
        roh.append(0)                      # Filtertyp 0: keiner
        for r, g, b in zeile:
            roh += bytes((r, g, b))

    def block(typ, daten):
        return (struct.pack(">I", len(daten)) + typ + daten
                + struct.pack(">I", zlib.crc32(typ + daten) & 0xFFFFFFFF))

    kopf = struct.pack(">IIBBBBB", breite, hoehe, 8, 2, 0, 0, 0)
    with open(pfad, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(block(b"IHDR", kopf))
        f.write(block(b"IDAT", zlib.compress(bytes(roh), 9)))
        f.write(block(b"IEND", b""))


def im_kapsel(x, y, links, rechts, oben, unten):
    """Liegt der Punkt in einem Rechteck mit halbrunden Enden?"""
    r = (unten - oben) / 2
    mitte_y = (oben + unten) / 2
    if links + r <= x <= rechts - r:
        return oben <= y <= unten
    cx = links + r if x < links + r else rechts - r
    return (x - cx) ** 2 + (y - mitte_y) ** 2 <= r * r
def im_kreis(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def im_kreuz(x, y, cx, cy, arm, dick):
    return ((abs(x - cx) <= arm and abs(y - cy) <= dick) or
            (abs(y - cy) <= arm and abs(x - cx) <= dick))


def zeichne(groesse):
    """Ein Gamepad in Gold auf Filzgrün – dasselbe Motiv wie die Startseite."""
    n = groesse
    bild = []
    # Das Motiv bleibt in der inneren Zone: Android schneidet bei runden oder
    # tropfenförmigen Masken bis zu zehn Prozent vom Rand weg.
    m = n / 2.0
    breite = n * 0.60
    hoehe = n * 0.34
    links, rechts = m - breite / 2, m + breite / 2
    oben, unten = m - hoehe / 2, m + hoehe / 2

    kreuz_x = links + hoehe * 0.52
    knopf_x = rechts - hoehe * 0.50
    knopf_r = hoehe * 0.155

    # Vierfach abgetastet: Ohne das werden die runden Kanten des Gehäuses
    # bei 192 Pixeln sichtbar treppig.
    proben = [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)]

    for y in range(n):
        zeile = []
        for x in range(n):
            # Hintergrund: heller in der Mitte, dunkel zum Rand – wie der Filz.
            d = math.hypot(x + 0.5 - m, y + 0.5 - m) / (n * 0.72)
            grund = mische(FILZ_INNEN, FILZ_AUSSEN, min(1.0, d))

            gold_anteil = 0
            for dx, dy in proben:
                px, py = x + dx, y + dy
                if not im_kapsel(px, py, links, rechts, oben, unten):
                    continue
                # Steuerkreuz links, zwei Knöpfe rechts – als Aussparung.
                if im_kreuz(px, py, kreuz_x, m, hoehe * 0.30, hoehe * 0.10):
                    continue
                if im_kreis(px, py, knopf_x - knopf_r * 1.5, m + knopf_r * 1.0, knopf_r):
                    continue
                if im_kreis(px, py, knopf_x + knopf_r * 1.0, m - knopf_r * 1.2, knopf_r):
                    continue
                gold_anteil += 1

            zeile.append(mische(grund, GOLD, gold_anteil / len(proben)))
        bild.append(zeile)
    return bild


if __name__ == "__main__":
    os.makedirs(ZIEL, exist_ok=True)
    for groesse in (192, 512, 180):
        pfad = os.path.join(ZIEL, "icon-%d.png" % groesse)
        schreibe_png(pfad, groesse, groesse, zeichne(groesse))
        print("%s (%d Byte)" % (pfad, os.path.getsize(pfad)))
