import {X86_64Emulator} from "./index";


async function run(){
    const emulator = new X86_64Emulator(undefined, {
        stdoutHandler: (charcode) => {
            process.stdout.write(String.fromCharCode(charcode))
        }
    })

    await emulator._initialize(10000)
    const result = await emulator._compile(`
;---------------------
;  Flat Assembler file
;  Syscall Hello World (Corrected)
;---------------------
format ELF64 executable 3
segment readable executable
entry $

  ; sys_write (syscall 1)
    mov     eax, 1          ; <<< THE FIX: syscall number for sys_write
    mov     edi, 1          ; file descriptor (1 = stdout)
    lea     rsi, [msg]      ; pointer to the message
    mov     edx, msg_size   ; length of the message
    syscall                 ; Make the system call

  ; sys_exit (syscall 60)
    mov     eax, 60         ; The syscall number for sys_exit
    xor     edi, edi        ; exit code 0 (success)
    syscall                 ; Make the system call

segment readable writeable
msg db 'Hello 64-bit world!',0xA
msg_size = $-msg
    `)
    if(!result.ok){
        console.error("Compilation failed:", result.errors)
    }
    await emulator._run()
}


void run();

