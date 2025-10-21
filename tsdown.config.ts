import { defineConfig } from 'tsdown'

export default defineConfig({
    copy: [
        './src/deps/gnu-as.elf',
        './src/deps/gnu-ld.elf',
        './src/deps/nasm.elf',
        './src/deps/fasm.elf'
    ]
})
