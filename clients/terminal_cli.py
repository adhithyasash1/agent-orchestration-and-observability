"""
Simple pure-Python Terminal Chat interface for AgentOS.
"""
import httpx
import sys
import asyncio

URL = "http://localhost:8000/api/v1/runs"

async def chat():
    print("Welcome to AgentOS CLI! Type 'q' or 'quit' to exit.")
    
    async with httpx.AsyncClient(timeout=180) as client:
        while True:
            try:
                user_input = input("\n[You]: ")
                if user_input.lower() in ("q", "quit", "exit"):
                    break
                if not user_input.strip():
                    continue
                
                print("AgentOS is thinking...", end="\r")
                res = await client.post(URL, json={"input": user_input})
                res.raise_for_status()
                data = res.json()
                
                print("\033[K[AgentOS]:", data.get("answer", "No answer returned.") + "\n")
                
                if data.get("tool_calls"):
                    print(f"  [Used Tools: {', '.join([t['tool'] for t in data['tool_calls']])}]")
                
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"[Error] Pipeline failure: {e}")

if __name__ == "__main__":
    asyncio.run(chat())
