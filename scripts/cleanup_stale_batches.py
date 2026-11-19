import sqlite3
import json
import os

db_path = 'data/jobs.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    with conn:
        conn.execute("UPDATE batch_sessions SET status = 'cancelled' WHERE status = 'running'")
    conn.close()

json_path = 'data/batch_sessions.json'
if os.path.exists(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    for k, v in data.items():
        if v.get('status') == 'running':
            v['status'] = 'cancelled'
            for it in v.get('items', []):
                if it.get('status') == 'processing':
                    it['status'] = 'cancelled'

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

print("Batch sessions cleaned successfully.")
