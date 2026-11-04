"""Read-only overlap counts; never print names, IDs, dates, or personnel rows."""
import os,json,hashlib
import psycopg
with psycopg.connect(host="aws-1-us-east-2.pooler.supabase.com",port=5432,
    user="postgres.qibhnkzgbnzavyelybgd",dbname="postgres",
    password=os.environ["SUPABASE_DB_PASSWORD"],sslmode="require",connect_timeout=20) as conn:
    conn.execute("set transaction read only")
    conn.execute("set statement_timeout = '30s'")
    people = conn.execute("""
      select id,public.aircontrol_focal_name_key(name),status,
        coalesce(to_jsonb(p)->>'deleted_at','')
      from public.aircontrol_personal p
    """).fetchall()
    ids=[r[0] for r in people if hashlib.sha256(r[1].encode()).hexdigest()==os.environ["COLLABORATOR_KEY"] and not r[3]]
    if not ids: print(json.dumps({"matched_people":0})); raise SystemExit(0)
    rows=conn.execute("""
      select v.status,v.deleted_at,v.reprogrammed_to_id,
        (v.start_date <= (%s || '-01')::date + interval '1 month' - interval '1 day'
         and v.end_date >= (%s || '-01')::date) as shown_in_selected_month
      from public.aircontrol_vacations v
      where v.collaborator_id=any(%s) and v.type='vacaciones'
        and v.start_date <= %s::date and v.end_date >= %s::date
    """,(os.environ["VISIBLE_MONTH"],os.environ["VISIBLE_MONTH"],ids,os.environ["END_DATE"],os.environ["START_DATE"])).fetchall()
    active=[r for r in rows if not r[1] and not (r[0]=='Reprogramado' and r[2])]
    print(json.dumps({"matched_people":len(ids),"active_overlaps":len(active),
      "active_overlaps_shown_in_selected_month":sum(bool(r[3]) for r in active),
      "superseded_overlaps":sum(not r[1] and r[0]=='Reprogramado' and bool(r[2]) for r in rows),
      "deleted_overlaps":sum(bool(r[1]) for r in rows)}))
