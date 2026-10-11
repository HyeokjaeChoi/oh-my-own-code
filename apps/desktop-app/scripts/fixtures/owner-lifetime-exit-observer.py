"""Probe-only helper exit observation; never used by production recovery."""
import ctypes
import hashlib
import json
import select
import sys


class Info(ctypes.Structure):
    _fields_ = [
        ("prefix", ctypes.c_uint32 * 12), ("comm", ctypes.c_char * 16),
        ("name", ctypes.c_char * 32), ("nfiles", ctypes.c_uint32),
        ("pgid", ctypes.c_uint32), ("pjobc", ctypes.c_uint32),
        ("e_tdev", ctypes.c_uint32), ("e_tpgid", ctypes.c_uint32),
        ("nice", ctypes.c_int32), ("sec", ctypes.c_uint64),
        ("usec", ctypes.c_uint64),
    ]


assert len(sys.argv) in (2, 3)
# Default preserves the existing lifetime acceptance. The copied-reader probe
# has several complete resource inventories before its executor can start.
timeout = 120
if len(sys.argv) == 3:
    assert sys.argv[2].isascii() and sys.argv[2].isdecimal()
    timeout = int(sys.argv[2])
    assert 1 <= timeout <= 1200
expected = json.loads(sys.argv[1])
assert set(expected) == {"pid", "platform", "bootId", "startToken"}
assert expected["platform"] == "darwin" and 0 < expected["pid"] < 2**31
libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
libc = ctypes.CDLL(None, use_errno=True)


def sample():
    value = Info()
    n = libproc.proc_pidinfo(expected["pid"], 3, 0, ctypes.byref(value), ctypes.sizeof(value))
    assert n == ctypes.sizeof(value) and value.sec > 0
    boot = ctypes.create_string_buffer(128)
    length = ctypes.c_size_t(len(boot))
    assert libc.sysctlbyname(b"kern.bootsessionuuid", boot, ctypes.byref(length), None, 0) == 0
    sha = lambda data: hashlib.sha256(data).hexdigest()
    actual = {
        "pid": expected["pid"], "platform": "darwin",
        "bootId": sha(boot.value),
        "startToken": sha((str(value.sec) + ":" + str(value.usec)).encode("ascii")),
    }
    assert actual == expected


sample()
queue = select.kqueue()
try:
    queue.control([select.kevent(expected["pid"], filter=select.KQ_FILTER_PROC,
                   flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                   fflags=select.KQ_NOTE_EXIT)], 0, 0)
    sample()
    assert not queue.control(None, 1, 0)
    print("READY", flush=True)
    events = queue.control(None, 1, timeout)
    assert len(events) == 1
    event = events[0]
    assert event.ident == expected["pid"] and event.filter == select.KQ_FILTER_PROC
    assert event.fflags & select.KQ_NOTE_EXIT and not event.flags & select.KQ_EV_ERROR
    print("EXIT", flush=True)
finally:
    queue.close()
