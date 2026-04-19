import asyncio
from aiogram import Bot, Dispatcher
from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo
from aiohttp import web
from config import BOT_TOKEN, WEBAPP_URL
import database as db
from handlers import user, trading, admin
from server import create_app
from utils.prices import get_price, calc_pnl

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

async def monitor_positions():
    """Фоновая задача: проверяет ликвидацию каждые 30 сек"""
    await asyncio.sleep(15)
    while True:
        try:
            positions = db.get_all_open_positions()
            for pos in positions:
                pos_id, user_id, symbol, direction, leverage, amount, entry_price, status, created_at = pos
                try:
                    current_price = await get_price(symbol)
                    if not current_price:
                        continue
                    pnl = calc_pnl(direction, leverage, amount, entry_price, current_price)
                    if pnl <= -amount:
                        db.close_position(pos_id, -amount)
                        try:
                            await bot.send_message(
                                user_id,
                                f"⚠️ Извините, но ваша позиция была ликвидирована.\n\n"
                                f"📌 #{pos_id} {symbol} {'LONG' if direction == 'long' else 'SHORT'} x{leverage}\n"
                                f"Цена входа: {entry_price:,.2f}\n"
                                f"Цена ликвидации: {current_price:,.2f}\n"
                                f"💸 Потеря: ₽{round(amount):,}".replace(',', ' ')
                            )
                        except Exception:
                            pass
                except Exception:
                    continue
        except Exception as e:
            print(f"monitor error: {e}")
        await asyncio.sleep(30)

async def main():
    db.init_db()
    dp.include_router(admin.router)
    dp.include_router(user.router)
    dp.include_router(trading.router)

    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="📈 Открыть биржу", web_app=WebAppInfo(url=WEBAPP_URL))
    )
    await bot.set_my_commands([
        BotCommand(command="start", description="Запустить бота"),
        BotCommand(command="balance", description="Мой баланс"),
        BotCommand(command="positions", description="Мои позиции"),
        BotCommand(command="admin", description="Админ панель"),
    ])

    api_app = create_app()
    runner = web.AppRunner(api_app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 8080)
    await site.start()
    print("API сервер запущен на порту 8080")

    asyncio.create_task(monitor_positions())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
