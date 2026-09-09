"""Local dev server that disables caching, so edits always show up on reload."""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # Ohne diesen Eintrag liefert der Server das Manifest als
    # application/octet-stream aus und der Browser lehnt es ab.
    extensions_map = dict(
        http.server.SimpleHTTPRequestHandler.extensions_map,
        **{".webmanifest": "application/manifest+json"}
    )

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    http.server.test(HandlerClass=NoCacheHandler, port=port)
