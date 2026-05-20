@echo off
echo Запуск OG Exchange...

:: Запускаем бота в отдельном окне
start "OG Bot" cmd /k "cd /d %~dp0bot && python main.py"

:: Ждём 3 секунды пока бот запустится
timeout /t 3 /nobreak > nul

:: Запускаем cloudflare tunnel в отдельном окне
start "Cloudflare Tunnel" cmd /k "cd /d %USERPROFILE%\Downloads && cloudflared-windows-amd64.exe tunnel --url http://localhost:8080 --protocol http2"

echo.
echo Бот запущен!
echo Смотри окно "Cloudflare Tunnel" - там будет URL типа https://xxxx.trycloudflare.com
echo Скопируй этот URL и вставь в app.js вместо текущего API адреса
echo.
pause
