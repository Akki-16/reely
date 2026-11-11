"""Reely backend entry point (used by the Tauri sidecar and for dev).

    reely-backend --port 8765 [--data-root /path/to/clinics]
Prints "READY <port>" on stdout once the API answers.
"""
import argparse
import os
import sys
import threading
import time
import urllib.request


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--data-root", default=None)
    args = ap.parse_args()
    if args.data_root:
        os.environ["REEL_DATA_ROOT"] = args.data_root

    import socket
    port = args.port
    if not port:
        with socket.socket() as s:
            s.bind((args.host, 0)); port = s.getsockname()[1]

    import uvicorn
    from app import app  # noqa: E402  (imports config → resolves paths)

    def announce():
        url = f"http://{args.host}:{port}/api/settings"
        for _ in range(200):
            try:
                urllib.request.urlopen(url, timeout=1)
                print(f"READY {port}", flush=True)
                return
            except Exception:
                time.sleep(0.25)
        print("READY_TIMEOUT", flush=True)

    threading.Thread(target=announce, daemon=True).start()
    uvicorn.run(app, host=args.host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
