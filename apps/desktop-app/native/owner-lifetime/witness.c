/* Evidence-only macOS observer. No process launch, signals, owner reads or repair. */
#if !defined(__APPLE__) || !defined(__arm64__)
#error owner_lifetime_requires_darwin_arm64
#endif
#include <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <libproc.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/event.h>
#include <sys/proc.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <time.h>
#include <unistd.h>
#include <dirent.h>

#define GENERATION_FD 3
#define STORE_FD 4
#define MAX_RECORD 4096
#define MAX_CONTROL 256
#define EXIT_SECONDS 15

struct lifetime {
    pid_t pid;
    const char *role;
    char boot[65], start[65], registration[65], exit_hash[65];
    bool accepted, exited;
};
static struct lifetime app = { .role = "app" }, child = { .role = "child" };
static char context_hash[65], generation_path[PATH_MAX];
static struct stat generation_stat, store_stat, context_stat;
static int queue_fd = -1;
static bool sealed, seal_command, input_eof;
static struct timespec app_exit_time;

static bool write_all(int fd, const char *bytes, size_t size) {
    while (size) {
        ssize_t n = write(fd, bytes, size);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
        bytes += n; size -= (size_t)n;
    }
    return true;
}
static int failed(void) {
    (void)write_all(STDOUT_FILENO, "FAILED\n", 7);
    if (queue_fd >= 0) close(queue_fd);
    return 1;
}
static void sha256(const void *bytes, size_t size, char hash[65]) {
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(bytes, (CC_LONG)size, digest);
    for (size_t i = 0; i < sizeof(digest); i++) snprintf(hash + i * 2, 3, "%02x", digest[i]);
    hash[64] = '\0';
}
static bool hash_text(const char *text) {
    if (strlen(text) != 64) return false;
    for (size_t i = 0; i < 64; i++)
        if (!(text[i] >= '0' && text[i] <= '9') && !(text[i] >= 'a' && text[i] <= 'f')) return false;
    return true;
}
static bool decimal(const char *text, uintmax_t *value) {
    if (!*text || (text[0] == '0' && text[1])) return false;
    for (const char *p = text; *p; p++) if (*p < '0' || *p > '9') return false;
    errno = 0; char *end;
    *value = strtoumax(text, &end, 10);
    return !errno && !*end;
}
static bool parse_pid(const char *text, pid_t *pid) {
    uintmax_t value;
    if (!decimal(text, &value) || !value || value > INT_MAX || value == (uintmax_t)getpid()) return false;
    *pid = (pid_t)value;
    return true;
}
static bool same_inode(const struct stat *a, const struct stat *b) {
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_uid == b->st_uid &&
        a->st_gid == b->st_gid && a->st_mode == b->st_mode && a->st_nlink == b->st_nlink;
}
static bool file_same(const struct stat *a, const struct stat *b) {
    return same_inode(a, b) && a->st_size == b->st_size &&
        a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec && a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
        a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec && a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec;
}
static bool directory(const struct stat *s) {
    return S_ISDIR(s->st_mode) && s->st_uid == getuid() && (s->st_mode & 07777) == 0700;
}
static bool same_directory(const struct stat *a, const struct stat *b) {
    // Publishing generation files or changing store children may change nlink.
    // Ownership, mode, device and the opened directory inode must stay fixed.
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_uid == b->st_uid &&
        a->st_gid == b->st_gid && a->st_mode == b->st_mode;
}
static bool record(const struct stat *s) {
    return S_ISREG(s->st_mode) && s->st_uid == getuid() && s->st_nlink == 1 &&
        (s->st_mode & 07777) == 0600 && s->st_size >= 0 && s->st_size <= MAX_RECORD;
}
static bool check_directories(void) {
    struct stat g, path, root;
    return fstat(GENERATION_FD, &g) == 0 && directory(&g) && same_directory(&generation_stat, &g) &&
        lstat(generation_path, &path) == 0 && same_directory(&g, &path) &&
        fstat(STORE_FD, &root) == 0 && directory(&root) && same_directory(&store_stat, &root);
}
static bool uuid_name(const char *name) {
    if (strlen(name) != 36) return false;
    for (size_t i = 0; i < 36; i++) {
        if (i == 8 || i == 13 || i == 18 || i == 23) { if (name[i] != '-') return false; }
        else if (!(name[i] >= '0' && name[i] <= '9') && !(name[i] >= 'a' && name[i] <= 'f') &&
                 !(name[i] >= 'A' && name[i] <= 'F')) return false;
    }
    return true;
}
static bool initial_context(uintmax_t dev, uintmax_t ino) {
    if (fstat(GENERATION_FD, &generation_stat) || fstat(STORE_FD, &store_stat) ||
        !directory(&generation_stat) || !directory(&store_stat) ||
        (uintmax_t)store_stat.st_dev != dev || (uintmax_t)store_stat.st_ino != ino ||
        generation_stat.st_dev != store_stat.st_dev || same_directory(&generation_stat, &store_stat) ||
        fcntl(GENERATION_FD, F_GETPATH, generation_path) < 0) return false;
    const char *name = strrchr(generation_path, '/');
    if (!name || !uuid_name(name + 1) || !check_directories()) return false;
    int directory_fd = openat(GENERATION_FD, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (directory_fd < 0) return false;
    DIR *entries = fdopendir(directory_fd);
    if (!entries) { close(directory_fd); return false; }
    bool valid = true; size_t count = 0; struct dirent *entry;
    errno = 0;
    while ((entry = readdir(entries))) {
        if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
        if (strcmp(entry->d_name, "context.json")) valid = false;
        count++;
        errno = 0;
    }
    if (errno || count != 1) valid = false;
    closedir(entries);
    if (!valid) return false;
    int fd = openat(GENERATION_FD, "context.json", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) return false;
    struct stat after, path; char bytes[MAX_RECORD + 1], actual[65];
    valid = !fstat(fd, &context_stat) && record(&context_stat) && context_stat.st_size > 0;
    size_t used = 0;
    while (valid && used < sizeof(bytes)) {
        ssize_t n = read(fd, bytes + used, sizeof(bytes) - used);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) { valid = false; break; }
        if (!n) break;
        used += (size_t)n;
    }
    if (!valid || used != (size_t)context_stat.st_size || used > MAX_RECORD || !used || bytes[used - 1] != '\n') valid = false;
    if (valid) {
        sha256(bytes, used, actual);
        valid = !strcmp(actual, context_hash) && !fstat(fd, &after) && file_same(&context_stat, &after) &&
            !fstatat(GENERATION_FD, "context.json", &path, AT_SYMLINK_NOFOLLOW) && file_same(&after, &path) &&
            !fsync(fd) && !fsync(GENERATION_FD) && check_directories();
    }
    if (close(fd)) valid = false;
    return valid;
}
static bool context_unchanged(void) {
    struct stat now;
    return check_directories() && !fstatat(GENERATION_FD, "context.json", &now, AT_SYMLINK_NOFOLLOW) &&
        file_same(&context_stat, &now);
}
static bool publish(const char *name, const char *bytes, char hash[65]) {
    size_t length = strlen(bytes);
    if (!length || length > MAX_RECORD || !context_unchanged()) return false;
    int fd = openat(GENERATION_FD, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) return false;
    struct stat before, after, path;
    bool ok = !fstat(fd, &before) && record(&before) && before.st_size == 0 &&
        write_all(fd, bytes, length) && !fstat(fd, &after) && record(&after) &&
        same_inode(&before, &after) && after.st_size == (off_t)length && !fsync(fd) &&
        !fstatat(GENERATION_FD, name, &path, AT_SYMLINK_NOFOLLOW) && file_same(&after, &path) &&
        !fsync(GENERATION_FD) && context_unchanged();
    if (close(fd)) ok = false;
    if (ok) sha256(bytes, length, hash);
    return ok;
}
static bool sample(const struct lifetime *life) {
    struct proc_bsdinfo info; memset(&info, 0, sizeof(info));
    if (proc_pidinfo(life->pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info) ||
        info.pbi_pid != (uint32_t)life->pid || info.pbi_uid != getuid() || info.pbi_status == SZOMB ||
        !info.pbi_start_tvsec || info.pbi_start_tvusec >= 1000000) return false;
    char token[64], boot[128], boot_hash[65], start_hash[65]; size_t size = sizeof(boot);
    if (sysctlbyname("kern.bootsessionuuid", boot, &size, NULL, 0) || !size || size > sizeof(boot) ||
        boot[size - 1] != '\0' || strlen(boot) != 36 || !uuid_name(boot)) return false;
    int n = snprintf(token, sizeof(token), "%" PRIu64 ":%" PRIu64,
        info.pbi_start_tvsec, info.pbi_start_tvusec);
    if (n <= 0 || (size_t)n >= sizeof(token)) return false;
    sha256(boot, strlen(boot), boot_hash); sha256(token, (size_t)n, start_hash);
    return !strcmp(boot_hash, life->boot) && !strcmp(start_hash, life->start);
}
static bool no_early_exit(void) {
    struct kevent early[4]; struct timespec zero = {0, 0};
    int n = kevent(queue_fd, NULL, 0, early, 4, &zero);
    if (n < 0) return false;
    for (int i = 0; i < n; i++)
        if (early[i].filter != EVFILT_READ || early[i].ident != STDIN_FILENO || early[i].flags & EV_ERROR) return false;
    return true;
}
static bool attach(struct lifetime *life) {
    if (sealed || !sample(life)) return false;
    struct kevent change, receipt;
    EV_SET(&change, life->pid, EVFILT_PROC, EV_ADD | EV_ENABLE | EV_ONESHOT | EV_RECEIPT, NOTE_EXIT, 0, life);
    struct timespec zero = {0, 0};
    int n = kevent(queue_fd, &change, 1, &receipt, 1, &zero);
    if (n != 1 || receipt.ident != (uintptr_t)life->pid || receipt.filter != EVFILT_PROC ||
        receipt.udata != life || !(receipt.flags & EV_ERROR) || receipt.data != 0 || !sample(life)) return false;
    // No receipt, NOTE_EXIT or any queued process change may be turned into an ACK.
    if (!no_early_exit()) return false;
    char bytes[512], name[32], acknowledgement[128];
    snprintf(bytes, sizeof(bytes), "V1\tregistration\t%s\t%d\t%s\t%s\t%s\n", life->role, life->pid, life->boot, life->start, context_hash);
    snprintf(name, sizeof(name), "%s.registration", life->role);
    if (!publish(name, bytes, life->registration)) return false;
    // Poll once more before ACK so an exit while flushing stays conservative.
    if (!no_early_exit() || !sample(life)) return false;
    life->accepted = true;
    int length = snprintf(acknowledgement, sizeof(acknowledgement), "READY\t%s\t%s\n", life->role, life->registration);
    if (!write_all(STDOUT_FILENO, acknowledgement, (size_t)length) && errno != EPIPE) return false;
    return true;
}
static bool control(char *line) {
    if (sealed) return false;
    if (!strcmp(line, "SEAL")) {
        if (seal_command) return false;
        seal_command = true; sealed = true; return true;
    }
    if (child.accepted || strncmp(line, "CHILD\t", 6)) return false;
    char *pid = line + 6, *boot = strchr(pid, '\t');
    if (!boot) return false;
    *boot++ = '\0'; char *start = strchr(boot, '\t');
    if (!start) return false;
    *start++ = '\0';
    if (!parse_pid(pid, &child.pid) || child.pid == app.pid || !hash_text(boot) || !hash_text(start)) return false;
    memcpy(child.boot, boot, 65); memcpy(child.start, start, 65);
    return attach(&child);
}
static bool read_controls(void) {
    static char line[MAX_CONTROL + 1]; static size_t used;
    // A bounded drain prevents a malicious writer from starving process events.
    for (size_t consumed = 0; consumed < 1024; consumed++) {
        char byte; ssize_t n = read(STDIN_FILENO, &byte, 1);
        if (n < 0 && errno == EINTR) { consumed--; continue; }
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return true;
        if (n < 0) return false;
        if (!n) { input_eof = true; sealed = true; return !used; }
        if (byte == '\n') {
            if (used + 1 > MAX_CONTROL) return false;
            line[used] = '\0'; if (!control(line)) return false; used = 0;
        } else {
            if (byte < 0x20 || byte > 0x7e) { if (byte != '\t') return false; }
            if (used >= MAX_CONTROL - 1) return false;
            line[used++] = byte;
        }
    }
    return false;
}
static bool observed_exit(const struct kevent *event) {
    struct lifetime *life = event->udata;
    if ((life != &app && life != &child) || !life->accepted || life->exited ||
        event->ident != (uintptr_t)life->pid || event->filter != EVFILT_PROC ||
        event->flags & EV_ERROR || !(event->fflags & NOTE_EXIT)) return false;
    if (life == &app) {
        sealed = true;
        if (clock_gettime(CLOCK_MONOTONIC, &app_exit_time)) return false;
    }
    char bytes[512], name[32];
    snprintf(bytes, sizeof(bytes), "V1\texit\t%s\t%d\t%s\t%s\t%s\n", life->role, life->pid, life->boot, life->start, context_hash);
    snprintf(name, sizeof(name), "%s.exit", life->role);
    if (!publish(name, bytes, life->exit_hash)) return false;
    life->exited = true;
    return true;
}
static bool terminal(void) {
    char bytes[512], hash[65];
    snprintf(bytes, sizeof(bytes), "V1\tterminal\t%s\t%s\t%s\t%s\t%s\n", context_hash,
        app.registration, app.exit_hash, child.accepted ? child.registration : "-", child.accepted ? child.exit_hash : "-");
    return publish("terminal", bytes, hash);
}
int main(int argc, char **argv) {
    if (signal(SIGPIPE, SIG_IGN) == SIG_ERR) return 1;
    umask(0077);
    uintmax_t dev, ino;
    if (argc != 8 || strcmp(argv[1], "--v1") || !parse_pid(argv[2], &app.pid) ||
        !hash_text(argv[3]) || !hash_text(argv[4]) || !hash_text(argv[5]) ||
        !decimal(argv[6], &dev) || !decimal(argv[7], &ino)) return failed();
    memcpy(app.boot, argv[3], 65); memcpy(app.start, argv[4], 65); memcpy(context_hash, argv[5], 65);
    if (!initial_context(dev, ino)) return failed();
    queue_fd = kqueue();
    if (queue_fd < 0 || !attach(&app)) return failed();
    int flags = fcntl(STDIN_FILENO, F_GETFL);
    if (flags < 0 || fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK) < 0) return failed();
    // Register stdin only after the app attach polls: stdin readiness is not an early process exit.
    struct kevent change, receipt; struct timespec zero = {0, 0};
    EV_SET(&change, STDIN_FILENO, EVFILT_READ, EV_ADD | EV_ENABLE | EV_RECEIPT, 0, 0, NULL);
    if (kevent(queue_fd, &change, 1, &receipt, 1, &zero) != 1 || receipt.ident != STDIN_FILENO ||
        receipt.filter != EVFILT_READ || !(receipt.flags & EV_ERROR) || receipt.data) return failed();
    for (;;) {
        if (app.exited && sealed && (!child.accepted || child.exited)) {
            bool ok = terminal(); close(queue_fd); queue_fd = -1; return ok ? 0 : failed();
        }
        struct timespec timeout, *wait = NULL;
        if (app.exited) {
            struct timespec now;
            if (clock_gettime(CLOCK_MONOTONIC, &now)) return failed();
            int64_t left = (int64_t)EXIT_SECONDS * 1000000000 -
                ((int64_t)(now.tv_sec - app_exit_time.tv_sec) * 1000000000 + now.tv_nsec - app_exit_time.tv_nsec);
            if (left <= 0) return failed();
            timeout.tv_sec = (time_t)(left / 1000000000); timeout.tv_nsec = (long)(left % 1000000000); wait = &timeout;
        }
        struct kevent events[4];
        int n = kevent(queue_fd, NULL, 0, events, 4, wait);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 || (!n && app.exited)) return failed();
        // A collected app exit closes admission before processing any pending CHILD.
        for (int i = 0; i < n; i++) if (events[i].filter != EVFILT_READ && !observed_exit(&events[i])) return failed();
        for (int i = 0; i < n; i++) if (events[i].filter == EVFILT_READ) {
            if (events[i].ident != STDIN_FILENO || events[i].flags & EV_ERROR || !read_controls()) return failed();
            if (input_eof) {
                EV_SET(&change, STDIN_FILENO, EVFILT_READ, EV_DELETE, 0, 0, NULL);
                if (kevent(queue_fd, &change, 1, NULL, 0, NULL) < 0) return failed();
            }
        }
    }
}
