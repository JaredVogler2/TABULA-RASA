import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "../../tests/support/db";
import { LIMITS, opening, openPostgres, type Db, type Limits } from "./db";

/**
 * How this application talks to PostgreSQL, checked at the wire and against a real server.
 *
 * A hosted database is usually reached through a transaction pooler (PgBouncer). A pooler
 * refuses a connection that asks for settings in its first message, and hands every
 * transaction a different server connection, so nothing may depend on what an earlier
 * transaction left behind. The first group of tests reads what is actually sent, with a
 * stand-in for the server that speaks just enough of the protocol; the second runs the limits
 * against a real PostgreSQL where one is given (`TEST_DATABASE_URL`). No pooler has been run
 * here: these tests hold the two properties a pooler needs, not a pooler.
 */

// ───────────────────────── a stand-in server: enough of the protocol to be connected to and asked simple things

interface Stand {
  port: number;
  /** The first message of every connection: the parameters it asked for. */
  startups: Record<string, string>[];
  /** Every statement text received, per connection, in order. */
  asked: string[][];
  close(): Promise<void>;
}

const message = (type: string, body: Buffer): Buffer => {
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
};
const cstring = (s: string): Buffer => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const int16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const int32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};

/** The answer to one simple query: a result for each statement in it, then "ready", in or out of a transaction. */
function answer(sql: string, state: { inTx: boolean }): Buffer {
  const parts: Buffer[] = [];
  for (const statement of sql.split(";").map((t) => t.trim()).filter(Boolean)) {
    const word = (statement.split(/\s+/)[0] ?? "").toUpperCase();
    if (word === "SELECT") {
      // one column called "one", of type int4, holding 1
      parts.push(message("T", Buffer.concat([int16(1), cstring("one"), int32(0), int16(0), int32(23), int16(4), int32(-1), int16(0)])));
      parts.push(message("D", Buffer.concat([int16(1), int32(1), Buffer.from("1")])));
      parts.push(message("C", cstring("SELECT 1")));
    } else {
      if (word === "BEGIN") state.inTx = true;
      if (word === "COMMIT" || word === "ROLLBACK") state.inTx = false;
      parts.push(message("C", cstring(word)));
    }
  }
  parts.push(message("Z", Buffer.from(state.inTx ? "T" : "I")));
  return Buffer.concat(parts);
}

