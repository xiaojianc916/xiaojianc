import pexpect, sys
child = pexpect.spawn('/bin/bash', ['-il'], encoding='utf-8', timeout=10)
child.logfile = sys.stdout
child.expect([r'[$#] '])
run_id='testrun'
start=f"\x1fSH_EDITOR_RUN_BEGIN:{run_id}\x1f"
endprefix=f"\x1fSH_EDITOR_RUN_END:{run_id}:"
cmd=(
    f"printf '{start}'; bash -lc \"echo Hello SH Editor\" > >(tee /tmp/out1) 2> >(tee -a /tmp/out1 >&2); "
    f"__sh_editor_status=$?; printf '%s' \"$__sh_editor_status\" > /tmp/status1; "
    f"printf '{endprefix}%s\\x1f' \"$__sh_editor_status\"; unset __sh_editor_status"
)
print('\n---SEND---')
print(cmd)
child.sendline(cmd)
child.expect([r'[$#] '])
print('\n---DONE---')
