import { PGlite } from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { emptyState } from '../src/migration.ts'

test('Postgres commits import and receipt together, deduplicates operations and isolates account reads',async()=>{
  const db=new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key); create function auth.role() returns text language sql as $$select current_setting('request.role',true)$$;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated; grant execute on function auth.uid() to authenticated;`)
    await db.exec(await readFile('supabase/migrations/001_planner.sql','utf8'))
    const owner='31cbb5df-9d55-4290-a8f8-c42d355c1955',other='978d6a8b-4f81-4b2e-836a-0f2e104c2de6',op='8a8f5340-2f3f-4f71-ac44-439bcfc00b6a'
    await db.query('insert into auth.users values($1),($2)',[owner,other])
    await db.exec("select set_config('request.role','service_role',false)")
    const state=emptyState()
    const query='select public.commit_planner_state($1,$2,0,$3,$4,$5) as result'
    const args=[owner,JSON.stringify(state),op,JSON.stringify({ok:true,value:'imported'}),JSON.stringify({sourceId:'native',checksum:'sum',report:{total:231}})]
    const once=await db.query(query,args),twice=await db.query(query,args)
    assert.deepEqual(twice.rows,once.rows)
    assert.equal((await db.query<any>('select revision from planner_states')).rows[0].revision,1)
    assert.equal((await db.query('select * from planner_imports')).rows.length,1)
    const bad=[owner,JSON.stringify(state),'6a354f10-f5f9-4c88-8ff0-2c4470974a5a',JSON.stringify({ok:true}),null]
    await assert.rejects(db.query(query,bad),/revision-conflict/)
    assert.equal((await db.query('select * from planner_operations')).rows.length,1)
    // A failure after updating state also rolls back the whole transaction.
    await assert.rejects(db.query('select public.commit_planner_state($1,$2,1,$3,$4,$5)',[owner,JSON.stringify(state),bad[2],bad[3],JSON.stringify({sourceId:null,checksum:'broken'})]))
    assert.equal((await db.query<any>('select revision from planner_states')).rows[0].revision,1)
    await db.exec(`grant select on planner_states to authenticated; set role authenticated; select set_config('request.uid','${other}',false);`)
    assert.equal((await db.query('select * from planner_states')).rows.length,0)
    await db.exec(`select set_config('request.uid','${owner}',false)`)
    assert.equal((await db.query('select * from planner_states')).rows.length,1)
    await assert.rejects(db.query('update planner_states set revision=99'),/permission denied/)
  } finally { await db.close() }
})
