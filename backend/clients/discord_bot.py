import discord
import httpx
import os

DISCORD_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "YOUR_TOKEN_HERE")
AGENTOS_URL = "http://localhost:8000/api/v1/runs"

intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f'AgentOS logged in as {client.user}')

@client.event
async def on_message(message):
    if message.author == client.user:
        return

    if client.user.mentioned_in(message) or isinstance(message.channel, discord.DMChannel):
        prompt = message.content.replace(f'<@{client.user.id}>', '').strip()
        
        async with message.channel.typing():
            try:
                async with httpx.AsyncClient(timeout=180) as http_client:
                    res = await http_client.post(AGENTOS_URL, json={"input": prompt})
                    res.raise_for_status()
                    answer = res.json().get("answer", "Received empty response from AgentOS.")
                    
                # Split large message into chunks for discord limit
                for i in range(0, len(answer), 2000):
                    await message.channel.send(answer[i:i+2000])
                    
            except Exception as e:
                await message.channel.send(f"⚠️ Error reaching AgentOS backend: `{str(e)}`")

if __name__ == "__main__":
    if DISCORD_TOKEN != "YOUR_TOKEN_HERE":
        client.run(DISCORD_TOKEN)
    else:
        print("Please set DISCORD_BOT_TOKEN to launch out-of-band Discord adapter!")
