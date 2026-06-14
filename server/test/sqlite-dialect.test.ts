import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sql } from "kysely";
import { openDatabaseWithHandle } from "../src/db.js";

describe("node sqlite dialect", () => {
  it("runs cte-wrapped writes as writes", async () => {
    const { db } = openDatabaseWithHandle(":memory:");
    try {
      await sql`create table items (id integer primary key, name text not null)`.execute(db);

      const write = await sql`
        with input(name) as (select 'alpha')
        insert into items(name)
        select name from input
      `.execute(db);

      assert.equal(write.numAffectedRows, 1n);

      const read = await sql<{ name: string }>`
        with rows as (select name from items)
        select name from rows
      `.execute(db);

      assert.equal(read.rows.length, 1);
      assert.equal(read.rows[0]?.name, "alpha");
    } finally {
      await db.destroy();
    }
  });

  it("returns rows for writes with returning", async () => {
    const { db } = openDatabaseWithHandle(":memory:");
    try {
      await sql`create table items (id integer primary key, name text not null)`.execute(db);

      const result = await sql<{ name: string }>`
        with input(name) as (select 'beta')
        insert into items(name)
        select name from input
        returning name
      `.execute(db);

      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0]?.name, "beta");
    } finally {
      await db.destroy();
    }
  });
});
