"""Own a child process tree; closing the UI cannot orphan mining engines."""

from __future__ import annotations
import argparse
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

import psutil


def windows_job():
    if os.name != "nt":
        return None

    class IO(ctypes.Structure):
        _fields_ = [
            (n, ctypes.c_ulonglong)
            for n in (
                "ReadOperationCount",
                "WriteOperationCount",
                "OtherOperationCount",
                "ReadTransferCount",
                "WriteTransferCount",
                "OtherTransferCount",
            )
        ]

    class Basic(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class Extended(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", Basic),
            ("IoInfo", IO),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    handle = kernel.CreateJobObjectW(None, None)
    info = Extended()
    info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (
        not handle
        or not kernel.SetInformationJobObject(
            handle, 9, ctypes.byref(info), ctypes.sizeof(info)
        )
        or not kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess())
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    # Keep this handle open until supervisor exit. Windows then kills descendants,
    # including grandchildren whose immediate parent has already exited.
    return handle


def stop_tree(process):
    try:
        parent = psutil.Process(process.pid)
        children = parent.children(recursive=True)
        parent.suspend()  # Prevent new children during enumeration/termination.
        children = parent.children(recursive=True)
    except psutil.NoSuchProcess:
        return
    for item in [*reversed(children), parent]:
        try:
            item.kill()
        except psutil.NoSuchProcess:
            pass
    psutil.wait_procs([*children, parent], timeout=3)
    process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--record", type=Path, required=True)
    parser.add_argument("--protected", action="store_true")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    a = parser.parse_args()
    argv = a.command[1:] if a.command[:1] == ["--"] else a.command
    if not argv:
        return 2
    job_handle = windows_job()
    record = json.loads(a.record.read_text(encoding="utf-8"))
    if not a.protected:
        # Discovery uses normal priority plus explicit engine HighQoS (set at
        # engine launch because QoS is not inherited). Other stages remain
        # background work. Children inherit this scheduling priority.
        discovery = record["name"] == "discovery"
        if os.name == "nt":
            psutil.Process().nice(
                psutil.NORMAL_PRIORITY_CLASS
                if discovery
                else psutil.BELOW_NORMAL_PRIORITY_CLASS
            )
        elif not discovery:
            os.nice(5)
    stop = threading.Event()

    def reader():
        line = sys.stdin.readline()
        if not a.protected:  # EOF also means the owning GUI disappeared.
            stop.set()

    threading.Thread(target=reader, daemon=True).start()
    record.update(pid=os.getpid(), created=psutil.Process().create_time())
    a.record.write_text(json.dumps(record), encoding="utf-8")
    child = None
    code = 1
    with a.log.open("ab", buffering=0) as log:
        try:
            child = subprocess.Popen(
                argv,
                stdout=log,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                start_new_session=os.name != "nt",
            )
            while child.poll() is None:
                if stop.wait(0.1):
                    stop_tree(child)
                    code = 130
                    break
            else:
                code = child.returncode
        except Exception as exc:
            log.write((f"\nSupervisor error: {exc}\n").encode("utf-8"))
        finally:
            if child and child.poll() is None:
                stop_tree(child)
            record.update(code=code, finished=time.time())
            temp = a.record.with_suffix(".tmp")
            temp.write_text(json.dumps(record), encoding="utf-8")
            temp.replace(a.record)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
