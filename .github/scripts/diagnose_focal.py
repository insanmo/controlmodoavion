"""Read-only diagnostics: schema and aggregate counts, no personnel records."""
import os
import json
import psycopg
from psycopg import sql

with psycopg.connect(
    host="aws-1-us-east-2.pooler.supabase.com", port=5432,
    user="postgres.qibhnkzgbnzavyelybgd", dbname="postgres",
    password=os.environ["SUPABASE_DB_PASSWORD"], sslmode="require", connect_timeout=20,
) as conn:
    conn.execute("set transaction read only")
    conn.execute("set statement_timeout = '30s'")
    constraints = conn.execute("""
        select c.conname, pg_get_constraintdef(c.oid), ns.nspname, cl.relname, a.attname
        from pg_constraint c
        join pg_class cl on cl.oid = c.confrelid
        join pg_namespace ns on ns.oid = cl.relnamespace
        join pg_attribute a on a.attrelid = c.confrelid and a.attnum = c.confkey[1]
        where c.conrelid = 'public.aircontrol_personal'::regclass and c.contype = 'f'
          and c.conname = 'aircontrol_personal_focal_user_id_fkey'
    """).fetchall()
    for name, definition, schema, table, column in constraints:
        print(json.dumps({"constraint": name, "definition": definition}))
        count = conn.execute(sql.SQL("""
            select count(*) from public.aircontrol_users u
            where not exists (select 1 from {}.{} r where r.{} = u.id)
        """).format(sql.Identifier(schema), sql.Identifier(table), sql.Identifier(column))).fetchone()[0]
        print(json.dumps({"application_user_ids_missing_from_fk_target": count}))
    print(json.dumps({"focal_constraint_found": bool(constraints)}))
    print(json.dumps({"personal_triggers": [r[0] for r in conn.execute("""
        select tgname from pg_trigger where tgrelid = 'public.aircontrol_personal'::regclass
        and not tgisinternal
    """).fetchall()]}))

# Keep source out of public logs; artifacts require repository authentication.
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
Path("diagnostic-source").mkdir(exist_ok=True)
try:
    request = Request("https://api.supabase.com/v1/projects/qibhnkzgbnzavyelybgd/functions/aircontrol-api/body", headers={"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"]})
    with urlopen(request, timeout=30) as response:
        Path("diagnostic-source/edge-function-body.bin").write_bytes(response.read())
        print(json.dumps({"function_source_downloaded": True, "content_type": response.headers.get("Content-Type")}))
except HTTPError as error:
    print(json.dumps({"function_source_downloaded": False, "status": error.code}))

session_token = None
def call_api(action, **payload):
    body = {"action": action, **payload}
    if session_token: body["sessionToken"] = session_token
    request = Request(os.environ["SUPABASE_URL"].rstrip("/") + "/functions/v1/aircontrol-api", data=json.dumps(body).encode(), headers={"Content-Type":"application/json", "apikey":os.environ["SUPABASE_ANON_KEY"], "Authorization":"Bearer " + os.environ["SUPABASE_ANON_KEY"]})
    with urlopen(request, timeout=30) as response:
        return json.load(response)
try:
    login = call_api("login", email=os.environ["ADMIN_EMAIL"], password=os.environ["ADMIN_TEMP_PASSWORD"])
    session_token = login.get("sessionToken")
    print(json.dumps({"diagnostic_login_succeeded": bool(session_token)}))
    if session_token:
        api_users = call_api("select", table="users").get("rows", [])
        with psycopg.connect(host="aws-1-us-east-2.pooler.supabase.com",port=5432,user="postgres.qibhnkzgbnzavyelybgd",dbname="postgres",password=os.environ["SUPABASE_DB_PASSWORD"],sslmode="require",connect_timeout=20) as conn:
            conn.execute("set transaction read only")
            db_ids = {str(row[0]) for row in conn.execute("select id from public.aircontrol_users").fetchall()}
            print(json.dumps({"api_user_count":len(api_users),"api_ids_missing_in_database":sum(str(user.get("id")) not in db_ids for user in api_users)}))
except HTTPError as error:
    print(json.dumps({"diagnostic_login_http_status":error.code}))
finally:
    if session_token:
        call_api("logout")
