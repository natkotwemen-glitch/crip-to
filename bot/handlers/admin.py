from aiogram import Router, F
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from aiogram.types import Message
import database as db
from config import ADMIN_ID

router = Router()

@router.message(Command("setbalance"))
async def set_balance_cmd(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    parts = message.text.split()
    if len(parts) != 3:
        await message.answer("Использование: /setbalance <user_id> <сумма>")
        return
    try:
        uid = int(parts[1])
        amount = float(parts[2])
    except ValueError:
        await message.answer("Неверный формат.")
        return
    db.set_balance(uid, amount)
    await message.answer(f"✅ Баланс юзера {uid} установлен: {amount} USD")

@router.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(
        "🔧 Админ панель",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📥 Заявки на пополнение", callback_data="admin_deposits")],
            [InlineKeyboardButton(text="📤 Заявки на вывод", callback_data="admin_withdrawals")],
            [InlineKeyboardButton(text="📊 Все открытые позиции", callback_data="admin_positions")],
        ])
    )

@router.callback_query(F.data == "admin_deposits")
async def admin_deposits(call: CallbackQuery):
    if call.from_user.id != ADMIN_ID:
        return
    deps = db.get_pending_deposits()
    if not deps:
        await call.message.edit_text("Нет заявок на пополнение.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_back")]
        ]))
        return
    text = "📥 Заявки на пополнение:\n\n"
    buttons = []
    for dep in deps:
        dep_id, user_id, amount, created_at = dep
        text += f"#{dep_id} | Юзер: {user_id} | Сумма: {amount} USD | {created_at}\n"
        buttons.append([
            InlineKeyboardButton(text=f"✅ #{dep_id}", callback_data=f"dep_approve_{dep_id}"),
            InlineKeyboardButton(text=f"❌ #{dep_id}", callback_data=f"dep_reject_{dep_id}")
        ])
    buttons.append([InlineKeyboardButton(text="🔙 Назад", callback_data="admin_back")])
    await call.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))

@router.callback_query(F.data == "admin_withdrawals")
async def admin_withdrawals(call: CallbackQuery):
    if call.from_user.id != ADMIN_ID:
        return
    wds = db.get_pending_withdrawals()
    if not wds:
        await call.message.edit_text("Нет заявок на вывод.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_back")]
        ]))
        return
    text = "📤 Заявки на вывод:\n\n"
    buttons = []
    for wd in wds:
        w_id, user_id, amount, created_at = wd
        text += f"#{w_id} | Юзер: {user_id} | Сумма: {amount} USD | {created_at}\n"
        buttons.append([
            InlineKeyboardButton(text=f"✅ #{w_id}", callback_data=f"wd_approve_{w_id}"),
            InlineKeyboardButton(text=f"❌ #{w_id}", callback_data=f"wd_reject_{w_id}")
        ])
    buttons.append([InlineKeyboardButton(text="🔙 Назад", callback_data="admin_back")])
    await call.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))

@router.callback_query(F.data.startswith("dep_approve_"))
async def dep_approve(call: CallbackQuery):
    if call.from_user.id != ADMIN_ID:
        return
    dep_id = int(call.data.split("_")[2])
    row = db.resolve_deposit(dep_id, "approved")
    if row:
        from main import bot
        await bot.send_message(row[0], f"✅ Пополнение #{dep_id} на {row[1]} USD подтверждено!")
    await call.message.edit_text(f"✅ Заявка #{dep_id} принята.")

@router.callback_query(F.data.startswith("dep_reject_"))
async def dep_reject(call: CallbackQuery):
    if call.from_user.id != ADMIN_ID:
        return
    dep_id = int(call.data.split("_")[2])
    row = db.resolve_deposit(dep_id, "rejected")
    if row:
        from main import bot
        await bot.send_message(row[0], f"❌ Пополнение #{dep_id} отклонено.")
    await call.message.edit_text(f"❌ Заявка #{dep_id} отклонена.")

