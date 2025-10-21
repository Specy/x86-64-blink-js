// @ts-ignore
import blinkenlib from "./deps/blinkenlib";
import {type AssemblerMode, type DiagnosticLine} from "./assemblers";
import {type Callbacks, nextTick, Signals, signals_info, SigtrapCodes} from './constants'

/**
 * Machine Cross-language struct.
 * offsers access to some of the blink Machine struct elements,
 * such as registers and virtual memory.
 *
 * Javascript DataView  <-----> Struct of uint32_t pointers to
 *                              important elements of Machine m
 *
 *
 */
class M_CLStruct {
    readonly version = 1;
    readonly sizeof_key = 4;
    readonly keys = {
        version: {index: 0, pointer: false} /*number*/,
        codemem: {index: 1, pointer: true},
        stackmem: {index: 2, pointer: true},
        readaddr: {index: 3, pointer: true},
        readsize: {index: 4, pointer: false} /*number*/,
        writeaddr: {index: 5, pointer: true},
        writesize: {index: 6, pointer: false} /*number*/,

        flags: {index: 7, pointer: false},
        cs__base: {index: 8, pointer: true},

        rip: {index: 9, pointer: true},
        rsp: {index: 10, pointer: true},
        rbp: {index: 11, pointer: true},
        rsi: {index: 12, pointer: true},
        rdi: {index: 13, pointer: true},

        r8: {index: 14, pointer: true},
        r9: {index: 15, pointer: true},
        r10: {index: 16, pointer: true},
        r11: {index: 17, pointer: true},
        r12: {index: 18, pointer: true},
        r13: {index: 19, pointer: true},
        r14: {index: 20, pointer: true},
        r15: {index: 21, pointer: true},

        rax: {index: 22, pointer: true},
        rbx: {index: 23, pointer: true},
        rcx: {index: 24, pointer: true},
        rdx: {index: 25, pointer: true},

        //disassembly buffer
        dis__max_lines: {index: 26, pointer: false},
        dis__max_line_len: {index: 27, pointer: false},
        dis__current_line: {index: 28, pointer: false},
        dis__buffer: {index: 29, pointer: true},
    };
    memory: WebAssembly.Memory;
    memView!: DataView;
    structView!: DataView;
    struct_pointer: number;

    constructor(memory: WebAssembly.Memory, struct_pointer: number) {
        this.memory = memory;
        this.struct_pointer = struct_pointer;
        this.growMemory();
        //check shared struct version
        const js_version = this.version;
        const wasm_version = this.getPtr("version");
        if (js_version !== wasm_version) {
            throw new Error("shared struct version mismatch");
        }
    }

    growMemory() {
        const struct_size = Object.keys(this.keys).length * this.sizeof_key;
        this.memView = new DataView(this.memory.buffer);
        this.structView = new DataView(
            this.memory.buffer,
            this.struct_pointer,
            struct_size,
        );
    }

    getDisasm(): { lines: string[], currentLine: number, maxLines: number } {
        const ptr = this.getPtr('dis__buffer');
        const max_lines = this.getPtr('dis__max_lines');
        const max_line_len = this.getPtr('dis__max_line_len');
        const current_line = this.getPtr('dis__current_line');

        // Handle disassembler failures
        if (current_line > max_lines) {
            return { lines: [], currentLine: current_line, maxLines: max_lines };
        }

        const lines: string[] = [];

        // Read each line from the 2D buffer
        for (let i = 0; i < max_lines; i++) {
            let line = '';
            // Read characters until null terminator or max line length
            for (let j = 0; j < max_line_len; j++) {
                const ch = this.memView.getUint8(ptr + i * max_line_len + j);
                if (!ch) break; // null terminator
                line += String.fromCharCode(ch);
            }
            lines.push(line);
        }

        return { lines, currentLine: current_line, maxLines: max_lines };
    }

    stringReadBytes(key: keyof typeof this.keys, num: number): string {
        const ptr = this.getPtr(key);
        let retStr = "";
        for (let i = 0; i < num; i++) {
            retStr += this.memView
                .getUint8(ptr + i)
                .toString(16)
                .padStart(2, "0");
            retStr += " ";
        }
        return retStr;
    }

