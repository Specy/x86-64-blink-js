# x86-64-blink-js
An emulator for x86-64 based off https://x64.halb.it


To build from source you must have installed:

- node
- texinfo
- emsdk
- musl-gcc
- make
- gcc
- flex
- bison


## Notes

there is an error in the `compile_musl_binutils.sh` the `gas/ld-new` should be `ld/ld-new`
and the copy should be `../../webapp` instead of `../webapp