from aiogram import Router, F
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from aiogram.types import Message
import database as db
from config import ADMIN_ID

router = Router()

def admin_only(func):
    async def wrapper(event, *args, **kwargs):
        user_id = event.from_user.id if hasattr(event, 'from_user') else None
        if user_id != ADMIN_ID:
            return
        return await func(event, *args, **kwargs)
    wrapper.__name__ = func.__name__
    return wrapper

@router.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(
        "🔧 Админ панель",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📥 Заявки на пополнение", callback_data="admin_deposits")],
            [InlineKeyboardButton(text="📤 Заявки на вывод", callback_data="admin_withdrawals")],
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
        text += f"#{dep_id} | Юзер: {user_id} | Сумма: {amount} | {created_at}\n"
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
        text += f"#{w_id} | Юзер: {user_id} | Сумма: {amount} | {created_at}\n"
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
        await bot.send_message(row[0], f"✅ Пополнение #{dep_id} на {row[1]} монет подтверждено!")
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
        await bot.send_message(row[0], f"✅ Вывод #{w_id} на {row[1]} монет выполнен!")
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
        ])
    )
