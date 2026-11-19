import sqlite3

conn = sqlite3.connect('data/jobs.db')
with conn:
    conn.execute("DELETE FROM tenants WHERE tenant_id IN ('tenant_beta', 'tenant_capped')")
    conn.execute("UPDATE tenants SET tenant_id = 'studio_main', name = 'Studio Workspace' WHERE tenant_id = 'tenant_alpha'")
    conn.execute("DELETE FROM tenant_quotas WHERE tenant_id IN ('tenant_beta', 'tenant_capped')")
    conn.execute("UPDATE tenant_quotas SET tenant_id = 'studio_main' WHERE tenant_id = 'tenant_alpha'")

cursor = conn.cursor()
cursor.execute('SELECT tenant_id, name FROM tenants')
print("Updated tenants:", cursor.fetchall())
conn.close()