    stringReadU64(key: keyof typeof this.keys): string {
        const ptr = this.getPtr(key);
        let hexStr = "";
        for (let i = 7; i >= 0; i--) {
            const byte = this.memView.getUint8(ptr + i);
            if (hexStr || byte || i === 0)
                hexStr += byte.toString(16).padStart(2, "0");
        }
        return `0x${hexStr}`;
    }

    readU64(key: keyof typeof this.keys): bigint {
        const ptr = this.getPtr(key);
        const little_endian = true;
        return this.memView.getBigUint64(ptr, little_endian);
    }

    getPtr(key: keyof typeof this.keys): number {
        if (!this.structView.buffer.byteLength) {
            console.log("blink: memory grew");
            this.growMemory();
        }
        const index = this.keys[key].index * this.sizeof_key;
        const little_endian = true;
        return this.structView.getUint32(index, little_endian);
    }

    writeStringToHeap(offset: number, str: string, maxLength: number) {
        if (!this.structView.buffer.byteLength) {
            console.log("blink: memory grew");
            this.growMemory();
        }
        if (offset === 0) {
            console.log("blink: write to null ptr");
            return;
        }
        const writeLen = Math.min(str.length, maxLength - 1);
        for (let i = 0; i < writeLen; ++i) {
            const u = str.charCodeAt(i);
            if (u >= 0x20 && u <= 0x7e) {
                this.memView.setUint8(offset + i, u);
            } else {
                //replace non-ascii characters with a space
                this.memView.setUint8(offset + i, 0x20);
            }
        }
        // Null-terminate the pointer to the buffer.
        this.memView.setUint8(offset + writeLen, 0);
    }
}


/**
 * A javascript wrapper for the blink x86-64 emulator.
 * The goal is to provide an interface to blink that is as
 * abstracted away as possible from emscripten, keeping open the
 * possibility to completely remove the emscripten dependency
 *
 */
export class Blink {
    #stdinHandler!: () => number | null;
    #stdoutHandler!: (charCode: number) => void;
    #stderrHandler!: (charCode: number) => void;
    #signalHandler!: (signal: number, code: number) => void;
    #stateChangeHandler!: (state: string, oldState: string) => void;

    m!: M_CLStruct;

    states = {
        NOT_READY: "NOT_READY",
        READY: "READY",
        ASSEMBLING: "ASSEMBLING",
        LINKING: "LINKING",
        PROGRAM_LOADED: "PROGRAM_LOADED",
        PROGRAM_RUNNING: "PROGRAM_RUNNING",
        PROGRAM_STOPPED: "PROGRAM_STOPPED",
    } as const;

    mode!: AssemblerMode;

    Module: any; /*Emscripten Module object*/
    memory!: WebAssembly.Memory;
    state: (typeof this.states)[keyof typeof this.states] = this.states.NOT_READY;
    stopReason: null | { loadFail: boolean; exitCode: number; details: string } = null;

    //program emulation arguments
    max_argc_len = 200;
    max_argv_len = 200;
    max_progname_len = 200;
    argc_ptr = 0;
    argv_ptr = 0;
    progname_ptr = 0;

    default_argc = "/program";
    default_argv = "";

    //assembler stdout and stderr
    assembler_logs = "";
    //assembler diagnostic errors
    assembler_errors: DiagnosticLine[] = [];

    /**
     * Initialize the emscripten blink module.
     */
    constructor(
        mode: AssemblerMode,
        callbacks: Callbacks
    ) {
        this.setCallbacks(callbacks);
        void this.init(mode)
    }

    private initPromise: Promise<void> | undefined;

    async init(mode: AssemblerMode,) {
        if (this.initPromise) return this.initPromise;
        this.initPromise = this.#initEmscripten(mode);
        return
    }

