import ast
import inspect
import json
import os
import re
from yt_clipping.web import server

with open('src/yt_clipping/web/server.py', 'r', encoding='utf-8') as f:
    code = f.read()

tree = ast.parse(code)

# 1. Routes and contracts
routes_info = []
for r in server.app.routes:
    if r.__class__.__name__ == 'APIRoute':
        ep = r.endpoint
        try:
            lines, start = inspect.getsourcelines(ep)
            end = start + len(lines) - 1
        except Exception:
            start, end = -1, -1
        routes_info.append({
            'methods': sorted(list(r.methods)),
            'path': r.path,
            'name': r.name,
            'endpoint': ep.__name__,
            'start': start,
            'end': end,
            'response_model': str(r.response_model) if r.response_model else None,
            'status_code': r.status_code,
            'tags': r.tags,
            'summary': r.summary,
        })
    elif r.__class__.__name__ == 'Mount':
        routes_info.append({
            'type': 'mount',
            'path': r.path,
            'name': r.name,
        })

# 2. Module globals and assignments
assignments = []
for node in tree.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name):
                assignments.append(target.id)

# 3. Functions
functions = []
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        decs = []
        for dec in node.decorator_list:
            if isinstance(dec, ast.Name):
                decs.append(dec.id)
            elif isinstance(dec, ast.Attribute):
                val_id = dec.value.id if isinstance(dec.value, ast.Name) else ''
                decs.append(f"{val_id}.{dec.attr}")
            elif isinstance(dec, ast.Call):
                func = dec.func
                if isinstance(func, ast.Attribute):
                    val_id = func.value.id if isinstance(func.value, ast.Name) else ''
                    decs.append(f"{val_id}.{func.attr}")
                elif isinstance(func, ast.Name):
                    decs.append(func.id)
        functions.append({
            'name': node.name,
            'is_async': isinstance(node, ast.AsyncFunctionDef),
            'decorators': decs,
            'lineno': node.lineno
        })

helper_functions = [f for f in functions if not any('app.' in d for d in f['decorators']) and f['name'] != 'start_server']

# 4. External imports from yt_clipping.web.server across repo
pattern = re.compile(r'from\s+yt_clipping\.web\.server\s+import\s+([^#\n]+)|import\s+yt_clipping\.web\.server')
external_imports = {}
for root, dirs, files in os.walk('.'):
    if any(p in root for p in ('.git', '.pytest_cache', 'node_modules', '.system_generated', '__pycache__', 'dist', 'build')):
        continue
    for file in files:
        if file.endswith(('.py', '.js', '.ts')):
            path = os.path.join(root, file).replace('\\', '/')
            try:
                with open(path, 'r', encoding='utf-8') as f_in:
                    f_content = f_in.read()
                    for m in pattern.finditer(f_content):
                        external_imports.setdefault(path, []).append(m.group(0).strip())
            except Exception:
                pass

# 5. Middleware and mounts
middleware_info = [str(m) for m in server.app.user_middleware]

# 6. Lifecycle hooks
lifespan_info = str(getattr(server.app.router, 'lifespan_context', None))

audit_data = {
    'total_routes': len(routes_info),
    'routes': routes_info,
    'assignments': assignments,
    'helper_functions': helper_functions,
    'external_imports': external_imports,
    'middleware': middleware_info,
    'lifespan': lifespan_info,
}

os.makedirs('docs/audits', exist_ok=True)
with open('docs/audits/BASELINE_INVENTORY.json', 'w', encoding='utf-8') as f_out:
    json.dump(audit_data, f_out, indent=2)

print("Baseline inventory successfully created at docs/audits/BASELINE_INVENTORY.json")