/** `behave` says, for the nth statement text of a connection, whether to answer it or to drop the connection. */
function standIn(behave: (connection: number, nth: number, sql: string) => "answer" | "die" = () => "answer"): Promise<Stand> {
  const startups: Record<string, string>[] = [];
  const asked: string[][] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    const connection = asked.length;
    asked.push([]);
    let buffered = Buffer.alloc(0);
    let started = false;
    const state = { inTx: false };
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        if (!started) {
          if (buffered.length < 8) return;
          const length = buffered.readInt32BE(0);
          if (buffered.length < length) return;
          const fields = buffered.subarray(8, length).toString("utf8").split("\0").filter((f) => f !== "");
          const params: Record<string, string> = {};
          for (let i = 0; i + 1 < fields.length; i += 2) params[fields[i] as string] = fields[i + 1] as string;
          startups.push(params);
          buffered = buffered.subarray(length);
          started = true;
          // "you are in" and "ready"
          socket.write(Buffer.concat([message("R", int32(0)), message("Z", Buffer.from("I"))]));
          continue;
        }
        if (buffered.length < 5) return;
        const type = String.fromCharCode(buffered[0] as number);
        const length = buffered.readInt32BE(1);
        if (buffered.length < length + 1) return;
        const body = buffered.subarray(5, length + 1);
        buffered = buffered.subarray(length + 1);
        if (type === "X") {
          socket.end();
          return;
        }
        if (type !== "Q") continue;
        const sql = body.subarray(0, body.length - 1).toString("utf8");
        const mine = asked[connection] as string[];
        mine.push(sql);
        if (behave(connection, mine.length - 1, sql) === "die") {
          socket.destroy();
          return;
        }
        socket.write(answer(sql, state));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        startups,
        asked,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

/** What a transaction pooler keeps track of in a connection's first message (and so accepts); anything else it refuses. */
const POOLER_ACCEPTS = new Set(["user", "database", "client_encoding", "datestyle", "timezone", "standard_conforming_strings", "application_name"]);

describe("what is sent to the database", () => {
  let stand: Stand | null = null;
  let db: Db | null = null;
  afterEach(async () => {
    await db?.close().catch(() => undefined);
    await stand?.close();
    db = null;
    stand = null;
  });
  const connect = async (behave?: Parameters<typeof standIn>[0], schema?: string): Promise<{ stand: Stand; db: Db }> => {
    stand = await standIn(behave);
    db = await openPostgres(`postgres://someone:secret@127.0.0.1:${stand.port}/things`, 1, schema);
    return { stand, db };
  };

  it("a connection's first message asks for nothing a transaction pooler would refuse: no settings travel in it", async () => {
    const { stand, db } = await connect(undefined, "ledger");
    await db.query("SELECT 1");
    expect(stand.startups).toHaveLength(1);
    const names = Object.keys(stand.startups[0] as Record<string, string>);
    expect(names).toContain("user");
    expect(names).toContain("database");
    for (const name of names) expect(POOLER_ACCEPTS.has(name), `startup parameter "${name}"`).toBe(true);
    expect(names).not.toContain("options");
  });

  it("every transaction opens with its limits and its schema, set for that transaction only", async () => {
    expect(opening(LIMITS, "ledger")).toBe("BEGIN; SET LOCAL statement_timeout = 15000; SET LOCAL lock_timeout = 5000; SET LOCAL idle_in_transaction_session_timeout = 30000; SET LOCAL search_path = ledger");
    expect(opening(LIMITS)).toBe("BEGIN; SET LOCAL statement_timeout = 15000; SET LOCAL lock_timeout = 5000; SET LOCAL idle_in_transaction_session_timeout = 30000");
    // nothing in it outlives the transaction: every SET is LOCAL
    expect(opening(LIMITS, "ledger").match(/\bSET\b(?! LOCAL)/g)).toBeNull();

    const { stand, db } = await connect(undefined, "ledger");
    // a statement on its own is a transaction of one
    expect(await db.query("SELECT 1")).toEqual([{ one: 1 }]);
    await db.tx(async (q) => {
      await q.query("SELECT 1");
      await q.query("SELECT 1");
    });
    expect(stand.asked[0]).toEqual([opening(LIMITS, "ledger"), "SELECT 1", "COMMIT", opening(LIMITS, "ledger"), "SELECT 1", "SELECT 1", "COMMIT"]);
  });

  it("a connection that died while nobody was looking costs nothing: the opening is tried once more on a new one", async () => {
    // the first connection accepts the client and then drops it at its first statement
    const { stand, db } = await connect((connection) => (connection === 0 ? "die" : "answer"));
    expect(await db.query("SELECT 1")).toEqual([{ one: 1 }]);
    expect(stand.asked).toEqual([[opening(LIMITS)], [opening(LIMITS), "SELECT 1", "COMMIT"]]);
  });

  it("and if the second does not open either, the failure is the caller's to see", async () => {
    const { stand, db } = await connect(() => "die");
    await expect(db.query("SELECT 1")).rejects.toThrow();
    expect(stand.asked).toEqual([[opening(LIMITS)], [opening(LIMITS)]]);
  });

  it("nothing after the opening is ever sent twice: a statement that may have run is not repeated", async () => {
    // every connection opens, and drops at the statement after the opening
    const { stand, db } = await connect((_connection, nth) => (nth === 1 ? "die" : "answer"));
    await expect(db.query("SELECT 1")).rejects.toThrow();
    expect(stand.asked).toEqual([[opening(LIMITS), "SELECT 1"]]);
    // the same inside a longer transaction: the work is not started again on another connection
    let ran = 0;
    await expect(
      db.tx(async (q) => {
        ran++;
        await q.query("SELECT 1");
      }),
    ).rejects.toThrow();
    expect(ran).toBe(1);
    expect(stand.asked).toEqual([[opening(LIMITS), "SELECT 1"], [opening(LIMITS), "SELECT 1"]]);
  });

  it("a schema name that could carry SQL is refused before anything is sent", async () => {
    stand = await standIn();
    await expect(openPostgres(`postgres://someone:secret@127.0.0.1:${stand.port}/things`, 1, "a; DROP TABLE budget")).rejects.toThrow("invalid schema name");
    expect(stand.startups).toHaveLength(0);
  });
});

// ───────────────────────── the limits themselves, against a real server

/** One limit short enough to wait for in a test, the others far away, so that it is certain which one acted. */
const only = (limit: Partial<Limits>): Limits => ({ statementMs: 20_000, lockMs: 20_000, idleInTxMs: 20_000, ...limit });
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!TEST_DATABASE_URL)("the limits every transaction runs under (PostgreSQL)", () => {
  const schema = `t_limits_${process.pid}`;
  const opened: Db[] = [];
  const open = async (max: number, limits: Limits): Promise<Db> => {
    const db = await openPostgres(TEST_DATABASE_URL, max, schema, limits);
    opened.push(db);
    return db;
  };
  const admin = async (sql: string): Promise<void> => {
    const db = await openPostgres(TEST_DATABASE_URL, 1);
    try {
      await db.query(sql);
    } finally {
      await db.close();
    }
  };
  afterEach(async () => {
    for (const db of opened.splice(0)) await db.close().catch(() => undefined);
    await admin(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });

  it("are in force for a statement on its own and inside a transaction, in the schema asked for, and are gone when it ends", async () => {
    await admin(`CREATE SCHEMA ${schema}`);
    const db = await open(1, LIMITS);
    const read = "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock, current_setting('idle_in_transaction_session_timeout') AS idle, current_schema() AS schema";
    const expected = { statement: "15s", lock: "5s", idle: "30s", schema };
    expect(await db.query(read)).toEqual([expected]);
    expect(await db.tx((q) => q.query(read))).toEqual([expected]);
    // The pool has one connection, so this is the same server session as before. A table made without naming a
    // schema lands in the one asked for…
    await db.query("CREATE TABLE made_here (id int)");
    expect(await db.query("SELECT table_schema FROM information_schema.tables WHERE table_name = 'made_here'")).toEqual([{ table_schema: schema }]);
    // …and the session itself was never set to anything. Ending the transaction by hand shows the session as
    // it is between transactions; a connection made here, with no settings at all, says what that should be.
    const { default: pg } = await import("pg");
    const plain = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await plain.connect();
    const untouched = (await plain.query(read)).rows as unknown[];
    await plain.end();
    const between = await db.tx(async (q) => {
      await q.query("COMMIT");
      return q.query(read);
    });
    expect(between).toEqual(untouched);
    expect(between).not.toEqual([expected]);
  });

  it("a statement that runs past its limit is cancelled, and the connection goes on working", async () => {
    await admin(`CREATE SCHEMA ${schema}`);
    const db = await open(1, only({ statementMs: 300 }));
    const started = Date.now();
    // 57014: "canceling statement due to statement timeout"
    await expect(db.query("SELECT pg_sleep(5)")).rejects.toMatchObject({ code: "57014" });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await db.query("SELECT 1 AS one")).toEqual([{ one: 1 }]);
  });

  it("a lock that is not given within its limit is not waited for any longer", async () => {
    await admin(`CREATE SCHEMA ${schema}`);
    const db = await open(2, only({ lockMs: 300 }));
    await db.query("CREATE TABLE held (id int PRIMARY KEY, v int)");
    await db.query("INSERT INTO held VALUES (1, 0)");
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    let letGo!: () => void;
    const until = new Promise<void>((resolve) => (letGo = resolve));
    const holder = db.tx(async (q) => {
      await q.query("SELECT v FROM held WHERE id = 1 FOR UPDATE");
      locked();
      await until;
    });
    try {
      await hasLock;
      const started = Date.now();
      // 55P03: "canceling statement due to lock timeout"
      await expect(db.query("UPDATE held SET v = 1 WHERE id = 1")).rejects.toMatchObject({ code: "55P03" });
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      letGo();
      await holder;
    }
    // nothing was written by the statement that gave up, and the row can be written now
    expect(await db.query("SELECT v FROM held WHERE id = 1")).toEqual([{ v: 0 }]);
    await db.query("UPDATE held SET v = 2 WHERE id = 1");
    expect(await db.query("SELECT v FROM held WHERE id = 1")).toEqual([{ v: 2 }]);
  });

  it("a transaction left idle past its limit is ended by the server; its work is undone and its connection is not used again", async () => {
    await admin(`CREATE SCHEMA ${schema}`);
    const db = await open(1, only({ idleInTxMs: 400 }));
    await db.query("CREATE TABLE left_idle (id int)");
    await expect(
      db.tx(async (q) => {
        await q.query("INSERT INTO left_idle VALUES (1)");
        await sleep(1200);
        await q.query("INSERT INTO left_idle VALUES (2)");
      }),
    ).rejects.toThrow();
    // the pool had one connection, and the server closed it: this needs a new one, and finds nothing written
    expect(await db.query("SELECT count(*)::int AS n FROM left_idle")).toEqual([{ n: 0 }]);
  });
});