    async #initEmscripten(mode: AssemblerMode) {
        this.mode = mode;
        const [assembler, linker] = await Promise.all([
            this.#fetchBinaryFile(mode.binaries.assembler.fileurl),
            mode.binaries.linker
                ? this.#fetchBinaryFile(mode.binaries.linker.fileurl)
                : null,

        ])
        this.Module = await blinkenlib({
            noInitialRun: true,
            preRun: (M: any) => {
                M.FS.init(
                    this.#stdinHandler,
                    (charcode: number) => {
                        this.#assembler_logcollector(charcode);
                        this.#stdoutHandler(charcode);
                    },
                    (charcode: number) => {
                        this.#assembler_logcollector(charcode);
                        this.#stderrHandler(charcode);
                    },
                );
                M.FS.writeFile('/assembler', new Uint8Array(assembler));
                M.FS.chmod('/assembler', 0o777);

                if (linker) {
                    M.FS.writeFile('/linker', new Uint8Array(linker));
                    M.FS.chmod('/linker', 0o777);
                }
            },
        });

        //dynamically register the javascript callbacks for the wasm code
        const signal_callback = this.#extern_c__signal_callback.bind(this);
        const signal_callback_llvm_signature = "vii";
        const fp_1 = this.Module.addFunction(
            signal_callback,
            signal_callback_llvm_signature,
        );

        const exit_callback = this.#extern_c__exit_callback.bind(this);
        const exit_callback_llvm_signature = "vi";
        const fp_2 = this.Module.addFunction(
            exit_callback,
            exit_callback_llvm_signature,
        );

        this.Module.callMain([
            fp_1.toString() /* signal_callback */,
            fp_2.toString() /* exit_callback */,
        ]);

        //init memory
        this.memory = this.Module.wasmExports.memory;
        //initialize the cross language struct
        const cls_pointer = this.Module._blinkenlib_get_clstruct();
        this.m = new M_CLStruct(this.memory, cls_pointer);
        //initialize the program emulation arguments
        this.argc_ptr = this.Module._blinkenlib_get_argc_string();
        this.argv_ptr = this.Module._blinkenlib_get_argv_string();
        this.progname_ptr = this.Module._blinkenlib_get_progname_string();

