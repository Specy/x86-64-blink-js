import {
    type Callbacks,
    type CompilationError,
    EmulatorStatus,
    type ExecutionStep,
    FLAGS,
    type Instruction,
    type LineError,
    RegisterSize,
    type StackFrame,
    X86_REGISTER_NAMES,
    X86Register
} from "./constants";
import {Blink} from "./Blink";
import {type AssemblerMode, assemblers} from "./assemblers";

export class X86_64Emulator {
    private blink: Blink;
    private blinkTypeCheck: Blink;
    private compiledCode: string = "";
    private initialized: boolean = false;

    constructor(mode?: AssemblerMode, callbacks?: Callbacks) {
        const selectedMode = mode ?? assemblers.FASM_trunk;
        this.blink = new Blink(selectedMode!, callbacks ?? {});
        this.blinkTypeCheck = new Blink(selectedMode!, callbacks ?? {});
    }

    async initialize(_undoSize: number): Promise<void> {
        await this.blink.init(this.blink.mode);
        this.initialized = true;
    }

    getCompiledCode(): { code: string } {
        return {code: this.compiledCode};
    }

    dispose(): void {
        // Clean up resources if needed
        this.initialized = false;
    }


    private async waitForBlinkReady(instance: Blink): Promise<void> {
        // Wait for compilation to complete
        await new Promise<void>((resolve) => {
            const checkState = () => {
                if (instance.state === instance.states.PROGRAM_RUNNING ||
                    instance.state === instance.states.READY) {
                    resolve();
                } else {
                    setTimeout(checkState, 10);
                }
            };
            checkState();
        });
    }

    async compile(code: string): Promise<{ ok: true } | { ok: false, errors: CompilationError[], report: string }> {
        if (!this.initialized) {
            return {
                ok: false,
                errors: [{type: 'raw', message: 'Emulator not initialized'}],
                report: 'Emulator not initialized'
            };
        }
        this.compiledCode = '';
        const success = this.blink.loadASM(code);
        if (!success) {
            return {
                ok: false,
                errors: [{type: 'raw', message: 'Failed to load assembly code'}],
                report: 'Failed to load assembly code'
            };
        }

        await this.waitForBlinkReady(this.blink);
        this.compiledCode = this.blink.m.getDisasm().lines.join('\n');

        if (this.blink.assembler_errors.length > 0) {
            const errors: CompilationError[] = this.blink.assembler_errors.map(err => ({
                type: 'raw',
                message: `Line ${err.line}: ${err.error}`
            }));
            return {
                ok: false,
                errors,
                report: this.blink.assembler_logs
            };
        }

        return {ok: true};
    }

    async checkCode(code: string): Promise<LineError[]> {
        const success = this.blinkTypeCheck.loadASM(code);
        const errors: LineError[] = [];
        await this.waitForBlinkReady(this.blink);

        for (const err of this.blinkTypeCheck.assembler_errors) {
            errors.push({
                lineIndex: err.line - 1,
                column: 0,
                line: {
                    line: "", // Line content not available
                    line_index: err.line - 1
                },
                message: err.error,
                formatted: `Line ${err.line}: ${err.error}`
            });
        }

        return errors;
    }

    undo(): void {
        throw new Error("Method cannot be implemented");
    }

    canUndo(): boolean {
        return false
    }

    async step(): Promise<{ terminated: boolean }> {
        this.blink.stepi();
        return {terminated: this.hasTerminated()};
    }

    getStatus(): EmulatorStatus {
        return this.hasTerminated() ? EmulatorStatus.Terminated : EmulatorStatus.Running;
    }

    writeMemoryBytes(address: bigint, data: Uint8Array): void {
        const ptr = Number(address);
        for (let i = 0; i < data.length; i++) {
            const byte = data[i];
            if (byte !== undefined) {
                this.blink.m.memView.setUint8(ptr + i, byte);
            }
        }
    }

