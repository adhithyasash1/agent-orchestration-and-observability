import os
import httpx
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes

TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "YOUR_TOKEN_HERE")
AGENTOS_URL = "http://localhost:8000/api/v1/runs"

async def chat_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    prompt = update.message.text
    if not prompt:
        return

    # Send typing action
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action='typing')
    
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            res = await client.post(AGENTOS_URL, json={"input": prompt})
            res.raise_for_status()
            answer = res.json().get("answer", "Empty response from AgentOS.")
        
        await context.bot.send_message(chat_id=update.effective_chat.id, text=answer)
    except Exception as e:
        await context.bot.send_message(
            chat_id=update.effective_chat.id, 
            text=f"⚠️ Error reaching AgentOS: {str(e)}"
        )

if __name__ == '__main__':
    if TELEGRAM_TOKEN != "YOUR_TOKEN_HERE":
        app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
        app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), chat_handler))
        print("Telegram bot adapter started...")
        app.run_polling()
    else:
        print("Please set TELEGRAM_BOT_TOKEN to launch out-of-band Telegram adapter!")
