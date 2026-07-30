# Code Black Native Radar Decoder

This crate provides the Beta 1 on-device Level II radar decoder for Code Black OPS.

- Decoder stack: `danielway/nexrad` crates, pinned through Cargo.
- License: MIT.
- Product scope: NEXRAD Level II REF, VEL, SRV, and CC.
- Android target: `aarch64-linux-android` / `arm64-v8a`.
- Packaged native library: `libcodeblack_radar.so`.
- Deferred: Level III / Echo Tops.

Build:

```powershell
$env:Path="$env:USERPROFILE\.cargo\bin;$env:Path"
$ndk="$env:LOCALAPPDATA\Android\Sdk\ndk\28.2.13676358"
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$ndk\toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android35-clang.cmd"
cargo +stable-x86_64-pc-windows-gnu build --target aarch64-linux-android --release
Copy-Item target\aarch64-linux-android\release\libcodeblack_radar.so ..\..\android\app\src\main\jniLibs\arm64-v8a\libcodeblack_radar.so -Force
```
