"""Install and test canonical focal assignment atomically; never log personnel."""
import os
import json
import uuid
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb

with psycopg.connect(host="aws-1-us-east-2.pooler.supabase.com",port=5432,
    user="postgres.qibhnkzgbnzavyelybgd",dbname="postgres",
    password=os.environ["SUPABASE_DB_PASSWORD"],sslmode="require",connect_timeout=20) as conn:
    conn.execute("set statement_timeout = '30s'")
    conn.execute("select pg_advisory_xact_lock(784658712)")
    conn.execute(Path("docs/repair-personal-focal-assignment.sql").read_text())
    default_id = conn.execute("select public.aircontrol_default_focal_id()").fetchone()[0]
    if not default_id: raise RuntimeError("No active default focal; rolling back repair")
    chosen_id, chosen_name = conn.execute("""
      select id, name from public.aircontrol_users
      where active and coalesce(to_jsonb(aircontrol_users)->>'deleted_at', '') = ''
      order by (id <> %s) desc, id limit 1
    """, (default_id,)).fetchone()
    conn.execute("savepoint regression_probes")
    conn.execute("set local role service_role")
    def insert_probe(focal_id, name):
        return conn.execute("""
          insert into public.aircontrol_personal (id,name,email,focal_user_id,excel_fields)
          values (%s,'__focal_assignment_regression_probe__',null,%s,%s)
          returning id,focal_user_id
        """, (uuid.uuid4(),focal_id,Jsonb({"FOCAL":name}))).fetchone()
    probe_id, resolved = insert_probe(uuid.uuid4(), chosen_name.upper())
    assert resolved == chosen_id, "Invalid UUID must resolve by Excel focal name"
    _, resolved = insert_probe(None, "")
    assert resolved == default_id, "Empty focal must use configured default"
    _, resolved = insert_probe(uuid.uuid4(), "Sin focal")
    assert resolved == default_id, "Unresolvable focal must use configured default"
    _, resolved = insert_probe(chosen_id, "")
    assert resolved == chosen_id, "Existing valid assignment must be preserved"
    resolved = conn.execute("""
       update public.aircontrol_personal set focal_user_id=%s,excel_fields=%s
       where id=%s returning focal_user_id
    """, (uuid.uuid4(),Jsonb({"FOCAL":chosen_name}),probe_id)).fetchone()[0]
    assert resolved == chosen_id, "Updates must resolve stale focal IDs"
    conn.execute("rollback to savepoint regression_probes")
    # This also persists the initial Rosa selection in the shared configuration.
    conn.execute("""
      insert into public.aircontrol_column_config
        (id,excel_header,display_name,display_order,data_type,load_to_db,show_in_personal)
      values ('6f0973b1-1472-4c3e-84c1-d41fa9912b78','__aircontrol_default_focal__',%s,-1,'text',false,false)
      on conflict (excel_header) do nothing
    """, (str(default_id),))
    repaired = conn.execute("""
      update public.aircontrol_personal set focal_user_id=null,updated_at=now()
      where focal_user_id is null
    """).rowcount
    constraints = conn.execute("""
      select count(*) from pg_constraint where conrelid='public.aircontrol_personal'::regclass
      and conname='aircontrol_personal_focal_user_id_fkey' and contype='f' and convalidated
    """).fetchone()[0]
    assert constraints == 1, "Original validated foreign key must remain"
    conn.commit()
    print(json.dumps({"repair_committed":True,"database_regression_checks":5,
      "test_rows_persisted":0,"previously_unassigned_rows_repaired":repaired,
      "original_foreign_key_preserved":True,"shared_default_saved":True}))
