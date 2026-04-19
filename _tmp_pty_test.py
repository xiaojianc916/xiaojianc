import os, pty, select, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execv('/bin/bash', ['/bin/bash', '-il'])

def read_for(seconds):
    end = time.time() + seconds
    buf = ''
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if fd in r:
            data = os.read(fd, 4096).decode('utf-8', 'replace')
            sys.stdout.write(data)
            sys.stdout.flush()
            buf += data
    return buf

read_for(1.2)
run_id='testrun'
start=f"\\x1fSH_EDITOR_RUN_BEGIN:{run_id}\\x1f"
endprefix=f"\\x1fSH_EDITOR_RUN_END:{run_id}:"
cmd=(
    "printf '{start}'; bash -lc \"echo Hello SH Editor\" > >(tee /tmp/out1) 2> >(tee -a /tmp/out1 >&2); "
    "__sh_editor_status=$?; printf '%s' \"$__sh_editor_status\" > /tmp/status1; "
    "printf '{endprefix}%s\\x1f' \"$__sh_editor_status\"; unset __sh_editor_status"
).format(start=start, endprefix=endprefix)
print('\\n---SEND---')
print(cmd)
os.write(fd, (cmd + '\\n').encode())
read_for(5)
print('\\n---DONE---')
