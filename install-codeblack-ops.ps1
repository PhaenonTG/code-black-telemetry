$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

npm run lint
npm run build
npx cap sync android
.\android\gradlew.bat -p android assembleDebug
adb install -r "android\app\build\outputs\apk\debug\app-debug.apk"