        this.#setState(this.states.READY);
    }

    /**
     * This callback receives the stdout and stderr of the blink emulator.
     * When An assembler is being emulated, the stream received is logged
     * in a buffer, in order to catch eventual diagnostic errors
     */
    #assembler_logcollector(charcode: number) {
        if (this.state === this.states.ASSEMBLING) {
            this.assembler_logs += String.fromCharCode(charcode);
        }
    }

    #setState(state: (typeof this.states)[keyof typeof this.states]) {
        if (this.state === state) {
            return;
        }
        console.log(`blink: ${state}`);
        this.#stateChangeHandler(state, this.state);
        this.state = state;
    }

    /**
     * This callback is called from the wasm code
     * when the guest process is stopped by a terminating signal
     *
     * SIGTRAP is the only signal that does not indicate
     * a program stop.
     */
    #extern_c__signal_callback(sig: Signals, code: number) {
        if (sig !== Signals.SIGTRAP) {
            const exitCode = 128 + sig;
            let details = `Program terminated with Exit(${exitCode}) Due to signal ${sig}`;
            if (Object.prototype.hasOwnProperty.call(signals_info, sig)) {
                const sigString = signals_info[sig].name;
                const sigDescr = signals_info[sig].description;
                details = `Program terminated with Exit(${exitCode}) due to signal ${sigString}: ${sigDescr}`;
            }
            this.stopReason = {
                loadFail: false,
                exitCode: exitCode,
                details: details,
            };
            this.#setState(this.states.PROGRAM_STOPPED);
            this.#signalHandler(sig, code);
        } else if (
            sig === Signals.SIGTRAP &&
            code === SigtrapCodes.BLINK_PREEMPT
        ) {
            console.log("preempt");
            nextTick().then(() => {
                this.Module._blinkenlib_preempt_resume();
            })
        } else {
            this.#signalHandler(sig, code);
        }
    }

    /**
     * This callback is called from the wasm code
     * when the guest process calls the exit syscall
     */
    #extern_c__exit_callback(code: number) {
        //Handle separately the return codes tha are generated from the
        //assembler or linker running in the emulator, and not
        //from a regular program
        if (this.state === this.states.ASSEMBLING) {
            this.loadASM_assembler_exit_callback(code);
            return;
        }
        if (this.state === this.states.LINKING) {
            this.loadASM_linker_exit_callback(code);
            return;
        }

        this.stopReason = {
            loadFail: false,
            exitCode: code,
            details: `program terminated with Exit(${code})`,
        };
        this.#setState(this.states.PROGRAM_STOPPED);
        console.log("exit callback called");
    }

    #setEmulationArgs(progname: string, argc: string, argv: string) {
        this.m.writeStringToHeap(
            this.progname_ptr,
            progname,
            this.max_progname_len,
        );
        this.m.writeStringToHeap(this.argc_ptr, argc, this.max_argc_len);
        this.m.writeStringToHeap(this.argv_ptr, argv, this.max_argv_len);
    }

    setCallbacks({
                     stdinHandler,
                     stderrHandler,
                     signalHandler,
                     stateChangeHandler,
                     stdoutHandler
                 }: Callbacks
    ) {
        this.#stdinHandler = stdinHandler ?? this.#default_stdinHandler
        this.#stdoutHandler = stdoutHandler ?? this.#default_stdoutHandler
        this.#stderrHandler = stderrHandler ?? this.#default_stderrHandler
        this.#signalHandler = signalHandler ?? this.#default_signalHandler
        this.#stateChangeHandler = stateChangeHandler ?? this.#default_stateChangeHandler
    }

    async #fetchBinaryFile(url: string): Promise<ArrayBuffer> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            return arrayBuffer;
        } catch (error) {
            console.error("Failed to fetch binary file:", error);
            throw error
        }
    }

    /**
     * Update the assembler mode of this blink instance.
     * The state will be set to NOT_READY, and
     * a new set of compilers will be downloaded.
     */
    async setMode(mode: AssemblerMode) {
        this.mode = mode;
        this.#setState(this.states.NOT_READY);
        this.assembler_logs = "";
        this.assembler_errors = [];

        //download assembler
        const downloadedElf = await this.#fetchBinaryFile(
            mode.binaries.assembler.fileurl,
        );
        const data = new Uint8Array(downloadedElf);
        const FS = this.Module.FS;
        const stream = FS.open("/assembler", "w+");
        FS.write(stream, data, 0, data.length, 0);
        FS.close(stream);
        FS.chmod("/assembler", 0o777);

        //download linker, if required by this mode
        if (mode.binaries.linker) {
            const downloadedElf = await this.#fetchBinaryFile(
                mode.binaries.linker.fileurl,
            );
            const data = new Uint8Array(downloadedElf);
            const FS = this.Module.FS;
            const stream = FS.open("/linker", "w+");
            FS.write(stream, data, 0, data.length, 0);
            FS.close(stream);
            FS.chmod("/linker", 0o777);
        }
        this.#setState(this.states.READY);
    }

    /**
     * save the program to the Virtual File System
     * set the emulation arguments
     * optionally start the program
     */
    loadElf(elfArrayBytes: ArrayBuffer): boolean {
        if (this.state === this.states.NOT_READY) {
            return false;
        }
        const data = new Uint8Array(elfArrayBytes);
        const FS = this.Module.FS;
        const stream = FS.open("/program", "w+");
        FS.write(stream, data, 0, data.length, 0);
        FS.close(stream);
        FS.chmod("/program", 0o777);

        this.starti();
        return true;
    }

    /**
     * Launch a multi stage process where:
     * - the assembly asmString is written to a file in the virtual FS.
     * - an assembler is emulated in blink
     * - a linker is emulated in blink
     * The state of this operation is kept via this.state.
     * If successful, it will be possible to launch the compiled program
     * via this.starti(), or this.run()
     */
    async loadASM(asmString: string): Promise<boolean> {
        if (this.state === this.states.NOT_READY) {
            return false;
        }
        this.assembler_logs = "";
        this.assembler_errors = [];
        this.#setState(this.states.ASSEMBLING);
        const FS = this.Module.FS;
        FS.writeFile("/assembly.s", asmString);
        await nextTick()
        //this hack ensures that the function is called after a browser render pass
        try {
            this.#setEmulationArgs(
                "/assembler",
                this.mode.binaries.assembler.commands,
                "",
            );
            this.Module._blinkenlib_run_fast();
            return true
        } catch (e) {
            console.error(e)
            return false
        }
    }

    loadASM_assembler_exit_callback(code: number) {
        if (code !== 0) {
            console.log("blink: assembler failed");
            if (this.mode.diagnosticsParser) {
                console.log("blink: assembler diagnostics parsed");
                this.assembler_errors = this.mode.diagnosticsParser(
                    this.assembler_logs,
                );
                console.log(this.assembler_logs);
                console.log(this.assembler_errors);
            }
            this.#setState(this.states.READY);
            return;
        }
        if (this.mode.binaries.linker) {
            //we need a separate linking step
            this.#setState(this.states.LINKING);
            //this hack ensures that the function is called after a browser render pass
            nextTick().then(() => {
                this.#setEmulationArgs(
                    "/linker",
                    this.mode.binaries.linker!.commands,
                    "",
                );
                this.Module._blinkenlib_run_fast();
            })
        } else {
            //the current assembler directly generates an ELF without a linker
            const FS = this.Module.FS;
            FS.chmod("/program", 0o777);
            this.#setState(this.states.PROGRAM_LOADED);
            this.starti();
        }
    }

    loadASM_linker_exit_callback(code: number) {
        if (code !== 0) {
            console.log("linker failed");
            this.#setState(this.states.READY);
            return;
        }
        const FS = this.Module.FS;
        FS.chmod("/program", 0o777);
        this.#setState(this.states.PROGRAM_LOADED);
        this.starti();
    }

    /**
     * start the program normally and execute it until
     * a breakpoint or end.
     */
    run() {
        try {
            this.#setState(this.states.PROGRAM_RUNNING);
            this.#setEmulationArgs("/program", this.default_argc, this.default_argv);
            this.Module._blinkenlib_run();
        } catch (e) {
            this.stopReason = {loadFail: true, exitCode: 0, details: "invalid ELF"};
            this.#setState(this.states.PROGRAM_STOPPED);
        }
    }

    /**
     * start the program and stop at the beginning of the
     * main function.
     */
    start() {
        try {
            this.#setEmulationArgs("/program", this.default_argc, this.default_argv);
            this.Module._blinkenlib_start();
            this.#setState(this.states.PROGRAM_RUNNING);
        } catch (e) {
            this.stopReason = {loadFail: true, exitCode: 0, details: "invalid ELF"};
            this.#setState(this.states.PROGRAM_STOPPED);
        }
    }

    /**
     * start the program and stop at the very first
     * instruction (before main)
     */
    starti() {
        try {
            this.#setEmulationArgs("/program", this.default_argc, this.default_argv);
            this.Module._blinkenlib_starti();
            this.#setState(this.states.PROGRAM_RUNNING);
        } catch (e) {
            this.stopReason = {loadFail: true, exitCode: 0, details: "invalid ELF"};
            this.#setState(this.states.PROGRAM_STOPPED);
        }
    }

    stepi() {
        this.Module._blinkenlib_stepi();
    }

    continue() {
        this.Module._blinkenlib_continue();
    }

    setready() {
        this.#setState(this.states.READY);
    }

    #default_signalHandler(sig: number, code: number) {
        console.log(`received signal: ${sig} code: ${code}`);
    }

    #default_stdinHandler(): number | null {
        console.log("stdin requested, EOF returned");
        return null; //EOF
    }

    #default_stdoutHandler(charcode: number) {
        console.log(`stdout: ${String.fromCharCode(charcode)}`);
    }

    #default_stderrHandler(charcode: number) {
        console.log(`stderr: ${String.fromCharCode(charcode)}`);
    }

    #default_stateChangeHandler(state: string, oldState: string) {
        console.log(`state change: ${oldState} -> ${state}`);
    }
}
