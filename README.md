# Code Black Native Broadcaster

This is the separate PHAENON3-native producer. It does not read, write, launch, configure, or otherwise depend on OBS. Its public output is a manually armed Facebook RTMPS encoder with a Windows DPAPI-protected stream key; OBS must remain closed while Native Facebook output is active.

The engine consumes only the approved CORE `nick` reader, creates a camera-only CLEAN preview, independently composes a PROGRAM preview with NVENC, and can send PROGRAM to Facebook. Field mode discards the PROGRAM encoder output locally so a long show cannot fill C:. The optional CLEAN camera archive is a separate, explicit control. The producer binds its control API to `127.0.0.1:18766` only.

Run it with:

```powershell
C:\CodeBlack\streaming\native-broadcaster\run-native-broadcaster.ps1
```

Run `field-preflight.ps1`, then open `http://127.0.0.1:18766/`. Start the preview pipeline, wait for `SOURCE_LIVE`, verify moving audio and both current previews, then start Facebook output. Sending frames to Facebook and publishing the Page live are separate actions; confirm the correct Page and preview in Facebook Live Producer before using its Go Live control.

## Stage while Nick is unavailable

Run `stage-for-nick.ps1` to arm only the private preview receiver. It can start the native service if needed, refuses to alter an on-air Facebook session, and leaves Facebook output OFF. Keep this workstation powered on and connected. The receiver retries automatically and resumes when the protected Core `nick` publisher returns.

Preparation verified on 2026-10-13: Chase build 20/0.1.6 is published; Core routes the Chase source to `nick`; a bounded synthetic 1080p30 video/AAC source produced current CLEAN and PROGRAM previews, active non-silent audio, and an online OPS bridge. Source loss and automatic recovery were observed while Facebook output stayed OFF. The encrypted Facebook RTMPS key decrypts for this Windows account and the Facebook RTMPS server accepts a TCP connection. These checks do not prove that Meta has accepted the encoder or that Nick's actual phone/microphone/network will work.

Facebook comments authorization is connected for Storm Chaser Nick Mounce. Existing Chase build 20 uses the same repaired relay. The OPS Producer console supports confirmed public replies by approved producers. OPS stream controls now support exclusive 30-second operator leases, authenticated preview/output start-stop, camera archive start-stop and lower thirds, with explicit Facebook-output confirmation and fresh video/audio checks. Commands expire after 15 seconds. Stop commands do not require a current lease or revision. Facebook public Go Live/End still requires Facebook Live Producer until Meta lifecycle qualification is complete; no 360 control SDK is connected.

Source is backed up on the telemetry repository's dedicated `save/native-broadcaster-20261013` branch. The allowlist `.gitignore` excludes local configuration, all credentials, relay certificates, recordings, logs and runtime evidence. Copy `config.example.json` to `config.json` and configure the private reader locally for a clean checkout; production output is disabled by default in the example.

Nick's departure steps: check build 20, sign into his own OPS account in Chase, connect to the vehicle network/Tailscale, open Chase, and press GO LIVE. This starts the field uplink; the producer separately verifies PROGRAM and audio, sends the encoder to Facebook, and publishes on Nick's Page. Nick does not need to sign into Facebook or receive the producer's Facebook credentials. Verify comments and the first Page reply once the real broadcast starts.

For the show:

1. Keep OBS closed.
2. Confirm Nick's Page in Facebook Live Producer and disable automatic publication unless that behavior is intentional.
3. Start the native preview pipeline and wait for fresh video and audio.
4. Start Facebook output, verify Facebook is receiving the correct PROGRAM composition, and run a private/unlisted rehearsal.
5. Confirm Chase build 20 shows Facebook comments as connected.
6. Only then use Facebook's Go Live control.
7. When finished, stop Facebook output first and then stop the preview pipeline. Confirm both controls show OFF/STANDBY.

The production output lock is `runtime\production-output.lock`. The Facebook output owns it while requested and refuses to start when OBS is running.

The OPS integration contract is in `OPS-PRODUCER-INTEGRATION.md`. Never expose the loopback producer port through a public tunnel.
