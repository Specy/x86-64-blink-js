export enum Signals {
    SIGHUP = 1,
    SIGINT = 2,
    SIGQUIT = 3,
    SIGILL = 4,
    SIGTRAP = 5,
    SIGABRT = 6,
    SIGBUS = 7,
    SIGFPE = 8,
    SIGKILL = 9,
    SIGUSR1 = 10,
    SIGSEGV = 11,
    SIGUSR2 = 12,
    SIGPIPE = 13,
    SIGALRM = 14,
    SIGTERM = 15,
    SIGSTKFLT = 16,
    SIGCHLD = 17,
    SIGCONT = 18,
    SIGSTOP = 19,
    SIGTSTP = 20,
    SIGTTIN = 21,
    SIGTTOU = 22,
    SIGURG = 23,
    SIGXCPU = 24,
    SIGXFSZ = 25,
    SIGVTALRM = 26,
    SIGPROF = 27,
    SIGWINCH = 28,
    SIGIO = 29,
    SIGPWR = 30,
    SIGSYS = 31,
}

export enum SigtrapCodes {
    BLINK_PREEMPT = 40,
    BLINK_STEP = 41,
}

export const signals_info = {
    1: {
        name: "SIGHUP",
        description: "Hang up controlling terminal or process.",
    },
    2: {name: "SIGINT", description: "Interrupt from keyboard, Control-C."},
    3: {name: "SIGQUIT", description: "Quit from keyboard, Control-\\."},
    4: {name: "SIGILL", description: "Illegal instruction."},
    5: {name: "SIGTRAP", description: "Breakpoint for debugging."},
    6: {name: "SIGABRT", description: "Abnormal termination."},
    7: {name: "SIGBUS", description: "Bus error."},
    8: {name: "SIGFPE", description: "Floating-point exception."},
    9: {name: "SIGKILL", description: "Forced-process termination."},
    10: {name: "SIGUSR1", description: "Available to processes."},
    11: {name: "SIGSEGV", description: "Invalid memory reference."},
    12: {name: "SIGUSR2", description: "Available to processes."},
    13: {name: "SIGPIPE", description: "Write to pipe with no readers."},
    14: {name: "SIGALRM", description: "Real-timer clock."},
    15: {name: "SIGTERM", description: "Process termination."},
    16: {name: "SIGSTKFLT", description: "Coprocessor stack error."},
    17: {
        name: "SIGCHLD",
        description:
            "Child process stopped or terminated or got a signal if traced.",
    },
    18: {name: "SIGCONT", description: "Resume execution, if stopped."},
    19: {name: "SIGSTOP", description: "Stop process execution, Ctrl-Z."},
    20: {name: "SIGTSTP", description: "Stop process issued from tty."},
    21: {name: "SIGTTIN", description: "Background process requires input."},
    22: {name: "SIGTTOU", description: "Background process requires output."},
    23: {name: "SIGURG", description: "Urgent condition on socket."},
    24: {
        name: "SIGXCPU",
        description: "CPU time limit exceeded, execution took too long.",
    },
    25: {name: "SIGXFSZ", description: "File size limit exceeded."},
    26: {name: "SIGVTALRM", description: "Virtual timer clock."},
    27: {name: "SIGPROF", description: "Profile timer clock."},
    28: {name: "SIGWINCH", description: "Window resizing."},
    29: {name: "SIGIO", description: "I/O now possible."},
    30: {name: "SIGPWR", description: "Power supply failure."},
    31: {name: "SIGSYS", description: "Bad system call."},
} satisfies Record<Signals, { name: string, description: string }>


export enum X86Register {
    RAX = 'rax',
    RBX = 'rbx',
    RCX = 'rcx',
    RDX = 'rdx',
    RSP = 'rsp',
    RBP = 'rbp',
    RSI = 'rsi',
    RDI = 'rdi',
    R8 = 'r8',
    R9 = 'r9',
    R10 = 'r10',
    R11 = 'r11',
    R12 = 'r12',
    R13 = 'r13',
    R14 = 'r14',
    R15 = 'r15',
    RIP = 'rip',
}

export const X86_REGISTER_NAMES = Object.values(X86Register);

export enum RegisterSize {
    Byte = 1,
    Word = 2,
    Long = 4,
    Double = 8
}

export enum EmulatorStatus {
    Terminated = 0,
    Running = 0,
}

export type Instruction = {
    address: bigint
    lineNumber: number
    code: string
}

export type CompilationError = {
    type: 'raw'
    message: string
}


export type LineError = {
    lineIndex: number
    column: number
    line: {
        line: string
        line_index: number
    }
    message: string
    formatted: string
}

export type ExecutionStep = {
    mutations: MutationOperation[]
    pc: number
    old_ccr: {
        bits: number
    }
    new_ccr: {
        bits: number
    }
    line: number
}

export type MutationOperation =
    | {
    type: 'WriteRegister'
    value: {
        register: string
        old: bigint
        size: RegisterSize
    }
}
    | {
    type: 'WriteMemory'
    value: {
        address: bigint
        old: bigint
        size: RegisterSize
    }
}
    | {
    type: 'WriteMemoryBytes'
    value: {
        address: bigint
        old: number[]
    }
}
    | {
    type: 'PopCallStack'
    value: {
        to: bigint
        from: bigint
    }
}
    | {
    type: 'PushCallStack'
    value: {
        to: bigint
        from: bigint
    }
}
    | {
    type: 'Other'
    value: string
}


export type StackFrame = {
    name: string
    address: bigint
    destination: bigint
    sp: bigint
    line: number
    color: string
}

export type Callbacks = {
    stdinHandler?: () => number | null,
    stdoutHandler?: (charCode: number) => void,
    stderrHandler?: (charCode: number) => void,
    signalHandler?: (signal: number, code: number) => void,
    stateChangeHandler?: (state: string, oldState: string) => void,
}

export const FLAGS = [
    { name: 'CF', bit: 0 },   // Carry
    { name: 'PF', bit: 2 },   // Parity
    { name: 'AF', bit: 4 },   // Auxiliary
    { name: 'ZF', bit: 6 },   // Zero
    { name: 'SF', bit: 7 },   // Sign
    { name: 'TF', bit: 8 },   // Trap
    { name: 'IF', bit: 9 },   // Interrupt
    { name: 'DF', bit: 10 },  // Direction
    { name: 'OF', bit: 11 },  // Overflow
];


export function nextTick(){
    if (typeof requestAnimationFrame === 'function'){
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    } else {
        return new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 0);
        });
    }
}