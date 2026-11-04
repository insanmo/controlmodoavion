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
