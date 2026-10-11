import ctypes
import json
import select
import subprocess
import sys


class Info(ctypes.Structure):
    _fields_ = [("prefix", ctypes.c_uint32 * 12), ("comm", ctypes.c_char * 16),
                ("name", ctypes.c_char * 32), ("nfiles", ctypes.c_uint32),
                ("pgid", ctypes.c_uint32), ("pjobc", ctypes.c_uint32),
                ("e_tdev", ctypes.c_uint32), ("e_tpgid", ctypes.c_uint32),
                ("nice", ctypes.c_int32), ("sec", ctypes.c_uint64),
                ("usec", ctypes.c_uint64)]


lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)


def identity(pid):
    value = Info()
    count = lib.proc_pidinfo(pid, 3, 0, ctypes.byref(value), ctypes.sizeof(value))
    if count != ctypes.sizeof(value) or value.sec == 0:
        raise RuntimeError("identity_unverified")
    return (pid, value.sec, value.usec)


if len(sys.argv) > 1:
    pid = int(sys.argv[1])
    before = identity(pid)
    queue = select.kqueue()
    try:
        queue.control([select.kevent(pid, filter=select.KQ_FILTER_PROC,
                      flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                      fflags=select.KQ_NOTE_EXIT)], 0, 0)
        if identity(pid) != before:
            raise RuntimeError("registration_identity_changed")
        print("armed", flush=True)
        events = queue.control(None, 1, 5)
        assert len(events) == 1
        event = events[0]
        assert event.ident == pid and event.filter == select.KQ_FILTER_PROC
        assert event.fflags & select.KQ_NOTE_EXIT
        assert not event.flags & select.KQ_EV_ERROR
        print(json.dumps({"result": "observed_exact_registered_exit",
                          "birth_identity_checked_before_and_after_attach": True,
                          "event": "EVFILT_PROC:NOTE_EXIT",
                          "not_pid_absence": True}), flush=True)
    finally:
        queue.close()
else:
    child = subprocess.Popen([sys.executable, "-c", "import sys;sys.stdin.read()"],
                             stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
    witness = None
    try:
        witness = subprocess.Popen([sys.executable, __file__, str(child.pid)],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True)
        armed = witness.stdout.readline().strip()
        if armed != "armed":
            raise RuntimeError(witness.stderr.read())
        child.stdin.close()
        result = witness.stdout.readline().strip()
        assert child.wait(timeout=5) == 0
        assert witness.wait(timeout=5) == 0
        print(json.dumps({"scope": "Supplemental local OS lifetime research only",
                          "result": json.loads(result), "owned_processes_exited": True,
                          "limitations": ["No durable witness proof, Native process, or owner integration",
                                          "No crash registration gap or PID reuse forced",
                                          "No production restart acceptance"]}))
    finally:
        for process in [child, witness]:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait(timeout=5)
