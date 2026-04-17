import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

from agentos.runtime.trace import TraceStore

def main():
    ap = argparse.ArgumentParser(description="Replay a trace run for debugging")
    ap.add_argument("--run-id", required=True, help="Run ID to pull from TraceStore")
    ap.add_argument("--db", default=str(PROJECT_ROOT / "data" / "agentos.db"), help="SQLite path")
    args = ap.parse_args()

    store = TraceStore(args.db)
    run_data = store.get_run(args.run_id)
    
    if not run_data:
        print(f"ERROR: No run found for run_id={args.run_id}")
        sys.exit(1)
        
    print(f"\n==========================================")
    print(f"▶ REPLAY RUN: {args.run_id} | Profile: {run_data['profile']}")
    print(f"==========================================")
    print(f"[INPUT]: {run_data['user_input']}\n")
    
    # Dump formatted transitions simulating ReAct pipeline outputs
    transitions = run_data.get("transitions", [])
    for t in transitions:
        step = t["step"]
        stage = t["stage"]
        
        print(f"--- Step {step} | Stage: {stage.upper()} ---")
        if t["action"]:
            try:
                action = json.loads(t["action"]) if isinstance(t["action"], str) else t["action"]
                print(f"🔧 ACTION: {json.dumps(action, indent=2)}")
            except Exception:
                print(f"🔧 ACTION: {t['action']}")
                
        if t["observation"]:
            obs = t["observation"]
            if isinstance(obs, str) and len(obs) > 500:
                obs = obs[:500] + "... [truncated]"
            print(f"👁️ OBSERVATION: {obs}")
            
        print()
    
    print(f"==========================================")
    print(f"✅ FINAL OUTPUT [{run_data['status']}]:")
    print(run_data["final_output"])
    print(f"==========================================")

if __name__ == "__main__":
    main()
