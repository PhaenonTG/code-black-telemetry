# Radar Loop Regression Results

- Atlas Page 1: passed
- Expanded Atlas: passed
- Android Back: passed
- REF current frame/history: passed
- VEL current frame/history: passed
- SRV current frame/history: passed
- CC current frame/history: passed
- Labels above radar: passed by screenshot inspection
- Vehicle marker: passed by screenshot inspection
- Camera state independence: passed during product/loop stress; no map remount observed visually
- Cached radar: passed`n- Offline cached frame: passed with Wi-Fi disabled and cached REF history visible
- Legacy rollback: code path retained; not switched during final installed Atlas-default run
- Native decoder/JNI: unchanged by this sprint and product frames generated from existing cached Level II output

