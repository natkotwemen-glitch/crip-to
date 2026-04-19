from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, ReplyKeyboardMarkup, KeyboardButton
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
import database as db

router = Router()

class DepositState(StatesGroup):
    waiting_amount = State()

class WithdrawState(StatesGroup):
    waiting_amount = State()

def main_menu():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="💰 Баланс"), KeyboardButton(text="📊 Торговля")],
            [KeyboardButton(text="📥 Пополнить"), KeyboardButton(text="📤 Вывести")],
            [KeyboardButton(text="📋 Мои позиции")],
        ],
        resize_keyboard=True
    )

@router.message(CommandStart())
async def start(message: Message):
    db.create_user(message.from_user.id, message.from_user.username)
    await message.answer(
        "👋 Добро пожаловать на OG Exchange!\n\n"
        "Торгуй криптой с плечом до x100.\n"
        "Нажми кнопку меню чтобы открыть биржу 📈",
        reply_markup=main_menu()
    )

@router.message(CommandStart())
async def start_cmd(message: Message):
    db.create_user(message.from_user.id, message.from_user.username)

@router.message(F.text == "💰 Баланс")
@router.message(Command("balance"))
async def show_balance(message: Message):
    bal = db.get_balance(message.from_user.id)
    await message.answer(f"💰 Твой баланс: <b>{bal:.2f} USD</b>", parse_mode="HTML")

@router.message(Command("positions"))
async def show_positions_cmd(message: Message):
    from utils.prices import get_price, calc_pnl
    positions = db.get_open_positions(message.from_user.id)
    if not positions:
        await message.answer("У тебя нет открытых позиций.")
        return
    text = "📋 Твои открытые позиции:\n\n"
    buttons = []
    for pos in positions:
        pos_id, user_id, symbol, direction, leverage, amount, entry_price, status, created_at = pos
        current_price = await get_price(symbol)
        pnl = calc_pnl(direction, leverage, amount, entry_price, current_price)
        emoji = "🟢" if pnl >= 0 else "🔴"
        liq_ch = 1 / leverage
        liq_price = entry_price * (1 - liq_ch) if direction == 'long' else entry_price * (1 + liq_ch)
        text += (
            f"#{pos_id} {symbol} {'LONG 📈' if direction == 'long' else 'SHORT 📉'} x{leverage}\n"
            f"💵 Вход: ${entry_price:,.2f} | Сейчас: ${current_price:,.2f}\n"
            f"💥 Ликвидация: ${liq_price:,.2f}\n"
            f"{emoji} PnL: {pnl:+.2f} USD\n\n"
        )
        buttons.append([InlineKeyboardButton(text=f"❌ Закрыть #{pos_id}", callback_data=f"close_{pos_id}")])
    await message.answer(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))

@router.message(F.text == "📥 Пополнить")
async def deposit_start(message: Message, state: FSMContext):
    await message.answer("Введи сумму пополнения (USD):")
    await state.set_state(DepositState.waiting_amount)

@router.message(DepositState.waiting_amount)
async def deposit_amount(message: Message, state: FSMContext):
    if message.text in ["💰 Баланс", "📊 Торговля", "📥 Пополнить", "📤 Вывести", "📋 Мои позиции"]:
        await state.clear()
        await message.answer("Действие отменено.", reply_markup=main_menu())
        return
    try:
        amount = float(message.text.replace(",", "."))
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer("Введи корректную сумму.")
        return
    dep_id = db.create_deposit(message.from_user.id, amount)
    await state.clear()
    from config import ADMIN_ID
    from main import bot
    await bot.send_message(
        ADMIN_ID,
        f"📥 Заявка на пополнение #{dep_id}\n"
        f"👤 @{message.from_user.username} (ID: {message.from_user.id})\n"
        f"💰 Сумма: {amount} USD",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="✅ Принять", callback_data=f"dep_approve_{dep_id}"),
             InlineKeyboardButton(text="❌ Отклонить", callback_data=f"dep_reject_{dep_id}")]
        ])
    )
    await message.answer(f"✅ Заявка #{dep_id} отправлена. Ожидай подтверждения.", reply_markup=main_menu())

@router.message(F.text == "📤 Вывести")
async def withdraw_start(message: Message, state: FSMContext):
    bal = db.get_balance(message.from_user.id)
    await message.answer(f"💰 Баланс: {bal:.2f} USD\nВведи сумму для вывода:")
    await state.set_state(WithdrawState.waiting_amount)

@router.message(WithdrawState.waiting_amount)
async def withdraw_amount(message: Message, state: FSMContext):
    if message.text in ["💰 Баланс", "📊 Торговля", "📥 Пополнить", "📤 Вывести", "📋 Мои позиции"]:
        await state.clear()
        await message.answer("Действие отменено.", reply_markup=main_menu())
        return
    try:
        amount = float(message.text.replace(",", "."))
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer("Введи корректную сумму.")
        return
    bal = db.get_balance(message.from_user.id)
    if amount > bal:
        await message.answer(f"Недостаточно средств. Баланс: {bal:.2f} USD")
        return
    w_id = db.create_withdrawal(message.from_user.id, amount)
    await state.clear()
    from config import ADMIN_ID
    from main import bot
    await bot.send_message(
        ADMIN_ID,
        f"📤 Заявка на вывод #{w_id}\n"
        f"👤 @{message.from_user.username} (ID: {message.from_user.id})\n"
        f"💰 Сумма: {amount} USD",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="✅ Выплачено", callback_data=f"wd_approve_{w_id}"),
             InlineKeyboardButton(text="❌ Отклонить", callback_data=f"wd_reject_{w_id}")]
        ])
    )
    await message.answer(f"✅ Заявка #{w_id} на вывод отправлена. Ожидай.", reply_markup=main_menu())
