from __future__ import annotations

import argparse
import os
from pathlib import Path
import queue
import sys
import threading
import time

from .client import Broadcaster, destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Broadcast native Xiangqi score files")
    parser.add_argument("url", nargs="?", default="")
    parser.add_argument("--file", action="append", type=Path, default=[])
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--install-protocol", action="store_true")
    args = parser.parse_args()
    if args.install_protocol:
        if os.name != "nt" or not sys.argv[0].endswith(".pyz"):
            parser.error("Download the .pyz application on Windows before registering its links")
        import winreg

        archive = str(Path(sys.argv[0]).resolve())
        executable = str(Path(sys.executable).with_name("pythonw.exe"))
        if not Path(executable).is_file():
            executable = sys.executable
        key_path = r"Software\Classes\lixiangqi-broadcaster"
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, "LiXiangQi Broadcaster")
            winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path + r"\shell\open\command") as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, f'"{executable}" "{archive}" "%1"')
        print("Native broadcaster links registered for this Windows account.")
        return
    if args.headless:
        client = Broadcaster(args.url, os.environ.get("LIXIANGQI_BROADCAST_TOKEN", ""), args.file)
        while True:
            try:
                count = client.tick()
                if count is not None:
                    print(f"Accepted {count} games", flush=True)
            except Exception as error:
                print(str(error), file=sys.stderr, flush=True)
                if args.once:
                    raise SystemExit(1) from error
                time.sleep(5)
            if args.once:
                return
            time.sleep(1)
    else:
        desktop(args.url, args.file)


def desktop(initial_url: str, paths: list[Path]) -> None:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title("LiXiangQi Broadcaster")
    root.minsize(540, 330)
    root.columnconfigure(0, weight=1)
    pane = ttk.Frame(root, padding=16)
    pane.grid(sticky="nsew")
    pane.columnconfigure(0, weight=1)
    url, token = tk.StringVar(value=initial_url), tk.StringVar()
    status = tk.StringVar(value="Choose the round, access token and score files, then start.")
    selected = tk.StringVar(value="\n".join(str(path) for path in paths))
    messages: queue.Queue[str] = queue.Queue()
    stopped = threading.Event()
    stopped.set()
    worker: threading.Thread | None = None

    def choose() -> None:
        nonlocal paths
        names = filedialog.askopenfilenames(filetypes=[("Xiangqi notation", "*.pgn"), ("All files", "*")])
        if names:
            paths = [Path(name) for name in names]
            selected.set("\n".join(names))

    def run(client: Broadcaster) -> None:
        while not stopped.is_set():
            try:
                count = client.tick()
                if count is not None:
                    messages.put(f"Accepted {count} games at {time.strftime('%H:%M:%S')}. Watching for changes.")
            except Exception as error:
                messages.put(str(error))
                stopped.wait(5)
            stopped.wait(1)

    def start() -> None:
        nonlocal worker
        if worker and worker.is_alive():
            return
        try:
            client = Broadcaster(url.get(), token.get().strip(), list(paths))
            if not paths:
                raise ValueError("Choose at least one score file")
            destination(url.get())
        except ValueError as error:
            messagebox.showerror("Cannot start broadcasting", str(error))
            return
        status.set(f"Broadcasting to {client.origin}, round {client.round_id}")
        stopped.clear()
        worker = threading.Thread(target=run, args=(client,), daemon=True)
        worker.start()

    def stop() -> None:
        stopped.set()
        status.set("Stopping. No further uploads will start.")

    def poll() -> None:
        while not messages.empty():
            status.set(messages.get_nowait())
        root.after(200, poll)

    for label, variable, hidden in [("Broadcast round URL", url, False), ("Access token (study:write)", token, True)]:
        ttk.Label(pane, text=label).grid(sticky="w", pady=(8, 2))
        ttk.Entry(pane, textvariable=variable, show="*" if hidden else "", width=70).grid(sticky="ew")
    ttk.Button(pane, text="Choose score files…", command=choose).grid(sticky="w", pady=10)
    ttk.Label(pane, textvariable=selected, wraplength=560).grid(sticky="w")
    buttons = ttk.Frame(pane)
    buttons.grid(sticky="w", pady=10)
    ttk.Button(buttons, text="Start", command=start).pack(side="left")
    ttk.Button(buttons, text="Stop", command=stop).pack(side="left", padx=8)
    ttk.Label(pane, textvariable=status, wraplength=560).grid(sticky="w", pady=8)
    root.protocol("WM_DELETE_WINDOW", lambda: (stopped.set(), root.destroy()))
    poll()
    root.mainloop()


if __name__ == "__main__":
    main()
