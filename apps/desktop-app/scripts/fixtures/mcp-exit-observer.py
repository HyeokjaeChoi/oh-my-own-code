"""TEST ONLY: observe one live synthetic MCP PID with macOS kernel NOTE_EXIT."""
from contextlib import closing
import json
import select
import sys


def observe(pid, timeout):
    if sys.platform != "darwin" or pid <= 0 or not 0 < timeout <= 60:
        raise ValueError("Unsupported bounded observer")
    with closing(select.kqueue()) as queue:
        event = select.kevent(
            pid,
            filter=select.KQ_FILTER_PROC,
            flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
            fflags=select.KQ_NOTE_EXIT,
        )
        queue.control([event], 0, 0)
        print(json.dumps({"event": "READY", "pid": pid}), flush=True)
        events = queue.control([], 1, timeout)
        if not (
            len(events) == 1
            and events[0].ident == pid
            and events[0].filter == select.KQ_FILTER_PROC
            and events[0].fflags & select.KQ_NOTE_EXIT
            and not events[0].flags & select.KQ_EV_ERROR
        ):
            raise RuntimeError("Exact kernel exit not observed")
        print(json.dumps({"event": "NOTE_EXIT", "pid": pid, "filter": "EVFILT_PROC"}), flush=True)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("Expected PID and timeout")
        observe(int(sys.argv[1]), float(sys.argv[2]))
    except Exception:
        print(json.dumps({"event": "FAILED"}), flush=True)
        sys.exit(1)