@router.callback_query(F.data.startswith("wd_approve_"))
async def wd_approve(call: CallbackQuery):
    if call.from_user.id != ADMIN_ID:
        return
    w_id = int(call.data.split("_")[2])
    row = db.resolve_withdrawal(w_id, "approved")
    if row:
        from main import bot
        await bot.send_message(row[0], f"✅ Вывод #{w_id} на {row[1]} USD выполнен!")
    await call.message.edit_text(f"✅ Вывод #{w_id} выполнен.")

@router.callback_query(F.data.startswith("wd_reject_"))
async def wd_reject(call: CallbackQuery):
    if call.from_user.id != ADMIN_ID:
        return
    w_id = int(call.data.split("_")[2])
    row = db.resolve_withdrawal(w_id, "rejected")
    if row:
        from main import bot
        await bot.send_message(row[0], f"❌ Вывод #{w_id} отклонён, средства возвращены.")
    await call.message.edit_text(f"❌ Вывод #{w_id} отклонён.")

@router.callback_query(F.data == "admin_back")
async def admin_back(call: CallbackQuery):
    if call.from_user.id != ADMIN_ID:
        return
    await call.message.edit_text(
        "🔧 Админ панель",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📥 Заявки на пополнение", callback_data="admin_deposits")],
            [InlineKeyboardButton(text="📤 Заявки на вывод", callback_data="admin_withdrawals")],
            [InlineKeyboardButton(text="📊 Все открытые позиции", callback_data="admin_positions")],
        ])
    )

@router.callback_query(F.data == "admin_positions")
async def admin_positions(call: CallbackQuery):
    if call.from_user.id != ADMIN_ID:
        return
    positions = db.get_all_open_positions()
    if not positions:
        await call.message.edit_text("Нет открытых позиций.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_back")]
        ]))
        return
    from utils.prices import get_price, calc_pnl
    text = "📊 Все открытые позиции:\n\n"
    buttons = []
    for pos in positions:
        pos_id, user_id, symbol, direction, leverage, amount, entry_price, status, created_at = pos
        current_price = await get_price(symbol)
        pnl = calc_pnl(direction, leverage, amount, entry_price, current_price)
        emoji = "🟢" if pnl >= 0 else "🔴"
        text += (
            f"#{pos_id} | Юзер: {user_id}\n"
            f"{symbol} {'LONG' if direction == 'long' else 'SHORT'} x{leverage}\n"
            f"Вход: ${entry_price:,.2f} | Сейчас: ${current_price:,.2f}\n"
            f"{emoji} PnL: {pnl:+.2f} USD\n\n"
        )
        buttons.append([InlineKeyboardButton(text=f"💥 Ликвидировать #{pos_id}", callback_data=f"admin_liq_{pos_id}")])
    buttons.append([InlineKeyboardButton(text="🔙 Назад", callback_data="admin_back")])
    if len(text) > 4000:
        text = text[:4000] + "\n..."
    await call.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))

@router.callback_query(F.data.startswith("admin_liq_"))
async def admin_liquidate(call: CallbackQuery):
    if call.from_user.id != ADMIN_ID:
        return
    pos_id = int(call.data.split("_")[2])
    positions = db.get_all_open_positions()
    pos = next((p for p in positions if p[0] == pos_id), None)
    if not pos:
        await call.answer("Позиция не найдена.")
        return
    _, user_id, symbol, direction, leverage, amount, entry_price, status, created_at = pos
    from utils.prices import get_price
    current_price = await get_price(symbol)
    db.close_position(pos_id, -amount)
    from main import bot
    await bot.send_message(
        user_id,
        f"⚠️ Извините, но ваша позиция была ликвидирована.\n\n"
        f"📌 #{pos_id} {symbol} {'LONG' if direction == 'long' else 'SHORT'} x{leverage}\n"
        f"💵 Цена входа: ${entry_price:,.2f}\n"
        f"📉 Цена ликвидации: ${current_price:,.2f}\n"
        f"💸 Потеря: -{amount:.2f} USD"
    )
    await call.answer(f"Позиция #{pos_id} ликвидирована.")
    await admin_positions(call)
