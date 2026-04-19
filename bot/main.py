import asyncio
from aiogram import Bot, Dispatcher
from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo
from aiohttp import web
from config import BOT_TOKEN, WEBAPP_URL
import database as db
from handlers import user, trading, admin
from server import create_app

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

async def main():
    db.init_db()
    dp.include_router(admin.router)
    dp.include_router(user.router)
    dp.include_router(trading.router)

    # Кнопка меню -> открывает WebApp
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="📈 Открыть биржу", web_app=WebAppInfo(url=WEBAPP_URL))
    )
    await bot.set_my_commands([BotCommand(command="start", description="Запустить бота")])

    # Запускаем API сервер и бота параллельно
    api_app = create_app()
    runner = web.AppRunner(api_app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 8080)
    await site.start()
    print("API сервер запущен на порту 8080")

    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