    readMemoryBytes(address: bigint, length: bigint): Uint8Array {
        const ptr = Number(address);
        const len = Number(length);
        const result = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            result[i] = this.blink.m.memView.getUint8(ptr + i);
        }
        return result;
    }

    getNextInstruction(): Instruction | null {
        const pc = this.getPc();
        return this.getInstructionAt(pc);
    }

    getUndoHistory(_max: number): ExecutionStep[] {
        throw new Error("Method cannot be implemented");
    }

    getPc(): bigint {
        return this.blink.m.readU64('rip');
    }

    getSp(): bigint {
        return this.blink.m.readU64('rsp');
    }

    getFlags(): { name: string, value: number, prev?: number }[] {
        const flags = this.blink.m.getPtr('flags');

        return FLAGS.map(f => ({
            name: f.name,
            value: (flags >> f.bit) & 1
        }));
    }

    getCallStack(): StackFrame[] {
        throw new Error("Method cannot be implemented");
    }

    getInstructionAt(address: bigint): Instruction | null {
        //TODO
        return {
            address,
            lineNumber: 0,
            code: ""
        };
    }

    getRegisterValues(): bigint[] {
        return X86_REGISTER_NAMES.map(reg => this.getRegisterValue(reg));
    }

    getRegisterValuesRecord(): Record<X86Register, bigint> {
        const record = {} as Record<X86Register, bigint>;
        for (const reg of X86_REGISTER_NAMES) {
            record[reg] = this.getRegisterValue(reg);
        }
        return record;
    }

    getRegisterValue(register: X86Register, size?: RegisterSize): bigint {
        const registerKey = register.toLowerCase() as keyof typeof this.blink.m.keys;

        if (!(registerKey in this.blink.m.keys)) {
            return 0n;
        }

        const value = this.blink.m.readU64(registerKey);

        if (!size || size === RegisterSize.Double) {
            return value;
        }

        // Mask based on size
        const masks = {
            [RegisterSize.Byte]: 0xFFn,
            [RegisterSize.Word]: 0xFFFFn,
            [RegisterSize.Long]: 0xFFFFFFFFn,
            [RegisterSize.Double]: 0xFFFFFFFFFFFFFFFFn
        };

        return value & masks[size];
    }

    setRegisterValue(register: X86Register, value: bigint, size?: RegisterSize): void {
        const registerKey = register.toLowerCase() as keyof typeof this.blink.m.keys;

        if (!(registerKey in this.blink.m.keys)) {
            return;
        }

        const ptr = this.blink.m.getPtr(registerKey);

        if (!size || size === RegisterSize.Double) {
            this.blink.m.memView.setBigUint64(ptr, value, true);
        } else if (size === RegisterSize.Long) {
            this.blink.m.memView.setUint32(ptr, Number(value & 0xFFFFFFFFn), true);
        } else if (size === RegisterSize.Word) {
            this.blink.m.memView.setUint16(ptr, Number(value & 0xFFFFn), true);
        } else if (size === RegisterSize.Byte) {
            this.blink.m.memView.setUint8(ptr, Number(value & 0xFFn));
        }
    }

    hasTerminated(): boolean {
        return this.blink.state === this.blink.states.PROGRAM_STOPPED;
    }

    async run(_limit?: number, _breakpoints?: number[]): Promise<EmulatorStatus> {
        this.blink.run();

        // Wait for program to complete or hit limit
        return new Promise((resolve) => {
            const check = () => {
                if (this.hasTerminated()) {
                    resolve(EmulatorStatus.Terminated);
                } else {
                    setTimeout(check, 10);
                }
            };
            check();
        });
    }

    // Additional helper methods
    async setMode(mode: AssemblerMode): Promise<void> {
        await this.blink.setMode(mode);
    }

    loadElf(elfArrayBytes: ArrayBuffer): boolean {
        return this.blink.loadElf(elfArrayBytes);
    }

    getBlinkInstance(): Blink {
        return this.blink;
    }
}

export {assemblers, type AssemblerMode} from "./assemblers";
export * from "./constants";
