$device = 'R5GL53J3Y4J'
function Tap($x,$y) { adb -s $device shell input tap $x $y | Out-Null; Start-Sleep -Milliseconds 180 }
function Swipe($x1,$y1,$x2,$y2,$ms=300) { adb -s $device shell input swipe $x1 $y1 $x2 $y2 $ms | Out-Null; Start-Sleep -Milliseconds 300 }
# Product switching on Page 1
for ($i=0; $i -lt 30; $i++) {
  Tap 545 1003; Tap 620 1003; Tap 699 1003; Tap 767 1003
}
# Recenter actions
for ($i=0; $i -lt 10; $i++) { Tap 707 1124 }
# Expanded open/close cycles via OPEN button and Android Back
for ($i=0; $i -lt 10; $i++) {
  Tap 1050 628
  Start-Sleep -Milliseconds 700
  adb -s $device shell input keyevent KEYCODE_BACK | Out-Null
  Start-Sleep -Milliseconds 600
}
# Background/resume cycles
for ($i=0; $i -lt 10; $i++) {
  adb -s $device shell input keyevent KEYCODE_HOME | Out-Null
  Start-Sleep -Milliseconds 450
  adb -s $device shell am start -n com.codeblackwx.ops/.MainActivity | Out-Null
  Start-Sleep -Milliseconds 900
}
# Restarts
for ($i=0; $i -lt 5; $i++) {
  adb -s $device shell am force-stop com.codeblackwx.ops | Out-Null
  Start-Sleep -Milliseconds 350
  adb -s $device shell am start -n com.codeblackwx.ops/.MainActivity | Out-Null
  Start-Sleep -Seconds 2
}
# Return to Page 1 and REF/Chase-like production state
adb -s $device shell am start -n com.codeblackwx.ops/.MainActivity | Out-Null
Start-Sleep -Seconds 3
Tap 545 1003
